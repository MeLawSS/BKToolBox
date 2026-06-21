# Immediate 高风险修复 Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-06-08 全仓审查报告中的 5 个 Immediate fixes，先消除误报成功、静默丢事件、错误恢复旧结果、非法移仓定位和错误的 Windows 图标 patch 目标。

**Architecture:** 这批修复跨 5 个独立子系统，但都可以通过小范围 TDD 逐项落地：`inject/native unload`、`stock move placement`、`hero-estimator restore`、`dumpcap parse acknowledgement`、`dist:win patch target`。每个 task 都只改一个清晰边界内的模块，并配一组最小回归测试，适合独立 subagent 顺序执行和逐 task checkpoint。

**Tech Stack:** Electron main/service CommonJS、Vue 3 + composable、Vitest、Node scripts、C++ IL2CPP AutoOperation Agent。

参考审查：`docs/superpowers/reviews/2026-06-08-full-repo-codereview.md`

---

## File Structure

- **Modify** `electron/services/inject-service.js` — 收紧 `UnloadAgent` 成功判定，只把“管道不可达”当作已卸载，不再把任意 ping 失败当成成功。
- **Modify** `electron/services/inject-service.test.mjs` — 覆盖 `UnloadAgent` 的超时/半死状态回归。
- **Modify** `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` — 卸载取消时恢复 pipe server，而不是留下 loaded-but-unreachable 状态。
- **Modify** `src/inject/stock-move.js` — 用源容器/目标容器坐标计算 shape offsets，禁止横向跨行。
- **Modify** `src/inject/stock-move.test.js` — 增加横向跨行回归测试，并同步 helper 新签名。
- **Modify** `src/inject/StockMovePanel.vue` — 调用新 placement helper 签名。
- **Modify** `src/inject/StockMovePanel.test.js` — 保持批量移仓组件回归覆盖。
- **Modify** `src/hero-estimator/useHeroEstimatorPanel.js` — 只恢复可重放的已计算结果；placeholder 推导结果只保留输入，不恢复结果表格。
- **Modify** `src/hero-estimator/HeroEstimatorPanel.test.js` — 增加 Elsa placeholder 结果在 remount 后不应被恢复的回归。
- **Modify** `lib/bidking-live-monitor.js` — 仅在 parse 成功后标记 dumpcap ring 文件为已消费。
- **Modify** `lib/bidking-live-monitor.test.mjs` — 增加 transient parse failure 后可重试同一 ring file 的回归。
- **Modify** `scripts/patch-win-icons.js` — 当输入是 `dist/` 时优先解析顶层打包产物 exe，再回退到 `win-unpacked/BKToolBox.exe`。
- **Modify** `scripts/pack-win-dir.test.mjs` — 覆盖 `dist` 根目录存在 portable exe 时的 target 选择。

---

### Task 1: 修复 `UnloadAgent` 半死成功路径

**Files:**
- Modify: `electron/services/inject-service.js`
- Modify: `electron/services/inject-service.test.mjs`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`

- [ ] **Step 1: 先写 service 层失败测试**

在 `electron/services/inject-service.test.mjs` 的 `UnloadAgent` 用例附近新增一个“`ping timed out` 不能被当成已卸载”的回归：

```js
it('does not treat ping timeout as proof that UnloadAgent finished', async () => {
  const sendAutoOperationCommand = vi.fn()
    .mockResolvedValueOnce({
      id: '7',
      ok: true,
      result: { unloading: true, delayMs: 200 },
    })
    .mockRejectedValue(new Error('ping timed out'));

  await expect(service.runAutoOperationCommand('UnloadAgent', { delayMs: 200 }, {
    sendAutoOperationCommand,
    unloadPollIntervalMs: 1,
    unloadTimeoutMs: 10,
    unloadGraceMs: 0,
  })).rejects.toThrow('AutoOperation Agent did not unload before timeout');
});
```

- [ ] **Step 2: 跑测试确认现在会失败**

Run: `npx vitest run electron/services/inject-service.test.mjs`
Expected: FAIL，当前实现会把任意 `Ping` 失败都视为已卸载，新增用例会拿到成功结果而不是抛错。

- [ ] **Step 3: 修改 JS 卸载判定，只接受“管道不可达”错误**

在 `electron/services/inject-service.js` 里新增一个只识别“agent 已经不可连接”的 helper，并让 `waitForAutoOperationAgentToUnload()` 只在这类错误上返回成功：

```js
function isAutoOperationAgentUnavailableError(error) {
  const message = String(error?.message || error).toLowerCase();
  return message.includes('enoent') ||
    message.includes('cannot find the file') ||
    message.includes('connect econnrefused') ||
    (message.includes('pipe') && message.includes('not found'));
}

