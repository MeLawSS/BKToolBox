# Inject Workspace Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `Inject` 页面从长页面 section 堆叠改造成 `Tools` 风格的左侧导航工作台，并把现有 inject 功能拆成可切换、页内保留状态、离页统一清空的独立 panel。

**Architecture:** 新增 `inject-page-lifecycle` 与 `workspace-shell` 两个共享层，前者负责离开 `Inject` 页时的统一清理事件，后者负责与 `Tools` 对齐的“左侧导航 + 右侧单内容区”布局。`src/inject/App.vue` 收敛为工作台壳层与共享资源装配器，业务逻辑下沉到 `src/inject/panels/` 下的独立组件；`StockMovePanel` 继续直接复用，不重写核心搬运实现。

**Tech Stack:** Vue 3 `<script setup>`、Vite、现有 `window.bidkingDesktop` preload bridge、`@vue/test-utils`、Vitest、现有 `src/shared/messages.js` i18n 体系。

参考设计: `docs/superpowers/specs/2026-06-10-inject-workspace-layout-design.md`

---

## File Structure

- **Create** `src/shared/inject-page-lifecycle.js` - `Inject` 页离开事件、缓存键与统一清理 helper。
- **Create** `src/shared/workspace-shell.css` - 页面无关的工作台壳层样式，供 `Inject` 复用。
- **Create** `src/inject/panels/InjectCabinetRewardPanel.vue` - 柜子奖励 panel。
- **Create** `src/inject/panels/InjectAgentPanel.vue` - Agent 状态 + 高级命令区 panel。
- **Create** `src/inject/panels/InjectWarehousePanel.vue` - 仓库统计 panel。
- **Create** `src/inject/panels/InjectListingPanel.vue` - 上架建议 panel。
- **Create** `src/inject/panels/InjectDelayedPricePanel.vue` - 延迟查价 panel。
- **Create** `src/inject/panels/InjectCollectionScanPanel.vue` - 长期扫描 panel。
- **Modify** `src/shared/TopBar.vue` - 在离开 `/Inject` 时派发 `leave-inject` 事件。
- **Modify** `src/shared/TopBar.test.js` - 覆盖 `leave-inject` 派发行为。
- **Modify** `src/shared/messages.js` - 增加 inject 工作台导航分组与 panel 标题文案。
- **Modify** `src/inject/main.js` - 引入共享 `workspace-shell.css`。
- **Modify** `src/inject/App.vue` - 改为工作台壳层、左侧导航、活动 panel 宿主与共享资源装配。
- **Modify** `src/inject/App.test.js` - 覆盖工作台导航、默认 panel、panel 切换、状态保留、离页清空。
- **Modify** `src/inject/inject.css` - 删除页面级长表单布局依赖，保留 inject 业务样式。
- **Modify** `src/inject/StockMovePanel.vue` - 适配一级 panel 挂载时的容器契约，仅做布局对接。
- **Modify** `src/inject/StockMovePanel.test.js` - 确认一级 panel 宿主下仍可工作。
- **Modify** `docs/Documentation.md` - 记录新的 Inject 工作台行为与验证命令。
- **Modify** `docs/ARCHITECTURE.md` - 记录新的 shared shell / inject panel 结构。

---

### Task 1: 建立 Inject 离页生命周期钩子

**Files:**
- Create: `src/shared/inject-page-lifecycle.js`
- Modify: `src/shared/TopBar.vue`
- Modify: `src/shared/TopBar.test.js`

- [ ] **Step 1: 先写失败测试，锁定 leave-inject 事件行为**

在 `src/shared/TopBar.test.js` 增加测试：

```js
it('dispatches a leave-inject event before navigating away from Inject', async () => {
  const w = mountBar('inject');
  await flushPromises();
  await nextTick();

  const handler = vi.fn();
  window.addEventListener('bidking:leave-inject', handler);

  const priceLink = w.findAll('.nav a').find((link) => link.attributes('href') === '/Price');
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });

  priceLink.element.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(false);
  expect(handler).toHaveBeenCalledTimes(1);

  window.removeEventListener('bidking:leave-inject', handler);
});
```

- [ ] **Step 2: 运行测试确认先失败**

Run: `npx vitest run src/shared/TopBar.test.js`

Expected: FAIL，因为当前 `TopBar.vue` 只会在离开 `tools` 时派发 `bidking:leave-tools`。

