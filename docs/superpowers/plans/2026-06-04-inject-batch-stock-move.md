# Inject 批量移仓 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Inject 页面新增一个桌面端批量移仓面板，允许用户从一个来源物品箱多选藏品并顺序搬运到另一个目标物品箱。

**Architecture:** 新增 Agent 命令 `GetStockContainers` 与 `MoveStockItem`，继续复用现有 `runAutoOperationCommand(command, args)` 桥接。`GetStockContainers` 先触发 `PlayerManager.GetAllStocks()` 刷新，再读取 `PlayerGameData.wareHouses -> WareHouseData.gridItemDatas` 输出紧凑快照（`width/height + item.pos/rotate/boxIds`），避免返回全量格位坐标。renderer 侧把目标位扫描逻辑抽到纯函数 `src/inject/stock-move.js`，并用新组件 `src/inject/StockMovePanel.vue` 承载 UI 与批量执行流程；`src/inject/App.vue` 只负责集成。

**Tech Stack:** Vue 3 `<script setup>`、Vitest + @vue/test-utils、Electron preload 通用 IPC、Node CommonJS `inject-service.js`、C++ IL2CPP AutoOperation Agent。

参考设计：`docs/superpowers/specs/2026-06-04-inject-batch-stock-move-design.md`

---

## File Structure

- **Create** `src/inject/stock-move.js` — 纯函数：容器/藏品排序、目标位扫描、单件 move args 生成。
- **Create** `src/inject/stock-move.test.js` — 上述纯函数测试。
- **Create** `src/inject/StockMovePanel.vue` — 加载物品箱、来源/目标选择、多选、批量执行、结果摘要。
- **Create** `src/inject/StockMovePanel.test.js` — 组件行为测试。
- **Modify** `src/shared/messages.js` — 新增 Inject 批量移仓文案，中英双语。
- **Modify** `src/inject/App.vue` — 挂载 `StockMovePanel`。
- **Modify** `src/inject/App.test.js` — 新面板集成可见性回归。
- **Modify** `electron/services/inject-service.js` — 给 `GetStockContainers` / `MoveStockItem` 分配合理 timeout。
- **Modify** `electron/services/inject-service.test.mjs` — 覆盖新增命令 timeout 与透传。
- **Modify** `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` — 新增两个命令与详细快照序列化 helper。
- **Modify** `docs/AUTO_OPERATION_COMMANDS.md` — 记录两个新命令并修正命令总表遗漏。
- **Modify** `docs/Documentation.md`
- **Modify** `docs/ARCHITECTURE.md`

---

## Task 1: 批量移仓纯逻辑 helper

**Files:**
- Create: `src/inject/stock-move.js`
- Test: `src/inject/stock-move.test.js`

- [ ] **Step 1: 写失败测试**

创建 `src/inject/stock-move.test.js`，覆盖以下行为：

```js
import { describe, expect, it } from 'vitest';
import {
  sortMovableItems,
  findFirstPlacement,
  buildMoveArgs,
} from './stock-move.js';

describe('sortMovableItems', () => {
  it('places larger items first, then keeps lower pos first for ties', () => {
    const rows = [
      { itemUid: 'b', boxCount: 1, pos: 9 },
      { itemUid: 'c', boxCount: 4, pos: 8 },
      { itemUid: 'a', boxCount: 4, pos: 3 },
    ];
    expect(sortMovableItems(rows).map((item) => item.itemUid)).toEqual(['a', 'c', 'b']);
  });
});

describe('findFirstPlacement', () => {
  const target = {
    stockId: 2,
    cells: [
      { boxId: 0, x: 0, y: 0 },
      { boxId: 1, x: 1, y: 0 },
      { boxId: 2, x: 0, y: 1 },
      { boxId: 3, x: 1, y: 1 },
      { boxId: 4, x: 2, y: 0 },
      { boxId: 5, x: 2, y: 1 },
    ],
    items: [
      { itemUid: 'occupied', boxIds: [0] },
    ],
  };

  it('finds the first row-major anchor that fits the shape', () => {
    const placement = findFirstPlacement(target, {
      boxIds: [20, 21, 30, 31],
      cells: [
        { boxId: 20, x: 4, y: 2 },
        { boxId: 21, x: 5, y: 2 },
        { boxId: 30, x: 4, y: 3 },
        { boxId: 31, x: 5, y: 3 },
      ],
    });
    expect(placement).toEqual({ newSlot: 1, boxIds: [1, 2, 3, 4] });
  });

  it('returns null when no placement exists', () => {
    const placement = findFirstPlacement(target, {
      boxIds: [20, 21, 22, 23, 24, 25],
      cells: [
        { boxId: 20, x: 0, y: 0 },
        { boxId: 21, x: 1, y: 0 },
        { boxId: 22, x: 2, y: 0 },
        { boxId: 23, x: 0, y: 1 },
        { boxId: 24, x: 1, y: 1 },
        { boxId: 25, x: 2, y: 1 },
      ],
    });
    expect(placement).toBeNull();
  });
});

describe('buildMoveArgs', () => {
  it('maps source item + placement to MoveStockItem args', () => {
    expect(buildMoveArgs({
      sourceItem: { stockId: 1, pos: 24, rotate: true },
      targetStockId: 9,
      placement: { newSlot: 13 },
    })).toEqual({
      oldStockId: 1,
      oldSlot: 24,
      newStockId: 9,
      newSlot: 13,
      isRotate: true,
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/inject/stock-move.test.js`
Expected: FAIL，提示找不到 `./stock-move.js`

