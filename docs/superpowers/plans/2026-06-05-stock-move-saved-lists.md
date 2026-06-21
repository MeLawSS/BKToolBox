# Batch Stock Move Saved Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Inject 页 `Batch Stock Move` 增加可持久化的“选中藏品列表”能力，支持保存当前 `itemCid` 选择到 `Documents/BidKing/stock-move-lists/`，并支持一键应用已保存列表到当前源仓。

**Architecture:** Electron 侧负责 `Documents/BidKing` 文件持久化和 IPC 暴露，renderer 侧仅消费 `list/save` bridge API 并把列表应用到现有 `selectedItemCids` 状态。现有 `GetStockContainers` / `MoveStockItem` 执行链路保持不变，本轮只扩展选中项持久化与复用。

**Tech Stack:** Electron main/preload、Node `fs/promises`、Vue 3 `<script setup>`、Vitest + `@vue/test-utils`、现有 Inject i18n 消息体系。

参考设计：`docs/superpowers/specs/2026-06-05-stock-move-saved-lists-design.md`

---

## File Structure

- **Modify** `electron/services/inject-service.js` - 新增 stock move saved lists 的目录路径、读取、保存、校验与排序逻辑。
- **Modify** `electron/services/inject-service.test.mjs` - 先写红态测试，锁定 `Documents/BidKing/stock-move-lists/` 的保存、读取、排序和坏文件容错行为。
- **Modify** `electron/main.js` - 注册 `inject:listStockMoveLists` 与 `inject:saveStockMoveList` IPC。
- **Modify** `electron/preload.js` - 暴露 `listStockMoveLists()` / `saveStockMoveList()` bridge API。
- **Modify** `src/inject/StockMovePanel.vue` - 新增 Saved Lists UI、列表加载/保存/应用状态与错误提示。
- **Modify** `src/inject/StockMovePanel.test.js` - 先写红态组件测试，锁定保存、刷新、部分匹配应用和空匹配提示。
- **Modify** `src/shared/messages.js` - 新增 Saved Lists 相关文案。
- **Modify** `docs/Documentation.md` - 同步 Inject 页 current-state。

---

### Task 1: 先锁定 Electron 侧 saved lists 持久化行为

**Files:**
- Modify: `electron/services/inject-service.test.mjs`
- Modify: `electron/services/inject-service.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: 在 `inject-service.test.mjs` 添加失败测试**

在 `electron/services/inject-service.test.mjs` 追加一组 `describe('inject-service stock move saved lists', ...)`，先覆盖 4 个行为：

```js
it('saves a stock move list under Documents/BidKing/stock-move-lists', async () => {
  const documentsDir = makeTempRoot();

  const result = await service.saveStockMoveList({
    name: '主仓高频车件',
    itemCids: [1083009, 1032006, 1083009],
    items: [
      { itemCid: 1083009, name: 'Intake Manifold', quality: 'blue', type: 'vehicle', sizeKey: '1x2' },
    ],
  }, { documentsDir });

  expect(result.ok).toBe(true);
  expect(result.value.name).toBe('主仓高频车件');
  expect(result.value.itemCids).toEqual([1083009, 1032006]);
  expect(result.value.id).toMatch(/^\d{14}-[a-z0-9]+$/);

  const listDir = path.join(documentsDir, 'BidKing', 'stock-move-lists');
  expect(fs.readdirSync(listDir)).toHaveLength(1);
});
```

```js
it('lists saved stock move lists sorted by savedAt desc and skips broken files', async () => {
  const documentsDir = makeTempRoot();
  const listDir = path.join(documentsDir, 'BidKing', 'stock-move-lists');
  fs.mkdirSync(listDir, { recursive: true });
  fs.writeFileSync(path.join(listDir, 'older.json'), JSON.stringify({
    id: 'older',
    name: 'older',
    savedAt: '2026-06-05T01:00:00.000Z',
    itemCids: [1011001],
    items: [],
  }));
  fs.writeFileSync(path.join(listDir, 'broken.json'), '{broken');
  fs.writeFileSync(path.join(listDir, 'newer.json'), JSON.stringify({
    id: 'newer',
    name: 'newer',
    savedAt: '2026-06-05T02:00:00.000Z',
    itemCids: [1032006],
    items: [],
  }));

  const result = await service.listStockMoveLists({ documentsDir });

  expect(result.ok).toBe(true);
  expect(result.value.map((entry) => entry.id)).toEqual(['newer', 'older']);
});
```

```js
it('rejects blank names and empty itemCid arrays', async () => {
  const documentsDir = makeTempRoot();

  await expect(service.saveStockMoveList({
    name: '   ',
    itemCids: [1083009],
    items: [],
  }, { documentsDir })).rejects.toThrow('name is required');

  await expect(service.saveStockMoveList({
    name: 'valid',
    itemCids: [],
    items: [],
  }, { documentsDir })).rejects.toThrow('itemCids is required');
});
```

- [ ] **Step 2: 运行 service 测试并确认先失败**

Run: `npx vitest run electron/services/inject-service.test.mjs`

Expected: FAIL，失败原因应是 `saveStockMoveList` / `listStockMoveLists` 尚未导出或行为不匹配。

- [ ] **Step 3: 在 `inject-service.js` 实现最小持久化逻辑**

在 `electron/services/inject-service.js` 增加最小 helper 与导出：

```js
function getStockMoveListsDir(documentsDir) {
    return path.join(documentsDir, 'BidKing', 'stock-move-lists');
}

