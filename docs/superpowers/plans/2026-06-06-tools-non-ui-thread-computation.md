# Tools Non-UI-Thread Computation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `Tools` 页下各个 panel 内部会阻塞 UI 的计算全部迁到非 UI 线程，并让长计算通过增量消息实时更新 UI。

**Architecture:** 沿用现有 `Hero Estimator` worker 模式，但按功能边界拆成三条计算通道：`Tools` solver-output worker、扩展后的 `Hero Estimator` worker、以及新的 `Ahmed` computation worker。UI 线程只负责表单、`EventSource` 生命周期、worker 调度和渲染，不再直接做重解析、组合枚举、价格约束校验或高频排序/过滤。

**Tech Stack:** Vue 3、Web Worker、`EventSource` `/run` 流、现有 `src/ethan/estimation-worker*.js` 模式、legacy Ahmed controller、Vitest + @vue/test-utils + happy-dom。

---

## File Structure

- **Create** `src/elsa/tools-run-output-worker-core.js` — `Tools` solver tabs 的纯解析/过滤/排序核心。
- **Create** `src/elsa/tools-run-output-worker.js` — `Tools` solver tabs worker entry。
- **Modify** `src/elsa/App.vue` — 把 solver 输出派生迁到 worker，主线程只保留 `EventSource` 和渲染。
- **Modify** `src/elsa/App.test.js` — 覆盖 solver-output worker 的增量更新、排序、切 tab/cancel。
- **Modify** `src/ethan/estimation-worker-core.js` — 接管 Hero Estimator 流式候选解析、过滤和增量 row 产出。
- **Modify** `src/ethan/estimation-worker.js` — 扩展消息协议，支持流式 append/cancel。
- **Modify** `src/hero-estimator/useHeroEstimatorPanel.js` — renderer 只转发 `/run` chunk、接收 worker row/status。
- **Modify** `src/hero-estimator/HeroEstimatorPanel.test.js` — 覆盖 worker-backed 增量预测、cancel、stale message 丢弃。
- **Create** `src/ahmed/ahmed-compute-core.js` — 从 Ahmed legacy controller 抽出的共享纯计算层。
- **Create** `src/ahmed/ahmed-worker-core.js` — Ahmed worker 的组合枚举/详情扩展核心。
- **Create** `src/ahmed/ahmed-worker.js` — Ahmed worker entry。
- **Modify** `public/ahmed/ahmed.js` — controller 改为 worker orchestrator，不再主线程枚举。
- **Modify** `src/ahmed/App.test.js` — 覆盖 Ahmed worker 驱动的计算和 detail expand。
- **Modify** `docs/Documentation.md` — 记录 `Tools` 三条 worker 通道和 current-state 行为。

---

## Task 1: Tools Solver Tabs 输出派生迁移到 Worker

**Files:**
- Create: `src/elsa/tools-run-output-worker-core.js`
- Create: `src/elsa/tools-run-output-worker.js`
- Modify: `src/elsa/App.vue`
- Test: `src/elsa/App.test.js`

- [ ] **Step 1: 写失败测试，证明 table/text 输出不再在 renderer 同步重算**

```js
it('streams solver table rows through the output worker instead of renderer-side parsing', async () => {
  vi.stubGlobal('Worker', FakeToolsOutputWorker);
  const wrapper = await mountApp();
  await selectTab(wrapper, 3);
  await fillVisibleInputs(wrapper, ['27197.45']);
  await wrapper.find('.action-button').trigger('click');

  expect(FakeToolsOutputWorker.starts).toBe(1);
});
```

- [ ] **Step 2: 跑失败测试，确认当前代码还没有 solver-output worker**

Run: `npx vitest run src/elsa/App.test.js -t "output worker"`

Expected: FAIL because `Worker` is never started for solver tabs and renderer still calls `getTableRows()` / `getFilteredLines()` directly.

- [ ] **Step 3: 新增 solver-output worker core，接管纯派生逻辑**

```js
export function createSolverOutputRunState(config) {
  return {
    runId: config.runId,
    mode: config.resultMode,
    filter: '',
    sort: { key: '', direction: 'asc' },
    lines: [],
    rows: [],
    status: 'waiting',
  };
}
```

- [ ] **Step 4: 新增 worker entry，支持 `start` / `append-source` / `set-filter` / `set-sort` / `cancel`**

```js
self.onmessage = (event) => {
  const { type, runId } = event.data ?? {};
  if (type === 'start') { /* init run state */ }
  if (type === 'append-source') { /* parse incoming chunk and emit row-batch/line-batch */ }
  if (type === 'cancel') { /* drop run state */ }
};
```

