# Price Collections Capture CIDs Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a button in the `price` page `collections` panel that captures the in-game collected collectible CID list, writes `Documents/BKPriceHistory/Cids.json`, and refreshes the panel from the existing collections API.

**Architecture:** Keep the renderer thin. The `price` page only triggers a dedicated desktop bridge action and then reuses `refreshCollections()`. Electron owns the native workflow (`startAutoOperationAgent` -> `GetCollectionItemCids` -> `recordCollectionCids`), and the recorder remains the single place that defines the output file semantics.

**Tech Stack:** Vue 3, Vitest, Electron IPC (`preload.js` + `ipcMain`), Node.js file I/O, existing AutoOperation Agent bridge.

---

## File Map

- Modify: `lib/trade-info-history-recorder.js`
  - Extend `recordCollectionCids(...)` result shape with `outputPath`.
- Modify: `lib/trade-info-history-recorder.test.mjs`
  - Lock the new return shape and output path behavior.
- Modify: `electron/services/inject-service.js`
  - Add `captureCollectionCidsToFile(...)`.
- Modify: `electron/services/inject-service.test.mjs`
  - Cover success path and start-agent sequencing for the new helper.
- Modify: `electron/preload.js`
  - Expose `captureCollectionCidsToFile`.
- Modify: `electron/main.js`
  - Add IPC handler `inject:captureCollectionCidsToFile`.
- Modify: `src/price/App.vue`
  - Add button, busy state, capability guard, and capture action.
- Modify: `src/price/App.test.js`
  - Cover UI rendering, success refresh flow, busy-state disabling, and failure behavior.

---

### Task 1: Recorder + Electron capture API

**Files:**
- Modify: `lib/trade-info-history-recorder.js`
- Modify: `lib/trade-info-history-recorder.test.mjs`
- Modify: `electron/services/inject-service.js`
- Modify: `electron/services/inject-service.test.mjs`
- Modify: `electron/preload.js`
- Modify: `electron/main.js`

- [ ] **Step 1: Write the failing recorder test for `outputPath`**

Add to `lib/trade-info-history-recorder.test.mjs` in the existing `writes Cids.json with unique positive cids` test:

```js
const expectedPath = path.join(rootDir, 'Cids.json');
expect(result).toEqual({
  written: true,
  itemCids: [1032006, 1013007],
  outputPath: expectedPath,
});
expect(JSON.parse(fs.readFileSync(expectedPath, 'utf8'))).toEqual([1032006, 1013007]);
```

- [ ] **Step 2: Run the recorder test to verify it fails**

Run: `npx vitest run lib/trade-info-history-recorder.test.mjs`
Expected: FAIL because `outputPath` is missing from `recordCollectionCids(...)`.

- [ ] **Step 3: Implement the recorder return-shape update**

Update `lib/trade-info-history-recorder.js`:

```js
function recordCollectionCids(cids, deps = {}) {
  const rootDir = deps.rootDir || getDefaultRootDir();
  const outputPath = path.join(rootDir, 'Cids.json');
  const seen = new Set();
  const itemCids = [];

  for (const value of Array.isArray(cids) ? cids : []) {
    const cid = normalizePositiveInteger(value);
    if (cid === null || seen.has(cid)) continue;
    seen.add(cid);
    itemCids.push(cid);
  }

  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(itemCids)}\n`, 'utf8');

  return { written: true, itemCids, outputPath };
}
```

- [ ] **Step 4: Re-run the recorder test**

Run: `npx vitest run lib/trade-info-history-recorder.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing Electron service tests**

Add to `electron/services/inject-service.test.mjs`:

```js
it('captures collection cids to file after starting the auto operation agent', async () => {
  const startAutoOperationAgent = vi.fn().mockResolvedValue({ ok: true });
  const runAutoOperationCommand = vi.fn().mockResolvedValue({
    ok: true,
    value: { cids: [1032006, 1013007, 1032006] },
  });
  const recordCollectionCids = vi.fn().mockReturnValue({
    written: true,
    itemCids: [1032006, 1013007],
    outputPath: 'C:/Users/test/Documents/BKPriceHistory/Cids.json',
  });

  const result = await service.captureCollectionCidsToFile({
    startAutoOperationAgent,
    runAutoOperationCommand,
    recordCollectionCids,
  });

  expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);
  expect(runAutoOperationCommand).toHaveBeenCalledWith('GetCollectionItemCids', {}, expect.any(Object));
  expect(recordCollectionCids).toHaveBeenCalledWith([1032006, 1013007, 1032006], expect.any(Object));
  expect(result).toEqual({
    ok: true,
    value: {
      itemCids: [1032006, 1013007],
      count: 2,
      outputPath: 'C:/Users/test/Documents/BKPriceHistory/Cids.json',
    },
  });
});

it('propagates GetCollectionItemCids failures from captureCollectionCidsToFile', async () => {
  const startAutoOperationAgent = vi.fn().mockResolvedValue({ ok: true });
  const runAutoOperationCommand = vi.fn().mockRejectedValue(new Error('native failed'));

  await expect(service.captureCollectionCidsToFile({
    startAutoOperationAgent,
    runAutoOperationCommand,
    recordCollectionCids: vi.fn(),
  })).rejects.toThrow('native failed');
});
```