- [ ] **Step 3: 写最小实现，新增 inject 生命周期 helper 并接入 TopBar**

创建 `src/shared/inject-page-lifecycle.js`：

```js
export const LEAVE_INJECT_EVENT = 'bidking:leave-inject';

export function dispatchLeaveInjectEvent(target = window) {
  if (!target || typeof target.dispatchEvent !== 'function') return;
  target.dispatchEvent(new CustomEvent(LEAVE_INJECT_EVENT));
}
```

修改 `src/shared/TopBar.vue`：

```js
import { dispatchLeaveInjectEvent } from './inject-page-lifecycle.js';

function handleNavClick(item, event) {
  if (item.page === props.activePage) {
    event.preventDefault();
    return;
  }

  if (props.activePage === 'tools' && item.page !== 'tools' && isPlainPrimaryNavigation(event)) {
    dispatchLeaveToolsEvent();
  }

  if (props.activePage === 'inject' && item.page !== 'inject' && isPlainPrimaryNavigation(event)) {
    dispatchLeaveInjectEvent();
  }
}
```

- [ ] **Step 4: 重新运行测试**

Run: `npx vitest run src/shared/TopBar.test.js`

Expected: PASS

- [ ] **Step 5: 提交本轮**

```bash
git add src/shared/inject-page-lifecycle.js src/shared/TopBar.vue src/shared/TopBar.test.js
git commit -m "feat: add inject leave lifecycle event"
```

---

### Task 2: 搭好 Inject 工作台壳层和左侧导航

**Files:**
- Create: `src/shared/workspace-shell.css`
- Modify: `src/shared/messages.js`
- Modify: `src/inject/main.js`
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`
- Modify: `src/inject/inject.css`

- [ ] **Step 1: 先写失败测试，锁定工作台导航结构**

在 `src/inject/App.test.js` 增加测试：

```js
it('renders grouped inject navigation and shows the default panel only', async () => {
  const wrapper = await mountApp();

  expect(wrapper.find('[data-testid="inject-nav-group-basic"]').text()).toContain('基础');
  expect(wrapper.find('[data-testid="inject-nav-group-trading"]').text()).toContain('交易');
  expect(wrapper.find('[data-testid="inject-tab-cabinet"]').attributes('aria-pressed')).toBe('true');

  expect(wrapper.find('[data-testid="inject-panel-cabinet"]').exists()).toBe(true);
  expect(wrapper.find('[data-testid="inject-panel-agent"]').exists()).toBe(false);
});

