# Price 仓库交易所上架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Price 页面选中某个仓库藏品后,通过一个弹窗手动输入单价(默认=当前最低价-10)和数量,确认后调用已注入的 AutoOperation Agent 把藏品上架到交易所。

**Architecture:** 纯前端。把可单元测试的纯逻辑(默认价、校验、总价)抽到 `src/price/listing-form.js`;弹窗 UI 放在新建的 `src/price/ListingModal.vue`;`src/price/App.vue` 在选中藏品详情区加「上架」按钮挂载弹窗。执行复用已暴露的 `window.bidkingDesktop.runAutoOperationCommand('GetItemTradeInfo' | 'ExchangeItem', args)`,无后端/Electron/Agent 改动。

**Tech Stack:** Vue 3 `<script setup>` + Vite,i18n 经 `src/shared/i18n.js`(locales `zh-CN` / `en-US`),Vitest + @vue/test-utils + happy-dom。

参考规范:`docs/superpowers/specs/2026-06-03-price-warehouse-listing-design.md`

---

## File Structure

- **Create** `src/price/listing-form.js` — 纯函数:`computeDefaultUnitPrice`、`computeTotal`、`validateListing`。无 Vue 依赖,单测直接覆盖。
- **Create** `src/price/listing-form.test.js` — 上述纯函数的单测。
- **Create** `src/price/ListingModal.vue` — 上架弹窗组件。挂载时拉 `GetItemTradeInfo`,渲染挂单阶梯,用纯函数算默认价/校验/总价,确认时调 `ExchangeItem`,emit `listed` / `close`。
- **Create** `src/price/ListingModal.test.js` — 弹窗组件交互测试。
- **Modify** `src/shared/messages.js` — 在 `zh-CN` 和 `en-US` 两处 `price` 块各加一个 `listing` 子对象。
- **Modify** `src/price/App.vue` — 详情区头部加「上架」按钮(仅桌面端 + agent 可用 + 持有数>0 时显示),挂载 `ListingModal`,成功后刷新仓库并提示。
- **Modify** `src/price/App.test.js` — 按钮可见性 + 打开弹窗 + 成功后刷新的回归测试。
- **Modify** `docs/Documentation.md` — 记录新功能当前状态。

---

## Task 1: 上架 i18n 文案

**Files:**
- Modify: `src/shared/messages.js`(`zh-CN` 的 `price` 块在第 106 行附近;`en-US` 的 `price` 块在第 733 行附近)

- [ ] **Step 1: 在 `zh-CN` 的 `price` 对象内新增 `listing` 子对象**

在 `src/shared/messages.js` 中 `'zh-CN'` → `price:` 对象内(例如紧跟 `noWarehouseItems: '暂无仓库藏品',` 之后)加入:

```js
      listing: {
        open: '上架',
        title: '上架到交易所',
        currentListings: '当前挂单',
        noListings: '当前无挂单',
        unitPrice: '单价',
        count: '数量',
        owned: '持有',
        total: '总价',
        confirm: '确认上架',
        submitting: '上架中',
        cancel: '取消',
        loadError: '获取交易所行情失败',
        submitError: '上架失败',
        unavailable: '当前环境不支持上架',
        success: '上架成功',
      },
```

- [ ] **Step 2: 在 `en-US` 的 `price` 对象内新增同结构 `listing` 子对象**

在 `'en-US'` → `price:` 对象内加入:

```js
      listing: {
        open: 'List',
        title: 'List on Exchange',
        currentListings: 'Current Listings',
        noListings: 'No current listings',
        unitPrice: 'Unit Price',
        count: 'Quantity',
        owned: 'Owned',
        total: 'Total',
        confirm: 'Confirm Listing',
        submitting: 'Listing...',
        cancel: 'Cancel',
        loadError: 'Failed to load exchange market info',
        submitError: 'Listing failed',
        unavailable: 'Current environment cannot list items',
        success: 'Listed successfully',
      },
```

- [ ] **Step 3: 跑现有测试确认未破坏**

Run: `npx vitest run src/price/App.test.js`
Expected: PASS(新增键不影响现有断言)

- [ ] **Step 4: Commit**

```bash
git add src/shared/messages.js
git commit -m "feat: add price listing i18n strings"
```

---

## Task 2: 上架纯逻辑(默认价 / 校验 / 总价)

**Files:**
- Create: `src/price/listing-form.js`
- Test: `src/price/listing-form.test.js`

- [ ] **Step 1: 写失败测试**

