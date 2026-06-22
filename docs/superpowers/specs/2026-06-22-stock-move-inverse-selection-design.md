# Inject 批量移仓 · 反选功能设计文档

> 日期: 2026-06-22 · 状态: 待审批

## 目标

在 `Inject` 页面批量移仓 tab 的工具栏新增"反选"按钮，对当前可见物品分组执行反向选择。

## 范围

- 仅影响 `src/inject/StockMovePanel.vue` 中的批量移仓面板
- 反选范围 = 当前搜索筛选后的可见物品分组（与全选一致；注意 `clearSelection` 清空全部选择，反选不沿用其语义）
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
  // Preserve selections hidden by the search filter; toggle only visible groups.
  const hiddenSelected = selectedItemCids.value.filter((cid) => !visibleCids.has(cid));
  const visibleUnselected = [...new Set(
    visibleSourceGroups.value
      .filter((g) => !currentSet.has(g.itemCid))
      .map((g) => g.itemCid),
  )];
  selectedItemCids.value = [...hiddenSelected, ...visibleUnselected];
  submitError.value = '';
  resetSummary();
}
```

逻辑：
- 保留被搜索筛选隐藏的已选分组（不被反选影响）
- 可见分组中已选的取消、未选的选中
- 与 `selectAllItems()` / `clearSelection()` 一致，重置 submit 状态
- 不主动清除 `savedListsError`（与全选/清空保持一致的先例；该错误在用户重新应用已保存列表或切换来源箱时自然消失）

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

`src/shared/messages.js` 新增 key `inject.stockMoveInvert`：

- `zh-CN`: `反选`
- `en`: `Invert Selection`

## 测试

`src/inject/StockMovePanel.test.js` 新增用例：

1. **核心切换** — 部分可见分组已选时，反选将已选的取消、未选的选中
2. **搜索筛选保留** — 搜索筛选隐藏部分已选分组后，反选仅作用于可见分组，保留隐藏的已选
3. **状态重置** — 反选后清除 submitError 和 summary（可合并入上述用例）
4. **边界：空选择** — 无选中项 + 所有可见 → 反选 = 全选
5. **边界：全选** — 全部可见已选 + 无隐藏 → 反选 = 空选择
6. **回归烟雾** — 反选后全选/清空仍正常工作

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/inject/StockMovePanel.vue` | 新增 `invertSelection()` 函数 + 模板按钮 |
| `src/shared/messages.js` | 新增 `inject.stockMoveInvert` i18n key |
| `src/inject/StockMovePanel.test.js` | 新增反选测试用例 |