it('switches to another inject panel through the workspace nav', async () => {
  const wrapper = await mountApp();

  await wrapper.find('[data-testid="inject-tab-agent"]').trigger('click');
  await nextTick();

  expect(wrapper.find('[data-testid="inject-panel-agent"]').exists()).toBe(true);
  expect(wrapper.find('[data-testid="inject-panel-cabinet"]').isVisible()).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认先失败**

Run: `npx vitest run src/inject/App.test.js`

Expected: FAIL，因为 `Inject` 仍是长页面，没有导航分组、激活 tab 和单内容区。

- [ ] **Step 3: 写最小实现，建立工作台壳层**

创建 `src/shared/workspace-shell.css`，先放通用布局：

```css
.workspace-page {
  width: min(1200px, calc(100vw - 28px));
  margin: 0 auto;
  padding: 22px 0 36px;
}

.workspace-shell {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 16px;
}

.workspace-nav {
  display: grid;
  gap: 12px;
  align-self: start;
}

.workspace-nav-group,
.workspace-panel-host {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.workspace-nav-button {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
}

.workspace-nav-button.is-active {
  background: var(--surface-2);
}
```

在 `src/shared/messages.js` 增加键：

```js
inject: {
  // existing keys...
  navLabel: 'Inject 工作台',
  navGroups: {
    basic: '基础',
    trading: '交易',
  },
  nav: {
    cabinet: '柜子奖励',
    agent: 'Agent 状态',
    warehouse: '仓库统计',
    stockMove: '批量移仓',
    listing: '上架建议',
    delayedPrice: '延迟查价',
    collectionScan: '长期扫描',
  },
}
```

在 `src/inject/main.js` 引入共享壳层：

```js
import '../shared/workspace-shell.css';
import './inject.css';
```

在 `src/inject/App.vue` 建立 panel 元数据与壳层：

```js
const panelTabs = [
  { panelId: 'cabinet', groupKey: 'inject.navGroups.basic', titleKey: 'inject.nav.cabinet', testId: 'cabinet' },
  { panelId: 'agent', groupKey: 'inject.navGroups.basic', titleKey: 'inject.nav.agent', testId: 'agent' },
  { panelId: 'warehouse', groupKey: 'inject.navGroups.trading', titleKey: 'inject.nav.warehouse', testId: 'warehouse' },
  { panelId: 'stockMove', groupKey: 'inject.navGroups.trading', titleKey: 'inject.nav.stockMove', testId: 'stockMove' },
  { panelId: 'listing', groupKey: 'inject.navGroups.trading', titleKey: 'inject.nav.listing', testId: 'listing' },
  { panelId: 'delayedPrice', groupKey: 'inject.navGroups.trading', titleKey: 'inject.nav.delayedPrice', testId: 'delayedPrice' },
  { panelId: 'collectionScan', groupKey: 'inject.navGroups.trading', titleKey: 'inject.nav.collectionScan', testId: 'collectionScan' },
];

const activePanelId = ref(panelTabs[0].panelId);
const renderedPanels = reactive(Object.fromEntries(panelTabs.map((tab, index) => [tab.panelId, index === 0])));

function setActivePanel(panelId) {
  renderedPanels[panelId] = true;
  activePanelId.value = panelId;
}
```

模板先改成：

```vue
<main class="workspace-page">
  <section class="page-head">
    <div>
      <h1>{{ t('inject.title') }}</h1>
      <p>{{ t('inject.subtitle') }}</p>
    </div>
  </section>

  <section class="workspace-shell">
    <aside class="workspace-nav" :aria-label="t('inject.navLabel')">
      <!-- group cards + buttons -->
    </aside>

    <section class="workspace-panel-host">
      <section
        v-if="renderedPanels.cabinet"
        v-show="activePanelId === 'cabinet'"
        class="inject-panel"
        data-testid="inject-panel-cabinet"
      >
        <!-- keep the existing cabinet section markup here for now -->
      </section>

      <section
        v-if="renderedPanels.agent"
        v-show="activePanelId === 'agent'"
        class="inject-panel"
        data-testid="inject-panel-agent"
      >
        <!-- keep the existing agent section markup here for now -->
      </section>

      <!-- repeat the same pattern for warehouse / stockMove / listing / delayedPrice / collectionScan using the current inline section markup -->
    </section>
  </section>
</main>
```

`Task 2` 的目标只是先把“壳层 + 导航 + 单内容区切换”建立起来，所有现有 section 先继续以内联模板挂在工作台壳层里。紧接着由 `Task 3 / Task 4` 把这些 section 替换成独立组件。

同时把 `src/inject/inject.css` 中只属于长页面外壳的 `.page`、`.inject-panel + .inject-panel` 等规则迁到新壳层语义下，保留按钮、表格、表单、结果区等 inject 业务样式。

- [ ] **Step 4: 重新运行测试**

Run: `npx vitest run src/inject/App.test.js`

Expected: PASS

- [ ] **Step 5: 提交本轮**

```bash
git add src/shared/workspace-shell.css src/shared/messages.js src/inject/main.js src/inject/App.vue src/inject/App.test.js src/inject/inject.css
git commit -m "feat: add inject workspace shell"
```

---

### Task 3: 抽出基础类 panel，并把高级命令并入 Agent 状态

**Files:**
- Create: `src/inject/panels/InjectCabinetRewardPanel.vue`
- Create: `src/inject/panels/InjectAgentPanel.vue`
- Create: `src/inject/panels/InjectWarehousePanel.vue`
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`

- [ ] **Step 1: 先写失败测试，锁定 Agent 状态 panel 的合并边界**

在 `src/inject/App.test.js` 增加测试：

```js
it('renders advanced auto-operation commands inside the agent panel', async () => {
  const wrapper = await mountApp();

  await wrapper.find('[data-testid="inject-tab-agent"]').trigger('click');
  await nextTick();

  expect(wrapper.find('[data-testid="auto-op-agent-status"]').exists()).toBe(true);
  expect(wrapper.find('[data-testid="auto-op-command-Ping"]').exists()).toBe(true);
  expect(wrapper.find('[data-testid="auto-op-command-InvokeMethod"]').exists()).toBe(true);
  expect(wrapper.find('[data-testid="warehouse-items-panel"]').exists()).toBe(false);
});

it('renders warehouse counts from its own workspace panel', async () => {
  window.bidkingDesktop = {
    isDesktop: true,
    queryCabinetReward: vi.fn(),
    claimCabinetReward: vi.fn(),
    startAutoOperationAgent: vi.fn(),
    runAutoOperationCommand: vi.fn().mockResolvedValue({
      ok: true,
      value: { items: [{ itemCid: 1011001, count: 2 }] },
    }),
  };
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [{ itemCid: 1011001, name: '数据线', quality: '白', type: '数码电子' }],
  });

  const wrapper = await mountApp();
  await wrapper.find('[data-testid="inject-tab-warehouse"]').trigger('click');
  await nextTick();

  await wrapper.find('[data-testid="warehouse-items-button"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(wrapper.find('[data-testid="warehouse-item-1011001"]').text()).toContain('数据线');
});
```

- [ ] **Step 2: 运行测试确认先失败**

Run: `npx vitest run src/inject/App.test.js`

Expected: FAIL，因为当前结构里 `Agent`、`仓库统计` 仍没有分离成独立 panel。

- [ ] **Step 3: 写最小实现，抽出基础 panel 并把状态迁进去**

创建 `src/inject/panels/InjectCabinetRewardPanel.vue`：

```vue
<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';

const { t } = useI18n();
const loadingAction = ref('');
const result = ref(null);
const errorMessage = ref('');

const canUseCabinetReward = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.queryCabinetReward === 'function' &&
    typeof window.bidkingDesktop?.claimCabinetReward === 'function',
  ),
);
</script>
```

创建 `src/inject/panels/InjectAgentPanel.vue`，把这些内容全部并入一个 panel：

- Agent load / status / pipe
- `OpenPanel / ClosePanel / Ping / GetCurrentUI / GetVisiblePanels / InvokeMethod`
- 原始命令结果区

组件内部直接消费共享 Agent runtime，并持有自己的命令输入/结果状态：

```js
const agent = useAutoOperationAgentSwitch();
const autoOperationInputs = ref({ panelName: '', className: '', methodName: '', arg0: '' });
const autoOperationCommandLoading = ref('');
const autoOperationCommandResult = ref(null);
const autoOperationError = ref('');
```

创建 `src/inject/panels/InjectWarehousePanel.vue`，只承载：

- 取数按钮
- 错误态
- 聚合仓库表格
- `warehouseItems / warehouseLoading / warehouseError / warehouseDisplayItems`

`src/inject/App.vue` 中：

- 删除基础面板的大块内联模板
- 只保留 `loadCollectibles()` 这类跨 panel 共享资源加载
- `CabinetRewardPanel` 与 `AgentPanel` 不再从 `App.vue` 接收业务状态
- `WarehousePanel` 仅接收 `collectibles` 目录数据用于 CID -> 名称映射

- [ ] **Step 4: 重新运行测试**

Run: `npx vitest run src/inject/App.test.js`

Expected: PASS

- [ ] **Step 5: 提交本轮**

```bash
git add src/inject/App.vue src/inject/App.test.js src/inject/panels/InjectCabinetRewardPanel.vue src/inject/panels/InjectAgentPanel.vue src/inject/panels/InjectWarehousePanel.vue
git commit -m "feat: extract inject foundation panels"
```

---

### Task 4: 抽出交易类 panel，并保留 StockMovePanel 作为一级 panel

**Files:**
- Create: `src/inject/panels/InjectListingPanel.vue`
- Create: `src/inject/panels/InjectDelayedPricePanel.vue`
- Create: `src/inject/panels/InjectCollectionScanPanel.vue`
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`
- Modify: `src/inject/StockMovePanel.vue`
- Modify: `src/inject/StockMovePanel.test.js`