创建 `src/price/listing-form.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { computeDefaultUnitPrice, computeTotal, validateListing } from './listing-form.js';

describe('computeDefaultUnitPrice', () => {
  it('returns minPrice minus 10 when comfortably above the floor', () => {
    expect(computeDefaultUnitPrice(1600)).toBe(1590);
  });

  it('floors at 1 when minPrice is 10 or below', () => {
    expect(computeDefaultUnitPrice(10)).toBe(1);
    expect(computeDefaultUnitPrice(5)).toBe(1);
  });

  it('returns null when there is no usable minPrice', () => {
    expect(computeDefaultUnitPrice(0)).toBeNull();
    expect(computeDefaultUnitPrice(null)).toBeNull();
    expect(computeDefaultUnitPrice(Number.NaN)).toBeNull();
  });
});

describe('computeTotal', () => {
  it('multiplies integer count and unit price', () => {
    expect(computeTotal({ count: 3, unitPrice: 1590 })).toBe(4770);
  });

  it('returns null for non-positive or non-integer inputs', () => {
    expect(computeTotal({ count: 0, unitPrice: 1590 })).toBeNull();
    expect(computeTotal({ count: 2.5, unitPrice: 1590 })).toBeNull();
    expect(computeTotal({ count: 3, unitPrice: 0 })).toBeNull();
  });
});

describe('validateListing', () => {
  it('accepts an integer count within owned range and a positive integer price', () => {
    expect(validateListing({ count: 5, unitPrice: 1590, ownedCount: 12 }))
      .toEqual({ valid: true, errors: {} });
  });

  it('rejects a count above the owned amount', () => {
    const result = validateListing({ count: 13, unitPrice: 1590, ownedCount: 12 });
    expect(result.valid).toBe(false);
    expect(result.errors.count).toBe(true);
  });

  it('rejects a count below 1 and a unit price below 1', () => {
    expect(validateListing({ count: 0, unitPrice: 1590, ownedCount: 12 }).errors.count).toBe(true);
    expect(validateListing({ count: 5, unitPrice: 0, ownedCount: 12 }).errors.unitPrice).toBe(true);
  });

  it('rejects non-integer inputs', () => {
    expect(validateListing({ count: 2.5, unitPrice: 1590, ownedCount: 12 }).errors.count).toBe(true);
    expect(validateListing({ count: 5, unitPrice: 10.5, ownedCount: 12 }).errors.unitPrice).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/price/listing-form.test.js`
Expected: FAIL(`Failed to resolve import "./listing-form.js"`)

- [ ] **Step 3: 写最小实现**

创建 `src/price/listing-form.js`:

```js
export function computeDefaultUnitPrice(minPrice) {
  const min = Number(minPrice);
  if (!Number.isFinite(min) || min <= 0) return null;
  return Math.max(min - 10, 1);
}

export function computeTotal({ count, unitPrice }) {
  const c = Number(count);
  const p = Number(unitPrice);
  if (!Number.isInteger(c) || !Number.isInteger(p)) return null;
  if (c < 1 || p < 1) return null;
  return c * p;
}

export function validateListing({ count, unitPrice, ownedCount }) {
  const c = Number(count);
  const p = Number(unitPrice);
  const owned = Number(ownedCount);
  const errors = {};
  if (!Number.isInteger(c) || c < 1 || (Number.isFinite(owned) && c > owned)) {
    errors.count = true;
  }
  if (!Number.isInteger(p) || p < 1) {
    errors.unitPrice = true;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/price/listing-form.test.js`
Expected: PASS(全部用例)

- [ ] **Step 5: Commit**

```bash
git add src/price/listing-form.js src/price/listing-form.test.js
git commit -m "feat: add price listing form helpers"
```

---

## Task 3: 上架弹窗组件 ListingModal.vue

**Files:**
- Create: `src/price/ListingModal.vue`
- Test: `src/price/ListingModal.test.js`

- [ ] **Step 1: 写失败测试**

创建 `src/price/ListingModal.test.js`:

```js
/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ListingModal from './ListingModal.vue';

function mockBridge(handlers = {}) {
  const runAutoOperationCommand = vi.fn(async (command, args) => {
    if (command === 'GetItemTradeInfo') {
      return handlers.tradeInfo
        ? handlers.tradeInfo(args)
        : { ok: true, value: { itemCid: args.itemCid, minPrice: 1600, totalCount: 7, tiers: [{ price: 1600, count: 2 }, { price: 1700, count: 5 }] } };
    }
    if (command === 'ExchangeItem') {
      return handlers.exchange ? handlers.exchange(args) : { ok: true, value: {} };
    }
    throw new Error(`unexpected command: ${command}`);
  });
  window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
  return runAutoOperationCommand;
}

async function mountModal(props = {}) {
  const wrapper = mount(ListingModal, {
    attachTo: document.body,
    props: { itemCid: 1022002, name: '测试藏品', quality: '金', ownedCount: 12, ...props },
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('ListingModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.bidkingDesktop;
  });

  afterEach(() => {
    delete window.bidkingDesktop;
  });

  it('fetches trade info on open, renders the ladder, and defaults the unit price to lowest minus 10', async () => {
    const run = mockBridge();
    const wrapper = await mountModal();

    expect(run).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1022002 });
    const tiersText = wrapper.find('[data-testid="listing-tiers"]').text();
    expect(tiersText).toContain('1600');
    expect(tiersText).toContain('1700');
    expect(wrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('1590');
    expect(wrapper.find('[data-testid="listing-count"]').element.value).toBe('12');
  });

  it('floors the default unit price at 1 and leaves it blank when there are no listings', async () => {
    mockBridge({ tradeInfo: () => ({ ok: true, value: { minPrice: 8, totalCount: 1, tiers: [{ price: 8, count: 1 }] } }) });
    const lowWrapper = await mountModal();
    expect(lowWrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('1');

    document.body.innerHTML = '';
    mockBridge({ tradeInfo: () => ({ ok: true, value: { minPrice: 0, totalCount: 0, tiers: [] } }) });
    const emptyWrapper = await mountModal();
    expect(emptyWrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('');
    expect(emptyWrapper.find('[data-testid="listing-tiers"]').text()).toContain('当前无挂单');
  });

  it('shows the live total and disables confirm when the count exceeds the owned amount', async () => {
    mockBridge();
    const wrapper = await mountModal();

    expect(wrapper.find('[data-testid="listing-total"]').text()).toContain('19,080');

    await wrapper.find('[data-testid="listing-count"]').setValue('13');
    await nextTick();
    expect(wrapper.find('[data-testid="listing-confirm"]').attributes('disabled')).toBeDefined();
  });

  it('lists with the entered count and unit price, then emits listed', async () => {
    const run = mockBridge();
    const wrapper = await mountModal();

    await wrapper.find('[data-testid="listing-unit-price"]').setValue('1590');
    await wrapper.find('[data-testid="listing-count"]').setValue('3');
    await nextTick();
    await wrapper.find('[data-testid="listing-confirm"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(run).toHaveBeenCalledWith('ExchangeItem', { itemCid: 1022002, count: 3, unitPrice: 1590 });
    expect(wrapper.emitted('listed')?.[0]?.[0]).toEqual({ itemCid: 1022002, count: 3, unitPrice: 1590 });
  });

  it('shows an error and stays open when listing fails', async () => {
    mockBridge({ exchange: () => ({ ok: false, error: '余额不足' }) });
    const wrapper = await mountModal();

    await wrapper.find('[data-testid="listing-confirm"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="listing-submit-error"]').text()).toContain('余额不足');
    expect(wrapper.emitted('listed')).toBeUndefined();
    expect(wrapper.find('[data-testid="listing-modal"]').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/price/ListingModal.test.js`
Expected: FAIL(`Failed to resolve import "./ListingModal.vue"`)

- [ ] **Step 3: 写组件实现**

创建 `src/price/ListingModal.vue`:

