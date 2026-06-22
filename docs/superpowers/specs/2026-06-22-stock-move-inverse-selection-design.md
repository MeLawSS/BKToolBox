# Inject 批量移仓 · 反选功能设计文档

> 日期: 2026-06-22 · 状态: 待审批

## 目标

在 `Inject` 页面批量移仓 tab 的工具栏新增"反选"按钮，对当前可见物品分组执行反向选择。

## 范围

- 仅影响 `src/inject/StockMovePanel.vue` 中的批量移仓面板
- 反选范围 = 当前搜索筛选后的可见物品分组（与全选/清空保持一致）
- 不改变已保存列表、批量移动执行等既有逻辑

## 非目标

- 不改变全选/清空按钮的行为
- 不增加右键菜单或其他交互入口
- 不影响其他 tab 或面板

## 方案

采用 **方案 A：新增"反选"按钮**。

在工具栏全选/清空按钮旁增加一个按钮，点击后调用 `invertSelection()` 函数。

## 实现要点

### 1. 反选函数 `invertSelection()`

```js
function invertSelection() {
  const visibleCids = new Set(visibleSourceGroups.value.map((g) => g.itemCid));
  const currentSet = new Set(selectedItemCids.value);
  selectedItemCids.value = [
    ...visibleSourceGroups.value
      .filter((g) => !currentSet.has(g.itemCid))
      .map((g) => g.itemCid),
  ];
}
```

逻辑：遍历可见分组，将不在当前选中集合中的 itemCid 收集为新选中数组。

### 2. 模板按钮

在全选/清空按钮组的末尾插入：

```html
<button
  class="command-button stock-move-secondary-button stock-move-secondary-button--compact"
  type="button"
  data-testid="stock-move-invert"
  :disabled="!visibleSourceGroups.length"
  @click="invertSelection"
>
  {{ t('inject.stockMoveInvert') }}
</button>
```

`disabled` 条件与全选一致：可见分组为空时禁用。

### 3. i18n

`src/shared/messages.js` 新增 key `inject.stockMoveInvert`，中文值为 `反选`。

## 测试

`src/inject/StockMovePanel.test.js` 补至少两条用例：

- 反选将已选项取消、未选项选中
- 搜索筛选后反选仅作用于可见分组

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/inject/StockMovePanel.vue` | 新增 `invertSelection()` 函数 + 模板按钮 |
| `src/shared/messages.js` | 新增 `inject.stockMoveInvert` i18n key |
| `src/inject/StockMovePanel.test.js` | 新增反选测试用例 |
