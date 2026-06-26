# Warehouse Auto-Sell Completion Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the warehouse auto-seller completes or fails, show a Windows desktop notification via the existing `window.bidkingDesktop.showNotification` bridge.

**Architecture:** Add a `_notifyCompletion` helper inside `useWarehouseAutoSeller` composable, call it before each of the four terminal `phase` assignments. Follow the existing Elsa `useElsaAutoOperation.js` pattern. No IPC or preload changes needed.

**Tech Stack:** Vue 3 composable, Vitest + Vue Test Utils

## Global Constraints

- Notification title: fixed `'BKToolBox'` (consistent with Elsa convention)
- Notification body: Chinese wrapper text with inline data (`successCount`, `skippedCount`, `lastError`)
- Notification failure must never block the auto-seller flow
- In non-desktop environments, auto-seller completes normally without errors
- Do not modify `electron/services/desktop-notification.js` or IPC layer
- Do not add i18n for notification wrapper text
- Do not add public notification config options to the composable

---

### Task 1: Add notification helper and call sites in composable

**Files:**
- Modify: `src/price/useWarehouseAutoSeller.js:83` (insert after `_cancelableSleep`, before `_getNextCandidate`)
- Modify: `src/price/useWarehouseAutoSeller.js:193-195` (insert before `phase = 'failed'`)
- Modify: `src/price/useWarehouseAutoSeller.js:202-204` (insert before `phase = 'completed'`)
- Modify: `src/price/useWarehouseAutoSeller.js:210` (insert before `phase = 'failed'`)
- Modify: `src/price/useWarehouseAutoSeller.js:217-219` (insert before `phase = 'failed'`)

**Interfaces:**
- Consumes: `window.bidkingDesktop?.showNotification` — existing bridge API, `(title: string, body: string) => Promise<{ok: boolean}>`
- Produces: `_notifyCompletion(title, body)` — internal helper, no return value

- [ ] **Step 1: Add `_notifyCompletion` helper**

Insert after the closing `}` of `_cancelableSleep` (line 83) and before `_getNextCandidate` (line 85):

```javascript
  async function _notifyCompletion(title, body) {
    const notify = window.bidkingDesktop?.showNotification;
    if (typeof notify !== 'function') return;
    try {
      const result = await notify(title, body);
      if (!result?.ok) {
        console.warn(`Desktop notification failed: ${result?.error || 'unknown error'}`);
      }
    } catch (e) {
      console.warn(`Desktop notification failed: ${e?.message || e}`);
    }
  }
```

- [ ] **Step 2: Add notification calls at four terminal sites**

**Site A — initial snapshot failure** (line 192-195):

Replace:
```javascript
      if (!snap.ok) {
        lastError.value = snap.error ?? errors.loadWarehouseFailed;
        phase.value = 'failed';
        return;
      }
```

With:
```javascript
      if (!snap.ok) {
        lastError.value = snap.error ?? errors.loadWarehouseFailed;
        await _notifyCompletion(
          'BKToolBox',
          `自动售卖失败：${lastError.value}`
        );
        phase.value = 'failed';
        return;
      }
```

**Site B — completion** (line 202-204):

Replace:
```javascript
        if (!candidate) {
          phase.value = 'completed';
          return;
        }
```

With:
```javascript
        if (!candidate) {
          await _notifyCompletion(
            'BKToolBox',
            `自动售卖完成，成功上架 ${successCount.value} 件，跳过 ${skippedCount.value} 件`
          );
          phase.value = 'completed';
          return;
        }
```

**Site C — item-processing failure** (line 210):

Replace:
```javascript
        if (outcome === 'failed') { phase.value = 'failed'; return; }
```

With:
```javascript
        if (outcome === 'failed') {
          await _notifyCompletion(
            'BKToolBox',
            `自动售卖失败：${lastError.value || '未知错误'}`
          );
          phase.value = 'failed';
          return;
        }
```

**Site D — snapshot-after-success failure** (lines 216-219):

Replace:
```javascript
          if (!snapAfter.ok) {
            lastError.value = snapAfter.error ?? errors.warehouseRefreshAfterSuccessFailed;
            phase.value = 'failed';
            return;
          }
```

With:
```javascript
          if (!snapAfter.ok) {
            lastError.value = snapAfter.error ?? errors.warehouseRefreshAfterSuccessFailed;
            await _notifyCompletion(
              'BKToolBox',
              `自动售卖失败：${lastError.value}`
            );
            phase.value = 'failed';
            return;
          }
```

- [ ] **Step 3: Run existing auto-seller tests to confirm no regressions**

```powershell
npx vitest run src/price/App.test.js -t "auto-seller"
```

Expected: all existing auto-seller tests pass without modification.

- [ ] **Step 4: Commit**

```bash
git add src/price/useWarehouseAutoSeller.js
git commit -m "feat: add desktop notification on auto-sell completion and failure"
```

---

### Task 2: Add notification tests

**Files:**
- Modify: `src/price/App.test.js:2652-2689` (update `mountAutoSellerTab` helper)
- Modify: `src/price/App.test.js` (add 7 new test cases at end of auto-seller describe block)

**Interfaces:**
- Consumes: `mountAutoSellerTab` (updated to accept `showNotification` option), `createWarehouseStockItem`, `createDeferred`
- Produces: 7 new `it(...)` blocks

- [ ] **Step 1: Update `mountAutoSellerTab` helper to support `showNotification`**

In `mountAutoSellerTab` (line 2652), add `showNotification` to the options destructuring and install it on `window.bidkingDesktop`:

Change:
```javascript
async function mountAutoSellerTab(options = {}) {
  const stockItems = options.stockItems ?? [];
  const commands = options.commands ?? {};
  const calls = [];
```