- [ ] **Step 3: 写最小实现**

创建 `src/inject/stock-move.js`，导出：

- `sortMovableItems(items)`
- `findFirstPlacement(targetContainer, item)`
- `buildMoveArgs({ sourceItem, targetStockId, placement })`

实现要求：

- `sortMovableItems` 按 `boxCount DESC, pos ASC`
- `findFirstPlacement`:
  - 用 item 当前 `cells` 归一化出 shape offsets
  - 以目标 `cells` 的 `y ASC, x ASC` 顺序扫描 anchor
  - 所有 offset 映射到的 `boxId` 必须存在且未被占用
  - 成功返回 `{ newSlot, boxIds }`
- `buildMoveArgs` 原样映射 `stockId/pos/rotate`

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/inject/stock-move.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/inject/stock-move.js src/inject/stock-move.test.js
git commit -m "feat: add inject stock move helpers"
```

---

## Task 2: Agent 命令与 service timeout

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Modify: `electron/services/inject-service.js`
- Test: `electron/services/inject-service.test.mjs`
- Modify: `docs/AUTO_OPERATION_COMMANDS.md`

- [ ] **Step 1: 写 service 层失败测试**

在 `electron/services/inject-service.test.mjs` 的命令 timeout 用例附近新增断言：

```js
await service.runAutoOperationCommand('GetStockContainers', {}, { sendAutoOperationCommand });
await service.runAutoOperationCommand('MoveStockItem', {
  oldStockId: 1,
  oldSlot: 24,
  newStockId: 2,
  newSlot: 13,
  isRotate: false,
}, { sendAutoOperationCommand });

expect(sendAutoOperationCommand).toHaveBeenCalledWith(
  'GetStockContainers',
  {},
  expect.objectContaining({ timeoutMs: 45000 })
);
expect(sendAutoOperationCommand).toHaveBeenCalledWith(
  'MoveStockItem',
  {
    oldStockId: 1,
    oldSlot: 24,
    newStockId: 2,
    newSlot: 13,
    isRotate: false,
  },
  expect.objectContaining({ timeoutMs: 45000 })
);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run electron/services/inject-service.test.mjs`
Expected: FAIL，新增命令 timeout 仍走默认值

- [ ] **Step 3: 修改 `inject-service.js`**

在 `getAutoOperationCommandTimeoutMs()` 中把以下命令加入长超时列表：

- `GetStockContainers`
- `MoveStockItem`

- [ ] **Step 4: 在 Agent 新增 detailed snapshot helper**

在 `BKAutoOpAgent.cpp` 中新增一组 helper：

- 刷新 `PlayerManager.GetAllStocks()`
- 读取 `PlayerGameData.wareHouses`
- 遍历每个 `WareHouseData.gridItemDatas`
- 输出每件 item 的：
  - `itemUid`
  - `itemCid`
  - `count`
  - `pos`
  - `rotate`
  - `stockId`
  - `boxCount`
  - `boxIds`
  - `canTrade`
  - `isLock`
- 输出每个 container 的：
  - `stockId`
  - `stockCid`
  - `width`
  - `height`
  - `boxCount`
  - `items`

约束：

- `pos` 优先直接取 `GridItemData.pos`
- `boxIds` 由 `itemId + pos + rotate + WareHouseData.width` 推导
- 不返回全量 `cells[{x,y}]`, 只返回每件 item 的 `boxIds`
- 结果需控制在 `BK_BUF_SIZE`

- [ ] **Step 5: 新增 `CmdGetStockContainers`**

命令行为：

- 调 `PlayerManager.GetAllStocks()`
- 走上述 helper 输出详细快照
- 成功返回 `{"containers":[...],"count":N,"source":"PlayerManager.GetAllStocks"}`

- [ ] **Step 6: 新增 `CmdMoveStockItem`**

命令参数：

- `oldStockId`
- `oldSlot`
- `newStockId`
- `newSlot`
- `isRotate`

命令行为：

- 校验所有整数参数
- 调 `PlayerManager.MoveItem(oldStockId, oldSlot, newStockId, newSlot, isRotate)`
- 等待 task 完成
- 将 task 结果里的最新 `List<StockContainerData>` 再序列化成详细快照
- 成功返回：

```json
{
  "moved": true,
  "oldStockId": 1,
  "oldSlot": 24,
  "newStockId": 2,
  "newSlot": 13,
  "isRotate": false,
  "containers": []
}
```

- [ ] **Step 7: 注册命令并更新文档**

在 `kCommands[]` 中注册：

- `GetStockContainers`
- `MoveStockItem`

在 `docs/AUTO_OPERATION_COMMANDS.md` 中补充两个命令说明，同时修正文档末尾命令总表，把已有但漏写的：

- `GetWarehouseItemList`
- `GetStockCollectibleCounts`

也加进去

- [ ] **Step 8: 跑验证**

Run:

```bash
npx vitest run electron/services/inject-service.test.mjs
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add electron/services/inject-service.js electron/services/inject-service.test.mjs tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp docs/AUTO_OPERATION_COMMANDS.md
git commit -m "feat: add auto operation stock move commands"
```

---

## Task 3: 批量移仓面板组件

**Files:**
- Create: `src/inject/StockMovePanel.vue`
- Create: `src/inject/StockMovePanel.test.js`
- Modify: `src/shared/messages.js`

- [ ] **Step 1: 写失败测试**

创建 `src/inject/StockMovePanel.test.js`，至少覆盖：

1. 点击“加载物品箱”后调用 `runAutoOperationCommand('GetStockContainers', {})`
2. 选择来源箱后展示来源箱藏品行
3. 勾选两件藏品并点击“批量移动”后，按顺序调用两次 `MoveStockItem`
4. 某件无空间时显示 skip 计数
5. 第二次 `MoveStockItem` 失败时显示部分成功并停止

测试使用 mock bridge：

```js
window.bidkingDesktop = {
  isDesktop: true,
  runAutoOperationCommand,
};
```

mock `GetStockContainers` / `MoveStockItem` 返回详细快照。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/inject/StockMovePanel.test.js`
Expected: FAIL，组件文件不存在