- [ ] **Step 6: Run the Electron service test file to verify it fails**

Run: `npx vitest run electron/services/inject-service.test.mjs`
Expected: FAIL because `captureCollectionCidsToFile` does not exist yet.

- [ ] **Step 7: Implement the Electron capture helper and bridge**

Update `electron/services/inject-service.js`:

```js
async function captureCollectionCidsToFile(deps = {}) {
  await (deps.startAutoOperationAgent || startAutoOperationAgent)(deps);
  const response = await (deps.runAutoOperationCommand || runAutoOperationCommand)(
    'GetCollectionItemCids',
    {},
    deps,
  );
  const cids = Array.isArray(response?.value?.cids) ? response.value.cids : [];
  const recorded = (deps.recordCollectionCids || recordCollectionCids)(cids, deps);
  return {
    ok: true,
    value: {
      itemCids: Array.isArray(recorded?.itemCids) ? recorded.itemCids : [],
      count: Array.isArray(recorded?.itemCids) ? recorded.itemCids.length : 0,
      outputPath: recorded?.outputPath || '',
    },
  };
}

module.exports = {
  refreshItemTradeInfo,
  runAutoOperationCommand,
  captureCollectionCidsToFile,
  ...
};
```

Update `electron/preload.js`:

```js
captureCollectionCidsToFile: () => ipcRenderer.invoke('inject:captureCollectionCidsToFile'),
```

Update `electron/main.js`:

```js
ipcMain.handle('inject:captureCollectionCidsToFile', async () => {
  try {
    return await captureCollectionCidsToFile();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
```

Also add the import in `electron/main.js`:

```js
const {
  refreshItemTradeInfo,
  runAutoOperationCommand,
  captureCollectionCidsToFile,
  ...
} = require('./services/inject-service');
```

- [ ] **Step 8: Re-run the focused backend tests**

Run: `npx vitest run lib/trade-info-history-recorder.test.mjs electron/services/inject-service.test.mjs electron/services/collection-price-scan-controller.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/trade-info-history-recorder.js \
        lib/trade-info-history-recorder.test.mjs \
        electron/services/inject-service.js \
        electron/services/inject-service.test.mjs \
        electron/preload.js \
        electron/main.js
git commit -m "feat: add collection cid capture bridge"
```

---

### Task 2: Price page button, busy state, and refresh flow

**Files:**
- Modify: `src/price/App.vue`
- Modify: `src/price/App.test.js`

- [ ] **Step 1: Write the failing UI tests**

Add to `src/price/App.test.js`:

```js
it('captures collection cids to file from the Collections tab and refreshes the panel', async () => {
  mockFetch({
    collectionsResponses: [
      [1022002],
      [1022002, 1022003],
    ],
    latestResponses: [
      latestRows,
      latestRows.map((row) => row.itemCid === 1022003
        ? { ...row, observedAt: '2026-05-28T13:10:00.000Z', minPrice: 2400 }
        : row),
    ],
  });
  const captureCollectionCidsToFile = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      itemCids: [1022002, 1022003],
      count: 2,
      outputPath: 'C:/Users/test/Documents/BKPriceHistory/Cids.json',
    },
  });
  window.bidkingDesktop = {
    isDesktop: true,
    runAutoOperationCommand: vi.fn(),
    captureCollectionCidsToFile,
  };
  const wrapper = await mountApp();

  await wrapper.find('[data-testid="price-tab-collections"]').trigger('click');
  await flushPromises();
  await nextTick();
  await wrapper.find('[data-testid="price-collections-capture"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(captureCollectionCidsToFile).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('/api/price-history/latest');
  expect(fetch).toHaveBeenCalledWith('/api/price-history/collections');
  expect(wrapper.find('[data-testid="price-collections"]').text()).toContain(getTestCollectible(1022003).name);
});

it('disables collections actions while capture is running', async () => {
  mockFetch();
  let resolveCapture;
  const captureCollectionCidsToFile = vi.fn(() => new Promise((resolve) => {
    resolveCapture = resolve;
  }));
  window.bidkingDesktop = {
    isDesktop: true,
    runAutoOperationCommand: vi.fn(),
    captureCollectionCidsToFile,
  };
  const wrapper = await mountApp();

  await wrapper.find('[data-testid="price-tab-collections"]').trigger('click');
  await nextTick();
  await wrapper.find('[data-testid="price-collections-capture"]').trigger('click');
  await nextTick();

  expect(wrapper.find('[data-testid="price-collections-capture"]').attributes('disabled')).toBeDefined();
  expect(wrapper.find('[data-testid="price-collections-refresh"]').attributes('disabled')).toBeDefined();

  resolveCapture({
    ok: true,
    value: { itemCids: [1022002], count: 1, outputPath: 'C:/Users/test/Documents/BKPriceHistory/Cids.json' },
  });
  await flushPromises();
});

it('shows an error and skips refresh when collections capture fails', async () => {
  mockFetch();
  window.bidkingDesktop = {
    isDesktop: true,
    runAutoOperationCommand: vi.fn(),
    captureCollectionCidsToFile: vi.fn().mockRejectedValue(new Error('capture failed')),
  };
  const wrapper = await mountApp();

  await wrapper.find('[data-testid="price-tab-collections"]').trigger('click');
  await nextTick();
  await wrapper.find('[data-testid="price-collections-capture"]').trigger('click');
  await flushPromises();
  await nextTick();

  expect(wrapper.text()).toContain('capture failed');
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/price-history/collections'))).toHaveLength(1);
});
```

