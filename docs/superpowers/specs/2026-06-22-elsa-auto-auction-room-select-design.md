# Elsa 自动竞拍 · 支持选择地图设计文档

> 日期: 2026-06-22 · 状态: 待审批

## 目标

Elsa 自动竞拍当前写死 `roomId: 101`（快递盲盒堆）。改为在自动操作面板提供下拉框选择地图，默认快递盲盒堆。

## 范围

- Elsa 自动操作面板新增房间下拉框
- `useElsaAutoOperation` 接受外部传入的 `roomId`，不再写死 `101`
- 复用 `ROOM_OPTIONS`（当前在 `InjectMetaOperationPanel.vue` 内，提取到独立模块）

## 非目标

- 不改变 InjectMetaOperation 面板已有的房间下拉
- 不影响手动 EnterRoom 等 MetaOperation 命令
- 不改变 AutoAuction C++ 侧逻辑

## 实现

### 1. 提取 ROOM_OPTIONS 到共享模块

新建 `src/inject/room-options.js`，从 `InjectMetaOperationPanel.vue` 移出 `ROOM_OPTIONS`：

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

`src/inject/panels/InjectMetaOperationPanel.vue` — 改为从 `../room-options.js` 导入。

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

- 导入 `ROOM_OPTIONS` from `../inject/room-options.js`
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

**CSS 新增：**

```css
.elsa-auto-operation-controls {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}
```

工具栏 grid 结构变为 `<header>` + `.elsa-auto-operation-controls` 两行（grid 原有 `grid-template-columns` 不变，controls 行占据第二列/新行）。

## 测试

### ElsaAutoOperationPanel.test.js （UI 层）

1. **默认值** — 下拉框默认选中 `'101'`（快递盲盒堆）
2. **运行时禁用** — 启用后下拉框 disabled，停止后恢复可用

### useElsaAutoOperation.test.js （命令层）

3. **roomId 传递** — 传入 `ref('102')` → 启用 → `AutoAuction` 命令携带 `roomId: 102`（已有 `roomId: 101` 断言在第 597 行，对照验证）

## 文件变更

| 文件 | 变更 |
|------|------|
| `src/inject/room-options.js` | **新建** — 从 InjectMetaOperationPanel 提取 ROOM_OPTIONS |
| `src/inject/panels/InjectMetaOperationPanel.vue` | 改为从 `room-options.js` 导入 ROOM_OPTIONS |
| `src/elsa/ElsaAutoOperationPanel.vue` | 新增下拉框 + 导入 ROOM_OPTIONS |
| `src/elsa/useElsaAutoOperation.js` | `roomId` 参数化为 `Ref<string>` |
| `src/elsa/ElsaAutoOperationPanel.test.js` | 新增 UI 层测试（默认值、运行时禁用） |
| `src/elsa/useElsaAutoOperation.test.js` | 新增 roomId 传递测试 |
