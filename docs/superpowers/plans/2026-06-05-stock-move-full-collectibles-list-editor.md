# Batch Stock Move Full-Collectibles List Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Batch Stock Move 的“创建 Saved List”改成独立弹窗，支持从全量 `collectibles.json` 搜索并选择任意藏品创建列表，同时保持主面板 Apply 仍只命中当前源仓实际存在的 `itemCid`。

**Architecture:** 新增一个独立 `StockMoveListEditorModal` 组件承载全量藏品搜索和草稿编辑；主面板只负责打开 modal、展示已保存列表和 Apply。草稿去重、搜索和快照生成抽到一个小型纯函数 helper，降低 modal 与 `StockMovePanel` 的状态耦合。

**Tech Stack:** Vue 3 `<script setup>`、Vitest + `@vue/test-utils`、现有 desktop preload save/list APIs、`src/inject/inject.css` 主题变量和全局按钮样式。

参考设计：`docs/superpowers/specs/2026-06-05-stock-move-full-collectibles-list-editor-design.md`

---

## File Structure

- **Create** `src/inject/stock-move-saved-list-draft.js` - 草稿去重、搜索、快照拼装纯函数。
- **Create** `src/inject/stock-move-saved-list-draft.test.js` - helper 单测。
- **Create** `src/inject/StockMoveListEditorModal.vue` - 全量藏品列表创建弹窗。
- **Create** `src/inject/StockMoveListEditorModal.test.js` - modal 组件测试。
- **Modify** `src/inject/StockMovePanel.vue` - 删除旧的“直接保存当前选择”交互，改为打开 modal，保存成功后刷新 saved lists。
- **Modify** `src/inject/StockMovePanel.test.js` - 主面板集成测试：打开/关闭 modal，保存成功后刷新 saved lists，Apply 行为不回归。
- **Modify** `src/shared/messages.js` - 新增 modal 与新建列表文案。
- **Modify** `src/inject/inject.css` - 新增 inject 页面 modal 样式。
- **Modify** `docs/Documentation.md` - 更新 current-state。

---

### Task 1: 先锁定草稿 helper 的纯逻辑

**Files:**
- Create: `src/inject/stock-move-saved-list-draft.js`
- Create: `src/inject/stock-move-saved-list-draft.test.js`

- [ ] **Step 1: 先写 helper 红态测试**

在 `src/inject/stock-move-saved-list-draft.test.js` 写 3 组失败测试，覆盖：

```js
import { describe, expect, it } from 'vitest';
import {
  addDraftCollectible,
  filterCollectiblesForDraftSearch,
  buildSavedListSnapshotItems,
} from './stock-move-saved-list-draft.js';

const collectibles = [
  { itemCid: 1011001, name: 'Data Cable', quality: 'white', type: 'daily', size: { key: '1x1' } },
  { itemCid: 1083009, name: 'Intake Manifold', quality: 'blue', type: 'vehicle', size: { key: '1x2' } },
];

it('deduplicates draft itemCids when adding the same collectible twice', () => {
  const first = addDraftCollectible([], collectibles[1]);
  const second = addDraftCollectible(first, collectibles[1]);
  expect(second.map((item) => item.itemCid)).toEqual([1083009]);
});

it('filters full collectibles by name, itemCid, quality, and type', () => {
  expect(filterCollectiblesForDraftSearch(collectibles, 'intake').map((item) => item.itemCid)).toEqual([1083009]);
  expect(filterCollectiblesForDraftSearch(collectibles, '1011001').map((item) => item.itemCid)).toEqual([1011001]);
  expect(filterCollectiblesForDraftSearch(collectibles, 'vehicle').map((item) => item.itemCid)).toEqual([1083009]);
});

it('builds saved-list snapshot items with the required shape', () => {
  expect(buildSavedListSnapshotItems([collectibles[1]])).toEqual([
    {
      itemCid: 1083009,
      name: 'Intake Manifold',
      quality: 'blue',
      type: 'vehicle',
      sizeKey: '1x2',
    },
  ]);
});
```

- [ ] **Step 2: 运行 helper 测试并确认先失败**

Run: `npx vitest run src/inject/stock-move-saved-list-draft.test.js`

Expected: FAIL，原因应为 helper 文件或导出符号尚不存在。