- [ ] **Step 1: 先写失败测试，锁定交易 panel 的独立切换行为**

在 `src/inject/App.test.js` 增加测试：

```js
it('keeps stock move as its own top-level workspace panel', async () => {
  const wrapper = await mountApp();

  await wrapper.find('[data-testid="inject-tab-stockMove"]').trigger('click');
  await nextTick();

  expect(wrapper.find('[data-testid="stock-move-panel"]').exists()).toBe(true);
  expect(wrapper.find('[data-testid="exchange-listing-advice"]').exists()).toBe(false);
});

it('renders listing advice from the listing panel only', async () => {
  global.fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => [{ itemCid: 1013002, name: '电动牙刷', quality: '蓝', type: '数码电子' }] })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'list_now', suggestedUnitPrice: 7799, netRevenuePerItem: 7019, expirationRisk: 'low', reason: 'recent gradient supports listing now' }) });

  window.bidkingDesktop = {
    isDesktop: true,
    queryCabinetReward: vi.fn(),
    claimCabinetReward: vi.fn(),
    startAutoOperationAgent: vi.fn(),
    runAutoOperationCommand: vi.fn(),
    confirmHighPriceExchangeListing: vi.fn().mockResolvedValue({ ok: true, value: { result: true } }),
  };

  const wrapper = await mountApp();
  await wrapper.find('[data-testid="inject-tab-listing"]').trigger('click');
  await nextTick();

  await wrapper.find('[data-testid="exchange-item-query"]').setValue('电动牙刷');
  await wrapper.find('[data-testid="exchange-item-candidate-1013002"]').trigger('click');
  await wrapper.find('[data-testid="refresh-listing-advice"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(wrapper.find('[data-testid="exchange-listing-advice"]').text()).toContain('7799');
});
```

