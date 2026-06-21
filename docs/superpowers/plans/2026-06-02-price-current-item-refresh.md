# Price Current Item Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Price tab refresh button that queries the currently selected item's latest exchange low price and updates the trend chart.

**Architecture:** Electron main owns the Agent call and history write through a new desktop helper. The Price renderer calls that helper for the selected `itemCid`, then reloads latest/history HTTP data. The text-only history list is removed from the panel.

**Tech Stack:** Vue 3, Electron IPC/preload, CommonJS services, Vitest, existing AutoOperation Agent and `recordTradeInfoSnapshot`.

---

## File Structure

- Modify `electron/services/inject-service.js`
  - Add `refreshItemTradeInfo(itemCid, deps)` helper.
- Modify `electron/services/inject-service.test.mjs`
  - Unit-test the helper's Agent startup, command call, recording, and error behavior.
- Modify `electron/main.js`
  - Add IPC handler `inject:refreshItemTradeInfo`.
- Modify `electron/preload.js`
  - Expose `window.bidkingDesktop.refreshItemTradeInfo(itemCid)`.
- Modify `src/price/App.vue`
  - Add refresh state/method, refresh button, reload latest/history after success, remove `.history-list`.
- Modify `src/price/App.test.js`
  - Test current-item refresh and absence of text history list.
- Modify `src/shared/messages.js`
  - Add zh/en labels for refresh button and error fallback if needed.
- Modify `src/price/price.css`
  - Remove obsolete `.history-list` styles and add header action/error styling only if existing classes are insufficient.

Do not touch `public/price` in this implementation pass because it already has unrelated dirty build output. Build output can be handled separately after source review.

---

## Task 1: Add Desktop Helper for One Item Refresh

**Files:**
- Modify: `electron/services/inject-service.js`
- Modify: `electron/services/inject-service.test.mjs`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Write failing service tests**

Add this block to `electron/services/inject-service.test.mjs` near the AutoOperation Agent tests:

```js
describe('single item trade info refresh', () => {
  it('starts the Agent, queries one item, records the snapshot, and returns the written summary', async () => {
    const startAutoOperationAgent = vi.fn().mockResolvedValue({ ok: true });
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        itemCid: 1022002,
        minPrice: 3996,
        tierCount: 1,
        totalCount: 3,
        tiers: [{ price: 3996, count: 3 }],
      },
    });
    const recordTradeInfoSnapshot = vi.fn().mockReturnValue({
      ok: true,
      itemCid: 1022002,
      minPrice: 3996,
      tierCount: 1,
      totalCount: 3,
    });

    const result = await service.refreshItemTradeInfo(1022002, {
      startAutoOperationAgent,
      runAutoOperationCommand,
      recordTradeInfoSnapshot,
    });

    expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1022002 }, expect.any(Object));
    expect(recordTradeInfoSnapshot).toHaveBeenCalledWith({
      itemCid: 1022002,
      minPrice: 3996,
      tierCount: 1,
      totalCount: 3,
      tiers: [{ price: 3996, count: 3 }],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        ok: true,
        itemCid: 1022002,
        minPrice: 3996,
        tierCount: 1,
        totalCount: 3,
      },
    });
  });

  it('rejects invalid item cids before starting the Agent', async () => {
    const startAutoOperationAgent = vi.fn();

    await expect(service.refreshItemTradeInfo('bad', { startAutoOperationAgent }))
      .rejects.toThrow('itemCid is required');
    expect(startAutoOperationAgent).not.toHaveBeenCalled();
  });

  it('throws the writer error when the snapshot cannot be recorded', async () => {
    await expect(service.refreshItemTradeInfo(1022002, {
      startAutoOperationAgent: vi.fn().mockResolvedValue({ ok: true }),
      runAutoOperationCommand: vi.fn().mockResolvedValue({
        ok: true,
        value: { itemCid: 1022002, tiers: [] },
      }),
      recordTradeInfoSnapshot: vi.fn().mockReturnValue({ ok: false, error: 'invalid trade info snapshot' }),
    })).rejects.toThrow('invalid trade info snapshot');
  });
});
```