- [ ] **Step 3: 写最小 helper 实现**

在 `src/inject/stock-move-saved-list-draft.js` 写最小纯函数：

```js
function normalizeItemCid(value) {
  const itemCid = Number(value);
  return Number.isInteger(itemCid) && itemCid > 0 ? itemCid : null;
}

export function addDraftCollectible(draftItems, collectible) {
  const next = Array.isArray(draftItems) ? [...draftItems] : [];
  const itemCid = normalizeItemCid(collectible?.itemCid ?? collectible?.cid);
  if (!itemCid || next.some((item) => item.itemCid === itemCid)) return next;
  next.push(collectible);
  return next;
}

export function filterCollectiblesForDraftSearch(collectibles, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return Array.isArray(collectibles) ? collectibles : [];
  return (Array.isArray(collectibles) ? collectibles : []).filter((item) => {
    const haystack = [
      item?.name,
      item?.quality,
      item?.type,
      item?.itemCid ?? item?.cid,
    ].map((value) => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(normalizedQuery);
  });
}

export function buildSavedListSnapshotItems(draftItems) {
  return (Array.isArray(draftItems) ? draftItems : []).map((item) => ({
    itemCid: Number(item.itemCid ?? item.cid),
    name: item?.name || '',
    quality: item?.quality || '',
    type: item?.type || '',
    sizeKey: item?.size?.key || '',
  }));
}
```

- [ ] **Step 4: 运行 helper 测试确认变绿**

Run: `npx vitest run src/inject/stock-move-saved-list-draft.test.js`

Expected: PASS

- [ ] **Step 5: 提交 helper 子任务**

```bash
git add src/inject/stock-move-saved-list-draft.js src/inject/stock-move-saved-list-draft.test.js
git commit -m "feat: add stock move saved list draft helpers"
```

---

### Task 2: 先写 modal 红态测试，再实现全量藏品创建弹窗

**Files:**
- Create: `src/inject/StockMoveListEditorModal.vue`
- Create: `src/inject/StockMoveListEditorModal.test.js`
- Modify: `src/shared/messages.js`
- Modify: `src/inject/inject.css`

- [ ] **Step 1: 先写 modal 红态测试**

在 `src/inject/StockMoveListEditorModal.test.js` 里先覆盖 5 个行为：

```js
it('finds collectibles that do not exist in the current source stock', async () => {
  // 搜索 "intake" 能在结果区看到 1083009
});

it('adds a searched collectible into the draft and deduplicates duplicate adds', async () => {
  // 连点两次“加入”，草稿里仍只出现一次
});

it('imports the current selected source-stock itemCids into the draft without clearing existing draft items', async () => {
  // 初始草稿已有 1083009，再导入当前选中 1011001，最终草稿为两项
});

it('removes a draft collectible', async () => {
  // 点“移除”后草稿列表减少
});

it('saves the draft through the desktop bridge with itemCids and snapshot items', async () => {
  // saveStockMoveList payload 断言
});
```

建议 modal props 形状固定为：

```js
{
  collectibles,
  initialDraftItems,
  initialName,
}
```

emits 固定为：

```js
['close', 'saved']
```

- [ ] **Step 2: 运行 modal 测试并确认先失败**

Run: `npx vitest run src/inject/StockMoveListEditorModal.test.js`

Expected: FAIL，原因应为 modal 文件尚不存在。

- [ ] **Step 3: 实现 modal 最小版本**

在 `src/inject/StockMoveListEditorModal.vue`：

- 用 `listing-overlay` / `themed-dialog` 这类现有 dialog 风格命名，但把样式定义补进 `src/inject/inject.css`
- 依赖 helper 管理草稿
- 直接调用 `window.bidkingDesktop.saveStockMoveList(...)`

最小结构接近：

```vue
<div class="listing-overlay stock-move-list-editor-overlay" data-testid="stock-move-list-editor-modal" @click.self="emit('close')">
  <div class="listing-dialog themed-dialog stock-move-list-editor-dialog">
    <!-- header -->
    <!-- search results -->
    <!-- draft list -->
    <!-- footer -->
  </div>
</div>
```

文案至少新增：

