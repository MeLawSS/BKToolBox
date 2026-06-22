# Inject 批量移仓 · 应用预设改为合并模式设计文档

> 日期: 2026-06-22 · 状态: 待审批

## 目标

批量移仓面板的"应用"按钮（已保存列表），从**替换选中**改为**合并选中**——应用预设时保留用户已勾选的藏品，将预设列表的 CID 追加到当前选中集合。

## 范围

- 仅修改 `src/inject/StockMovePanel.vue` 中的 `applySavedList()` 函数
- 不改变 UI、i18n、已保存列表存储/加载逻辑

## 非目标

- 不改变"新建列表""保存当前选择""导入当前选择"等其他按钮行为
- 不影响反选、全选、清空等功能

## 实现

`applySavedList()` 第 387 行，改一行：

```js
// 改前
selectedItemCids.value = nextSelection;

// 改后
selectedItemCids.value = [...new Set([...selectedItemCids.value, ...nextSelection])];
```

逻辑：将当前已选 CID 与预设列表 CID 做并集（Set 去重）。

## 边界情况

| 场景 | 行为 |
|------|------|
| 预设列表 CID 全部已选中 | 无变化，不报错 |
| 预设列表 CID 都不在当前来源箱 | 与现在一致：显示"无匹配项"，不改变选中 |
| 预设列表部分已选、部分未选 | 只追加未选部分 |
| 当前无任何选中 | 等价于替换，选中 = 预设列表 |

## 测试

`src/inject/StockMovePanel.test.js` 新增一条：

- 手动勾选部分分组 → 应用已保存列表 → 断言选中 = 原有 ∪ 预设（去重）

## 文件变更

| 文件 | 变更 |
|------|------|
| `src/inject/StockMovePanel.vue` | `applySavedList()` 一行改动 |
| `src/inject/StockMovePanel.test.js` | 新增合并模式测试 |