- [ ] **Step 5: 改 `src/elsa/App.vue`，让 solver tabs 只转发 `/run` chunk 给 worker**

```js
source.onmessage = (event) => {
  const message = JSON.parse(event.data);
  solverWorkers[index]?.postMessage({
    type: 'append-source',
    runId,
    message,
  });
};
```

- [ ] **Step 6: 把 filter/sort 请求改成发消息给 worker，而不是 render 时 `map/filter/sort`**

```js
worker.postMessage({
  type: 'set-sort',
  runId,
  sort: { key, direction },
});
```

- [ ] **Step 7: 补测试，覆盖增量 row、purple `dedupe-total-cells` 顺序、切 tab cancel**

Run: `npx vitest run src/elsa/App.test.js`

Expected: PASS，新增用例证明 worker 增量回写且 stale run 不污染当前 tab。

- [ ] **Step 8: 提交 Task 1**

```bash
git add src/elsa/App.vue src/elsa/App.test.js src/elsa/tools-run-output-worker-core.js src/elsa/tools-run-output-worker.js
git commit -m "Workerize Tools solver output"
```

---

## Task 2: Hero Estimator 流式候选解析与匹配迁移到 Worker

**Files:**
- Modify: `src/ethan/estimation-worker-core.js`
- Modify: `src/ethan/estimation-worker.js`
- Modify: `src/hero-estimator/useHeroEstimatorPanel.js`
- Test: `src/hero-estimator/HeroEstimatorPanel.test.js`

- [ ] **Step 1: 写失败测试，证明 total-price / price-only 分支会通过 worker 增量回传 row**