- [ ] **Step 2: Verify service tests fail**

Run:

```bash
npm test -- electron/services/inject-service.test.mjs
```

Expected: FAIL because `refreshItemTradeInfo` is not exported.

- [ ] **Step 3: Implement service helper**

In `electron/services/inject-service.js`, import the recorder near the top:

```js
const {
    recordTradeInfoSnapshot: defaultRecordTradeInfoSnapshot,
} = require('../../lib/trade-info-history-recorder');
```

Add the helper near other AutoOperation helpers:

```js
async function refreshItemTradeInfo(itemCid, deps = {}) {
    const cid = parseRequiredPositiveSafeInteger(Number(itemCid), 'itemCid is required');
    await (deps.startAutoOperationAgent || startAutoOperationAgent)(deps);
    const response = await (deps.runAutoOperationCommand || runAutoOperationCommand)(
        'GetItemTradeInfo',
        { itemCid: cid },
        deps
    );
    const written = (deps.recordTradeInfoSnapshot || defaultRecordTradeInfoSnapshot)(response?.value);
    if (written?.ok === false) {
        throw new Error(written.error || 'failed to record trade info snapshot');
    }
    return { ok: true, value: written };
}
```

Export it from `module.exports`.

- [ ] **Step 4: Add IPC/preload wiring**

In `electron/main.js`, include `refreshItemTradeInfo` in the destructured service imports. Add this handler near other `inject:*` handlers:

```js
ipcMain.handle('inject:refreshItemTradeInfo', async (_event, itemCid) => {
    try {
        return await refreshItemTradeInfo(itemCid);
    } catch (error) {
        return { ok: false, error: error.message };
    }
});
```

In `electron/preload.js`, add:

```js
refreshItemTradeInfo: (itemCid) => ipcRenderer.invoke('inject:refreshItemTradeInfo', itemCid),
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- electron/services/inject-service.test.mjs
```

Expected: PASS.

Commit:

```bash
git add electron/services/inject-service.js electron/services/inject-service.test.mjs electron/main.js electron/preload.js
git commit -m "feat: add price item refresh ipc"
```

---

## Task 2: Add Price Panel Refresh Button and Remove Text History List

**Files:**
- Modify: `src/price/App.vue`
- Modify: `src/price/App.test.js`
- Modify: `src/shared/messages.js`
- Modify: `src/price/price.css`

- [ ] **Step 1: Write failing Price tests**

Add this test to `src/price/App.test.js`:

```js
it('refreshes the selected item latest price and updates the trend history', async () => {
  mockFetch({
    latestResponses: [
      latestRows,
      latestRows.map((row) => row.itemCid === 1022002
        ? { ...row, observedAt: '2026-05-28T13:10:00.000Z', minPrice: 3996 }
        : row),
    ],
    itemHistoryResponses: {
      1022002: [
        [
          { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
          { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
        ],
        [
          { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
          { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
          { observedAt: '2026-05-28T13:10:00.000Z', minPrice: 3996 },
        ],
      ],
    },
  });
  const refreshItemTradeInfo = vi.fn().mockResolvedValue({
    ok: true,
    value: { itemCid: 1022002, minPrice: 3996 },
  });
  window.bidkingDesktop = {
    isDesktop: true,
    refreshItemTradeInfo,
  };

  const wrapper = await mountApp();
  await wrapper.find('[data-testid="opportunity-1022002"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('5,000');

  await wrapper.find('[data-testid="price-item-refresh"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(refreshItemTradeInfo).toHaveBeenCalledWith(1022002);
  expect(fetch).toHaveBeenCalledWith('/api/price-history/latest');
  expect(fetch).toHaveBeenCalledWith('/api/price-history/item/1022002?limit=1000');
  expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('3,996');
});

it('does not render the text history list below the trend chart', async () => {
  const wrapper = await mountApp();

  await wrapper.find('[data-testid="opportunity-1022002"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(wrapper.find('[data-testid="price-history-list"]').exists()).toBe(false);
  expect(wrapper.find('[data-testid="price-detail"]').text()).not.toContain('2026/5/28');
});
```

- [ ] **Step 2: Verify Price tests fail**

