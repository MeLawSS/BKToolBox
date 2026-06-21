# Price 上架默认价百分比配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Price 页仓库上架默认单价从“最低价减 10”改成一个保存在 detail panel 中、全页面共享且持久化的百分比配置，并在打开 ListingModal 时按 `floor(minPrice * percent / 100)` 生成默认建议价。

**Architecture:** 保持当前结构不扩散：`App.vue` 持有并持久化页面级百分比配置，`ListingModal.vue` 通过 `defaultPricePercent` prop 使用该值，`listing-form.js` 负责可单测的默认价计算与配置归一化逻辑。UI 只新增 detail panel 配置输入，不改变 `ExchangeItem` 调用链、仓库刷新链和弹窗手动改单价行为。

**Tech Stack:** Vue 3 `<script setup>`、Vitest + `@vue/test-utils`、`window.localStorage`、现有 `window.bidkingDesktop.runAutoOperationCommand(...)` 桥接。

参考规范: `docs/superpowers/specs/2026-06-03-price-listing-default-percentage-design.md`

---

## File Structure

- **Modify** `src/price/listing-form.js` - 将默认价逻辑改为百分比算法，并补一个配置归一化 helper，避免组件各自处理非法值。
- **Modify** `src/price/listing-form.test.js` - 覆盖 `98`、小数、`>100`、下限 `1`、无 `minPrice`、非法百分比回退等纯逻辑行为。
- **Modify** `src/price/ListingModal.vue` - 接收页面级百分比 props，打开时按新公式计算默认价，保留无挂单留空和手动修改能力。
- **Modify** `src/price/ListingModal.test.js` - 断言默认价由百分比决定，而不是旧的 `-10` 规则。
- **Modify** `src/price/App.vue` - 在 detail panel 增加百分比配置输入，负责从 `localStorage` 读取、写入并把值传给 `ListingModal`。
- **Modify** `src/price/App.test.js` - 覆盖默认值、持久化恢复、切换藏品后仍保持全局值、打开弹窗时把该值传给弹窗并影响默认单价。
- **Modify** `src/shared/messages.js` - 新增 detail panel 百分比配置相关文案。
- **Modify** `docs/Documentation.md` - 在功能落地后同步 current-state。

---

### Task 1: 调整默认价纯逻辑并锁定单元测试

**Files:**
- Modify: `src/price/listing-form.js`
- Modify: `src/price/listing-form.test.js`

- [ ] **Step 1: 先把旧规则测试改成新规则**

在 `src/price/listing-form.test.js` 把“最低价减 10”的断言改成百分比断言，并补这些用例：

```js
expect(computeDefaultUnitPrice(1600, 98)).toBe(1568);
expect(computeDefaultUnitPrice(1600, 98.5)).toBe(1576);
expect(computeDefaultUnitPrice(1600, 105)).toBe(1680);
expect(computeDefaultUnitPrice(1, 50)).toBe(1);
expect(computeDefaultUnitPrice(0, 98)).toBeNull();
```

同时新增一个配置归一化测试，约束非法值回退到 `98`：

```js
expect(parseListingDefaultPricePercent(undefined)).toBe(98);
expect(parseListingDefaultPricePercent('98.5')).toBe(98.5);
expect(parseListingDefaultPricePercent('0')).toBe(98);
expect(parseListingDefaultPricePercent('-3')).toBe(98);
expect(parseListingDefaultPricePercent('abc')).toBe(98);
```

- [ ] **Step 2: 运行纯逻辑测试并确认先失败**

Run: `npx vitest run src/price/listing-form.test.js`

Expected: FAIL，失败点体现当前 `computeDefaultUnitPrice` 仍是旧的 `minPrice - 10` 逻辑，且 `parseListingDefaultPricePercent` 尚不存在。

- [ ] **Step 3: 实现最小纯逻辑改动**

在 `src/price/listing-form.js`：

- 把 `computeDefaultUnitPrice` 改成接收 `percent`
- 算法使用 `Math.floor(minPrice * percent / 100)` 并 `Math.max(..., 1)`
- 保留 `minPrice` 不可用时返回 `null`
- 新增 `parseListingDefaultPricePercent(rawValue)`，统一把非法值回退到 `98`

目标实现形态接近：

```js
export function parseListingDefaultPricePercent(rawValue) {
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : 98;
}

export function computeDefaultUnitPrice(minPrice, percent) {
  const min = Number(minPrice);
  if (!Number.isFinite(min) || min <= 0) return null;
  const ratio = parseListingDefaultPricePercent(percent);
  return Math.max(Math.floor(min * ratio / 100), 1);
}
```

- [ ] **Step 4: 重新运行纯逻辑测试**

Run: `npx vitest run src/price/listing-form.test.js`

Expected: PASS，且覆盖默认值、小数、`>100`、空行情与非法配置回退。

---

### Task 2: 在 Price detail panel 增加全局百分比配置

**Files:**
- Modify: `src/price/App.vue`
- Modify: `src/price/App.test.js`
- Modify: `src/shared/messages.js`

- [ ] **Step 1: 先补 App 层行为测试**

在 `src/price/App.test.js` 新增或调整用例，至少覆盖：

```js
window.localStorage.clear();
const wrapper = await mountApp();
await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
expect(wrapper.find('[data-testid="price-listing-default-percent"]').element.value).toBe('98');
```

```js
window.localStorage.setItem('bidking-price-listing-default-percent:v1', '98.5');
const wrapper = await mountApp();
await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
expect(wrapper.find('[data-testid="price-listing-default-percent"]').element.value).toBe('98.5');
```