- [ ] **Step 2: 运行测试确认先失败**

Run: `npx vitest run src/inject/App.test.js src/inject/StockMovePanel.test.js`

Expected: FAIL，因为 `StockMovePanel` 仍嵌在长页面语境里，listing / delayed / scan 也未抽出独立 panel。

- [ ] **Step 3: 写最小实现，抽出交易 panel 并把状态迁进去**

创建 `src/inject/panels/InjectListingPanel.vue`，负责：

- 搜索/选择藏品
- 输入 count / unit price
- 刷新 listing advice
- 高价上架确认

组件内部直接持有 listing 相关状态与行为，只从 `App.vue` 接收共享 `collectibles`：

```js
defineProps({
  collectibles: {
    type: Array,
    default: () => [],
  },
});

const selectedExchangeItem = ref(null);
const exchangeItemInputs = ref({ query: '', count: '1', unitPrice: '' });
const listingAdvice = ref(null);
const listingAdviceContext = ref(null);
const listingAdviceLoading = ref(false);
const listingAdviceError = ref('');
```

创建 `src/inject/panels/InjectDelayedPricePanel.vue`，负责：

- 搜索/选择藏品
- delay / jitter 输入
- start / refresh / cancel
- 任务状态展示
- 内部持有 `selectedDelayedPriceItem / delayedPriceInputs / delayedPriceTask / delayedPriceError`

创建 `src/inject/panels/InjectCollectionScanPanel.vue`，负责：

- 采集参数输入
- start / stop
- 采集状态展示
- 内部持有 `collectionScanState / collectionScanError / collectionScanLoading / collectionScanInputs`

在 `src/inject/App.vue`：

- 把 listing / delayed / collection scan 的内联模板全部替换成 panel 组件
- `StockMovePanel` 作为 `panelTabs` 中的一级组件继续挂载
- `ListingPanel / DelayedPricePanel / CollectionScanPanel` 只接收共享 `collectibles`
- 把 `StockMovePanel` 上层容器从“内联 section”改为适配 `.workspace-panel-host` 的一级面板，不改搬运核心逻辑

在 `src/inject/StockMovePanel.vue`：

- 保留 `data-testid="stock-move-panel"`
- 去掉对长页面局部栈布局的假设
- 让最外层容器能自然占满右侧 panel host

- [ ] **Step 4: 重新运行测试**

Run: `npx vitest run src/inject/App.test.js src/inject/StockMovePanel.test.js`

Expected: PASS

- [ ] **Step 5: 提交本轮**

```bash
git add src/inject/App.vue src/inject/App.test.js src/inject/StockMovePanel.vue src/inject/StockMovePanel.test.js src/inject/panels/InjectListingPanel.vue src/inject/panels/InjectDelayedPricePanel.vue src/inject/panels/InjectCollectionScanPanel.vue
git commit -m "feat: extract inject trading panels"
```

---

### Task 5: 补状态保留、离页清空和文档验证

**Files:**
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`
- Modify: `docs/Documentation.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: 先写失败测试，锁定“页内保留 / 离页清空”**

在 `src/inject/App.test.js` 增加测试：

