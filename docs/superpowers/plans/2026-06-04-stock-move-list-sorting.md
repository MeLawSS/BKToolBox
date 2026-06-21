# Inject 批量移仓列表排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Inject 页 `Batch Stock Move` 分组列表增加可点击列排序，支持 7 个数据列升序/降序切换，同时保持现有搜索、分组、多选和批量移动行为不变。

**Architecture:** 仅在 `src/inject/StockMovePanel.vue` 增加局部排序状态与排序函数，不改 agent、IPC 或其他页面。测试继续集中在 `src/inject/StockMovePanel.test.js`，通过真实分组渲染断言默认顺序、排序切换、搜索后排序以及勾选保持行为。

**Tech Stack:** Vue 3 `<script setup>`、computed/ref、Vitest + `@vue/test-utils`、现有 Inject 页面样式体系。

参考设计: `docs/superpowers/specs/2026-06-04-stock-move-list-sorting-design.md`

---

## File Structure

- **Modify** `src/inject/StockMovePanel.vue` - 增加排序状态、比较函数、表头交互和方向标记。
- **Modify** `src/inject/StockMovePanel.test.js` - 先写失败测试，锁定默认顺序、升降序切换、搜索后排序和勾选保持。
- **Modify** `docs/Documentation.md` - 同步当前 Inject 批量移仓列表支持列排序。

---

### Task 1: 先锁定 StockMovePanel 排序行为测试

**Files:**
- Modify: `src/inject/StockMovePanel.test.js`

- [ ] **Step 1: 添加失败测试覆盖默认顺序与排序切换**

在 `src/inject/StockMovePanel.test.js` 新增一组最小但真实的组件测试，建议复用 `createSnapshot()` 并扩展为至少 3 个分组，以便能观察顺序变化。

新增测试应至少包含以下断言片段：

```js
const rowCids = wrapper.findAll('tbody tr[data-testid^="stock-move-row-group-"]')
  .map((row) => row.attributes('data-testid').replace('stock-move-row-group-', ''));

expect(rowCids).toEqual(['1032006', '1083009', '1011001']);
```

```js
await wrapper.find('[data-testid="stock-move-sort-count"]').trigger('click');
let sortedCids = wrapper.findAll('tbody tr[data-testid^="stock-move-row-group-"]')
  .map((row) => row.attributes('data-testid').replace('stock-move-row-group-', ''));
expect(sortedCids).toEqual(['1083009', '1032006', '1011001']);

await wrapper.find('[data-testid="stock-move-sort-count"]').trigger('click');
sortedCids = wrapper.findAll('tbody tr[data-testid^="stock-move-row-group-"]')
  .map((row) => row.attributes('data-testid').replace('stock-move-row-group-', ''));
expect(sortedCids).toEqual(['1011001', '1032006', '1083009']);
```

再补两个关键行为：

```js
await wrapper.find('[data-testid="stock-move-search"]').setValue('boot');
await wrapper.find('[data-testid="stock-move-sort-name"]').trigger('click');
expect(wrapper.findAll('tbody tr[data-testid^="stock-move-row-group-"]')).toHaveLength(1);
expect(wrapper.find('[data-testid="stock-move-row-group-1032006"]').exists()).toBe(true);
```

```js
await wrapper.find('[data-testid="stock-move-item-group-1032006"]').setValue(true);
await wrapper.find('[data-testid="stock-move-sort-name"]').trigger('click');
expect(wrapper.find('[data-testid="stock-move-item-group-1032006"]').element.checked).toBe(true);
```

- [ ] **Step 2: 运行组件测试并确认先失败**

Run: `npx vitest run src/inject/StockMovePanel.test.js`

Expected: FAIL，失败点应体现当前不存在 `stock-move-sort-*` 表头控件，且列表顺序无法被点击切换。

- [ ] **Step 3: Commit 测试基线（可选，若团队习惯只在绿态提交则跳过）**

不提交红态代码；保留工作区继续进入最小实现。

---

### Task 2: 在 StockMovePanel 落地单列排序

**Files:**
- Modify: `src/inject/StockMovePanel.vue`

- [ ] **Step 1: 增加排序状态与默认比较函数**

在 `src/inject/StockMovePanel.vue` 中新增局部状态：

```js
const sortKey = ref('boxCount');
const sortDirection = ref('desc');
```

并抽出默认比较与通用比较 helper，要求：

- 默认比较保持 `boxCount DESC -> name ASC -> itemCid ASC`
- 文本列用 `localeCompare`
- 数值列用数值比较
- `size` 主比较值为 `width * height`
- 相等时统一回退到默认比较，避免顺序抖动

- [ ] **Step 2: 在分组结果上应用排序**

把 `sourceGroups` 的尾部从固定 `.sort(...)` 改成统一的排序流程。目标实现形态接近：

```js
return [...groups.values()].sort(compareSourceGroup);
```

其中 `compareSourceGroup(left, right)` 会读取当前 `sortKey` / `sortDirection`，并在未分出高下时回退到默认比较。

- [ ] **Step 3: 增加表头点击交互**

把 7 个数据列表头改成带 `data-testid` 的按钮，例如：

- `stock-move-sort-name`
- `stock-move-sort-quality`
- `stock-move-sort-type`
- `stock-move-sort-itemCid`
- `stock-move-sort-size`
- `stock-move-sort-count`
- `stock-move-sort-boxCount`

切换规则：

- 点击当前激活列: `desc <-> asc`
- 点击非激活列: 切换到该列并默认从 `desc` 开始

- [ ] **Step 4: 显示简洁方向标记**

在表头文本旁显示最小方向提示，例如：

```vue
{{ isActiveSort('count') ? (sortDirection === 'desc' ? '↓' : '↑') : '' }}
```

要求：

- 只在当前激活列显示方向
- 不新增复杂提示文案
- 不破坏现有表格布局

- [ ] **Step 5: 运行组件测试确认变绿**

Run: `npx vitest run src/inject/StockMovePanel.test.js`

Expected: PASS

---

### Task 3: 更新当前状态文档并做最小验证

**Files:**
- Modify: `docs/Documentation.md`

- [ ] **Step 1: 更新 Inject 页面 current-state**

在 `docs/Documentation.md` 中补一条当前行为说明：`Batch Stock Move` 列表现已支持 7 个数据列的单列升序/降序排序，默认顺序仍为按占格数优先。

- [ ] **Step 2: 运行最小验证链**

Run: `npx vitest run src/inject/StockMovePanel.test.js`

Expected: PASS

Run: `git diff --check`

Expected: 无输出

- [ ] **Step 3: 提交本轮实现**

```bash
git add docs/superpowers/specs/2026-06-04-stock-move-list-sorting-design.md docs/superpowers/plans/2026-06-04-stock-move-list-sorting.md src/inject/StockMovePanel.vue src/inject/StockMovePanel.test.js docs/Documentation.md
git commit -m "feat: add sorting to stock move list"
```

---

## Self-Review

- 规格覆盖检查:
  - 7 个数据列均可排序: Task 1 + Task 2
  - 默认顺序不变: Task 1 + Task 2
  - 搜索后排序: Task 1
  - 勾选保持: Task 1
  - 仅改 renderer: Task 2
- 占位符检查:
  - 无占位式标记
  - 每个任务包含明确文件、命令和预期结果
- 类型一致性:
  - 排序 key 在 spec 和 plan 中统一使用 `name / quality / type / itemCid / size / count / boxCount`