```js
it('streams total-price candidate rows through the estimation worker', async () => {
  vi.stubGlobal('Worker', FakeEstimationWorker);
  const wrapper = mount(HeroEstimatorPanel, { props: { profile: elsaProfile, embedded: true } });
  await wrapper.find('#elsa-total-price-orange').setValue('25875');
  await wrapper.find('#elsa-estimate-form').trigger('submit');

  expect(FakeEstimationWorker.starts).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 跑失败测试，确认当前 SSE candidate parsing 仍在 renderer**

Run: `npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js -t "streams total-price candidate rows through the estimation worker"`

Expected: FAIL because `startTotalPriceSearch()` and `startPriceOnlySearch()` still parse chunks in `useHeroEstimatorPanel.js`.

- [ ] **Step 3: 扩展 worker core，加入流式 candidate parser 和 row builder**

```js
export function appendSolverChunk(runState, text) {
  const candidates = parseChunkIntoCandidates(runState, text);
  return candidates.map((candidate) => buildPredictionRowPayload(runState, candidate));
}
```

- [ ] **Step 4: 扩展 worker entry，支持 `start-stream-run` / `append-source` / `cancel`**

```js
if (message.type === 'start-stream-run') {
  runs.set(runId, createStreamRunState(message));
}
```

- [ ] **Step 5: 改 renderer composable，移除主线程 candidate 解析/price-match tag 循环**

```js
worker.postMessage({
  type: 'append-source',
  runId,
  text: String(message.text ?? ''),
});
```

- [ ] **Step 6: 保留现有 monitor/page-state 行为，但所有 row/status 由 worker 消息驱动**

```js
worker.onmessage = (event) => {
  if (event.data.runId !== activeRunId) return;
  if (event.data.type === 'row') tableRows.value = [...tableRows.value, event.data.row];
};
```

- [ ] **Step 7: 补测试，覆盖 incremental row、cancel、clear、stale worker message 丢弃**

Run: `npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js src/ethan/estimator.test.js`

Expected: PASS，现有 Elsa total-price / Ethan worker 用例继续通过，新用例证明流式分支不再在主线程重算。

- [ ] **Step 8: 提交 Task 2**

```bash
git add src/ethan/estimation-worker-core.js src/ethan/estimation-worker.js src/hero-estimator/useHeroEstimatorPanel.js src/hero-estimator/HeroEstimatorPanel.test.js
git commit -m "Workerize hero estimator streaming branches"
```

---

## Task 3: Ahmed 提交计算与详情展开迁移到 Worker

**Files:**
- Create: `src/ahmed/ahmed-compute-core.js`
- Create: `src/ahmed/ahmed-worker-core.js`
- Create: `src/ahmed/ahmed-worker.js`
- Modify: `public/ahmed/ahmed.js`
- Test: `src/ahmed/App.test.js`

- [ ] **Step 1: 写失败测试，证明 Ahmed submit 会启动 worker，并通过 progress/row-batch 更新 UI**

```js
it('runs Ahmed combination search in a worker and renders incremental rows', async () => {
  vi.stubGlobal('Worker', FakeAhmedWorker);
  const wrapper = mountApp();
  await wrapper.find('#total-count').setValue('10');
  await wrapper.find('#avg-wg').setValue('1');
  await wrapper.find('#avg-blue').setValue('2');
  await wrapper.find('#avg-purple').setValue('3');
  await wrapper.find('#avg-orange').setValue('4');
  await wrapper.find('#combo-form').trigger('submit');

  expect(FakeAhmedWorker.starts).toBe(1);
});
```

- [ ] **Step 2: 跑失败测试，确认当前 Ahmed controller 仍同步调用 `calculateCombinationsForController()`**

Run: `npx vitest run src/ahmed/App.test.js -t "runs Ahmed combination search in a worker"`

Expected: FAIL because `public/ahmed/ahmed.js` currently computes directly inside `handleSubmit`.

- [ ] **Step 3: 抽共享纯计算层到 `src/ahmed/ahmed-compute-core.js`**

```js
export {
  calculateCombinations,
  getDetailForRow,
  getExpectedTotal,
  getPossibleCounts,
  matchesPriceConstraints,
  resolveKnownItemsForGroup,
  resolveSelectedItems,
  resolveTotalCells,
} from '../../public/ahmed/ahmed-core.js';
```

- [ ] **Step 4: 新增 Ahmed worker core，支持 `start-run` 和 `open-detail` 两类动作**

```js
export function runAhmedComputation(input, emit) {
  emit({ type: 'progress', stage: 'prepare' });
  // enumerate combinations and emit row-batch
}
```

- [ ] **Step 5: 新增 Ahmed worker entry，并实现 `runId` / `cancel` / stale drop**

```js
self.onmessage = (event) => {
  if (event.data.type === 'cancel') runs.delete(event.data.runId);
};
```

- [ ] **Step 6: 改 `public/ahmed/ahmed.js` 为 thin orchestrator**

```js
const worker = new Worker(new URL('../../src/ahmed/ahmed-worker.js', import.meta.url), { type: 'module' });
worker.postMessage({ type: 'start-run', runId, input });
```

- [ ] **Step 7: 把 result detail 打开逻辑也改为 worker-backed**

```js
worker.postMessage({
  type: 'open-detail',
  runId,
  row,
});
```

- [ ] **Step 8: 补测试，覆盖 progress、row-batch、detail expand、clear/cancel**

Run: `npx vitest run src/ahmed/App.test.js public/ahmed/ahmed-controller.test.mjs`

Expected: PASS，Ahmed 冒烟和 DOM contract 继续成立，同时新增 worker 驱动行为测试。

- [ ] **Step 9: 提交 Task 3**

```bash
git add src/ahmed/ahmed-compute-core.js src/ahmed/ahmed-worker-core.js src/ahmed/ahmed-worker.js public/ahmed/ahmed.js src/ahmed/App.test.js
git commit -m "Workerize Ahmed panel computations"
```

---

## Task 4: Cross-Panel 回归、文档和最终验证

**Files:**
- Modify: `docs/Documentation.md`
- Verify: `src/elsa/App.test.js`
- Verify: `src/hero-estimator/HeroEstimatorPanel.test.js`
- Verify: `src/ahmed/App.test.js`

- [ ] **Step 1: 更新 current-state 文档，记录 Tools 三条 worker 通道**

```md
- `Tools` 当前通过 3 条非 UI 线程计算通道保持页面响应：solver-output worker、Hero Estimator worker、Ahmed worker。
```

- [ ] **Step 2: 跑聚合测试，验证三条链路同时通过**

Run: `npx vitest run src/elsa/App.test.js src/hero-estimator/HeroEstimatorPanel.test.js src/ahmed/App.test.js src/ethan/estimator.test.js`

Expected: PASS

- [ ] **Step 3: 跑页面构建，确认 worker entry 和 legacy Ahmed controller 一起可构建**

Run: `npm run build:pages`

Expected: exit 0

- [ ] **Step 4: 跑补丁格式检查**

Run: `git diff --check`

Expected: no output

- [ ] **Step 5: 提交最终集成**

```bash
git add docs/Documentation.md
git commit -m "Keep Tools computations off the UI thread"
```

---

## Notes

- 实现顺序必须保持 `Tools solver tabs -> Hero Estimator -> Ahmed`，这样每一轮都能独立减小卡顿面。
- `Ahmed` 仍保留 legacy DOM contract；workerization 不能顺手改 DOM id/class。
- 所有 worker 都必须支持 `runId` 和 `cancel`；没有 stale-drop 的 worker 视为未完成。