function normalizeSavedStockMoveItemCids(itemCids) {
    return [...new Set(
        (Array.isArray(itemCids) ? itemCids : [])
            .map((value) => Number(value))
            .filter((value) => Number.isSafeInteger(value) && value > 0)
    )];
}
```

```js
async function saveStockMoveList(payload = {}, deps = {}) {
    const documentsDir = deps.documentsDir || process.env.BIDKING_DOCUMENTS_DIR;
    if (!documentsDir) throw new Error('Documents directory is not available.');

    const name = String(payload.name || '').trim();
    if (!name) throw new Error('name is required');

    const itemCids = normalizeSavedStockMoveItemCids(payload.itemCids);
    if (!itemCids.length) throw new Error('itemCids is required');

    const savedAt = new Date().toISOString();
    const id = `${savedAt.replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
    const value = {
        id,
        name,
        savedAt,
        itemCids,
        items: Array.isArray(payload.items) ? payload.items : [],
    };

    const listDir = getStockMoveListsDir(documentsDir);
    await fs.promises.mkdir(listDir, { recursive: true });
    await fs.promises.writeFile(path.join(listDir, `${id}.json`), JSON.stringify(value, null, 2), 'utf8');
    return { ok: true, value };
}
```

```js
async function listStockMoveLists(deps = {}) {
    const documentsDir = deps.documentsDir || process.env.BIDKING_DOCUMENTS_DIR;
    if (!documentsDir) throw new Error('Documents directory is not available.');

    const listDir = getStockMoveListsDir(documentsDir);
    try {
        const names = await fs.promises.readdir(listDir);
        const entries = [];
        for (const name of names) {
            if (!name.endsWith('.json')) continue;
            try {
                const value = await readJsonFile(path.join(listDir, name));
                entries.push(value);
            } catch (_error) {}
        }
        entries.sort((left, right) => String(right.savedAt || '').localeCompare(String(left.savedAt || '')));
        return { ok: true, value: entries };
    } catch (error) {
        if (error?.code === 'ENOENT') return { ok: true, value: [] };
        throw error;
    }
}
```

并导出它们，同时在 `electron/main.js` 与 `electron/preload.js` 增加薄封装：

```js
ipcMain.handle('inject:listStockMoveLists', () => listStockMoveLists());
ipcMain.handle('inject:saveStockMoveList', (_event, payload) => saveStockMoveList(payload));
```

```js
listStockMoveLists: () => ipcRenderer.invoke('inject:listStockMoveLists'),
saveStockMoveList: (payload) => ipcRenderer.invoke('inject:saveStockMoveList', payload),
```

- [ ] **Step 4: 运行 service 测试确认变绿**

Run: `npx vitest run electron/services/inject-service.test.mjs`

Expected: PASS

- [ ] **Step 5: 提交 Electron 持久化子任务**

```bash
git add electron/services/inject-service.js electron/services/inject-service.test.mjs electron/main.js electron/preload.js
git commit -m "feat: persist stock move saved lists"
```

---

### Task 2: 先写 renderer 红态测试，再落地 Saved Lists UI 和应用逻辑

**Files:**
- Modify: `src/inject/StockMovePanel.test.js`
- Modify: `src/inject/StockMovePanel.vue`
- Modify: `src/shared/messages.js`

- [ ] **Step 1: 在 `StockMovePanel.test.js` 添加失败测试**

扩展 `setupDesktop()` 允许注入 `listStockMoveLists` 和 `saveStockMoveList` mock，再增加 4 个组件测试：

```js
it('saves the current selected itemCid groups and reloads saved lists', async () => {
  const snapshot = createSortableSnapshot();
  const runAutoOperationCommand = vi.fn(async (command) => {
    if (command === 'GetStockContainers') return { ok: true, value: snapshot };
    throw new Error(`unexpected command: ${command}`);
  });
  const listStockMoveLists = vi.fn()
    .mockResolvedValueOnce({ ok: true, value: [] })
    .mockResolvedValueOnce({ ok: true, value: [{ id: 'saved-1', name: '常用车件', savedAt: '2026-06-05T03:04:05.000Z', itemCids: [1083009], items: [] }] });
  const saveStockMoveList = vi.fn(async (payload) => ({ ok: true, value: { id: 'saved-1', savedAt: '2026-06-05T03:04:05.000Z', ...payload } }));
  setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList });

  const wrapper = await mountPanel();
  await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
  await flushPromises();
  await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
  await wrapper.find('[data-testid="stock-move-item-group-1083009"]').setValue(true);
  await wrapper.find('[data-testid="stock-move-saved-list-name"]').setValue('常用车件');
  await wrapper.find('[data-testid="stock-move-save-list"]').trigger('click');

  expect(saveStockMoveList).toHaveBeenCalledWith(expect.objectContaining({
    name: '常用车件',
    itemCids: [1083009],
  }));
  expect(listStockMoveLists).toHaveBeenCalledTimes(2);
});
```

```js
it('applies only itemCids that exist in the current source container', async () => {
  const snapshot = createSortableSnapshot();
  const runAutoOperationCommand = vi.fn(async (command) => {
    if (command === 'GetStockContainers') return { ok: true, value: snapshot };
    throw new Error(`unexpected command: ${command}`);
  });
  const listStockMoveLists = vi.fn(async () => ({
    ok: true,
    value: [{
      id: 'saved-1',
      name: '混合列表',
      savedAt: '2026-06-05T03:04:05.000Z',
      itemCids: [1083009, 9999999],
      items: [],
    }],
  }));
  setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList: vi.fn() });

  const wrapper = await mountPanel();
  await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
  await flushPromises();
  await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
  await wrapper.find('[data-testid="stock-move-apply-list-saved-1"]').trigger('click');

  expect(wrapper.find('[data-testid="stock-move-item-group-1083009"]').element.checked).toBe(true);
  expect(wrapper.find('[data-testid="stock-move-item-group-1032006"]').element.checked).toBe(false);
});
```

```js
it('shows an error when an applied saved list has no matches in the current source container', async () => {
  // 列表中只有当前源仓不存在的 itemCid
  expect(wrapper.find('[data-testid="stock-move-saved-lists-error"]').text()).toContain('没有匹配');
});
```

```js
it('renders the current source match count for each saved list', async () => {
  expect(wrapper.find('[data-testid="stock-move-saved-list-match-saved-1"]').text()).toBe('1');
});
```

- [ ] **Step 2: 运行组件测试并确认先失败**

Run: `npx vitest run src/inject/StockMovePanel.test.js`

Expected: FAIL，失败点应体现当前不存在 `stock-move-saved-list-*` 控件，且组件还未消费新的 desktop bridge API。

- [ ] **Step 3: 在 `messages.js` 和 `StockMovePanel.vue` 实现最小 UI / 状态逻辑**

在 `src/shared/messages.js` 增加最小文案：

```js
stockMoveSavedLists: '已保存列表',
stockMoveSavedListName: '列表名称',
stockMoveSavedListNamePlaceholder: '例如：主仓高频车件',
stockMoveSaveList: '保存当前选择',
stockMoveApplyList: '应用',
stockMoveSavedKinds: '保存种类',
stockMoveSavedMatches: '当前匹配',
stockMoveSavedAt: '保存时间',
stockMoveNoSavedLists: '暂无已保存列表',
stockMoveSavedListNoMatches: '当前源仓没有匹配藏品',
```

在 `src/inject/StockMovePanel.vue` 增加最小状态：

```js
const savedListsLoading = ref(false);
const savedListsError = ref('');
const savedLists = ref([]);
const saveListName = ref('');
const savingList = ref(false);
```

新增只依赖 bridge 的加载与保存方法：

```js
const canManageSavedLists = computed(() =>
  Boolean(
    canRunAutoOperationCommand.value &&
    typeof window.bidkingDesktop?.listStockMoveLists === 'function' &&
    typeof window.bidkingDesktop?.saveStockMoveList === 'function',
  ),
);
```

```js
async function refreshSavedLists() {
  if (!canManageSavedLists.value) return;
  savedListsLoading.value = true;
  savedListsError.value = '';
  try {
    const response = await window.bidkingDesktop.listStockMoveLists();
    if (response?.ok === false) throw new Error(response.error || t('inject.failed'));
    savedLists.value = Array.isArray(response?.value) ? response.value : [];
  } catch (error) {
    savedListsError.value = error?.message || t('inject.failed');
  } finally {
    savedListsLoading.value = false;
  }
}
```

```js
async function saveCurrentSelectionList() {
  if (!canManageSavedLists.value || savingList.value) return;
  const name = saveListName.value.trim();
  if (!name || !selectedItemCids.value.length) return;

  const selectedSet = new Set(selectedItemCids.value);
  const items = sourceGroups.value
    .filter((group) => selectedSet.has(group.itemCid))
    .map((group) => ({
      itemCid: group.itemCid,
      name: group.collectible?.name || '',
      quality: group.collectible?.quality || '',
      type: group.collectible?.type || '',
      sizeKey: group.sizeText,
    }));

  savingList.value = true;
  savedListsError.value = '';
  try {
    await window.bidkingDesktop.saveStockMoveList({
      name,
      itemCids: items.map((item) => item.itemCid),
      items,
    });
    saveListName.value = '';
    await refreshSavedLists();
  } catch (error) {
    savedListsError.value = error?.message || t('inject.failed');
  } finally {
    savingList.value = false;
  }
}
```

再加应用函数：

```js
function applySavedList(savedList) {
  const available = new Set(sourceGroups.value.map((group) => group.itemCid));
  const nextSelection = (Array.isArray(savedList?.itemCids) ? savedList.itemCids : [])
    .map((value) => Number(value))
    .filter((itemCid) => available.has(itemCid));

  if (!nextSelection.length) {
    savedListsError.value = t('inject.stockMoveSavedListNoMatches');
    return;
  }

  selectedItemCids.value = [...new Set(nextSelection)];
  savedListsError.value = '';
  submitError.value = '';
  resetSummary();
}
```

模板中新增 Saved Lists 区块和必要的 `data-testid`：

```vue
<section class="stock-move-saved-lists">
  <div class="auto-op-fields">
    <label>
      <span>{{ t('inject.stockMoveSavedListName') }}</span>
      <input
        v-model="saveListName"
        :placeholder="t('inject.stockMoveSavedListNamePlaceholder')"
        data-testid="stock-move-saved-list-name"
      />
    </label>
    <button
      class="command-button"
      type="button"
      data-testid="stock-move-save-list"
      :disabled="!saveListName.trim() || !selectedItemCids.length || savingList"
      @click="saveCurrentSelectionList"
    >
      {{ t('inject.stockMoveSaveList') }}
    </button>
  </div>
</section>
```

并在 `loadStockContainers()` 成功后与 `onMounted()` 中调用 `refreshSavedLists()`，保证桌面端进入页面和点击加载后都能看到最新列表。

- [ ] **Step 4: 运行组件测试确认变绿**

Run: `npx vitest run src/inject/StockMovePanel.test.js`

Expected: PASS

- [ ] **Step 5: 提交 renderer 子任务**

```bash
git add src/inject/StockMovePanel.vue src/inject/StockMovePanel.test.js src/shared/messages.js
git commit -m "feat: add stock move saved lists panel"
```

---

### Task 3: 更新 current-state 文档并执行最小验证链

**Files:**
- Modify: `docs/Documentation.md`

- [ ] **Step 1: 在 `Documentation.md` 记录当前行为**

在 Inject 页面 current-state 段落中补一条：

```md
- `Batch Stock Move` 当前支持把已选 `itemCid` 分组保存到 `Documents/BidKing/stock-move-lists/`；应用已保存列表时只选中当前源仓实际存在的 `itemCid`，若无任何命中则在面板内提示，不触发移仓命令。
```

- [ ] **Step 2: 运行最小验证链**

Run: `npx vitest run electron/services/inject-service.test.mjs src/inject/StockMovePanel.test.js`

Expected: PASS

Run: `git diff --check`

Expected: 无输出

- [ ] **Step 3: 提交收尾文档与验证结果**

```bash
git add docs/Documentation.md docs/superpowers/plans/2026-06-05-stock-move-saved-lists.md
git commit -m "docs: record stock move saved lists"
```

---

## Self-Review

- 规格覆盖检查：
  - 保存 `itemCid` 集合：Task 1 + Task 2
  - `Documents/BidKing/stock-move-lists/` 持久化：Task 1
  - 列表按 `savedAt` 倒序读取：Task 1
  - 损坏 JSON 跳过：Task 1
  - 一键应用当前源仓存在项：Task 2
  - 全部不匹配时提示：Task 2
  - current-state 文档同步：Task 3
- 占位符检查：
  - 无 `TODO` / `TBD`
  - 每个任务包含明确文件、命令与预期结果
- 类型一致性：
  - 统一使用 `itemCids` 作为存储字段
  - 统一使用 `listStockMoveLists` / `saveStockMoveList` 作为 bridge 与 IPC 名称