- [ ] **Step 3: 补 i18n 文案**

在 `src/shared/messages.js` 的 `inject` 文案中新增中英双语键，至少包括：

- `stockMoveTitle`
- `stockMoveDescription`
- `stockMoveLoad`
- `stockMoveSource`
- `stockMoveTarget`
- `stockMoveSelectAll`
- `stockMoveClear`
- `stockMoveSubmit`
- `stockMoveLoading`
- `stockMoveNoSpace`
- `stockMovePartialFailure`
- `stockMoveSuccessCount`
- `stockMoveSkippedCount`
- `stockMoveStopReason`

- [ ] **Step 4: 实现 `StockMovePanel.vue`**

组件职责：

- `loadStockContainers()`
- 来源/目标下拉
- 当前来源箱多选表格
- 调用 `sortMovableItems` / `findFirstPlacement` / `buildMoveArgs`
- 顺序执行批量搬运
- 展示结果摘要

实现约束：

- 仅使用 `window.bidkingDesktop.runAutoOperationCommand(...)`
- 不自己管理 agent load/unload
- 不直接操作 `App.vue` 其他 AutoOperation 状态

- [ ] **Step 5: 跑组件测试确认通过**

Run: `npx vitest run src/inject/StockMovePanel.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/messages.js src/inject/StockMovePanel.vue src/inject/StockMovePanel.test.js
git commit -m "feat: add inject stock move panel"
```

---

## Task 4: 集成到 Inject 页面并更新 current-state 文档

**Files:**
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`
- Modify: `docs/Documentation.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: 写失败集成测试**

在 `src/inject/App.test.js` 新增两类断言：

1. 桌面端 + `runAutoOperationCommand` 可用时显示 `StockMovePanel`
2. 非桌面端隐藏 `StockMovePanel`

建议断言 `data-testid="stock-move-panel"`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/inject/App.test.js`
Expected: FAIL，找不到新面板

- [ ] **Step 3: 在 `App.vue` 挂载新组件**

在 AutoOperation 区域内、仓库聚合面板附近插入：

```vue
<StockMovePanel />
```

并引入组件。

- [ ] **Step 4: 更新 current-state 文档**

`docs/Documentation.md` 补充：

- Inject 页面现在支持“批量移动藏品到其他物品箱”
- 使用 `GetStockContainers` + `MoveStockItem`
- v1 限制为单来源箱 -> 单目标箱

`docs/ARCHITECTURE.md` 补充：

- `src/inject/StockMovePanel.vue`
- `src/inject/stock-move.js`
- Agent 新命令说明

- [ ] **Step 5: 跑验证**

Run:

```bash
npx vitest run src/inject/stock-move.test.js src/inject/StockMovePanel.test.js src/inject/App.test.js electron/services/inject-service.test.mjs
git diff --check
```

Expected:

- 所有目标测试 PASS
- `git diff --check` 无输出

- [ ] **Step 6: Commit**

```bash
git add src/inject/App.vue src/inject/App.test.js docs/Documentation.md docs/ARCHITECTURE.md
git commit -m "feat: add inject batch stock move flow"
```

---

## Self-Review

- **Spec coverage:** 已覆盖 Agent 命令、timeout、renderer helper、UI、文档与验证。
- **Placeholder scan:** 无 `TODO/TBD/implement later`。
- **Type consistency:** 统一使用 `GetStockContainers`、`MoveStockItem`、`oldStockId/oldSlot/newStockId/newSlot/isRotate`。