- [ ] **Step 2: Run the price page test file to verify it fails**

Run: `npx vitest run src/price/App.test.js`
Expected: FAIL because the new button and capture action do not exist yet.

- [ ] **Step 3: Implement the price page feature**

Update `src/price/App.vue` state:

```js
const isCapturingCollections = ref(false);

const canCaptureCollections = computed(() =>
  Boolean(
    window.bidkingDesktop?.isDesktop
    && typeof window.bidkingDesktop?.captureCollectionCidsToFile === 'function',
  ));
```

Add the action:

```js
async function captureCollectionsToFile() {
  if (isCapturingCollections.value) return;
  if (!canCaptureCollections.value) {
    errorText.value = t('price.refreshCollectionsUnavailable');
    return;
  }

  isCapturingCollections.value = true;
  errorText.value = '';
  try {
    const result = await window.bidkingDesktop.captureCollectionCidsToFile();
    if (result?.ok === false) throw new Error(result.error || t('price.refreshCollectionsUnavailable'));
    await refreshCollections();
  } catch (error) {
    errorText.value = getErrorMessage(error);
  } finally {
    isCapturingCollections.value = false;
  }
}
```

Update the collections header template:

```vue
<div class="panel-actions">
  <button
    class="ghost-button"
    type="button"
    data-testid="price-collections-capture"
    :disabled="isCapturingCollections || isRefreshingCollections"
    @click="captureCollectionsToFile"
  >
    {{ isCapturingCollections ? t('price.capturingCollections') : t('price.captureCollections') }}
  </button>
  <button
    class="ghost-button"
    type="button"
    data-testid="price-collections-refresh"
    :disabled="isCapturingCollections || isRefreshingCollections"
    @click="refreshCollections"
  >
    {{ isRefreshingCollections ? t('price.refreshingCollections') : t('price.refreshCollections') }}
  </button>
</div>
```

Update `src/shared/messages.js`:

```js
captureCollections: '写入收藏列表',
capturingCollections: '写入中',
refreshCollectionsUnavailable: '当前环境不支持写入 Collections 藏品',
```

```js
captureCollections: 'Capture Collections',
capturingCollections: 'Capturing',
refreshCollectionsUnavailable: 'Current environment cannot capture collection items',
```

Update `src/price/price.css` if needed:

```css
.panel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
```

- [ ] **Step 4: Re-run the price page test file**

Run: `npx vitest run src/price/App.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/price/App.vue src/price/App.test.js src/shared/messages.js src/price/price.css
git commit -m "feat: add price collections capture button"
```

---

### Task 3: Focused verification and finish line

**Files:**
- No new code expected unless verification reveals a bug.

- [ ] **Step 1: Run the full targeted test set**

Run:

```bash
npx vitest run \
  src/price/App.test.js \
  electron/services/inject-service.test.mjs \
  electron/services/collection-price-scan-controller.test.mjs \
  lib/trade-info-history-recorder.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Build the price page**

Run: `npm run build:price`
Expected: successful Vite build with no errors.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat master...
```

Expected: only the intended `price` page, Electron bridge, recorder, tests, and docs files changed in this worktree branch.

- [ ] **Step 4: Commit any final fixups**

```bash
git add .
git commit -m "chore: finalize collection capture button verification"
```

- [ ] **Step 5: Record execution note**

If no final fixup commit is needed, note in the implementation log / final response that Task 3 completed with verification only and no extra code changes.