To:
```javascript
async function mountAutoSellerTab(options = {}) {
  const stockItems = options.stockItems ?? [];
  const commands = options.commands ?? {};
  const calls = [];
  const showNotification = options.showNotification;
```

Change line 2677 from:
```javascript
  window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
```

To:
```javascript
  window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
  if (showNotification) window.bidkingDesktop.showNotification = showNotification;
```

- [ ] **Step 2: Write 7 new test cases**

Insert before the closing `});` of the `describe('auto-seller', () => {` block:

```javascript
  it('notifies on completion with success and skipped counts', async () => {
    const showNotification = vi.fn().mockResolvedValue({ ok: true, shown: true });
    const { wrapper } = await mountAutoSellerTab({ stockItems: [], showNotification });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(showNotification).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledWith(
      'BKToolBox',
      expect.stringContaining('自动售卖完成')
    );
    expect(showNotification.mock.calls[0][1]).toMatch(/成功上架\s+0\s+件，跳过\s+0\s+件/);
  });

  it('notifies on initial snapshot failure', async () => {
    const showNotification = vi.fn().mockResolvedValue({ ok: true, shown: true });
    const { wrapper } = await mountAutoSellerTab({
      commands: {
        GetStockContainers: async () => ({ ok: false, error: 'bridge error' }),
      },
      showNotification,
    });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(showNotification).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledWith(
      'BKToolBox',
      expect.stringContaining('自动售卖失败')
    );
    expect(showNotification.mock.calls[0][1]).toContain('bridge error');
  });

  it('notifies on item-processing failure', async () => {
    let snapCalls = 0;
    const showNotification = vi.fn().mockResolvedValue({ ok: true, shown: true });
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetItemTradeInfo: async () => ({ ok: false, error: 'trade info unavailable' }),
        GetStockContainers: async () => {
          snapCalls++;
          // First call (initial snapshot) succeeds; second call (inside _handleNonRecoverableSkip) fails
          if (snapCalls === 1) {
            return {
              ok: true,
              value: createWarehouseSnapshot([
                createWarehouseContainer({ stockId: 0, items: [
                  createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
                ]}),
              ]),
            };
          }
          return { ok: false, error: 'snapshot after skip failed' };
        },
      },
      showNotification,
    });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(showNotification).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledWith(
      'BKToolBox',
      expect.stringContaining('自动售卖失败')
    );
    expect(showNotification.mock.calls[0][1]).toContain('snapshot after skip failed');
  });

  it('notifies on snapshot-after-success failure', async () => {
    let snapCalls = 0;
    const showNotification = vi.fn().mockResolvedValue({ ok: true, shown: true });
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => ({ ok: true }),
        GetStockContainers: async () => {
          snapCalls++;
          if (snapCalls <= 2) {
            return {
              ok: true,
              value: createWarehouseSnapshot([
                createWarehouseContainer({ stockId: 0, items: [
                  createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
                ]}),
              ]),
            };
          }
          return { ok: false, error: 'post-sale snapshot failed' };
        },
      },
      showNotification,
    });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(showNotification).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledWith(
      'BKToolBox',
      expect.stringContaining('自动售卖失败')
    );
    expect(showNotification.mock.calls[0][1]).toContain('post-sale snapshot failed');
  });

  it('completes normally when showNotification returns { ok: false }', async () => {
    const showNotification = vi.fn().mockResolvedValue({ ok: false, shown: false });
    const { wrapper } = await mountAutoSellerTab({ stockItems: [], showNotification });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toContain('已完成');
  });

  it('completes normally when showNotification throws', async () => {
    const showNotification = vi.fn().mockRejectedValue(new Error('notification crashed'));
    const { wrapper } = await mountAutoSellerTab({ stockItems: [], showNotification });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toContain('已完成');
  });

  it('completes normally when showNotification is absent (non-desktop)', async () => {
    // mountAutoSellerTab installs isDesktop + runAutoOperationCommand but no showNotification
    const { wrapper } = await mountAutoSellerTab({ stockItems: [] });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toContain('已完成');
  });
```

- [ ] **Step 3: Run the new tests**

```powershell
npx vitest run src/price/App.test.js -t "auto-seller"
```

Expected: all existing tests + 7 new tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/price/App.test.js
git commit -m "test: add auto-sell notification regression tests (7 cases)"
```

---

### Task 3: Update Documentation.md

**Files:**
- Modify: `docs/Documentation.md`

**Interfaces:**
- Produces: one documentation line recording the new notification behavior

- [ ] **Step 1: Add documentation line**

Find the Price page section in `docs/Documentation.md` (around the auto-seller/listing area). Add:

```markdown
- 当自动售卖完成或失败时（桌面环境下，需要 `bidkingDesktop` 桥接），`useWarehouseAutoSeller` 会通过 `window.bidkingDesktop.showNotification` 发送 Windows 桌面通知；通知失败不会阻塞售卖流程
```

- [ ] **Step 2: Commit**

```bash
git add docs/Documentation.md
git commit -m "docs: record auto-sell desktop notification behavior"
```

---

### Task 4: Full verification

**Files:**
- (none — verification only)

- [ ] **Step 1: Run git diff --check**

```powershell
git diff --check
```

Expected: no output (no whitespace errors).

- [ ] **Step 2: Run full test suite**

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run page build**

```powershell
npm run build:pages
```

Expected: all page entry bundles build successfully.

- [ ] **Step 4: Final review of the diff**

```powershell
git diff master --stat
```

Confirm only the expected files are changed:
- `src/price/useWarehouseAutoSeller.js` (notification helper + 4 call sites)
- `src/price/App.test.js` (helper update + 7 test cases)
- `docs/Documentation.md` (documentation update)
