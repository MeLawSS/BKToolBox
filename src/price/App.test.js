/* @vitest-environment happy-dom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import realCollectibles from '../../public/data/collectibles.json';
import App from './App.vue';

const priceCss = readFileSync(resolve(process.cwd(), 'src/price/price.css'), 'utf8');

vi.mock('vue-chartjs', () => ({
  Line: {
    name: 'MockLine',
    props: ['data', 'options'],
    template: '<div data-testid="mock-line" />',
  },
}));

const testCids = [1022001, 1022002, 1022003, 1022004];
const collectibles = realCollectibles.filter((item) => testCids.includes(getCollectibleCid(item)));
const latestRows = [
  { itemCid: 1022001, observedAt: '2026-05-28T12:24:37.000Z', minPrice: 1600 },
  { itemCid: 1022002, observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
  { itemCid: 1022003, observedAt: '2026-05-28T12:35:02.000Z', minPrice: 1500 },
  { itemCid: 1022004, observedAt: '2026-05-28T12:40:02.000Z', minPrice: 700 },
];
const LISTING_DEFAULT_PRICE_PERCENT_KEY = 'bidking-price-listing-default-percent:v1';

function getCollectibleCid(collectible) {
  const explicitCid = collectible?.itemCid ?? collectible?.cid ?? collectible?.id;
  if (explicitCid !== undefined && explicitCid !== null && explicitCid !== '') return Number(explicitCid);
  const match = String(collectible?.image || '').match(/icon_(\d+)\.png/);
  return match ? Number(match[1]) : null;
}

function getTestCollectible(itemCid) {
  return collectibles.find((item) => getCollectibleCid(item) === itemCid);
}

function getLatestRow(itemCid) {
  return latestRows.find((item) => item.itemCid === itemCid);
}

function ratioText(itemCid) {
  return `${(getLatestRow(itemCid).minPrice / Number(getTestCollectible(itemCid).price)).toFixed(2)}x`;
}

function opportunityOrder(wrapper) {
  return wrapper.findAll('[data-testid^="opportunity-"]')
    .map((row) => Number(row.attributes('data-testid').replace('opportunity-', '')));
}

function warehouseOrder(wrapper) {
  return wrapper.findAll('tr[data-testid^="warehouse-"]')
    .map((row) => Number(row.attributes('data-testid').replace('warehouse-', '')));
}

function mockFetch(options = {}) {
  const collectionsResponses = options.collectionsResponses || [[1022002, 1022001]];
  const latestResponses = options.latestResponses || [latestRows];
  const itemHistoryResponses = options.itemHistoryResponses || {};
  let collectionsCallIndex = 0;
  let latestCallIndex = 0;
  const itemHistoryCallIndexes = {};
  const defaultItemHistories = {
    1022001: [
      [
        { observedAt: '2026-05-28T12:24:37.000Z', minPrice: 1600 },
      ],
    ],
    1022002: [
      [
        { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
        { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
      ],
    ],
  };

  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).endsWith('/data/collectibles.json')) {
      return { ok: true, json: async () => collectibles };
    }
    if (String(url).endsWith('/api/price-history/latest')) {
      const rows = latestResponses[Math.min(latestCallIndex, latestResponses.length - 1)];
      latestCallIndex += 1;
      return {
        ok: true,
        json: async () => ({
          items: rows,
        }),
      };
    }
    if (String(url).endsWith('/api/price-history/collections')) {
      const itemCids = collectionsResponses[Math.min(collectionsCallIndex, collectionsResponses.length - 1)];
      collectionsCallIndex += 1;
      return {
        ok: true,
        json: async () => ({ itemCids }),
      };
    }
    const itemHistoryMatch = String(url).match(/\/api\/price-history\/item\/(\d+)\?limit=1000$/);
    if (itemHistoryMatch) {
      const itemCid = Number(itemHistoryMatch[1]);
      const responses = itemHistoryResponses[itemCid]
        || defaultItemHistories[itemCid]
        || [[]];
      const callIndex = itemHistoryCallIndexes[itemCid] || 0;
      itemHistoryCallIndexes[itemCid] = callIndex + 1;
      return {
        ok: true,
        json: async () => ({
          itemCid,
          history: responses[Math.min(callIndex, responses.length - 1)],
        }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createWarehouseStockItem(overrides = {}) {
  const stockId = Number(overrides.stockId ?? 0);
  const pos = Number(overrides.pos ?? 0);
  const boxIds = Array.isArray(overrides.boxIds) ? overrides.boxIds : [pos];
  const defaultBoxCount = boxIds.length || 1;
  return {
    itemUid: String(overrides.itemUid ?? `item-${stockId}-${pos}`),
    itemCid: Number(overrides.itemCid ?? 0),
    count: Number(overrides.count ?? 1),
    pos,
    rotate: Boolean(overrides.rotate),
    stockId,
    boxCount: Number(overrides.boxCount ?? defaultBoxCount),
    boxIds,
    canTrade: true,
    isLock: false,
    ...overrides,
  };
}

function createWarehouseContainer(overrides = {}) {
  const stockId = Number(overrides.stockId ?? 0);
  return {
    stockId,
    stockCid: Number(overrides.stockCid ?? stockId),
    width: Number(overrides.width ?? 4),
    height: Number(overrides.height ?? 3),
    boxCount: Number(overrides.boxCount ?? 12),
    items: Array.isArray(overrides.items) ? overrides.items : [],
    ...overrides,
  };
}

function createWarehouseSnapshot(containers = []) {
  return {
    containers,
    count: containers.length,
    source: 'PlayerManager.GetAllStocks',
  };
}

async function mountApp() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  await nextTick();
  return wrapper;
}

function createWarehouseMocks(options = {}) {
  const collectionCids = Object.prototype.hasOwnProperty.call(options, 'collectionCids')
    ? options.collectionCids
    : undefined;
  const stockResponses = Array.isArray(options.stockResponses) ? options.stockResponses : [];
  let stockCallIndex = 0;

  return vi.fn(async (command) => {
    if (command === 'GetCollectionItemCids') {
      if (collectionCids === undefined) {
        return { ok: false, error: 'not available' };
      }
      return { ok: true, value: { cids: collectionCids, count: collectionCids.length } };
    }
    if (command === 'GetStockContainers') {
      const res = stockResponses[Math.min(stockCallIndex, stockResponses.length - 1)];
      stockCallIndex += 1;
      return { ok: true, value: res };
    }
    throw new Error(`unexpected command: ${command}`);
  });
}

describe('Price App', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    delete window.bidkingDesktop;
    mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows double-price opportunities sorted by sale price and loads item history', async () => {
    const wrapper = await mountApp();

    const opportunityText = wrapper.find('[data-testid="price-opportunities"]').text();
    expect(opportunityText).toContain(getTestCollectible(1022002).name);
    expect(opportunityText).toContain(getTestCollectible(1022003).name);
    expect(opportunityText).toContain(getTestCollectible(1022001).name);
    expect(opportunityText).not.toContain(getTestCollectible(1022004).name);
    expect(opportunityText.indexOf(getTestCollectible(1022002).name)).toBeLessThan(
      opportunityText.indexOf(getTestCollectible(1022001).name),
    );
    expect(opportunityText).toContain(ratioText(1022002));
    expect(opportunityText).toContain(ratioText(1022001));

    await wrapper.find('[data-testid="opportunity-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(fetch).toHaveBeenCalledWith('/api/price-history/item/1022002?limit=1000');
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain(getTestCollectible(1022002).name);
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('4,400');
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('5,000');
    expect(wrapper.find('[data-testid="price-trend-chart"]').exists()).toBe(true);
  });

  it('sorts double-price opportunities by base price, minimum price, and ratio', async () => {
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-sort-basePrice"]').trigger('click');
    await nextTick();
    expect(opportunityOrder(wrapper)).toEqual([1022002, 1022003, 1022001]);

    await wrapper.find('[data-testid="price-sort-basePrice"]').trigger('click');
    await nextTick();
    expect(opportunityOrder(wrapper)).toEqual([1022001, 1022003, 1022002]);

    await wrapper.find('[data-testid="price-sort-minPrice"]').trigger('click');
    await nextTick();
    expect(opportunityOrder(wrapper)).toEqual([1022003, 1022001, 1022002]);

    await wrapper.find('[data-testid="price-sort-minPrice"]').trigger('click');
    await nextTick();
    expect(opportunityOrder(wrapper)).toEqual([1022002, 1022001, 1022003]);

    await wrapper.find('[data-testid="price-sort-ratio"]').trigger('click');
    await nextTick();
    expect(opportunityOrder(wrapper)).toEqual([1022001, 1022003, 1022002]);

    await wrapper.find('[data-testid="price-sort-ratio"]').trigger('click');
    await nextTick();
    expect(opportunityOrder(wrapper)).toEqual([1022002, 1022003, 1022001]);
  });

  it('filters collectibles by name or item id', async () => {
    const wrapper = await mountApp();

    await wrapper.find('input[type="search"]').setValue('1022001');
    await nextTick();

    expect(wrapper.find('[data-testid="price-search-results"]').text()).toContain(getTestCollectible(1022001).name);
    expect(wrapper.find('[data-testid="price-search-results"]').text()).not.toContain(getTestCollectible(1022002).name);
  });

  it('does not render the trend chart when selected history has fewer than two rows', async () => {
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="opportunity-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(fetch).toHaveBeenCalledWith('/api/price-history/item/1022001?limit=1000');
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain(getTestCollectible(1022001).name);
    expect(wrapper.find('[data-testid="price-trend-chart"]').exists()).toBe(false);
  });

  it('shows collection cids in the Collections tab and loads selected history', async () => {
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-collections"]').trigger('click');
    await nextTick();

    const collectionsText = wrapper.find('[data-testid="price-collections"]').text();
    expect(collectionsText).toContain(getTestCollectible(1022002).name);
    expect(collectionsText).toContain(getTestCollectible(1022001).name);
    expect(collectionsText).not.toContain(getTestCollectible(1022003).name);

    await wrapper.find('[data-testid="collection-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(fetch).toHaveBeenCalledWith('/api/price-history/item/1022002?limit=1000');
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain(getTestCollectible(1022002).name);
  });

  it('refreshes warehouse collectibles from the AutoOperation Agent and loads selected history', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1099001', itemCid: 1099001, stockId: 0, pos: 2, count: 2 }),
            ],
          }),
          createWarehouseContainer({
            stockId: 2,
            stockCid: 9102,
            items: [
              createWarehouseStockItem({ itemUid: 'stock-1022002', itemCid: 1022002, stockId: 2, pos: 0, count: 3 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand,
    };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain('暂无仓库藏品');

    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetStockContainers', {});
    const warehouseText = wrapper.find('[data-testid="price-warehouse"]').text();
    expect(warehouseText).toContain(getTestCollectible(1022002).name);
    expect(warehouseText).toContain('4');
    expect(warehouseText).toContain(getTestCollectible(1022001).name);
    expect(warehouseText).toContain('1');
    expect(warehouseText).not.toContain('1099001');

    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(fetch).toHaveBeenCalledWith('/api/price-history/item/1022002?limit=1000');
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain(getTestCollectible(1022002).name);
  });

  it('shows only collectibles present in the main warehouse while keeping total cross-stock counts', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 2 }),
            ],
          }),
          createWarehouseContainer({
            stockId: 2,
            stockCid: 9102,
            items: [
              createWarehouseStockItem({ itemUid: 'stock-1022002', itemCid: 1022002, stockId: 2, pos: 0, count: 3 }),
              createWarehouseStockItem({ itemUid: 'stock-1022003', itemCid: 1022003, stockId: 2, pos: 1, count: 5 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand,
    };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    const warehouseText = wrapper.find('[data-testid="price-warehouse"]').text();
    expect(warehouseText).toContain(getTestCollectible(1022002).name);
    expect(warehouseText).toContain(getTestCollectible(1022001).name);
    expect(warehouseText).not.toContain(getTestCollectible(1022003).name);
    expect(wrapper.find('[data-testid="warehouse-1022002"]').text()).toContain('4');
    expect(wrapper.find('[data-testid="warehouse-1022001"]').text()).toContain('2');
  });

  it('defaults the warehouse panel to index 0 (first collectible) after refresh', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand,
    };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="opportunity-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain(getTestCollectible(1022002).name);

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).not.toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022002).name);
  });

  it('falls back to saved index when clicking a search result whose CID is not in the warehouse list', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand,
    };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('input[type="search"]').setValue('1022003');
    await nextTick();
    const searchButton = wrapper.findAll('[data-testid="price-search-results"] button')
      .find((button) => button.text().includes('1022003'));
    expect(searchButton).toBeTruthy();

    await searchButton.trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).not.toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022002).name);
    expect(detailText).not.toContain(getTestCollectible(1022003).name);
  });

  it('falls back to sort-synced index when clicking a non-warehouse search result after sorting', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 1, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 2, count: 1 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand,
    };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="price-sort-warehouse-cells"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-sort-warehouse-cells"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022001, 1022003, 1022002]);

    await wrapper.find('input[type="search"]').setValue('1022004');
    await nextTick();
    const searchButton = wrapper.findAll('[data-testid="price-search-results"] button')
      .find((button) => button.text().includes('1022004'));
    expect(searchButton).toBeTruthy();

    await searchButton.trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).not.toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022003"]').classes()).not.toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022002).name);
    expect(detailText).not.toContain(getTestCollectible(1022004).name);
  });

  it('keeps a default warehouse selection when warehouse refresh finishes before collectibles metadata loads', async () => {
    const collectiblesDeferred = createDeferred();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/data/collectibles.json')) {
        return collectiblesDeferred.promise;
      }
      if (String(url).endsWith('/api/price-history/latest')) {
        return {
          ok: true,
          json: async () => ({
            items: latestRows,
          }),
        };
      }
      if (String(url).endsWith('/api/price-history/collections')) {
        return {
          ok: true,
          json: async () => ({ itemCids: [1022002, 1022001] }),
        };
      }
      if (String(url).endsWith('/api/price-history/item/1022002?limit=1000')) {
        return {
          ok: true,
          json: async () => ({
            itemCid: 1022002,
            history: [
              { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
              { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
                createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              ],
            }),
          ]),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand,
    };

    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    collectiblesDeferred.resolve({
      ok: true,
      json: async () => collectibles,
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain(getTestCollectible(1022002).name);
  });

  it('re-syncs to the first visible warehouse collectible after metadata loads when the raw fallback item stays invisible', async () => {
    const collectiblesDeferred = createDeferred();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/data/collectibles.json')) {
        return collectiblesDeferred.promise;
      }
      if (String(url).endsWith('/api/price-history/latest')) {
        return {
          ok: true,
          json: async () => ({
            items: latestRows,
          }),
        };
      }
      if (String(url).endsWith('/api/price-history/collections')) {
        return {
          ok: true,
          json: async () => ({ itemCids: [1022002, 1022001] }),
        };
      }
      if (String(url).endsWith('/api/price-history/item/1099001?limit=1000')) {
        return {
          ok: true,
          json: async () => ({
            itemCid: 1099001,
            history: [],
          }),
        };
      }
      if (String(url).endsWith('/api/price-history/item/1022002?limit=1000')) {
        return {
          ok: true,
          json: async () => ({
            itemCid: 1022002,
            history: [
              { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
              { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1099001', itemCid: 1099001, stockId: 0, pos: 0, count: 1 }),
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 1, count: 1 }),
              ],
            }),
          ]),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand,
    };

    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    collectiblesDeferred.resolve({
      ok: true,
      json: async () => collectibles,
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain(getTestCollectible(1022002).name);
    expect(wrapper.find('[data-testid="price-detail"]').text()).not.toContain('请选择藏品查看趋势');
  });

  it('renders occupied cells and sorts warehouse rows by cells, count, base price, and latest low price', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 1, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 2, count: 1 }),
            ],
          }),
          createWarehouseContainer({
            stockId: 2,
            stockCid: 9102,
            items: [
              createWarehouseStockItem({ itemUid: 'stock-1022002', itemCid: 1022002, stockId: 2, pos: 0, count: 3 }),
              createWarehouseStockItem({ itemUid: 'stock-1022003', itemCid: 1022003, stockId: 2, pos: 1, count: 1 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand,
    };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-cells-1022002"]').text()).toBe('1');
    expect(wrapper.find('[data-testid="warehouse-cells-1022003"]').text()).toBe('2');
    expect(wrapper.find('[data-testid="warehouse-cells-1022001"]').text()).toBe('4');

    await wrapper.find('[data-testid="price-sort-warehouse-cells"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022002, 1022003, 1022001]);

    await wrapper.find('[data-testid="price-sort-warehouse-cells"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022001, 1022003, 1022002]);

    await wrapper.find('[data-testid="price-sort-warehouse-count"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022001, 1022003, 1022002]);

    await wrapper.find('[data-testid="price-sort-warehouse-count"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022002, 1022003, 1022001]);

    await wrapper.find('[data-testid="price-sort-warehouse-basePrice"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022002, 1022003, 1022001]);

    await wrapper.find('[data-testid="price-sort-warehouse-basePrice"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022001, 1022003, 1022002]);

    await wrapper.find('[data-testid="price-sort-warehouse-minPrice"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022003, 1022001, 1022002]);

    await wrapper.find('[data-testid="price-sort-warehouse-minPrice"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022002, 1022001, 1022003]);
  });

  it('refreshes collection cids, latest prices, and selected item history', async () => {
    mockFetch({
      collectionsResponses: [
        [1022002, 1022001],
        [1022003, 1022001],
      ],
      latestResponses: [
        latestRows,
        [
          { itemCid: 1022001, observedAt: '2026-05-28T12:24:37.000Z', minPrice: 1600 },
          { itemCid: 1022002, observedAt: '2026-05-28T12:50:00.000Z', minPrice: 5100 },
          { itemCid: 1022003, observedAt: '2026-05-28T13:00:00.000Z', minPrice: 1800 },
        ],
      ],
      itemHistoryResponses: {
        1022002: [
          [
            { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
            { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
          ],
          [
            { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
            { observedAt: '2026-05-28T12:50:00.000Z', minPrice: 5100 },
          ],
        ],
      },
    });
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-collections"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="collection-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-collections"]').text()).toContain(getTestCollectible(1022002).name);
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('5,000');

    await wrapper.find('[data-testid="price-collections-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    const collectionsText = wrapper.find('[data-testid="price-collections"]').text();
    expect(collectionsText).toContain(getTestCollectible(1022003).name);
    expect(collectionsText).not.toContain(getTestCollectible(1022002).name);
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain(getTestCollectible(1022002).name);
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('5,100');
    expect(fetch).toHaveBeenCalledWith('/api/price-history/latest');
    expect(fetch).toHaveBeenCalledWith('/api/price-history/collections');
    expect(fetch).toHaveBeenCalledWith('/api/price-history/item/1022002?limit=1000');
  });

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
    await nextTick();
    expect(wrapper.find('[data-testid="price-collections-capture"]').exists()).toBe(true);

    await wrapper.find('[data-testid="price-collections-capture"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(captureCollectionCidsToFile).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/price-history/latest'))).toHaveLength(2);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/price-history/collections'))).toHaveLength(2);
    expect(wrapper.find('[data-testid="price-collections"]').text()).toContain(getTestCollectible(1022003).name);
  });

  it('disables collections capture when the desktop bridge is unavailable', async () => {
    delete window.bidkingDesktop;
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-collections"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="price-collections-capture"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="price-collections-refresh"]').attributes('disabled')).toBeUndefined();
  });

  it('disables collections capture and refresh while writing collection cids', async () => {
    const deferred = createDeferred();
    const captureCollectionCidsToFile = vi.fn(() => deferred.promise);
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

    deferred.resolve({
      ok: true,
      value: {
        itemCids: [1022002],
        count: 1,
        outputPath: 'C:/Users/test/Documents/BKPriceHistory/Cids.json',
      },
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-collections-capture"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('[data-testid="price-collections-refresh"]').attributes('disabled')).toBeUndefined();
  });

  it('shows an error and skips refresh when collections capture fails', async () => {
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
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/price-history/latest'))).toHaveLength(1);
  });

  it('shows an error and skips refresh when the collections capture bridge resolves with ok false', async () => {
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand: vi.fn(),
      captureCollectionCidsToFile: vi.fn().mockResolvedValue({ ok: false, error: 'bridge failed' }),
    };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-collections"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-collections-capture"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain('bridge failed');
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/price-history/collections'))).toHaveLength(1);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/price-history/latest'))).toHaveLength(1);
  });

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

  it('keeps later selected item history when a refreshed previous item history resolves late', async () => {
    const latestRefresh = createDeferred();
    const staleHistoryRefresh = createDeferred();
    const itemHistoryCallIndexes = {};
    const refreshItemTradeInfo = vi.fn().mockResolvedValue({
      ok: true,
      value: { itemCid: 1022002, minPrice: 6200 },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      refreshItemTradeInfo,
    };
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/data/collectibles.json')) {
        return { ok: true, json: async () => collectibles };
      }
      if (String(url).endsWith('/api/price-history/latest')) {
        if (fetch.mock.calls.filter(([calledUrl]) => String(calledUrl).endsWith('/api/price-history/latest')).length === 1) {
          return { ok: true, json: async () => ({ items: latestRows }) };
        }
        return {
          ok: true,
          json: async () => ({
            items: await latestRefresh.promise,
          }),
        };
      }
      if (String(url).endsWith('/api/price-history/collections')) {
        return { ok: true, json: async () => ({ itemCids: [1022002, 1022001] }) };
      }
      if (String(url).includes('/api/price-history/item/1022002')) {
        const callIndex = itemHistoryCallIndexes[1022002] || 0;
        itemHistoryCallIndexes[1022002] = callIndex + 1;
        if (callIndex === 0) {
          return {
            ok: true,
            json: async () => ({
              itemCid: 1022002,
              history: [
                { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
                { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            itemCid: 1022002,
            history: await staleHistoryRefresh.promise,
          }),
        };
      }
      if (String(url).includes('/api/price-history/item/1022001')) {
        return {
          ok: true,
          json: async () => ({
            itemCid: 1022001,
            history: [
              { observedAt: '2026-05-28T12:24:37.000Z', minPrice: 1600 },
              { observedAt: '2026-05-28T12:45:37.000Z', minPrice: 1700 },
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = await mountApp();
    await wrapper.find('[data-testid="opportunity-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('5,000');

    await wrapper.find('[data-testid="price-item-refresh"]').trigger('click');
    latestRefresh.resolve(latestRows.map((row) => row.itemCid === 1022002
      ? { ...row, observedAt: '2026-05-28T13:20:00.000Z', minPrice: 6200 }
      : row));
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="opportunity-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain(getTestCollectible(1022001).name);
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('1,700');

    staleHistoryRefresh.resolve([
      { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
      { observedAt: '2026-05-28T13:20:00.000Z', minPrice: 6200 },
    ]);
    await flushPromises();
    await nextTick();

    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022001).name);
    expect(detailText).toContain('1,700');
    expect(detailText).not.toContain('6,200');
  });

  it('does not show stale selected item refresh errors after selection changes', async () => {
    const refreshItemTradeInfo = createDeferred();
    window.bidkingDesktop = {
      isDesktop: true,
      refreshItemTradeInfo: vi.fn(() => refreshItemTradeInfo.promise),
    };

    const wrapper = await mountApp();
    await wrapper.find('[data-testid="opportunity-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="price-item-refresh"]').trigger('click');
    await wrapper.find('[data-testid="opportunity-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();

    refreshItemTradeInfo.reject(new Error('stale refresh failed'));
    await flushPromises();
    await nextTick();

    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022001).name);
    expect(detailText).not.toContain('stale refresh failed');
  });

  it('does not render the text history list below the trend chart', async () => {
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="opportunity-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-history-list"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="price-detail"]').text()).not.toContain('2026/5/28');
  });

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
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
            createWarehouseContainer({
              stockId: 2,
              stockCid: 9102,
              items: [
                createWarehouseStockItem({ itemUid: 'stock-1022002', itemCid: 1022002, stockId: 2, pos: 0, count: 3 }),
              ],
            }),
          ]),
        };
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
    expect(wrapper.find('[data-testid="price-listing-open"]').classes()).toContain('primary-button');
    await wrapper.find('[data-testid="price-listing-open"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="listing-modal"]').exists()).toBe(true);

    await wrapper.find('[data-testid="listing-confirm"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('ExchangeItem', { itemCid: 1022002, count: 4, unitPrice: 1568 });
    expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'GetStockContainers')).toHaveLength(2);
    expect(wrapper.find('[data-testid="listing-modal"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="price-listing-message"]').text()).toContain('上架成功');
  });

  it('restores, persists, and applies the detail-panel default listing percentage', async () => {
    window.localStorage.setItem(LISTING_DEFAULT_PRICE_PERCENT_KEY, '105');
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
            createWarehouseContainer({
              stockId: 2,
              stockCid: 9102,
              items: [
                createWarehouseStockItem({ itemUid: 'stock-1022002', itemCid: 1022002, stockId: 2, pos: 0, count: 3 }),
              ],
            }),
          ]),
        };
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

    const percentInput = wrapper.find('[data-testid="price-listing-default-percent"]');
    expect(percentInput.element.value).toBe('105');

    await percentInput.setValue('98.5');
    await nextTick();
    expect(window.localStorage.getItem(LISTING_DEFAULT_PRICE_PERCENT_KEY)).toBe('98.5');

    await wrapper.find('[data-testid="price-listing-open"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('1576');
  });

  it('selects the clicked warehouse row and records its index', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 2, count: 2 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).not.toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022001).name);
  });

  it('keeps the same index after refresh even when warehouse CIDs change', async () => {
    const responses = [
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 2, count: 2 }),
          ],
        }),
      ]),
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022004', itemCid: 1022004, stockId: 0, pos: 0, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 1, count: 3 }),
            createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 2, count: 1 }),
          ],
        }),
      ]),
    ];
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: responses,
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022003"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).not.toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022004"]').classes()).not.toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022003).name);
  });

  it('selects the last warehouse item when the saved index exceeds the new list length', async () => {
    const responses = [
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 2, count: 2 }),
          ],
        }),
      ]),
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022004', itemCid: 1022004, stockId: 0, pos: 0, count: 1 }),
          ],
        }),
      ]),
    ];
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: responses,
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="warehouse-1022003"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022003"]').classes()).toContain('selected');

    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022004"]').classes()).toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022004).name);
  });

  it('clears the warehouse selection when refresh returns an empty list', async () => {
    const responses = [
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
          ],
        }),
      ]),
      createWarehouseSnapshot([]),
    ];
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: responses,
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).toContain('selected');

    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('请选择藏品查看趋势');
  });

  it('keeps the selected CID on sort and silently syncs the index to its new position', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 2, count: 2 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Click index 1 (1022001)
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    // Sort by cells ascending → 1022001 moves from index 1 to index 2
    await wrapper.find('[data-testid="price-sort-warehouse-cells"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022002, 1022003, 1022001]);

    // 1022001 still selected (sort keeps CID), now at index 2
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    // Fallback to synced index 2 when clicking non-warehouse item
    await wrapper.find('input[type="search"]').setValue('1022004');
    await nextTick();
    const searchButton = wrapper.findAll('[data-testid="price-search-results"] button')
      .find((button) => button.text().includes('1022004'));
    await searchButton.trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022001).name);
  });

  it('uses the sort-synced index on the next data refresh', async () => {
    const responses = [
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 0, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 2, count: 2 }),
          ],
        }),
      ]),
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022004', itemCid: 1022004, stockId: 0, pos: 0, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 2, count: 1 }),
          ],
        }),
      ]),
    ];
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: responses,
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Click 1022003 (index 0 in container order)
    await wrapper.find('[data-testid="warehouse-1022003"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022003"]').classes()).toContain('selected');

    // Sort by cells ascending → [1022002, 1022003, 1022001]
    // 1022003 (2 cells) moves from index 0 to index 1 → index synced to 1
    await wrapper.find('[data-testid="price-sort-warehouse-cells"]').trigger('click');
    await nextTick();
    expect(warehouseOrder(wrapper)).toEqual([1022002, 1022003, 1022001]);

    // Refresh with CIDs that shift under the same sort
    // New data sorted by cells: 1022002 (1) < 1022004 (1, tiebreak 1022002<1022004) < 1022001 (4)
    // Index 1 = 1022004
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="warehouse-1022004"]').classes()).toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022004).name);
  });

  it('preserves the selected CID when switching back to the warehouse tab', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    await wrapper.find('[data-testid="price-tab-opportunities"]').trigger('click');
    await nextTick();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022001).name);
  });

  it('selects the clicked search result CID when it is in the warehouse list', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 2, count: 2 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Click index 1 (1022001) to set a non-zero index
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    // Search for 1022003 which IS in the warehouse list
    await wrapper.find('input[type="search"]').setValue('1022003');
    await nextTick();
    const searchButton = wrapper.findAll('[data-testid="price-search-results"] button')
      .find((button) => button.text().includes('1022003'));
    await searchButton.trigger('click');
    await flushPromises();
    await nextTick();

    // CID-first branch: 1022003 is in warehouse → selected directly
    expect(wrapper.find('[data-testid="warehouse-1022003"]').classes()).toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).not.toContain('selected');
    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).not.toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022003).name);
  });

  it('keeps the same index after refresh when warehouse CIDs stay the same', async () => {
    const snapshot = createWarehouseSnapshot([
      createWarehouseContainer({
        stockId: 0,
        items: [
          createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
          createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
          createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 2, count: 2 }),
        ],
      }),
    ]);
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [snapshot],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Click index 1 (1022001)
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    // Refresh with same data — same CIDs, same order
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Index 1 should still be 1022001
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022001).name);
  });

  it('falls back to saved index on tab switch when the previously selected CID has disappeared', async () => {
    const responses = [
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 2, count: 2 }),
          ],
        }),
      ]),
      createWarehouseSnapshot([
        createWarehouseContainer({
          stockId: 0,
          items: [
            createWarehouseStockItem({ itemUid: 'main-1022004', itemCid: 1022004, stockId: 0, pos: 0, count: 1 }),
          ],
        }),
      ]),
    ];
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: responses,
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    // First refresh on warehouse tab
    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Select index 1 (1022001)
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    // Switch to opportunities tab
    await wrapper.find('[data-testid="price-tab-opportunities"]').trigger('click');
    await nextTick();

    // While on opportunities, refresh warehouse — new data removes 1022001
    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // 1022001 gone, index 1 > new list length (1) → clamped to last → 1022004
    expect(wrapper.find('[data-testid="warehouse-1022004"]').classes()).toContain('selected');
    const detailText = wrapper.find('[data-testid="price-detail"]').text();
    expect(detailText).toContain(getTestCollectible(1022004).name);
  });

  it('filters warehouse items to only those in the live collection', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      collectionCids: [1022002, 1022003],
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 2, count: 2 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    const warehouseText = wrapper.find('[data-testid="price-warehouse"]').text();
    expect(warehouseText).toContain(getTestCollectible(1022002).name);
    expect(warehouseText).toContain(getTestCollectible(1022003).name);
    expect(warehouseText).not.toContain(getTestCollectible(1022001).name);
  });

  it('fetches GetCollectionItemCids only once across multiple warehouse refreshes', async () => {
    const snapshot = createWarehouseSnapshot([
      createWarehouseContainer({
        stockId: 0,
        items: [
          createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
        ],
      }),
    ]);
    const runAutoOperationCommand = createWarehouseMocks({
      collectionCids: [1022002],
      stockResponses: [snapshot],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetCollectionItemCids', {});

    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    const collectionCalls = runAutoOperationCommand.mock.calls.filter(
      ([command]) => command === 'GetCollectionItemCids'
    );
    expect(collectionCalls).toHaveLength(1);
  });

  it('shows all main warehouse items when GetCollectionItemCids fails', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    const warehouseText = wrapper.find('[data-testid="price-warehouse"]').text();
    expect(warehouseText).toContain(getTestCollectible(1022002).name);
    expect(warehouseText).toContain(getTestCollectible(1022001).name);
  });

  it('retries GetCollectionItemCids on a later warehouse refresh after an initial failure', async () => {
    const snapshot = createWarehouseSnapshot([
      createWarehouseContainer({
        stockId: 0,
        items: [
          createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
          createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
        ],
      }),
    ]);

    let collectionAttempt = 0;
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') {
        collectionAttempt += 1;
        if (collectionAttempt === 1) {
          throw new Error('temporary collection failure');
        }
        return { ok: true, value: { cids: [1022002], count: 1 } };
      }
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
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

    let warehouseText = wrapper.find('[data-testid="price-warehouse"]').text();
    expect(warehouseText).toContain(getTestCollectible(1022002).name);
    expect(warehouseText).toContain(getTestCollectible(1022001).name);

    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    warehouseText = wrapper.find('[data-testid="price-warehouse"]').text();
    expect(warehouseText).toContain(getTestCollectible(1022002).name);
    expect(warehouseText).not.toContain(getTestCollectible(1022001).name);

    const collectionCalls = runAutoOperationCommand.mock.calls.filter(
      ([command]) => command === 'GetCollectionItemCids'
    );
    expect(collectionCalls).toHaveLength(2);
  });

  it('shows empty warehouse when collection is empty', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      collectionCids: [],
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain('暂无仓库藏品');
  });

  it('does not select a filtered-out CID when collection filter produces an empty table', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      collectionCids: [1099001],
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain('暂无仓库藏品');
    expect(wrapper.find('[data-testid="price-detail"]').text()).toContain('请选择藏品查看趋势');
  });

  it('selects by index in the filtered warehouse list when collection filter is active', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      collectionCids: [1022002, 1022003],
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 2, count: 2 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Filtered list: [1022002, 1022003]. 1022001 excluded.
    // Index 0 = 1022002 should be selected by default
    expect(wrapper.find('[data-testid="warehouse-1022002"]').classes()).toContain('selected');

    // Click index 1 (1022003) in the filtered list
    await wrapper.find('[data-testid="warehouse-1022003"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022003"]').classes()).toContain('selected');
  });

  it('shows the quick listing button on warehouse tab when an owned item is selected', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 3 }),
            ],
          }),
        ]),
      ],
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

    expect(wrapper.find('[data-testid="price-quick-listing"]').exists()).toBe(true);
  });

  it('hides the quick listing button on non-warehouse tabs even when the item is owned', async () => {
    const runAutoOperationCommand = createWarehouseMocks({
      stockResponses: [
        createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
            ],
          }),
        ]),
      ],
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    // Load warehouse data so canListItem becomes true for 1022002
    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Select 1022002 on warehouse tab — quick list button visible
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="price-quick-listing"]').exists()).toBe(true);

    // Switch to collections tab — 1022002 still selected (same CID), owned count still > 0
    await wrapper.find('[data-testid="price-tab-collections"]').trigger('click');
    await nextTick();

    // Button hidden because activeTab !== 'warehouse', not because canListItem is false
    expect(wrapper.find('[data-testid="price-quick-listing"]').exists()).toBe(false);
  });

  it('calls GetItemTradeInfo then ExchangeItem with full count and calculated unit price on quick list', async () => {
    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
                createWarehouseStockItem({ itemUid: 'stock-1022002', itemCid: 1022002, stockId: 2, pos: 0, count: 3 }),
              ],
            }),
          ]),
        };
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

    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1022002 });
    expect(runAutoOperationCommand).toHaveBeenCalledWith('ExchangeItem', { itemCid: 1022002, count: 4, unitPrice: 1568 });
    expect(runAutoOperationCommand.mock.calls.filter(([c]) => c === 'GetStockContainers')).toHaveLength(2);
    expect(wrapper.find('[data-testid="price-listing-message"]').text()).toContain('上架成功');
  });

  it('shows a red error when GetItemTradeInfo fails during quick list', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') {
        return { ok: false, error: 'trade info unavailable' };
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

    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await flushPromises();
    await nextTick();

    const errorEl = wrapper.find('[data-testid="price-quick-listing-error"]');
    expect(errorEl.exists()).toBe(true);
    expect(errorEl.classes()).toContain('error-text');
    expect(errorEl.text()).toContain('trade info unavailable');
  });

  it('shows a red error when the calculated list price is below the base price', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') {
        return { ok: true, value: { itemCid: 1022002, minPrice: 300, totalCount: 1, tiers: [{ price: 300, count: 1 }] } };
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

    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await flushPromises();
    await nextTick();

    // basePrice for 1022002 is 312, listPrice = floor(300 * 98 / 100) = 294 < 312
    const errorEl = wrapper.find('[data-testid="price-quick-listing-error"]');
    expect(errorEl.exists()).toBe(true);
    expect(errorEl.classes()).toContain('error-text');
    expect(errorEl.text()).toContain('上架价低于原价');
  });

  it('uses unitPrice of 1 for very cheap items via computeDefaultUnitPrice floor', async () => {
    // Temporarily override basePrice to 0 to bypass the below-base-price guard
    const targetItem = collectibles.find((c) => getCollectibleCid(c) === 1022003);
    const savedPrice = targetItem.price;
    targetItem.price = 0;
    try {
      const runAutoOperationCommand = vi.fn(async (command) => {
        if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
        if (command === 'GetStockContainers') {
          return {
            ok: true,
            value: createWarehouseSnapshot([
              createWarehouseContainer({
                stockId: 0,
                items: [
                  createWarehouseStockItem({ itemUid: 'main-1022003', itemCid: 1022003, stockId: 0, pos: 0, count: 1 }),
                ],
              }),
            ]),
          };
        }
        if (command === 'GetItemTradeInfo') {
          return { ok: true, value: { itemCid: 1022003, minPrice: 1, totalCount: 1, tiers: [{ price: 1, count: 1 }] } };
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
      await wrapper.find('[data-testid="warehouse-1022003"]').trigger('click');
      await flushPromises();
      await nextTick();

      await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
      await flushPromises();
      await nextTick();

      expect(runAutoOperationCommand).toHaveBeenCalledWith('ExchangeItem', { itemCid: 1022003, count: 1, unitPrice: 1 });
    } finally {
      targetItem.price = savedPrice;
    }
  });

  it('clears the quick listing error when modal listing succeeds after a failed quick list', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') {
        return { ok: true, value: { itemCid: 1022002, minPrice: 300, totalCount: 1, tiers: [{ price: 300, count: 1 }] } };
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

    // Quick list fails (below base price): basePrice=312, listPrice=floor(300*98/100)=294 < 312
    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="price-quick-listing-error"]').exists()).toBe(true);

    // Open modal and succeed
    await wrapper.find('[data-testid="price-listing-open"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="listing-confirm"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-quick-listing-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="price-listing-message"]').text()).toContain('上架成功');
  });

  it('disables the quick listing button and shows loading text while in flight', async () => {
    const tradeInfoDeferred = createDeferred();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') return tradeInfoDeferred.promise;
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

    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await nextTick();

    const btn = wrapper.find('[data-testid="price-quick-listing"]');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.text()).toContain('上架中');

    tradeInfoDeferred.resolve({ ok: true, value: { itemCid: 1022002, minPrice: 1000, totalCount: 1, tiers: [{ price: 1000, count: 1 }] } });
    await flushPromises();
    await nextTick();

    expect(btn.attributes('disabled')).toBeUndefined();
  });

  it('disables the normal listing button while quick listing is in progress', async () => {
    const tradeInfoDeferred = createDeferred();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') return tradeInfoDeferred.promise;
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

    expect(wrapper.find('[data-testid="price-listing-open"]').attributes('disabled')).toBeUndefined();

    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="price-listing-open"]').attributes('disabled')).toBeDefined();

    tradeInfoDeferred.resolve({ ok: true, value: { itemCid: 1022002, minPrice: 5000, totalCount: 1, tiers: [{ price: 5000, count: 1 }] } });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="price-listing-open"]').attributes('disabled')).toBeUndefined();
  });

  it('does not write quick list result to a different item selected mid-flight', async () => {
    const tradeInfoDeferred = createDeferred();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
                createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') return tradeInfoDeferred.promise;
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

    // Select 1022002 and start quick list
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await nextTick();

    // Switch to 1022001 while GetItemTradeInfo is pending
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="warehouse-1022001"]').classes()).toContain('selected');

    // Resolve the request — result was for 1022002, should NOT appear on 1022001's panel
    tradeInfoDeferred.resolve({ ok: true, value: { itemCid: 1022002, minPrice: 5000, totalCount: 1, tiers: [{ price: 5000, count: 1 }] } });
    await flushPromises();
    await nextTick();

    // No success or error message should appear — result discarded because selection changed
    expect(wrapper.find('[data-testid="price-listing-message"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="price-quick-listing-error"]').exists()).toBe(false);
  });

  it('does not write below-base-price error to a different item selected mid-flight', async () => {
    const tradeInfoDeferred = createDeferred();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'main-1022002', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
                createWarehouseStockItem({ itemUid: 'main-1022001', itemCid: 1022001, stockId: 0, pos: 1, count: 1 }),
              ],
            }),
          ]),
        };
      }
      if (command === 'GetItemTradeInfo') return tradeInfoDeferred.promise;
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Select 1022002 and start quick list
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await nextTick();

    // Switch to 1022001 while GetItemTradeInfo is pending
    await wrapper.find('[data-testid="warehouse-1022001"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Resolve with a price below base price (1022002 basePrice=312, minPrice=300 → listPrice=294 < 312)
    tradeInfoDeferred.resolve({ ok: true, value: { itemCid: 1022002, minPrice: 300, totalCount: 1, tiers: [{ price: 300, count: 1 }] } });
    await flushPromises();
    await nextTick();

    // Error should NOT appear — discarded because selection changed
    expect(wrapper.find('[data-testid="price-quick-listing-error"]').exists()).toBe(false);
  });

  it('renders all three left-side panel tabs with their table-wrap container', async () => {
    const wrapper = await mountApp();

    // opportunities tab (default)
    const oppPanel = wrapper.find('[data-testid="price-opportunities"]');
    expect(oppPanel.exists()).toBe(true);
    expect(oppPanel.find('.table-wrap').exists()).toBe(true);

    // switch to collections
    await wrapper.find('[data-testid="price-tab-collections"]').trigger('click');
    await nextTick();
    const colPanel = wrapper.find('[data-testid="price-collections"]');
    expect(colPanel.exists()).toBe(true);
    expect(colPanel.find('.table-wrap').exists()).toBe(true);

    // switch to warehouse
    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();
    const whPanel = wrapper.find('[data-testid="price-warehouse"]');
    expect(whPanel.exists()).toBe(true);
    expect(whPanel.find('.table-wrap').exists()).toBe(true);
  });

  it('renders the warehouse table and detail panel on the same page', async () => {
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand: vi.fn(async () => ({
        ok: false,
        error: 'not available',
      })),
    };
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
    await nextTick();

    const whPanel = wrapper.find('[data-testid="price-warehouse"]');
    expect(whPanel.exists()).toBe(true);
    expect(whPanel.find('table').exists()).toBe(true);

    const detailPanel = wrapper.find('[data-testid="price-detail"]');
    expect(detailPanel.exists()).toBe(true);
  });

  it('pins the left desktop panel height in CSS and restores auto height on mobile', () => {
    expect(priceCss).toMatch(/\.opportunity-panel\s*\{[\s\S]*--price-primary-panel-height:\s*640px;/);
    expect(priceCss).toMatch(/\.opportunity-panel\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*height:\s*var\(--price-primary-panel-height\);/);
    expect(priceCss).toMatch(/\.opportunity-panel\s*>\s*\.error-text\s*\{[\s\S]*flex:\s*0 0 auto;/);
    expect(priceCss).toMatch(/\.opportunity-panel\s+\.table-wrap\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-height:\s*0;[\s\S]*max-height:\s*none;/);
    expect(priceCss).toMatch(/@media\s*\(max-width:\s*980px\)\s*\{[\s\S]*\.opportunity-panel\s*\{[\s\S]*display:\s*block;[\s\S]*height:\s*auto;/);
    expect(priceCss).toMatch(/@media\s*\(max-width:\s*980px\)\s*\{[\s\S]*\.opportunity-panel\s+\.table-wrap\s*\{[\s\S]*flex:\s*unset;[\s\S]*min-height:\s*unset;[\s\S]*max-height:\s*560px;/);
  });

  it('renders opportunities and search when the collections endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/data/collectibles.json')) {
        return { ok: true, json: async () => collectibles };
      }
      if (String(url).endsWith('/api/price-history/latest')) {
        return { ok: true, json: async () => ({ items: latestRows }) };
      }
      if (String(url).endsWith('/api/price-history/collections')) {
        throw new Error('collections unavailable');
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = await mountApp();

    // Page still renders without error banner
    expect(wrapper.find('.error-text').exists()).toBe(false);

    // Opportunities tab renders with data
    const oppPanel = wrapper.find('[data-testid="price-opportunities"]');
    expect(oppPanel.exists()).toBe(true);
    expect(oppPanel.text()).toContain(getTestCollectible(1022002).name);

    // Search panel renders
    expect(wrapper.find('[data-testid="price-search-results"]').exists()).toBe(true);

    // Collections tab renders empty (endpoint failed)
    await wrapper.find('[data-testid="price-tab-collections"]').trigger('click');
    await nextTick();
    const colPanel = wrapper.find('[data-testid="price-collections"]');
    expect(colPanel.exists()).toBe(true);
    expect(colPanel.text()).toContain('暂无 Collections 藏品');
  });

  describe('refreshWarehouseSnapshot()', () => {
    it('manual refresh still works after extraction refactor', async () => {
      const runAutoOperationCommand = createWarehouseMocks({
        stockResponses: [
          createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [
                createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 3 }),
              ],
            }),
          ]),
        ],
      });
      window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };

      const wrapper = await mountApp();
      await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
      await nextTick();

      await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
      await flushPromises();
      await nextTick();

      expect(runAutoOperationCommand).toHaveBeenCalledWith('GetStockContainers', {});
      expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain(
        getTestCollectible(1022002).name,
      );
    });

    it('concurrent callers share one in-flight GetStockContainers request', async () => {
      const stockDeferred = createDeferred();
      let getStockContainersCalls = 0;
      const runAutoOperationCommand = vi.fn(async (command) => {
        if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
        if (command === 'GetStockContainers') {
          getStockContainersCalls++;
          return stockDeferred.promise;
        }
        throw new Error(`unexpected: ${command}`);
      });
      window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };

      const wrapper = await mountApp();
      await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
      await nextTick();

      // Trigger two refreshes before the first resolves
      wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
      wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
      await nextTick();

      stockDeferred.resolve({
        ok: true,
        value: createWarehouseSnapshot([
          createWarehouseContainer({
            stockId: 0,
            items: [
              createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
            ],
          }),
        ]),
      });
      await flushPromises();
      await nextTick();

      // Only one GetStockContainers call should have been made
      expect(getStockContainersCalls).toBe(1);
      expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain(
        getTestCollectible(1022002).name,
      );
    });

    it('returns ok:false and sets warehouseError on GetStockContainers failure', async () => {
      const runAutoOperationCommand = vi.fn(async (command) => {
        if (command === 'GetCollectionItemCids') return { ok: false, error: 'not available' };
        if (command === 'GetStockContainers') return { ok: false, error: 'bridge unavailable' };
        throw new Error(`unexpected: ${command}`);
      });
      window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };

      const wrapper = await mountApp();
      await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
      await nextTick();

      await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
      await flushPromises();
      await nextTick();

      expect(wrapper.find('[data-testid="price-warehouse"]').text()).toContain('bridge unavailable');
    });
  });
});

async function mountAutoSellerTab(options = {}) {
  const stockItems = options.stockItems ?? [];
  const commands = options.commands ?? {};
  const calls = [];

  const runAutoOperationCommand = vi.fn(async (command, args) => {
    calls.push({ command, args });
    if (command === 'GetCollectionItemCids') {
      return { ok: true, value: { cids: stockItems.map(i => i.itemCid) } };
    }
    if (command === 'GetStockContainers') {
      const fn = commands.GetStockContainers;
      if (fn) return fn(args, calls);
      return {
        ok: true,
        value: createWarehouseSnapshot([
          createWarehouseContainer({ stockId: 0, items: stockItems }),
        ]),
      };
    }
    const fn = commands[command];
    if (fn) return fn(args, calls);
    throw new Error(`unexpected auto-seller command: ${command}`);
  });

  window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
  const wrapper = await mountApp();
  await wrapper.find('[data-testid="price-tab-warehouse"]').trigger('click');
  await nextTick();

  return { wrapper, calls, runAutoOperationCommand };
}

describe('auto-seller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    delete window.bidkingDesktop;
    mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('start button is shown in warehouse tab when desktop available', async () => {
    const { wrapper } = await mountAutoSellerTab();
    expect(wrapper.find('[data-testid="price-auto-seller-start"]').exists()).toBe(true);
  });

  it('start button is disabled when quick listing is in progress', async () => {
    const listingDeferred = createDeferred();
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => listingDeferred.promise,
      },
    });

    // First: load warehouse via manual refresh to select the item
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Select the item and start quick listing
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await nextTick();
    wrapper.find('[data-testid="price-quick-listing"]').trigger('click');
    await nextTick();

    // While quick listing is in progress, start auto-seller button should be disabled
    expect(wrapper.find('[data-testid="price-auto-seller-start"]').attributes('disabled')).toBeDefined();

    listingDeferred.resolve({ ok: true });
    await flushPromises();
  });

  it('start button is disabled when listing modal is open', async () => {
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
    });

    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-testid="price-listing-open"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="price-auto-seller-start"]').attributes('disabled')).toBeDefined();
  });

  it('completes immediately when warehouse is empty after initial refresh', async () => {
    const { wrapper } = await mountAutoSellerTab({ stockItems: [] });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toContain('completed');
  });

  it('enters failed state when initial warehouse refresh fails', async () => {
    const { wrapper } = await mountAutoSellerTab({
      commands: {
        GetStockContainers: async () => ({ ok: false, error: 'bridge error' }),
      },
    });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toContain('failed');
    expect(wrapper.find('[data-testid="auto-seller-error"]').text()).toContain('bridge error');
  });

  it('disables refresh button, quick-listing button, and listing-open button while auto-seller is active', async () => {
    const exchDeferred = createDeferred();
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => exchDeferred.promise,
      },
    });

    // Load warehouse first so the quick-listing buttons appear
    await wrapper.find('[data-testid="price-warehouse-refresh"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="warehouse-1022002"]').trigger('click');
    await nextTick();

    wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Auto-seller is now active (ExchangeItem pending)
    expect(wrapper.find('[data-testid="price-warehouse-refresh"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="price-auto-seller-start"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="price-auto-seller-stop"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="price-quick-listing"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="price-listing-open"]').attributes('disabled')).toBeDefined();

    exchDeferred.resolve({ ok: true });
    await flushPromises();
  });

  it('returns to idle-like state (start button shown) after completion', async () => {
    const { wrapper } = await mountAutoSellerTab({ stockItems: [] });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    // After completed, start button is back
    expect(wrapper.find('[data-testid="price-auto-seller-start"]').exists()).toBe(true);
  });

  it('auto-seller: lists one item successfully then completes when warehouse empties', async () => {
    let stockCallCount = 0;
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 2 }),
      ],
      commands: {
        GetStockContainers: async () => {
          stockCallCount++;
          // First call (on start): return one item; second call (after ExchangeItem): empty
          if (stockCallCount === 1) {
            return {
              ok: true,
              value: createWarehouseSnapshot([
                createWarehouseContainer({
                  stockId: 0,
                  items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 2 })],
                }),
              ]),
            };
          }
          return { ok: true, value: createWarehouseSnapshot([createWarehouseContainer({ stockId: 0, items: [] })]) };
        },
        GetItemTradeInfo: async (args) => {
          expect(args.itemCid).toBe(1022002);
          return { ok: true, value: { minPrice: 5000 } };
        },
        ExchangeItem: async (args) => {
          expect(args.itemCid).toBe(1022002);
          expect(args.count).toBe(2);
          // listPrice = floor(5000 * 98/100) = 4900
          expect(args.unitPrice).toBe(4900);
          return { ok: true };
        },
      },
    });

    vi.useFakeTimers();
    try {
      wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0); // bridge calls resolve immediately

      // After ExchangeItem success, successCount increments and 1.5s sleep begins
      // Advance past the 1.5s wait
      await vi.advanceTimersByTimeAsync(2000);
      await nextTick();

      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('completed');
      expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('成功: 1');
      expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('跳过: 0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-seller: waits 1.5 seconds between successful listings', async () => {
    let stockCallCount = 0;
    const exchCallCount = { value: 0 };
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetStockContainers: async () => {
          stockCallCount++;
          if (stockCallCount <= 2) {
            // First two calls return one item each (simulates item being present for second listing)
            return {
              ok: true,
              value: createWarehouseSnapshot([
                createWarehouseContainer({
                  stockId: 0,
                  items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
                }),
              ]),
            };
          }
          return { ok: true, value: createWarehouseSnapshot([createWarehouseContainer({ stockId: 0, items: [] })]) };
        },
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => {
          exchCallCount.value++;
          return { ok: true };
        },
      },
    });

    vi.useFakeTimers();
    try {
      wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0); // first item bridges resolve

      // After first ExchangeItem, we're in the 1.5s sleep
      // Only one ExchangeItem call so far
      expect(exchCallCount.value).toBe(1);
      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('running');

      // Advance past 1.5s
      await vi.advanceTimersByTimeAsync(2000);
      await nextTick();
      // Second item has been processed
      expect(exchCallCount.value).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-seller: skips item below base price without calling ExchangeItem', async () => {
    // itemCid 1022001 (急救毯): basePrice=770; minPrice=700 → listPrice=floor(700*98/100)=686 < 770 → skip
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022001, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetStockContainers: async (_args, calls) => {
          // After the below-base-price skip, the composable calls refresh → return empty
          const stockCalls = calls.filter((c) => c.command === 'GetStockContainers').length;
          if (stockCalls <= 1) {
            return {
              ok: true,
              value: createWarehouseSnapshot([
                createWarehouseContainer({
                  stockId: 0,
                  items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022001, stockId: 0, pos: 0, count: 1 })],
                }),
              ]),
            };
          }
          return { ok: true, value: createWarehouseSnapshot([createWarehouseContainer({ stockId: 0, items: [] })]) };
        },
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 700 } }),
      },
    });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('completed');
    expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('跳过: 1');
    expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('成功: 0');
    // ExchangeItem must NOT have been called
    // (if ExchangeItem were called, the test would throw "unexpected auto-seller command: ExchangeItem")
  });

  it('auto-seller: items all in terminalSkipCids → completes rather than looping', async () => {
    let stockCallCount = 0;
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022001, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetStockContainers: async () => {
          stockCallCount++;
          // always return same item
          return {
            ok: true,
            value: createWarehouseSnapshot([
              createWarehouseContainer({
                stockId: 0,
                items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022001, stockId: 0, pos: 0, count: 1 })],
              }),
            ]),
          };
        },
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 700 } }), // below base price → skip
      },
    });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    // The item is skipped and added to terminalSkipCids. Even though warehouse still shows the item
    // (stockCallCount > 1), the composable sees it's already in terminalSkipCids → completed.
    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('completed');
    expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('跳过: 1');
  });

  it('auto-seller: non-ExchangeItem-returned-false error skips the item', async () => {
    let stockCallCount = 0;
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetStockContainers: async () => {
          stockCallCount++;
          if (stockCallCount <= 1) {
            return {
              ok: true,
              value: createWarehouseSnapshot([
                createWarehouseContainer({
                  stockId: 0,
                  items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
                }),
              ]),
            };
          }
          return { ok: true, value: createWarehouseSnapshot([createWarehouseContainer({ stockId: 0, items: [] })]) };
        },
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => ({ ok: false, error: 'slot full' }),
      },
    });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('completed');
    expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('跳过: 1');
    expect(wrapper.find('[data-testid="auto-seller-error"]').text()).toContain('slot full');
  });

  it('auto-seller: ExchangeItem returned false → 10s wait → RefreshExchangeSellSlots → retry success', async () => {
    let exchCallCount = 0;
    let stockCallCount = 0;
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetStockContainers: async () => {
          stockCallCount++;
          if (stockCallCount <= 1) {
            return {
              ok: true,
              value: createWarehouseSnapshot([
                createWarehouseContainer({
                  stockId: 0,
                  items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
                }),
              ]),
            };
          }
          return { ok: true, value: createWarehouseSnapshot([createWarehouseContainer({ stockId: 0, items: [] })]) };
        },
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => {
          exchCallCount++;
          if (exchCallCount === 1) return { ok: false, error: 'ExchangeItem returned false' };
          return { ok: true };
        },
        RefreshExchangeSellSlots: async () => ({ ok: true }),
      },
    });

    vi.useFakeTimers();
    try {
      wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0); // initial load + first GetItemTradeInfo + first ExchangeItem

      // ExchangeItem returned false → retry_wait phase, 10s sleep begins
      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');

      // Advance past 10s — sleep ends → Refresh → retry ExchangeItem(2nd, succeeds) → 1.5s sleep starts
      await vi.advanceTimersByTimeAsync(10100);
      // Flush remaining microtasks from the async chain (Refresh → ExchangeItem → snapshot)
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      // ExchangeItem(2nd) has been called and succeeded; 1.5s post-success sleep is now running
      expect(exchCallCount).toBe(2);

      // Advance past the 1.5s wait and let the outer loop reach _getNextCandidate → null → completed
      await vi.advanceTimersByTimeAsync(2000);
      await nextTick();

      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('completed');
      expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('成功: 1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-seller: ExchangeItem returned false persists → repeats retry chain each time', async () => {
    let exchCallCount = 0;
    let refreshCallCount = 0;
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetStockContainers: async () => ({
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
            }),
          ]),
        }),
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => {
          exchCallCount++;
          return { ok: false, error: 'ExchangeItem returned false' };
        },
        RefreshExchangeSellSlots: async () => {
          refreshCallCount++;
          return { ok: true };
        },
      },
    });

    vi.useFakeTimers();
    try {
      wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0);

      // First retry cycle: ExchangeItem(1) called, 10s sleep begins
      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');
      expect(exchCallCount).toBe(1);
      await vi.advanceTimersByTimeAsync(10100);
      await vi.advanceTimersByTimeAsync(0);
      // Refresh(1) fired → ExchangeItem(2) retry fired (also fails) → second 10s sleep started
      expect(refreshCallCount).toBe(1);
      expect(exchCallCount).toBe(2);

      // Second retry cycle starts: still in retry_wait for the second sleep
      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');
      await vi.advanceTimersByTimeAsync(10100);
      await vi.advanceTimersByTimeAsync(0);
      // Refresh(2) fired → ExchangeItem(3) retry fired (also fails) → third 10s sleep started
      expect(refreshCallCount).toBe(2);
      expect(exchCallCount).toBe(3);

      // Still in retry_wait (third sleep), not stuck or completed
      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-seller: RefreshExchangeSellSlots failure → task enters failed', async () => {
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetStockContainers: async () => ({
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
            }),
          ]),
        }),
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => ({ ok: false, error: 'ExchangeItem returned false' }),
        RefreshExchangeSellSlots: async () => ({ ok: false, error: 'unknown screen' }),
      },
    });

    vi.useFakeTimers();
    try {
      wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0); // first ExchangeItem call
      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');

      await vi.advanceTimersByTimeAsync(10100);
      await vi.advanceTimersByTimeAsync(0); // RefreshExchangeSellSlots resolves

      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('failed');
      expect(wrapper.find('[data-testid="auto-seller-error"]').text()).toContain('unknown screen');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-seller: stop during retry_wait immediately stops the run', async () => {
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetStockContainers: async () => ({
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
            }),
          ]),
        }),
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => ({ ok: false, error: 'ExchangeItem returned false' }),
      },
    });

    vi.useFakeTimers();
    try {
      wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0); // first ExchangeItem
      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('retry_wait');

      // Click stop during the 10s wait
      wrapper.find('[data-testid="price-auto-seller-stop"]').trigger('click');
      await vi.advanceTimersByTimeAsync(100); // let the 50ms sleep poll fire
      await nextTick();

      expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('stopped');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-seller: warehouse refresh failure after success → task enters failed', async () => {
    let stockCallCount = 0;
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetStockContainers: async () => {
          stockCallCount++;
          if (stockCallCount === 1) {
            return {
              ok: true,
              value: createWarehouseSnapshot([
                createWarehouseContainer({
                  stockId: 0,
                  items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
                }),
              ]),
            };
          }
          // second call (after success) fails
          return { ok: false, error: 'refresh failed after listing' };
        },
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => ({ ok: true }),
      },
    });

    await wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('failed');
    expect(wrapper.find('[data-testid="auto-seller-error"]').text()).toContain('refresh failed after listing');
  });

  it('auto-seller: enters stopping phase when stopped during DLL call, then transitions to stopped', async () => {
    const exchDeferred = createDeferred();
    const { wrapper } = await mountAutoSellerTab({
      stockItems: [
        createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 }),
      ],
      commands: {
        GetStockContainers: async () => ({
          ok: true,
          value: createWarehouseSnapshot([
            createWarehouseContainer({
              stockId: 0,
              items: [createWarehouseStockItem({ itemUid: 'u1', itemCid: 1022002, stockId: 0, pos: 0, count: 1 })],
            }),
          ]),
        }),
        GetItemTradeInfo: async () => ({ ok: true, value: { minPrice: 5000 } }),
        ExchangeItem: async () => exchDeferred.promise,
      },
    });

    wrapper.find('[data-testid="price-auto-seller-start"]').trigger('click');
    await flushPromises();
    await nextTick();

    // ExchangeItem is in flight — _inDllCall is true
    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('running');

    // Stop during DLL call → phase should be 'stopping'
    wrapper.find('[data-testid="price-auto-seller-stop"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('stopping');

    // Resolve the pending ExchangeItem → _checkStop() gate fires → 'stopped'
    exchDeferred.resolve({ ok: true });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="auto-seller-phase"]').text()).toBe('stopped');
    expect(wrapper.find('[data-testid="auto-seller-counts"]').text()).toContain('成功: 0');
  });
});