```js
it('preserves panel-local state while switching inside Inject', async () => {
  const wrapper = await mountApp();

  await wrapper.find('[data-testid="inject-tab-listing"]').trigger('click');
  await nextTick();
  await wrapper.find('[data-testid="exchange-item-query"]').setValue('琉璃');

  await wrapper.find('[data-testid="inject-tab-cabinet"]').trigger('click');
  await nextTick();
  await wrapper.find('[data-testid="inject-tab-listing"]').trigger('click');
  await nextTick();

  expect(wrapper.find('[data-testid="exchange-item-query"]').element.value).toBe('琉璃');
});

it('clears inject workspace state after the leave-inject event', async () => {
  const wrapper = await mountApp();

  await wrapper.find('[data-testid="inject-tab-listing"]').trigger('click');
  await nextTick();
  await wrapper.find('[data-testid="exchange-item-query"]').setValue('琉璃');

  window.dispatchEvent(new CustomEvent('bidking:leave-inject'));
  await nextTick();

  expect(wrapper.find('[data-testid="inject-tab-cabinet"]').attributes('aria-pressed')).toBe('true');
  expect(wrapper.find('[data-testid="inject-panel-listing"]').exists()).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认先失败**

Run: `npx vitest run src/inject/App.test.js`

Expected: FAIL，因为当前还没有 `leave-inject` 监听与统一清理逻辑。

- [ ] **Step 3: 写最小实现，补工作台状态策略**

在 `src/inject/App.vue` 中：

- 保持 `renderedPanels[panelId] = true`，只在第一次访问时挂载 panel
- 通过 `v-show` 隐藏非当前 panel，保留组件实例
- 监听 `LEAVE_INJECT_EVENT`
- 收到事件时重置：
  - `activePanelId`
  - `renderedPanels`
  - `collectibles`

这样做的关键点是：一旦 `renderedPanels` 恢复为只保留默认 panel，其他 panel 组件会被卸载，其局部输入和结果状态也会随之清空；重新进入 `Inject` 时就是冷启动。

实现草图：

```js
import { LEAVE_INJECT_EVENT } from '../shared/inject-page-lifecycle.js';

function resetWorkspaceState() {
  activePanelId.value = panelTabs[0].panelId;
  panelTabs.forEach((tab, index) => {
    renderedPanels[tab.panelId] = index === 0;
  });
  collectibles.value = [];
}

onMounted(() => {
  window.addEventListener(LEAVE_INJECT_EVENT, resetWorkspaceState);
});

onUnmounted(() => {
  window.removeEventListener(LEAVE_INJECT_EVENT, resetWorkspaceState);
});
```

同步更新 `docs/Documentation.md`：

- 说明 `Inject` 现为工作台布局
- 说明“页内切换保留状态，离开 `Inject` 清空缓存”
- 记录验证命令

同步更新 `docs/ARCHITECTURE.md`：

- 增加 `src/shared/workspace-shell.css`
- 增加 `src/shared/inject-page-lifecycle.js`
- 增加 `src/inject/panels/*.vue`
- 说明 `App.vue` 是工作台壳层而不是业务长页面

- [ ] **Step 4: 跑最小验证链**

Run: `npx vitest run src/shared/TopBar.test.js src/inject/App.test.js src/inject/StockMovePanel.test.js`

Expected: PASS

Run: `npm run build:inject`

Expected: PASS

Run: `git diff --check`

Expected: 无输出

- [ ] **Step 5: 提交本轮**

```bash
git add src/inject/App.vue src/inject/App.test.js docs/Documentation.md docs/ARCHITECTURE.md
git commit -m "feat: finalize inject workspace state handling"
```

---

## Self-Review

- 规格覆盖检查:
  - 左侧导航 + 右侧单内容区: Task 2
  - `基础` / `交易` 分组: Task 2
  - `原始命令 / InvokeMethod` 并入 `Agent 状态`: Task 3
  - `StockMovePanel` 保留一级 panel: Task 4
  - 页内切换保留状态: Task 5
  - 离开 `Inject` 后统一清空: Task 1 + Task 5
  - 不依赖 `elsa.css`: Task 2
  - 文档同步: Task 5
- 待补占位文本检查:
  - 无
- 类型一致性:
  - 统一使用 `panelId`, `renderedPanels`, `LEAVE_INJECT_EVENT`
  - 统一将 `Agent 状态` 视为包含高级命令区的单一 panel
