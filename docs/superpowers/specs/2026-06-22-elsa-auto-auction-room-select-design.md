# Elsa 自动竞拍 · 支持选择地图设计文档

> 日期: 2026-06-22 · 状态: 待审批

## 目标

Elsa 自动竞拍当前写死 `roomId: 101`（快递盲盒堆）。改为在自动操作面板提供下拉框选择地图，默认快递盲盒堆。

## 范围

- Elsa 自动操作面板新增房间下拉框
- `useElsaAutoOperation` 接受外部传入的 `roomId`，不再写死 `101`
- 复用 `InjectMetaOperationPanel.vue` 已有的 `ROOM_OPTIONS`

## 非目标

- 不改变 InjectMetaOperation 面板已有的房间下拉
- 不影响手动 EnterRoom 等 MetaOperation 命令
- 不改变 AutoAuction C++ 侧逻辑

## 实现

### 1. 导出 ROOM_OPTIONS

`src/inject/panels/InjectMetaOperationPanel.vue` — `ROOM_OPTIONS` 加 `export`：

```js
export const ROOM_OPTIONS = [
  { value: '101', label: '快递盲盒堆' },
  // ... 其余不变
];
```

### 2. useElsaAutoOperation 接受 roomId 参数

`src/elsa/useElsaAutoOperation.js` — 函数签名加 `roomId` 参数，默认 `101`：

```js
export function useElsaAutoOperation({ roomId } = {}) {
  const effectiveRoomId = Number(roomId) || 101;
  // ...
  const result = await cmd('AutoAuction', { roomId: effectiveRoomId, useExpectedPrice: true });
}
```

### 3. ElsaAutoOperationPanel 新增下拉框

`src/elsa/ElsaAutoOperationPanel.vue`：

- 导入 `ROOM_OPTIONS` from `InjectMetaOperationPanel.vue`
- 新增 `selectedRoomId` ref，默认 `'101'`
- 传给 `useElsaAutoOperation({ roomId: selectedRoomId.value })`
- 模板：在开启/关闭按钮上方插入 `<select v-model="selectedRoomId">`，label 复用 `inject.metaOperationRoom`

### 4. 布局

下拉框 + 按钮同排在 `.elsa-auto-operation-toolbar` 内，下拉框在左、按钮在右（或下拉框在上、按钮在下）。

## 测试

`src/elsa/ElsaAutoOperationPanel.test.js` 新增：

- 默认选中快递盲盒堆
- 切换到其他地图后，自动竞拍命令携带对应 roomId

## 文件变更

| 文件 | 变更 |
|------|------|
| `src/inject/panels/InjectMetaOperationPanel.vue` | `ROOM_OPTIONS` 加 `export` |
| `src/elsa/ElsaAutoOperationPanel.vue` | 新增下拉框 + 导入 ROOM_OPTIONS |
| `src/elsa/useElsaAutoOperation.js` | `roomId` 参数化，默认 101 |
| `src/elsa/ElsaAutoOperationPanel.test.js` | 新增房间选择测试 |
