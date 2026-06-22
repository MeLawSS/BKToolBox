# Elsa 自动竞拍房间选择 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elsa 自动竞拍面板新增地图下拉框，替代写死的 `roomId: 101`。

**Architecture:** 提取 ROOM_OPTIONS 为共享模块 → `useElsaAutoOperation` 接受 `Ref<string>` → 面板新增下拉框（disabled when running）→ CSS 自包含。

**Tech Stack:** Vue 3 (Composition API), Vitest + @vue/test-utils

## Global Constraints

- roomId 通过 `Ref<string>` 传入，在 `enable()` 时读取，避免捕获过期值
- 运行时（`isEnabled || isBusy`）禁用下拉框
- CSS 自包含在 ElsaAutoOperationPanel scoped style（Elsa 不加载 inject.css）
- data-testid: `elsa-auto-operation-room-select`
- label 复用已有 i18n key `inject.metaOperationRoom`
- 默认选中 `'101'`（快递盲盒堆）

---

### Task 1: 提取 ROOM_OPTIONS 共享模块

**Files:**
- Create: `src/inject/room-options.js`
- Modify: `src/inject/panels/InjectMetaOperationPanel.vue`

**Interfaces:**
- Produces: `ROOM_OPTIONS` — `Array<{ value: string, label: string }>`，8 个地图条目
- Consumes (InjectMetaOperationPanel): `import { ROOM_OPTIONS } from '../room-options.js'`

- [ ] **Step 1: 创建共享模块**

新建 `src/inject/room-options.js`：

```js
export const ROOM_OPTIONS = [
  { value: '101', label: '快递盲盒堆' },
  { value: '102', label: '废弃仓库' },
  { value: '103', label: '航运集装箱' },
  { value: '104', label: '空置别墅' },
  { value: '105', label: '沉船密封仓' },
  { value: '106', label: '隐秘拍卖会' },
  { value: '304', label: '幽静别墅' },
  { value: '305', label: '深海沉船' },
];
```

- [ ] **Step 2: InjectMetaOperationPanel 改为导入**

在 `src/inject/panels/InjectMetaOperationPanel.vue` 中，将第 8-17 行的 `ROOM_OPTIONS` 常量定义删除，替换为导入：

```js
import { ROOM_OPTIONS } from '../room-options.js';
```

- [ ] **Step 3: 运行测试确认无回归**

```bash
npx vitest run src/inject/panels/InjectMetaOperationPanel.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/inject/room-options.js src/inject/panels/InjectMetaOperationPanel.vue
git commit -m "refactor(inject): extract ROOM_OPTIONS to shared module"
```

---

### Task 2: Hook 参数化 + 面板下拉框 + CSS

**Files:**
- Modify: `src/elsa/useElsaAutoOperation.js`
- Modify: `src/elsa/ElsaAutoOperationPanel.vue`

**Interfaces:**
- Consumes: `ROOM_OPTIONS` from `../inject/room-options.js` (Task 1)
- `useElsaAutoOperation({ roomId })` — 新增可选参数 `roomId: Ref<string>`
- `ElsaAutoOperationPanel` — 导入 `ROOM_OPTIONS`，新增 `selectedRoomId` ref，传 ref 给 hook

- [ ] **Step 1: useElsaAutoOperation 接受 roomId Ref**

在 `src/elsa/useElsaAutoOperation.js` 中：

函数签名改为：

```js
export function useElsaAutoOperation({ roomId } = {}) {
```

在 `runScript` 的 `while` 循环内（约第 225 行），将：

```js
const result = await cmd('AutoAuction', { roomId: 101, useExpectedPrice: true });
```

改为：

```js
const effectiveRoomId = Number(roomId?.value) || 101;
const result = await cmd('AutoAuction', { roomId: effectiveRoomId, useExpectedPrice: true });
```

- [ ] **Step 2: ElsaAutoOperationPanel 新增下拉框和样式**

在 `src/elsa/ElsaAutoOperationPanel.vue` 中：

**script 部分：** 新增导入和 ref：

```js
import { ROOM_OPTIONS } from '../inject/room-options.js';
```

在 `const { t } = useI18n();` 之后新增：

```js
const selectedRoomId = ref('101');
```

将 `useElsaAutoOperation()` 调用改为：

```js
const { isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, log } =
  useElsaAutoOperation({ roomId: selectedRoomId });
```

**template 部分：** 将 `<header>` 和 `<button>` 包裹在 controls row 中。替换第 31-63 行（`.elsa-auto-operation-toolbar` 内部）：

```html
      <div class="elsa-auto-operation-toolbar">
        <header class="section-head elsa-auto-operation-head">
          <div class="elsa-auto-operation-copy">
            <h2>{{ t('tools.hero.elsaAutoOperationTitle') }}</h2>
            <p class="elsa-auto-operation-summary">
              {{ t('tools.hero.elsaAutoOperationMonitorLabel') }} · {{ monitorStatus }}
              <span aria-hidden="true"> / </span>
              {{ t('tools.hero.elsaAutoOperationAgentLabel') }} ·
              {{
                agentConnected
                  ? t('tools.hero.elsaAutoOperationAgentConnected')
                  : t('tools.hero.elsaAutoOperationAgentDisconnected')
              }}
            </p>
          </div>
        </header>

        <div class="elsa-auto-operation-controls">
          <label>
            <span>{{ t('inject.metaOperationRoom') }}</span>
            <select
              v-model="selectedRoomId"
              data-testid="elsa-auto-operation-room-select"
              :disabled="isEnabled || isBusy"
            >
              <option v-for="room in ROOM_OPTIONS" :key="room.value" :value="room.value">
                {{ room.label }}
              </option>
            </select>
          </label>

          <button
            class="command-button elsa-auto-operation-toggle"
            :class="{ 'is-enabled': isEnabled, 'is-disabled': !isEnabled }"
            type="button"
            :disabled="isBusy"
            data-testid="elsa-auto-operation-toggle"
            @click="toggle"
          >
            {{
              isBusy
                ? t('tools.hero.elsaAutoOperationBusy')
                : isEnabled
                  ? t('tools.hero.elsaAutoOperationDisable')
                  : t('tools.hero.elsaAutoOperationEnable')
            }}
          </button>
        </div>
      </div>
```