```js
await wrapper.find('[data-testid="price-listing-default-percent"]').setValue('105');
expect(window.localStorage.getItem('bidking-price-listing-default-percent:v1')).toBe('105');
```

再补一个切换 selected item 后仍保持同一页面级值的断言，避免误做成 per-item 状态。

- [ ] **Step 2: 运行 App 测试并确认先失败**

Run: `npx vitest run src/price/App.test.js`

Expected: FAIL，失败点是 detail panel 里还没有百分比输入，也没有任何 `localStorage` 恢复逻辑。

- [ ] **Step 3: 在 `App.vue` 落地页面级状态与持久化**

在 `src/price/App.vue`：

- 新增常量，例如 `LISTING_DEFAULT_PERCENT_STORAGE_KEY = 'bidking-price-listing-default-percent:v1'`
- 用 `parseListingDefaultPricePercent(window.localStorage.getItem(...))` 初始化一个 `ref`
- 在 detail panel 增加 `type="number"`、`step="any"` 的百分比输入
- 用户修改时立刻更新状态并写回 `localStorage`
- 该输入显示在 selected-item detail panel 中，和当前选中 item 一起出现，但值本身不随 item 改变

实现时避免把持久化逻辑散落到 `ListingModal.vue`，页面级配置应由页面 owner 管理。

- [ ] **Step 4: 补文案**

在 `src/shared/messages.js` 的 `price` 文案块新增类似键：

```js
listingDefaultPercent: '默认上架价(%)',
listingDefaultPercentHint: '用于计算上架弹窗里的默认单价',
```

英文块同步补齐。

- [ ] **Step 5: 重新运行 App 测试**

Run: `npx vitest run src/price/App.test.js`

Expected: PASS，确认默认值、恢复值、修改后持久化、全局共享语义均成立。

---

### Task 3: 让 ListingModal 按页面百分比生成默认单价

**Files:**
- Modify: `src/price/ListingModal.vue`
- Modify: `src/price/ListingModal.test.js`
- Modify: `src/price/App.vue`

- [ ] **Step 1: 先改弹窗测试，明确新默认价行为**

在 `src/price/ListingModal.test.js` 把旧断言：

```js
expect(wrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('1590');
```

改成基于 props 百分比的断言，例如：

```js
const wrapper = await mountModal({ defaultPricePercent: 98 });
expect(wrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('1568');
```

再补两个关键用例：

```js
const decimalWrapper = await mountModal({ defaultPricePercent: 98.5 });
expect(decimalWrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('1576');
```

```js
const highWrapper = await mountModal({ defaultPricePercent: 105 });
expect(highWrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('1680');
```

保留“无挂单时留空”和“手动编辑后正常提交”的现有断言。

- [ ] **Step 2: 运行弹窗测试并确认先失败**

Run: `npx vitest run src/price/ListingModal.test.js`

Expected: FAIL，失败点是 `ListingModal` 仍未接收百分比 props，仍使用旧的 `computeDefaultUnitPrice(minPrice)` 调用方式。

- [ ] **Step 3: 在 `ListingModal.vue` 和 `App.vue` 接通新 props**

在 `src/price/ListingModal.vue`：

- 新增 `defaultPricePercent` prop
- `loadTradeInfo()` 中改为 `computeDefaultUnitPrice(minPrice, props.defaultPricePercent)`
- 只在弹窗初次拿到行情时填充建议值，不影响后续用户手动改价

在 `src/price/App.vue`：

- 挂载 `ListingModal` 时把页面级百分比值透传进去

- [ ] **Step 4: 回归弹窗与页面相关测试**

Run: `npx vitest run src/price/ListingModal.test.js src/price/App.test.js`

Expected: PASS，确认默认价来自百分比配置，且现有上架成功/失败流程未回归。

---

### Task 4: 更新 current-state 文档并做最小验证

**Files:**
- Modify: `docs/Documentation.md`

- [ ] **Step 1: 更新 Price 页面 current-state**

把 `docs/Documentation.md` 中关于 Price 仓库 panel 上架功能的描述，从“默认价 = 当前最低价 - 10”更新为“detail panel 全局百分比配置 + localStorage 持久化 + floor(minPrice * percent / 100)”。

- [ ] **Step 2: 运行本功能最小验证链**

Run: `npx vitest run src/price/listing-form.test.js src/price/ListingModal.test.js src/price/App.test.js`

Expected: PASS

Run: `git diff --check`

Expected: 无输出

- [ ] **Step 3: 按项目习惯提交本轮实现**

```bash
git add src/price/listing-form.js src/price/listing-form.test.js src/price/ListingModal.vue src/price/ListingModal.test.js src/price/App.vue src/price/App.test.js src/shared/messages.js docs/Documentation.md
git commit -m "feat: make price listing default use persistent percent"
```

---

## Self-Review

- 规格覆盖检查:
  - detail panel 内全局配置: Task 2
  - 默认值 `98`: Task 1, Task 2
  - 小数与 `>100`: Task 1, Task 3
  - 默认价公式 `floor(minPrice * percent / 100)` 且下限 `1`: Task 1, Task 3
  - 无可用 `minPrice` / 无挂单保持留空: Task 1, Task 3
  - 弹窗手动改价保留: Task 3
  - `localStorage` 持久化: Task 2
- 占位符扫描:
  - 本计划未使用 `TODO` / `TBD` / “自行处理”等占位描述
- 命名一致性:
  - 统一使用 `defaultPricePercent`、`parseListingDefaultPricePercent`、`bidking-price-listing-default-percent:v1`

Plan complete and saved to `docs/superpowers/plans/2026-06-03-price-listing-default-percentage.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
