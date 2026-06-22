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

### 2. useElsaAutoOperation 接受 roomId Ref

`src/elsa/useElsaAutoOperation.js` — 接受 `Ref<string>`，在 `enable()` 时读取 `.value`（非顶层解包，避免捕获过期值）：

```js
export function useElsaAutoOperation({ roomId } = {}) {
  // roomId 是 Ref<string>，不在顶层解包
  async function enable() {
    const effectiveRoomId = Number(roomId?.value) || 101;
    // ... runScript 闭包内使用 effectiveRoomId
    const result = await cmd('AutoAuction', { roomId: effectiveRoomId, useExpectedPrice: true });
  }
}
```

### 3. ElsaAutoOperationPanel 新增下拉框

`src/elsa/ElsaAutoOperationPanel.vue`：

- 导入 `ROOM_OPTIONS` from `InjectMetaOperationPanel.vue`
- 新增 `selectedRoomId` ref，默认 `'101'`
- 传给 `useElsaAutoOperation({ roomId: selectedRoomId })` — **传 ref 本身，非 `.value`**
- `data-testid="elsa-auto-operation-room-select"`
- 运行时（`isEnabled || isBusy`）禁用下拉框，防止运行中切换房间
- label 复用 `inject.metaOperationRoom`

### 4. 布局

在 `.elsa-auto-operation-toolbar` 内，`<header>` 下方新增一行 `.elsa-auto-operation-controls`：

```html
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
  <button class="command-button elsa-auto-operation-toggle" ...>
    <!-- 不变 -->
  </button>
</div>
```

## 测试

`src/elsa/ElsaAutoOperationPanel.test.js` 新增：

1. **默认值** — 下拉框默认选中 `'101'`（快递盲盒堆）
2. **切换后启用** — 切换到 `'102'` → 点击启用 → `AutoAuction` 命令携带 `roomId: 102`
3. **运行时禁用** — 启用后下拉框 disabled，停止后恢复可用

## 文件变更

| 文件 | 变更 |
|------|------|
| `src/inject/panels/InjectMetaOperationPanel.vue` | `ROOM_OPTIONS` 加 `export` |
| `src/elsa/ElsaAutoOperationPanel.vue` | 新增下拉框 + 导入 ROOM_OPTIONS |
| `src/elsa/useElsaAutoOperation.js` | `roomId` 参数化，默认 101 |
| `src/elsa/ElsaAutoOperationPanel.test.js` | 新增房间选择测试 |