```vue
<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from '../shared/i18n.js';
import { computeDefaultUnitPrice, computeTotal, validateListing } from './listing-form.js';

const props = defineProps({
  itemCid: { type: Number, required: true },
  name: { type: String, default: '' },
  quality: { type: String, default: '' },
  ownedCount: { type: Number, default: 0 },
});
const emit = defineEmits(['listed', 'close']);

const { t } = useI18n();

const tiers = ref([]);
const isLoading = ref(false);
const loadError = ref('');
const unitPriceInput = ref('');
const countInput = ref(props.ownedCount > 0 ? String(props.ownedCount) : '');
const isSubmitting = ref(false);
const submitError = ref('');

const validation = computed(() => validateListing({
  count: countInput.value,
  unitPrice: unitPriceInput.value,
  ownedCount: props.ownedCount,
}));
const total = computed(() => computeTotal({ count: countInput.value, unitPrice: unitPriceInput.value }));
const canSubmit = computed(() => validation.value.valid && !isSubmitting.value);

function getBridge() {
  const desktop = window.bidkingDesktop;
  if (!desktop?.isDesktop || typeof desktop.runAutoOperationCommand !== 'function') return null;
  return desktop;
}

async function loadTradeInfo() {
  const bridge = getBridge();
  if (!bridge) {
    loadError.value = t('price.listing.unavailable');
    return;
  }
  isLoading.value = true;
  loadError.value = '';
  try {
    const response = await bridge.runAutoOperationCommand('GetItemTradeInfo', { itemCid: props.itemCid });
    if (response?.ok === false) throw new Error(response.error || t('price.listing.loadError'));
    const value = response?.value || {};
    tiers.value = Array.isArray(value.tiers) ? value.tiers : [];
    const minPrice = Number(value.minPrice);
    const suggested = computeDefaultUnitPrice(minPrice);
    unitPriceInput.value = suggested === null ? '' : String(suggested);
  } catch (error) {
    loadError.value = error?.message || String(error);
  } finally {
    isLoading.value = false;
  }
}

async function submit() {
  if (!validation.value.valid || isSubmitting.value) return;
  const bridge = getBridge();
  if (!bridge) {
    submitError.value = t('price.listing.unavailable');
    return;
  }
  const count = Number(countInput.value);
  const unitPrice = Number(unitPriceInput.value);
  isSubmitting.value = true;
  submitError.value = '';
  try {
    const response = await bridge.runAutoOperationCommand('ExchangeItem', { itemCid: props.itemCid, count, unitPrice });
    if (response?.ok === false) throw new Error(response.error || t('price.listing.submitError'));
    emit('listed', { itemCid: props.itemCid, count, unitPrice });
  } catch (error) {
    submitError.value = error?.message || String(error);
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(loadTradeInfo);
</script>

<template>
  <div class="listing-overlay" data-testid="listing-modal" @click.self="emit('close')">
    <div class="listing-dialog">
      <header class="listing-header">
        <h3>{{ t('price.listing.title') }}</h3>
        <p>{{ name }} · {{ itemCid }}<span v-if="quality"> / {{ quality }}</span></p>
      </header>

      <p v-if="loadError" class="error-text" data-testid="listing-load-error">{{ loadError }}</p>

      <section class="listing-tiers" data-testid="listing-tiers">
        <span class="label">{{ t('price.listing.currentListings') }}</span>
        <p v-if="!tiers.length" class="empty-cell">{{ t('price.listing.noListings') }}</p>
        <ul v-else>
          <li v-for="(tier, index) in tiers" :key="index">{{ tier.price }} × {{ tier.count }}</li>
        </ul>
      </section>

      <div class="listing-fields">
        <label>
          <span>{{ t('price.listing.unitPrice') }}</span>
          <input v-model="unitPriceInput" type="number" min="1" data-testid="listing-unit-price">
        </label>
        <label>
          <span>{{ t('price.listing.count') }}</span>
          <input v-model="countInput" type="number" min="1" :max="ownedCount" data-testid="listing-count">
          <small>{{ t('price.listing.owned') }}: {{ ownedCount }}</small>
        </label>
      </div>

      <p class="listing-total" data-testid="listing-total">
        {{ t('price.listing.total') }}: {{ total === null ? '-' : total.toLocaleString('en-US') }}
      </p>

      <p v-if="submitError" class="error-text" data-testid="listing-submit-error">{{ submitError }}</p>

      <footer class="listing-footer">
        <button type="button" class="ghost-button" data-testid="listing-cancel" @click="emit('close')">
          {{ t('price.listing.cancel') }}
        </button>
        <button type="button" data-testid="listing-confirm" :disabled="!canSubmit" @click="submit">
          {{ isSubmitting ? t('price.listing.submitting') : t('price.listing.confirm') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.listing-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.listing-dialog {
  background: var(--panel-bg, #1f2733);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 20px;
  width: min(440px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.listing-tiers ul { margin: 4px 0 0; padding-left: 18px; }
.listing-fields { display: flex; gap: 16px; }
.listing-fields label { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.listing-fields input { padding: 6px 8px; }
.listing-footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/price/ListingModal.test.js`
Expected: PASS(5 个用例)

- [ ] **Step 5: Commit**

```bash
git add src/price/ListingModal.vue src/price/ListingModal.test.js
git commit -m "feat: add exchange listing modal"
```

---