Run:

```bash
npm test -- src/price/App.test.js
```

Expected: FAIL because the refresh button does not exist and the history list is still rendered.

- [ ] **Step 3: Add messages**

In `src/shared/messages.js`, add under zh `price`:

```js
refreshItem: '刷新当前藏品',
refreshingItem: '刷新中',
refreshItemUnavailable: '当前环境不支持刷新当前藏品',
```

Add under en `price`:

```js
refreshItem: 'Refresh Item',
refreshingItem: 'Refreshing',
refreshItemUnavailable: 'Current environment cannot refresh this item',
```

- [ ] **Step 4: Implement Price refresh state and method**

In `src/price/App.vue`, add refs:

```js
const isRefreshingItem = ref(false);
const itemRefreshError = ref('');
```

Add computed:

```js
const canRefreshSelectedItem = computed(() =>
  Boolean(
    selectedItemCid.value &&
    window.bidkingDesktop?.isDesktop &&
    typeof window.bidkingDesktop?.refreshItemTradeInfo === 'function',
  ),
);
```

Extract history loading into a helper:

```js
async function loadSelectedHistory(cid) {
  const payload = await fetchJson(`/api/price-history/item/${cid}?limit=1000`);
  selectedHistory.value = Array.isArray(payload.history) ? payload.history : [];
}
```

Change `selectItem` to call `loadSelectedHistory(cid)`.

Add:

```js
async function refreshSelectedItem() {
  if (!selectedItemCid.value || isRefreshingItem.value) return;
  if (!canRefreshSelectedItem.value) {
    itemRefreshError.value = t('price.refreshItemUnavailable');
    return;
  }
  const cid = selectedItemCid.value;
  isRefreshingItem.value = true;
  itemRefreshError.value = '';
  try {
    const result = await window.bidkingDesktop.refreshItemTradeInfo(cid);
    if (result?.ok === false) throw new Error(result.error || t('price.refreshItemUnavailable'));
    const latestPayload = await fetchJson('/api/price-history/latest');
    latestPrices.value = Array.isArray(latestPayload.items) ? latestPayload.items : [];
    if (selectedItemCid.value === cid) await loadSelectedHistory(cid);
  } catch (error) {
    itemRefreshError.value = getErrorMessage(error);
  } finally {
    isRefreshingItem.value = false;
  }
}
```

- [ ] **Step 5: Add button and remove text list**

In the detail panel header, add:

```vue
<button
  v-if="selectedItemCid"
  class="ghost-button"
  type="button"
  data-testid="price-item-refresh"
  :disabled="isRefreshingItem || !canRefreshSelectedItem"
  @click="refreshSelectedItem"
>
  {{ isRefreshingItem ? t('price.refreshingItem') : t('price.refreshItem') }}
</button>
```

Below the header, add:

```vue
<p v-if="itemRefreshError" class="error-text">{{ itemRefreshError }}</p>
```

Remove this entire block:

```vue
<div v-if="selectedHistory.length" class="history-list">
  <div v-for="row in selectedHistory" :key="`${row.observedAt}:${row.minPrice}`">
    <span>{{ formatDateTime(row.observedAt) }}</span>
    <strong>{{ formatNumber(row.minPrice) }}</strong>
  </div>
</div>
```

Remove `.history-list` CSS rules from `src/price/price.css` if no longer used.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- src/price/App.test.js
```

Expected: PASS.

Commit:

```bash
git add src/price/App.vue src/price/App.test.js src/shared/messages.js src/price/price.css
git commit -m "feat: refresh selected price item"
```

---

## Task 3: Final Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- electron/services/inject-service.test.mjs src/price/App.test.js src/price/PriceTrendChart.test.js
```

Expected: all selected tests pass.

- [ ] **Step 2: Check git status**

Run:

```bash
git status --short
```

Expected: only pre-existing unrelated dirty files remain, especially existing `public/price` build output changes.

- [ ] **Step 3: Do not build public/price in this pass**

Do not run `npm run build:price` unless the user explicitly asks to update and commit generated `public/price` assets, because the working tree already contains unrelated `public/price` changes.