**style 部分：** 在 scoped `<style>` 中追加：

```css
.elsa-auto-operation-controls {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}

.elsa-auto-operation-controls label {
  display: grid;
  gap: 6px;
}

.elsa-auto-operation-controls label span {
  color: var(--muted);
  font-size: 12px;
}

.elsa-auto-operation-controls select {
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  padding: 0 10px;
}
```

- [ ] **Step 3: 运行测试确认无回归**

```bash
npx vitest run src/elsa/ElsaAutoOperationPanel.test.js src/elsa/useElsaAutoOperation.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/elsa/useElsaAutoOperation.js src/elsa/ElsaAutoOperationPanel.vue
git commit -m "feat(elsa): add room select dropdown to auto auction panel"
```

---

### Task 3: 测试

**Files:**
- Modify: `src/elsa/ElsaAutoOperationPanel.test.js`
- Modify: `src/elsa/useElsaAutoOperation.test.js`

**Interfaces:**
- Consumes: `selectedRoomId` ref, `ROOM_OPTIONS` import (Task 2)

- [ ] **Step 1: ElsaAutoOperationPanel.test.js — UI 层测试**

在 panel 测试文件的最后一个 `it(...)` 之后、`});` 之前，插入两条测试：

```js
  it('renders room select dropdown defaulting to 101', async () => {
    const wrapper = mount(ElsaAutoOperationPanel, {
      attachTo: document.body,
      global: { stubs: { TopBar: true } },
    });
    await nextTick();
    const select = wrapper.find('[data-testid="elsa-auto-operation-room-select"]');
    expect(select.exists()).toBe(true);
    expect(select.element.value).toBe('101');
  });

  it('disables room select while auto operation is enabled', async () => {
    isEnabled.value = true;
    await nextTick();
    const wrapper = mount(ElsaAutoOperationPanel, {
      attachTo: document.body,
      global: { stubs: { TopBar: true } },
    });
    await nextTick();
    const select = wrapper.find('[data-testid="elsa-auto-operation-room-select"]');
    expect(select.element.disabled).toBe(true);

    isEnabled.value = false;
    await nextTick();
    expect(select.element.disabled).toBe(false);
  });
```

- [ ] **Step 2: useElsaAutoOperation.test.js — 命令层测试**

在 `useElsaAutoOperation.test.js` 第 606 行（`});` 结束第一个 describe 之前）插入：

```js
  it('passes the configured roomId to AutoAuction', async () => {
    vi.useFakeTimers();
    const resolveAutoAuction = createDeferred();
    const autoAuctionPromise = resolveAutoAuction.promise;

    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand: vi.fn(async (name, args) => {
        if (name === 'AutoAuction') return autoAuctionPromise;
        if (name === 'CancelAutoAuction')
          return Promise.resolve({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 100000 } });
        return Promise.resolve({ ok: true, value: {} });
      }),
      writeDataFile: vi.fn(() => Promise.resolve()),
      showNotification: vi.fn(() => Promise.resolve({ ok: true })),
    };

    // Set up data file with expected price pipe to avoid crash
    const pricePipe = createDeferred();
    window.bidkingDesktop.readDataFile = vi.fn(() => pricePipe.promise);

    const selectedRoomId = ref('102');
    const { result, wrapper } = withSetup(() => useElsaAutoOperation({ roomId: selectedRoomId }));
    try {
      await result.enable();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(4000);
      await flushPromises();

      // The initial expected-price sync call counts as a pipe read; tick once
      // more so the internal price watcher settles and the runScript loop reaches AutoAuction.
      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();

      const autoAuctionIndex = window.bidkingDesktop.runAutoOperationCommand.mock.calls.findIndex(
        ([name]) => name === 'AutoAuction',
      );
      expect(autoAuctionIndex).toBeGreaterThanOrEqual(0);
      expect(window.bidkingDesktop.runAutoOperationCommand.mock.calls[autoAuctionIndex]).toEqual([
        'AutoAuction',
        { roomId: 102, useExpectedPrice: true },
      ]);
    } finally {
      resolveAutoAuction?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 100000 } });
      window.bidkingDesktop.readDataFile = undefined;
      wrapper.unmount();
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 3: 运行全部测试确认通过**

```bash
npx vitest run src/elsa/ElsaAutoOperationPanel.test.js src/elsa/useElsaAutoOperation.test.js src/inject/panels/InjectMetaOperationPanel.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/elsa/ElsaAutoOperationPanel.test.js src/elsa/useElsaAutoOperation.test.js
git commit -m "test(elsa): add room select UI and command payload coverage"
```

---

### Task 4: 验证 & 文档

- [ ] **Step 1: 运行完整测试套件**

```bash
npx vitest run
```

- [ ] **Step 2: 更新 spec 状态**

将 `docs/superpowers/specs/2026-06-22-elsa-auto-auction-room-select-design.md` 第 3 行 `状态: 已审批` 改为 `状态: 已实现`。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-22-elsa-auto-auction-room-select-design.md
git commit -m "docs(spec): mark room select spec as implemented"
```