async function waitForAutoOperationAgentToUnload(deps = {}) {
  const timeoutMs = clampSafeInteger(deps.unloadTimeoutMs, 0, 60000, 10000);
  const pollIntervalMs = clampSafeInteger(deps.unloadPollIntervalMs, 1, 5000, 100);
  const graceMs = clampSafeInteger(deps.unloadGraceMs, 0, 5000, 500);
  const pingTimeoutMs = clampSafeInteger(deps.unloadPingTimeoutMs, 1, 5000, 500);
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() <= deadline) {
    try {
      await pingAutoOperationAgent({
        ...deps,
        timeoutMs: pingTimeoutMs,
      });
    } catch (error) {
      if (isAutoOperationAgentUnavailableError(error)) {
        if (graceMs > 0) await delay(graceMs);
        return;
      }
      lastError = error;
    }
    await delay(pollIntervalMs);
  }

  throw lastError || new Error('AutoOperation Agent did not unload before timeout');
}
```

- [ ] **Step 4: 修改 native 卸载取消路径，恢复 pipe server**

在 `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` 的 `UnloadThread()` 里，当 `activeHandlers > 0` 时不要留下“已关闭 pipe 但 DLL 仍在”的状态。把 `g_shuttingDown` 和 `g_unloadScheduled` 复位，并重新拉起 `AgentMain`：

```cpp
if (activeHandlers > 0) {
    Logf("Unload canceled: %ld connection handler(s) still active", activeHandlers);
    InterlockedExchange(&g_shuttingDown, 0);
    InterlockedExchange(&g_unloadScheduled, 0);
    if (!g_agentThread || WaitForSingleObject(g_agentThread, 0) == WAIT_OBJECT_0) {
        g_agentThread = CreateThread(NULL, 0, AgentMain, NULL, 0, NULL);
    }
    return 0;
}
```

约束：

- 只在“卸载被取消”分支重启 `AgentMain`
- 不要改动 `CmdUnloadAgent()` 已经对外返回的 JSON 结构
- 不要把 `ping timed out` 这种“未知状态”吞成成功

- [ ] **Step 5: 跑目标测试确认通过**

Run: `npx vitest run electron/services/inject-service.test.mjs`
Expected: PASS，包括：

- 原有 `UnloadAgent` 成功路径仍通过
- 新增 `ping timed out` 回归不再误报成功

- [ ] **Step 6: Commit**

```bash
git add electron/services/inject-service.js electron/services/inject-service.test.mjs tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp
git commit -m "fix: harden autooperation unload confirmation"
```

---

### Task 2: 修复批量移仓横向跨行定位

**Files:**
- Modify: `src/inject/stock-move.js`
- Modify: `src/inject/stock-move.test.js`
- Modify: `src/inject/StockMovePanel.vue`
- Modify: `src/inject/StockMovePanel.test.js`

- [ ] **Step 1: 先写纯函数失败测试**

在 `src/inject/stock-move.test.js` 的 `findFirstPlacement` 组内新增横向跨行回归：

```js
it('skips row-wrapping anchors for horizontal shapes', () => {
  const target = {
    stockId: 2,
    width: 3,
    cells: [
      { boxId: 0, x: 0, y: 0 },
      { boxId: 1, x: 1, y: 0 },
      { boxId: 2, x: 2, y: 0 },
      { boxId: 3, x: 0, y: 1 },
      { boxId: 4, x: 1, y: 1 },
      { boxId: 5, x: 2, y: 1 },
    ],
    items: [
      { itemUid: 'occupied-a', boxIds: [0] },
      { itemUid: 'occupied-b', boxIds: [1] },
    ],
  };

  const placement = findFirstPlacement(target, { width: 3 }, {
    pos: 0,
    boxIds: [0, 1],
  });

  expect(placement).toEqual({ newSlot: 3, boxIds: [3, 4] });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/inject/stock-move.test.js`
Expected: FAIL，当前实现会返回 `{ newSlot: 2, boxIds: [2, 3] }`。

- [ ] **Step 3: 用源容器坐标归一化 shape offsets**

把 `src/inject/stock-move.js` 中的 helper 改成显式接收源容器宽度，并基于源/目标坐标而不是 `boxId delta` 计算：

```js
function getShapeOffsets(sourceContainer, item) {
  const width = Number(sourceContainer?.width);
  const baseSlot = Number(item?.pos);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(baseSlot)) return [];

  const baseX = baseSlot % width;
  const baseY = Math.floor(baseSlot / width);
  return (item?.boxIds || []).map((boxId) => ({
    dx: (boxId % width) - baseX,
    dy: Math.floor(boxId / width) - baseY,
  }));
}

export function findFirstPlacement(targetContainer, sourceContainer, item) {
  const offsets = getShapeOffsets(sourceContainer, item);
  const occupied = toOccupiedSet(targetContainer?.items);
  const cellsByCoord = new Map((targetContainer?.cells || []).map((cell) => [
    `${cell.x},${cell.y}`,
    cell.boxId,
  ]));

  const anchors = [...(targetContainer?.cells || [])].sort((left, right) => {
    if (left.y !== right.y) return left.y - right.y;
    return left.x - right.x;
  });

  for (const anchor of anchors) {
    const boxIds = [];
    let fits = true;
    for (const offset of offsets) {
      const key = `${anchor.x + offset.dx},${anchor.y + offset.dy}`;
      const boxId = cellsByCoord.get(key);
      if (!Number.isInteger(boxId) || occupied.has(boxId)) {
        fits = false;
        break;
      }
      boxIds.push(boxId);
    }
    if (fits) return { newSlot: anchor.boxId, boxIds };
  }

  return null;
}
```

- [ ] **Step 4: 更新调用点到新签名**

在 `src/inject/StockMovePanel.vue` 把：

```js
const placement = findFirstPlacement(liveTarget, liveItem);
```

改成：

```js
const placement = findFirstPlacement(liveTarget, liveSource, liveItem);
```

- [ ] **Step 5: 跑移仓相关测试确认通过**

Run: `npx vitest run src/inject/stock-move.test.js src/inject/StockMovePanel.test.js`
Expected: PASS，原有批量移仓回归保持通过，新增横向跨行用例通过。

- [ ] **Step 6: Commit**

```bash
git add src/inject/stock-move.js src/inject/stock-move.test.js src/inject/StockMovePanel.vue src/inject/StockMovePanel.test.js
git commit -m "fix: prevent wrapped stock move placements"
```

---

### Task 3: 禁止恢复 placeholder 推导出的 Elsa/Ethan 旧结果

**Files:**
- Modify: `src/hero-estimator/useHeroEstimatorPanel.js`
- Modify: `src/hero-estimator/HeroEstimatorPanel.test.js`

- [ ] **Step 1: 先写 remount 失败测试**

在 `src/hero-estimator/HeroEstimatorPanel.test.js` 新增一个 Elsa reload 回归，确认“monitor placeholder + 手填总价”算出的旧结果不会在 remount 后直接恢复：

```js
it('does not restore placeholder-derived Elsa results after remount without fresh monitor context', async () => {
  vi.stubGlobal('Worker', FakeEstimationWorker);

  const first = mount(HeroEstimatorPanel, {
    props: { profile: elsaProfile, embedded: true },
    attachTo: document.body,
  });
  mountedWrappers.push(first);
  await flushPromises();
  await nextTick();

  const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');
  monitorSource.emitEvent('event', {
    key: 'elsa-reload-hero',
    gameUid: 'game-1',
    group: 'hero',
    skill: {
      uid: 'elsa-reload-hero-skill',
      heroCid: 103,
      skillCid: 1001034,
      hitBoxList: [{ boxId: 0, itemSlotType: 11, itemQuility: 4, itemQuilityName: '紫' }],
    },
  });
  monitorSource.emitEvent('event', {
    key: 'elsa-reload-map',
    gameUid: 'game-1',
    group: 'map',
    skill: {
      uid: 'elsa-reload-map-skill',
      skillCid: 200011,
      totalHitBoxIndex: 6,
    },
  });
  await nextTick();

  await first.find('#elsa-total-price-orange').setValue('25875');
  await first.find('#elsa-estimate-form').trigger('submit');
  await settleWorkerStream();

  getLatestRunSource()?.onmessage?.({
    data: JSON.stringify({
      type: 'out',
      text: 'Count=1, TotalPrice=25875\\n  TotalCells=6, TotalPrice=25875, Count=1: [候选A]\\n',
    }),
  });
  getLatestRunSource()?.onmessage?.({
    data: JSON.stringify({ type: 'done', code: 0 }),
  });
  await settleWorkerStream();

  expect(first.findAll('#elsa-result-body tr')).toHaveLength(1);
  first.unmount();

  const second = mount(HeroEstimatorPanel, {
    props: { profile: elsaProfile, embedded: true },
    attachTo: document.body,
  });
  mountedWrappers.push(second);
  await flushPromises();
  await nextTick();

  expect(second.find('#elsa-total-price-orange').element.value).toBe('25875');
  expect(second.findAll('#elsa-result-body tr')).toHaveLength(0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js`
Expected: FAIL，当前实现会把 `rows/summary/meta` 从 localStorage 恢复回来。

- [ ] **Step 3: 只持久化“可重放”的已计算结果**

在 `src/hero-estimator/useHeroEstimatorPanel.js` 里把存储结构从“总是写 `rows/summary/meta`”改成“只有 `hasCalculated && !hasMonitorPlaceholderInputs()` 才写 result 快照”：

```js
function saveState() {
  if (isRestoring.value || isDiscardingPageState) return;

  const canRestoreResult = hasCalculated.value && !hasMonitorPlaceholderInputs();
  const savedResult = canRestoreResult
    ? {
        lastState: lastState.value,
        rows: tableRows.value,
        summary: { ...summary },
        meta: {
          text: metaText.value,
          status: metaStatus.value,
        },
        monitorAuto: {
          gameUid: activeMonitorGameUid,
        },
      }
    : null;

  window.localStorage.setItem(profile.storageKey, JSON.stringify({
    inputs: {
      global: { ...globalInputs },
      groups: Object.fromEntries(groups.map((group) => [
        group.key,
        { ...groupInputs[group.key] },
      ])),
    },
    hasCalculated: canRestoreResult,
    result: savedResult,
    savedAt: new Date().toISOString(),
  }));
}
```

- [ ] **Step 4: restore 时没有 `result` 就清空结果区**

在 `restoreState()` 里按 `saved.result` 恢复；没有结果快照时，保留输入值，但不要恢复 `rows/summary/meta`：

```js
function restoreState() {
  const saved = loadSavedState();
  if (!saved) return false;

  isRestoring.value = true;
  try {
    if (saved.inputs) {
      Object.assign(globalInputs, saved.inputs.global ?? {});
      for (const group of groups) {
        Object.assign(groupInputs[group.key], saved.inputs.groups?.[group.key] ?? {});
      }
    }

    const savedResult = saved.result ?? null;
    hasCalculated.value = Boolean(saved.hasCalculated && savedResult);
    lastState.value = savedResult?.lastState ?? null;
    tableRows.value = Array.isArray(savedResult?.rows) ? savedResult.rows : [];
    Object.assign(summary, savedResult?.summary ?? { total: null, low: null, high: null });
    metaText.value = savedResult?.meta?.text ?? t(heroKey('meta.waitingInput'));
    metaStatus.value = savedResult?.meta?.status ?? '';
    activeMonitorGameUid = savedResult?.monitorAuto?.gameUid ? String(savedResult.monitorAuto.gameUid) : null;
  } finally {
    isRestoring.value = false;
  }

  return true;
}
```

- [ ] **Step 5: 跑 hero-estimator 测试确认通过**

Run: `npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js src/elsa/ElsaHeroPanel.test.js`
Expected: PASS，新增 remount 回归通过，现有 Elsa 面板包装测试继续通过。

- [ ] **Step 6: Commit**

```bash
git add src/hero-estimator/useHeroEstimatorPanel.js src/hero-estimator/HeroEstimatorPanel.test.js
git commit -m "fix: stop restoring placeholder-driven hero estimates"
```

---

### Task 4: dumpcap ring 文件只在 parse 成功后才标记为已消费

**Files:**
- Modify: `lib/bidking-live-monitor.js`
- Modify: `lib/bidking-live-monitor.test.mjs`

- [ ] **Step 1: 先写 transient parse failure 回归**

在 `lib/bidking-live-monitor.test.mjs` 新增一个直接覆盖 `parseDumpcapCaptures()` 的测试：

```js
it('retries a dumpcap ring file after a transient parse failure', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
  const capturePath = path.join(outputDir, 'tcp-live.pcapng');
  const ringPath = path.join(outputDir, 'tcp-live_00001.pcapng');
  const eventsPath = ringPath.replace(/\.pcapng$/i, '.events.json');

  await writeFile(ringPath, 'pcap');
  await writeFile(eventsPath, '[]', 'utf8');

  const monitor = new BidKingLiveMonitor({
    execFileAsync: vi.fn(),
    sleep: async () => {},
    runtimeRoot: outputDir,
    outputDir,
  });

  const parseCaptureFile = vi.fn()
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce(undefined);
  monitor.parseCaptureFile = parseCaptureFile;
  monitor.handleParsedEvent = vi.fn(() => 0);

  await expect(
    monitor.parseDumpcapCaptures({ outputDir }, capturePath, { includeNewest: true })
  ).rejects.toThrow('boom');

  await expect(
    monitor.parseDumpcapCaptures({ outputDir }, capturePath, { includeNewest: true })
  ).resolves.toEqual({ parsedEvents: 0, newEvents: 0 });

  expect(parseCaptureFile).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run lib/bidking-live-monitor.test.mjs`
Expected: FAIL，第二次调用不会重试同一个 ring file。

- [ ] **Step 3: 把 `parsedDumpcapFiles.add()` 移到 parse 成功之后**

在 `lib/bidking-live-monitor.js` 的 `parseDumpcapCaptures()` 中，把“标记已消费”移到 `parseCaptureFile()` 和事件读取完成之后：

```js
for (const pcapPath of candidates) {
  if (this.parsedDumpcapFiles.has(pcapPath)) continue;
  lastFile = pcapPath;
  const eventsPath = pcapPath.replace(/\.pcapng$/i, '.events.json');
  await this.parseCaptureFile(options, pcapPath, eventsPath);
  const events = sortEventsForProcessing(readEventsFile(eventsPath));
  this.parsedDumpcapFiles.add(pcapPath);
  parsedEvents += events.length;
  for (const event of events) {
    newEvents += this.handleParsedEvent(event);
  }
}
```

约束：

- parse 失败时不要写入 `parsedDumpcapFiles`
- parse 成功但事件数组为空时，仍然要记为已消费，避免空文件无限重试

- [ ] **Step 4: 跑 monitor 测试确认通过**

Run: `npx vitest run lib/bidking-live-monitor.test.mjs`
Expected: PASS，新增 transient failure 回归通过，现有 dumpcap/pktmon 测试保持通过。

- [ ] **Step 5: Commit**

```bash
git add lib/bidking-live-monitor.js lib/bidking-live-monitor.test.mjs
git commit -m "fix: retry dumpcap files after transient parse failures"
```

---

### Task 5: 修正 `dist:win` 的图标 patch 目标解析

**Files:**
- Modify: `scripts/patch-win-icons.js`
- Modify: `scripts/pack-win-dir.test.mjs`

- [ ] **Step 1: 先写 `dist/` 根目录优先顶层 exe 的失败测试**

在 `scripts/pack-win-dir.test.mjs` 增加一个 temp dir 用例，确保输入 `dist/` 时优先返回顶层打包产物，再回退到 `win-unpacked`：

```js
import os from 'node:os';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

it('prefers packaged executables in the dist root before win-unpacked', async () => {
  const distDir = await mkdtemp(path.join(os.tmpdir(), 'bk-dist-'));
  await mkdir(path.join(distDir, 'win-unpacked'), { recursive: true });
  await writeFile(path.join(distDir, 'BKToolBox Portable.exe'), '');
  await writeFile(path.join(distDir, 'win-unpacked', 'BKToolBox.exe'), '');

  try {
    expect(resolveExecutableTargets(distDir)).toEqual([
      path.join(distDir, 'BKToolBox Portable.exe'),
      path.join(distDir, 'win-unpacked', 'BKToolBox.exe'),
    ]);
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`
Expected: FAIL，当前 `resolveExecutableTargets()` 只会返回 `win-unpacked/BKToolBox.exe`。

- [ ] **Step 3: 让 `resolveExecutableTargets()` 扫描 `dist/` 顶层 exe**

在 `scripts/patch-win-icons.js` 中保留“直接 app dir 输入”逻辑，但对 `dist/` 根目录改成：

```js
function resolveExecutableTargets(inputDir) {
  const resolved = path.resolve(inputDir);
  if (path.basename(resolved).toLowerCase() !== 'dist') {
    return [
      path.join(resolved, 'BKToolBox.exe'),
    ];
  }

  const topLevelExecutables = fs.readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => path.join(resolved, entry.name));

  return [
    ...topLevelExecutables,
    path.join(resolved, 'win-unpacked', 'BKToolBox.exe'),
  ];
}
```

约束：

- 不要对 `dist/BKToolBox-dev` 这种 direct app dir 输入改语义
- 顶层 exe 的顺序必须在 `win-unpacked` 之前
- `main()` 里现有的 `fs.existsSync()` 过滤逻辑保留

- [ ] **Step 4: 跑 packaging 相关测试确认通过**

Run: `npx vitest run scripts/pack-win-dir.test.mjs scripts/deploy-unpacked-app.test.mjs scripts/prepare-dumpcap-runtime.test.mjs scripts/windows-build-metadata.test.mjs`
Expected: PASS，新增 `dist/` 目标解析用例通过，其他 packaging 回归不受影响。

- [ ] **Step 5: Commit**

```bash
git add scripts/patch-win-icons.js scripts/pack-win-dir.test.mjs
git commit -m "fix: prefer packaged dist executables for icon patching"
```

---

## Verification Sweep

在五个 task 全部完成后，再跑一次跨模块最小验证，避免“单 task 通过，但组合后回归”：

- [ ] **Step 1: 运行最终目标测试切片**

Run:

```bash
npx vitest run \
  electron/services/inject-service.test.mjs \
  src/inject/stock-move.test.js \
  src/inject/StockMovePanel.test.js \
  src/hero-estimator/HeroEstimatorPanel.test.js \
  src/elsa/ElsaHeroPanel.test.js \
  lib/bidking-live-monitor.test.mjs \
  scripts/pack-win-dir.test.mjs \
  scripts/deploy-unpacked-app.test.mjs \
  scripts/prepare-dumpcap-runtime.test.mjs \
  scripts/windows-build-metadata.test.mjs
```

Expected: PASS

- [ ] **Step 2: 跑格式与工作区检查**

Run:

```bash
git diff --check
git status --short
```

Expected:

- `git diff --check` 无输出
- `git status --short` 为空

- [ ] **Step 3: 如需汇总收尾，补一条总结 commit 或保持最后一个 task commit 为收尾点**

如果最后一个 task commit 已经是完整收尾点，则不要额外制造“空总结 commit”。

---

Plan complete and saved to `docs/superpowers/plans/2026-06-08-immediate-high-risk-remediation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 我为每个 task 派发 fresh subagent，逐 task review + checkpoint，最适合这批跨模块修复。

**2. Inline Execution** - 在当前 session 里按本计划逐 task 执行，适合连续小步实现。