- `inject.stockMoveCreateList`
- `inject.stockMoveImportSelected`
- `inject.stockMoveDraftTitle`
- `inject.stockMoveDraftEmpty`
- `inject.stockMoveAddCollectible`
- `inject.stockMoveRemoveCollectible`
- `inject.stockMoveSearchAllCollectibles`
- `inject.stockMoveSaveDraft`
- `inject.stockMoveCancelDraft`

- [ ] **Step 4: 运行 modal 测试确认变绿**

Run: `npx vitest run src/inject/StockMoveListEditorModal.test.js`

Expected: PASS

- [ ] **Step 5: 提交 modal 子任务**

```bash
git add src/inject/StockMoveListEditorModal.vue src/inject/StockMoveListEditorModal.test.js src/shared/messages.js src/inject/inject.css
git commit -m "feat: add stock move list editor modal"
```

---

### Task 3: 集成 StockMovePanel，替换旧保存入口并收尾文档

**Files:**
- Modify: `src/inject/StockMovePanel.vue`
- Modify: `src/inject/StockMovePanel.test.js`
- Modify: `docs/Documentation.md`

- [ ] **Step 1: 先写主面板红态测试**

在 `src/inject/StockMovePanel.test.js` 增加：

```js
it('opens and closes the stock move list editor modal', async () => {
  // 点击“新建列表”后 modal 出现，再关闭
});

it('refreshes saved lists after the modal reports a successful save', async () => {
  // modal emit('saved') 后主面板再次调用 listStockMoveLists
});
```

并删除或改写旧的“直接保存当前选择”测试，因为旧入口将被移除。

- [ ] **Step 2: 运行主面板测试并确认先失败**

Run: `npx vitest run src/inject/StockMovePanel.test.js`

Expected: FAIL，原因应为当前主面板还没有 modal 集成入口。

- [ ] **Step 3: 实现主面板集成**

在 `src/inject/StockMovePanel.vue`：

- 删除旧的列表名称输入框和直接保存按钮
- 增加 `isListEditorOpen` 状态
- 增加 `open/close` 方法
- 从 `selectedItemCids + collectiblesByCid` 生成 `initialDraftItems`
- 挂载 `<StockMoveListEditorModal />`
- 处理 `saved` 事件后关闭 modal 并 `await refreshSavedLists()`

目标形态接近：

```vue
<button
  class="command-button"
  type="button"
  data-testid="stock-move-open-list-editor"
  @click="openListEditor"
>
  {{ t('inject.stockMoveCreateList') }}
</button>
```

```vue
<StockMoveListEditorModal
  v-if="isListEditorOpen"
  :collectibles="collectibles"
  :initial-draft-items="selectedDraftItems"
  @close="closeListEditor"
  @saved="handleListEditorSaved"
/>
```

- [ ] **Step 4: 更新 current-state 文档**

在 `docs/Documentation.md` 中把旧的“保存当前选择”描述更新为：

- 现在通过独立 modal 从全量 `collectibles` 创建列表
- 可导入当前源仓勾选项
- Apply 语义不变

- [ ] **Step 5: 运行最终最小验证链**

Run: `npx vitest run src/inject/stock-move-saved-list-draft.test.js src/inject/StockMoveListEditorModal.test.js src/inject/StockMovePanel.test.js`

Expected: PASS

Run: `npm run build:inject`

Expected: PASS

Run: `git diff --check`

Expected: 无输出

- [ ] **Step 6: 提交集成收尾**

```bash
git add src/inject/StockMovePanel.vue src/inject/StockMovePanel.test.js docs/Documentation.md
git commit -m "feat: create stock move lists from full collectibles"
```

---

## Self-Review

- 规格覆盖检查：
  - 独立 modal：Task 2 + Task 3
  - 全量 `collectibles` 搜索：Task 1 + Task 2
  - 导入当前源仓勾选项：Task 2
  - 保存仍写 `{ itemCids, items }`：Task 1 + Task 2
  - 主面板 Apply 语义不变：Task 3
  - current-state 文档同步：Task 3
- 占位符检查：
  - 无 `TODO` / `TBD`
  - 每个任务都有明确文件、命令和预期结果
- 类型一致性：
  - `itemCids` 作为保存字段命名保持一致
  - modal 事件统一为 `close` / `saved`
  - 主面板打开按钮统一使用 `stock-move-open-list-editor`