## Task 4: App.vue 接入上架按钮与弹窗

**Files:**
- Modify: `src/price/App.vue`(脚本区 + 详情区 `detail-panel` header,约第 511-527 行)
- Test: `src/price/App.test.js`

- [ ] **Step 1: 写失败测试**

在 `src/price/App.test.js` 的 `describe('Price App', …)` 内,文件末尾(最后一个 `it` 之后、`})` 之前)追加。注意:把现有 `refreshes warehouse collectibles …` 等用例里的 `runAutoOperationCommand` mock 保持不变;以下新增用例使用各自的命令感知 mock。

```js
  it('hides the listing button when not running on desktop', async () => {
    const wrapper = await mountApp();
    await wrapper.find('[data-testid="opportunity-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="price-listing-open"]').exists()).toBe(false);
  });

  it('hides the listing button for a selected item that is not owned in the warehouse', async () => {
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand: vi.fn(async () => ({ ok: true, value: { items: [] } })),
    };
    const wrapper = await mountApp();
    await wrapper.find('[data-testid="opportunity-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="price-listing-open"]').exists()).toBe(false);
  });

  it('opens the listing modal for an owned warehouse item and refreshes counts after listing', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockCollectibleCounts') {
        return { ok: true, value: { items: [{ itemCid: 1022002, count: 4 }] } };
      }
      if (command === 'GetItemTradeInfo') {
        return { ok: true, value: { itemCid: 1022002, minPrice: 1600, totalCount: 7, tiers: [{ price: 1600, count: 2 }] } };
      }
      if (command === 'ExchangeItem') {
        return { ok: true, value: {} };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-listing-open"]').exists()).toBe(true);
    await wrapper.find('[data-testid="price-listing-open"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="listing-modal"]').exists()).toBe(true);

    await wrapper.find('[data-testid="listing-confirm"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('ExchangeItem', { itemCid: 1022002, count: 4, unitPrice: 1590 });
    expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'GetStockCollectibleCounts')).toHaveLength(2);
    expect(wrapper.find('[data-testid="listing-modal"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="price-listing-message"]').text()).toContain('上架成功');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/price/App.test.js -t "listing"`
Expected: FAIL(找不到 `price-listing-open` / `price-listing-message` 等元素)

- [ ] **Step 3: 在 `App.vue` 脚本区接入逻辑**

在 `src/price/App.vue` 顶部 import 区(第 5 行 `import PriceTrendChart …` 之后)加:

```js
import ListingModal from './ListingModal.vue';
```

在 ref 声明区(第 23 行 `opportunitySort` 之后)加:

```js
const isListingModalOpen = ref(false);
const listingMessage = ref('');
```

在 computed 区(第 98 行 `canRefreshWarehouse` 之后)加:

```js
const selectedOwnedCount = computed(() => {
  const row = warehouseItems.value.find((item) => item.itemCid === selectedItemCid.value);
  return row ? Number(row.count) || 0 : 0;
});

const canListItem = computed(() =>
  Boolean(
    selectedItemCid.value
    && selectedOwnedCount.value > 0
    && window.bidkingDesktop?.isDesktop
    && typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
  ));
```

在方法区(第 286 行 `refreshSelectedItem` 函数之后、`onMounted` 之前)加:

```js
function openListingModal() {
  listingMessage.value = '';
  isListingModalOpen.value = true;
}

function closeListingModal() {
  isListingModalOpen.value = false;
}

async function onItemListed() {
  isListingModalOpen.value = false;
  listingMessage.value = t('price.listing.success');
  await refreshWarehouseItems();
}
```

- [ ] **Step 4: 在 `App.vue` 详情区模板接入按钮与弹窗**

把 `src/price/App.vue` 详情区 header(第 517-526 行的「刷新当前藏品」按钮)替换为同时含「上架」按钮的版本——在该 `<button … data-testid="price-item-refresh" …>` 之前插入:

```html
          <button
            v-if="canListItem"
            type="button"
            data-testid="price-listing-open"
            @click="openListingModal"
          >
            {{ t('price.listing.open') }}
          </button>
```

在详情区 `itemRefreshError` 提示(第 529 行 `<p v-if="itemRefreshError" …>`)之后插入成功提示:

```html
        <p v-if="listingMessage" class="info-text" data-testid="price-listing-message">{{ listingMessage }}</p>
```

在 `detail-panel` 的 `</section>`(第 560 行)之前插入弹窗挂载:

```html
        <ListingModal
          v-if="isListingModalOpen"
          :item-cid="selectedItemCid"
          :name="selectedDisplayItem?.name || ''"
          :quality="selectedDisplayItem?.quality || ''"
          :owned-count="selectedOwnedCount"
          @listed="onItemListed"
          @close="closeListingModal"
        />
```

- [ ] **Step 5: 跑新增测试确认通过**

Run: `npx vitest run src/price/App.test.js -t "listing"`
Expected: PASS(3 个新增用例)

- [ ] **Step 6: 跑整个 price 测试确认无回归**

Run: `npx vitest run src/price/App.test.js src/price/ListingModal.test.js src/price/listing-form.test.js`
Expected: PASS(全部)

- [ ] **Step 7: Commit**

```bash
git add src/price/App.vue src/price/App.test.js
git commit -m "feat: wire exchange listing into price warehouse panel"
```

---

## Task 5: 文档与整体验证

**Files:**
- Modify: `docs/Documentation.md`

- [ ] **Step 1: 在 `docs/Documentation.md` 记录新功能**

在 Documentation.md 中 Price 页面相关的「当前状态」小节追加一条(若无该小节,则在文末「已知功能/状态」类列表追加):

```markdown
- Price 仓库 panel 选中已持有藏品后,详情区显示「上架」按钮(仅桌面端 + AutoOperation Agent 可用 + 持有数>0 时);点击弹出 `ListingModal`,打开时调 `GetItemTradeInfo` 拉实时挂单并把单价默认填为「当前最低价-10」(下限 1,无挂单则留空),数量默认持有全部、上限为持有数,确认后调 `ExchangeItem` 上架,成功后刷新仓库持有数并提示。可单测纯逻辑在 `src/price/listing-form.js`。
```

- [ ] **Step 2: 跑整个单测套件**

Run: `npm test`
Expected: PASS(全部测试文件)

- [ ] **Step 3: 跑页面构建确认无破坏**

Run: `npm run build:pages`
Expected: 构建成功(生成 `public/price` 产物)

- [ ] **Step 4: Commit**

```bash
git add docs/Documentation.md
git commit -m "docs: record price warehouse listing feature"
```

---

## Self-Review

**1. Spec coverage(逐条对照 spec):**
- 触发按钮(详情区、仅桌面+agent) → Task 4 `canListItem` + 模板按钮 ✓(并额外要求持有数>0,符合 spec「选中已持有藏品」)
- 弹窗打开拉 `GetItemTradeInfo` + 渲染挂单阶梯 → Task 3 `loadTradeInfo` + `listing-tiers` ✓
- 单价默认 = 最低价-10,下限 1,无挂单留空 → Task 2 `computeDefaultUnitPrice` + Task 3 测试 ✓
- 数量默认持有全部、上限持有数 → Task 3 `countInput` 初值 + Task 2 `validateListing` ✓
- 明细只显示总价 → Task 3 `listing-total`(无手续费/税/净额) ✓
- 前端校验 count∈[1,owned]、unitPrice≥1 整数 → Task 2 `validateListing` ✓
- 确认调 `ExchangeItem` → Task 3 `submit` ✓
- 成功关闭+刷新持有数+提示;失败弹窗内显示并保持打开 → Task 3 错误处理 + Task 4 `onItemListed` ✓
- Web 模式隐藏按钮 → Task 4 测试「hides the listing button when not running on desktop」✓
- 测试计划全部覆盖 → Tasks 2-4 ✓

**2. Placeholder scan:** 无 TBD/TODO;每个代码步骤含完整代码。✓

**3. Type consistency:** `runAutoOperationCommand(command, args)` 返回 `{ ok, value, error }` 在 Modal 与 App 测试中一致;`GetItemTradeInfo` value 形状 `{ minPrice, totalCount, tiers:[{price,count}] }` 与 Agent `TradeListSummary` JSON 契约一致;`ExchangeItem` 入参 `{ itemCid, count, unitPrice }` 与 `CmdExchangeItem` 一致;emit `listed` payload `{ itemCid, count, unitPrice }` 在 Modal 与 App `onItemListed` 之间一致;helper 函数名 `computeDefaultUnitPrice`/`computeTotal`/`validateListing` 在 Task 2 定义、Task 3 使用一致。✓

> 备注:`.info-text` 样式类若 `App.vue` 现有样式中不存在,提示文本仍可正常显示(无样式),不影响功能与测试;如需美化可在实现时复用现有提示样式。
