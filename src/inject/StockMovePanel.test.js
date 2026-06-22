/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import StockMovePanel from './StockMovePanel.vue';

const collectibles = [
  {
    itemCid: 1011001,
    name: 'Data Cable',
    quality: 'white',
    type: 'daily',
    size: { width: 1, height: 1, key: '1x1' },
  },
  {
    itemCid: 1032006,
    name: 'Boots',
    quality: 'green',
    type: 'fashion',
    size: { width: 2, height: 2, key: '2x2' },
  },
  {
    itemCid: 1083009,
    name: 'Intake Manifold',
    quality: 'blue',
    type: 'vehicle',
    size: { width: 1, height: 2, key: '1x2' },
  },
];

function createSnapshot(overrides = {}) {
  return {
    containers: [
      {
        stockId: 1,
        stockCid: 9101,
        width: 4,
        height: 3,
        boxCount: 12,
        items: [
          {
            itemUid: 'boots-a',
            itemCid: 1032006,
            count: 1,
            pos: 0,
            rotate: false,
            stockId: 1,
            boxCount: 4,
            boxIds: [0, 1, 4, 5],
            canTrade: true,
            isLock: false,
          },
          {
            itemUid: 'cable-a',
            itemCid: 1011001,
            count: 1,
            pos: 2,
            rotate: false,
            stockId: 1,
            boxCount: 1,
            boxIds: [2],
            canTrade: true,
            isLock: false,
          },
        ],
      },
      {
        stockId: 2,
        stockCid: 9102,
        width: 4,
        height: 3,
        boxCount: 12,
        items: [
          {
            itemUid: 'blocker',
            itemCid: 1011001,
            count: 1,
            pos: 0,
            rotate: false,
            stockId: 2,
            boxCount: 1,
            boxIds: [0],
            canTrade: true,
            isLock: false,
          },
        ],
      },
    ],
    count: 2,
    source: 'PlayerManager.GetAllStocks',
    ...overrides,
  };
}

function createSortableSnapshot() {
  const base = createSnapshot();
  return createSnapshot({
    containers: [
      {
        ...base.containers[0],
        items: [
          base.containers[0].items[0],
          base.containers[0].items[1],
          {
            itemUid: 'cable-b',
            itemCid: 1011001,
            count: 1,
            pos: 3,
            rotate: false,
            stockId: 1,
            boxCount: 1,
            boxIds: [3],
            canTrade: true,
            isLock: false,
          },
          {
            itemUid: 'cable-c',
            itemCid: 1011001,
            count: 1,
            pos: 8,
            rotate: false,
            stockId: 1,
            boxCount: 1,
            boxIds: [8],
            canTrade: true,
            isLock: false,
          },
          {
            itemUid: 'intake-a',
            itemCid: 1083009,
            count: 1,
            pos: 6,
            rotate: false,
            stockId: 1,
            boxCount: 2,
            boxIds: [6, 10],
            canTrade: true,
            isLock: false,
          },
          {
            itemUid: 'intake-b',
            itemCid: 1083009,
            count: 1,
            pos: 7,
            rotate: false,
            stockId: 1,
            boxCount: 2,
            boxIds: [7, 11],
            canTrade: true,
            isLock: false,
          },
        ],
      },
      base.containers[1],
    ],
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function setupDesktop(runAutoOperationCommand, options = {}) {
  window.bidkingDesktop = {
    isDesktop: true,
    runAutoOperationCommand,
    listStockMoveLists: options.listStockMoveLists || vi.fn(async () => ({ ok: true, value: [] })),
    saveStockMoveList:
      options.saveStockMoveList || vi.fn(async (payload) => ({ ok: true, value: payload })),
  };
}

async function mountPanel(options = {}) {
  const wrapper = mount(StockMovePanel, {
    attachTo: document.body,
    props: {
      collectibles,
      ...options.props,
    },
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

function getSummaryFieldText(wrapper, field) {
  return wrapper.get(`[data-testid="stock-move-summary-${field}"]`).text();
}

function getVisibleGroupCids(wrapper) {
  return wrapper
    .findAll('tbody tr[data-testid^="stock-move-row-group-"]')
    .map((row) => row.attributes('data-testid').replace('stock-move-row-group-', ''));
}

function getCheckedCids(wrapper) {
  return wrapper
    .findAll('tbody input[type="checkbox"]')
    .filter((checkbox) => checkbox.element.checked)
    .map((checkbox) => Number(checkbox.element.value));
}

describe('StockMovePanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    delete window.bidkingDesktop;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads stock containers and renders grouped source stock items', async () => {
    const snapshot = createSnapshot({
      containers: [
        {
          ...createSnapshot().containers[0],
          items: [
            ...createSnapshot().containers[0].items,
            {
              itemUid: 'cable-b',
              itemCid: 1011001,
              count: 1,
              pos: 3,
              rotate: false,
              stockId: 1,
              boxCount: 1,
              boxIds: [3],
              canTrade: true,
              isLock: false,
            },
          ],
        },
        createSnapshot().containers[1],
      ],
    });
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: snapshot,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetStockContainers', {});

    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    const panelText = wrapper.find('[data-testid="stock-move-panel"]').text();
    expect(panelText).toContain('Boots');
    expect(panelText).toContain('Data Cable');
    expect(wrapper.find('[data-testid="stock-move-row-group-1011001"]').text()).toContain('2');
    expect(wrapper.find('[data-testid="stock-move-row-group-1032006"]').exists()).toBe(true);
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
  });

  it('uses scoped themed select and secondary button classes inside the stock move panel', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const listStockMoveLists = vi.fn(async () => ({
      ok: true,
      value: [
        {
          id: 'saved-1',
          name: '常用车件',
          savedAt: '2026-06-05T03:04:05.000Z',
          itemCids: [1083009],
          items: [],
        },
      ],
    }));
    setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList: vi.fn() });

    const wrapper = await mountPanel();

    expect(wrapper.get('[data-testid="stock-move-source"]').classes()).toContain('stock-move-select');
    expect(wrapper.get('[data-testid="stock-move-target"]').classes()).toContain('stock-move-select');
    expect(wrapper.get('[data-testid="stock-move-select-all"]').classes()).toContain('stock-move-secondary-button');
    expect(wrapper.get('[data-testid="stock-move-clear"]').classes()).toContain('stock-move-secondary-button');
    expect(wrapper.get('[data-testid="stock-move-open-list-editor"]').classes()).toEqual(
      expect.arrayContaining(['stock-move-secondary-button', 'stock-move-secondary-button--compact']),
    );
    expect(wrapper.get('[data-testid="stock-move-apply-list-saved-1"]').classes()).toEqual(
      expect.arrayContaining(['stock-move-secondary-button', 'stock-move-secondary-button--compact']),
    );
  });

  it('keeps the default grouped order and toggles numeric sorting on click', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: snapshot,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    expect(getVisibleGroupCids(wrapper)).toEqual(['1032006', '1083009', '1011001']);

    await wrapper.find('[data-testid="stock-move-sort-itemCid"]').trigger('click');
    await nextTick();
    expect(getVisibleGroupCids(wrapper)).toEqual(['1083009', '1032006', '1011001']);

    await wrapper.find('[data-testid="stock-move-sort-itemCid"]').trigger('click');
    await nextTick();
    expect(getVisibleGroupCids(wrapper)).toEqual(['1011001', '1032006', '1083009']);
  });

  it('toggles text sorting and keeps selected groups checked', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: snapshot,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    await wrapper.find('[data-testid="stock-move-item-group-1032006"]').setValue(true);
    await wrapper.find('[data-testid="stock-move-sort-name"]').trigger('click');
    await nextTick();

    expect(getVisibleGroupCids(wrapper)).toEqual(['1083009', '1011001', '1032006']);
    expect(wrapper.find('[data-testid="stock-move-item-group-1032006"]').element.checked).toBe(true);

    await wrapper.find('[data-testid="stock-move-sort-name"]').trigger('click');
    await nextTick();
    expect(getVisibleGroupCids(wrapper)).toEqual(['1032006', '1011001', '1083009']);
    expect(wrapper.find('[data-testid="stock-move-item-group-1032006"]').element.checked).toBe(true);
  });

  it('keeps search filtering applied while sorting visible groups', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return {
          ok: true,
          value: snapshot,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    await wrapper.find('[data-testid="stock-move-search"]').setValue('blue');
    await nextTick();
    expect(getVisibleGroupCids(wrapper)).toEqual(['1083009']);

    await wrapper.find('[data-testid="stock-move-sort-name"]').trigger('click');
    await nextTick();
    expect(getVisibleGroupCids(wrapper)).toEqual(['1083009']);
  });

  it('filters grouped rows by search and select-all only chooses visible groups', async () => {
    const snapshot = createSnapshot({
      containers: [
        {
          ...createSnapshot().containers[0],
          items: [
            ...createSnapshot().containers[0].items,
            {
              itemUid: 'cable-b',
              itemCid: 1011001,
              count: 1,
              pos: 3,
              rotate: false,
              stockId: 1,
              boxCount: 1,
              boxIds: [3],
              canTrade: true,
              isLock: false,
            },
          ],
        },
        createSnapshot().containers[1],
      ],
    });
    const movedSnapshot = createSnapshot({
      containers: [
        {
          ...snapshot.containers[0],
          items: [
            snapshot.containers[0].items[1],
            snapshot.containers[0].items[2],
          ],
        },
        {
          ...snapshot.containers[1],
          items: [
            snapshot.containers[1].items[0],
            {
              itemUid: 'boots-a',
              itemCid: 1032006,
              count: 1,
              pos: 1,
              rotate: false,
              stockId: 2,
              boxCount: 4,
              boxIds: [1, 2, 5, 6],
              canTrade: true,
              isLock: false,
            },
          ],
        },
      ],
    });

    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
      }
      if (command === 'MoveStockItem') {
        expect(args).toEqual({
          oldStockId: 1,
          oldSlot: 0,
          newStockId: 2,
          newSlot: 1,
          isRotate: false,
        });
        return { ok: true, value: { moved: true, containers: movedSnapshot.containers } };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await wrapper.find('[data-testid="stock-move-target"]').setValue('2');
    await nextTick();

    await wrapper.find('[data-testid="stock-move-search"]').setValue('boot');
    await nextTick();

    expect(wrapper.find('[data-testid="stock-move-row-group-1032006"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="stock-move-row-group-1011001"]').exists()).toBe(false);

    await wrapper.find('[data-testid="stock-move-select-all"]').trigger('click');
    await wrapper.find('[data-testid="stock-move-submit"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'MoveStockItem')).toHaveLength(1);
  });

  it('renders and moves items from the main warehouse with stockId zero', async () => {
    const firstSnapshot = createSnapshot({
      containers: [
        {
          stockId: 0,
          stockCid: 0,
          width: 4,
          height: 3,
          boxCount: 12,
          items: [
            {
              itemUid: 'main-a',
              itemCid: 1011001,
              count: 1,
              pos: 1,
              rotate: false,
              stockId: 0,
              boxCount: 1,
              boxIds: [1],
              canTrade: true,
              isLock: false,
            },
          ],
        },
        createSnapshot().containers[1],
      ],
    });
    const secondSnapshot = createSnapshot({
      containers: [
        {
          ...firstSnapshot.containers[0],
          items: [],
        },
        {
          ...firstSnapshot.containers[1],
          items: [
            ...firstSnapshot.containers[1].items,
            {
              itemUid: 'main-a',
              itemCid: 1011001,
              count: 1,
              pos: 1,
              rotate: false,
              stockId: 2,
              boxCount: 1,
              boxIds: [1],
              canTrade: true,
              isLock: false,
            },
          ],
        },
      ],
    });

    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: firstSnapshot };
      }
      if (command === 'MoveStockItem') {
        expect(args).toEqual({
          oldStockId: 0,
          oldSlot: 1,
          newStockId: 2,
          newSlot: 1,
          isRotate: false,
        });
        return { ok: true, value: { moved: true, containers: secondSnapshot.containers } };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('0');
    await wrapper.find('[data-testid="stock-move-target"]').setValue('2');
    await nextTick();

    expect(wrapper.find('[data-testid="stock-move-row-group-1011001"]').exists()).toBe(true);

    await wrapper.find('[data-testid="stock-move-item-group-1011001"]').setValue(true);
    await wrapper.find('[data-testid="stock-move-submit"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(2, 'MoveStockItem', {
      oldStockId: 0,
      oldSlot: 1,
      newStockId: 2,
      newSlot: 1,
      isRotate: false,
    });
  });

  it('updates progress in real time while moving selected items sequentially', async () => {
    vi.useFakeTimers();
    const firstSnapshot = createSnapshot();
    const secondSnapshot = createSnapshot({
      containers: [
        {
          ...firstSnapshot.containers[0],
          items: [
            firstSnapshot.containers[0].items[1],
          ],
        },
        {
          ...firstSnapshot.containers[1],
          items: [
            firstSnapshot.containers[1].items[0],
            {
              itemUid: 'boots-a',
              itemCid: 1032006,
              count: 1,
              pos: 1,
              rotate: false,
              stockId: 2,
              boxCount: 4,
              boxIds: [1, 2, 5, 6],
              canTrade: true,
              isLock: false,
            },
          ],
        },
      ],
    });
    const thirdSnapshot = createSnapshot({
      containers: [
        {
          ...firstSnapshot.containers[0],
          items: [],
        },
        {
          ...firstSnapshot.containers[1],
          items: [
            firstSnapshot.containers[1].items[0],
            {
              itemUid: 'boots-a',
              itemCid: 1032006,
              count: 1,
              pos: 1,
              rotate: false,
              stockId: 2,
              boxCount: 4,
              boxIds: [1, 2, 5, 6],
              canTrade: true,
              isLock: false,
            },
            {
              itemUid: 'cable-a',
              itemCid: 1011001,
              count: 1,
              pos: 3,
              rotate: false,
              stockId: 2,
              boxCount: 1,
              boxIds: [3],
              canTrade: true,
              isLock: false,
            },
          ],
        },
      ],
    });

    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: firstSnapshot };
      }
      if (command === 'MoveStockItem' && args.oldSlot === 0) {
        return { ok: true, value: { moved: true, stocksRefreshed: true, containers: secondSnapshot.containers } };
      }
      if (command === 'MoveStockItem' && args.oldSlot === 2) {
        return { ok: true, value: { moved: true, stocksRefreshed: true, containers: thirdSnapshot.containers } };
      }
      throw new Error(`unexpected command: ${command} ${JSON.stringify(args)}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await wrapper.find('[data-testid="stock-move-target"]').setValue('2');
    await nextTick();

    await flushPromises();
    await wrapper.find('[data-testid="stock-move-item-group-1032006"]').setValue(true);
    await wrapper.find('[data-testid="stock-move-item-group-1011001"]').setValue(true);

    const submitPromise = wrapper.find('[data-testid="stock-move-submit"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(2, 'MoveStockItem', {
      oldStockId: 1,
      oldSlot: 0,
      newStockId: 2,
      newSlot: 1,
      isRotate: false,
    });
    expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'MoveStockItem')).toHaveLength(1);
    expect(getSummaryFieldText(wrapper, 'processed')).toBe('1');
    expect(getSummaryFieldText(wrapper, 'total')).toBe('2');
    expect(getSummaryFieldText(wrapper, 'success')).toBe('1');
    expect(getSummaryFieldText(wrapper, 'skipped')).toBe('0');
    expect(getSummaryFieldText(wrapper, 'failed')).toBe('0');
    expect(getSummaryFieldText(wrapper, 'current-item')).toBe('Data Cable');

    await vi.advanceTimersByTimeAsync(999);
    expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'MoveStockItem')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await submitPromise;
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(3, 'MoveStockItem', {
      oldStockId: 1,
      oldSlot: 2,
      newStockId: 2,
      newSlot: 3,
      isRotate: false,
    });
    expect(getSummaryFieldText(wrapper, 'processed')).toBe('2');
    expect(getSummaryFieldText(wrapper, 'total')).toBe('2');
    expect(getSummaryFieldText(wrapper, 'success')).toBe('2');
    expect(getSummaryFieldText(wrapper, 'skipped')).toBe('0');
    expect(getSummaryFieldText(wrapper, 'failed')).toBe('0');
    expect(getSummaryFieldText(wrapper, 'current-item')).toBe('-');
  });

  it('skips items with no available placement and continues remaining moves', async () => {
    const snapshot = createSnapshot({
      containers: [
        createSnapshot().containers[0],
        {
          stockId: 2,
          stockCid: 9102,
          width: 3,
          height: 2,
          boxCount: 6,
          items: [
            {
              itemUid: 'block-a',
              itemCid: 1011001,
              count: 1,
              pos: 0,
              rotate: false,
              stockId: 2,
              boxCount: 1,
              boxIds: [0],
              canTrade: true,
              isLock: false,
            },
            {
              itemUid: 'block-b',
              itemCid: 1011001,
              count: 1,
              pos: 1,
              rotate: false,
              stockId: 2,
              boxCount: 1,
              boxIds: [1],
              canTrade: true,
              isLock: false,
            },
            {
              itemUid: 'block-c',
              itemCid: 1011001,
              count: 1,
              pos: 3,
              rotate: false,
              stockId: 2,
              boxCount: 1,
              boxIds: [3],
              canTrade: true,
              isLock: false,
            },
          ],
        },
      ],
    });
    const movedSnapshot = createSnapshot({
      containers: [
        {
          ...snapshot.containers[0],
          items: [
            snapshot.containers[0].items[0],
          ],
        },
        {
          ...snapshot.containers[1],
          items: [
            ...snapshot.containers[1].items,
            {
              itemUid: 'cable-a',
              itemCid: 1011001,
              count: 1,
              pos: 2,
              rotate: false,
              stockId: 2,
              boxCount: 1,
              boxIds: [2],
              canTrade: true,
              isLock: false,
            },
          ],
        },
      ],
    });

    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
      }
      if (command === 'MoveStockItem') {
        expect(args.oldSlot).toBe(2);
        return { ok: true, value: { moved: true, containers: movedSnapshot.containers } };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await wrapper.find('[data-testid="stock-move-target"]').setValue('2');
    await nextTick();

    await wrapper.find('[data-testid="stock-move-item-group-1032006"]').setValue(true);
    await wrapper.find('[data-testid="stock-move-item-group-1011001"]').setValue(true);
    await wrapper.find('[data-testid="stock-move-submit"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'MoveStockItem')).toHaveLength(1);
    expect(getSummaryFieldText(wrapper, 'processed')).toBe('2');
    expect(getSummaryFieldText(wrapper, 'success')).toBe('1');
    expect(getSummaryFieldText(wrapper, 'skipped')).toBe('1');
    expect(getSummaryFieldText(wrapper, 'failed')).toBe('0');
  });

  it('stops the batch when a move command fails', async () => {
    vi.useFakeTimers();
    const firstSnapshot = createSnapshot();
    const secondSnapshot = createSnapshot({
      containers: [
        {
          ...firstSnapshot.containers[0],
          items: [
            firstSnapshot.containers[0].items[1],
          ],
        },
        {
          ...firstSnapshot.containers[1],
          items: [
            firstSnapshot.containers[1].items[0],
            {
              itemUid: 'boots-a',
              itemCid: 1032006,
              count: 1,
              pos: 1,
              rotate: false,
              stockId: 2,
              boxCount: 4,
              boxIds: [1, 2, 5, 6],
              canTrade: true,
              isLock: false,
            },
          ],
        },
      ],
    });

    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: firstSnapshot };
      }
      if (command === 'MoveStockItem' && args.oldSlot === 0) {
        return { ok: true, value: { moved: true, containers: secondSnapshot.containers } };
      }
      if (command === 'MoveStockItem' && args.oldSlot === 2) {
        return { ok: false, error: 'move failed' };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await wrapper.find('[data-testid="stock-move-target"]').setValue('2');
    await nextTick();

    await wrapper.find('[data-testid="stock-move-item-group-1032006"]').setValue(true);
    await wrapper.find('[data-testid="stock-move-item-group-1011001"]').setValue(true);
    const submitPromise = wrapper.find('[data-testid="stock-move-submit"]').trigger('click');
    await flushPromises();
    await nextTick();

    await vi.advanceTimersByTimeAsync(1000);
    await submitPromise;
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'MoveStockItem')).toHaveLength(2);
    expect(getSummaryFieldText(wrapper, 'processed')).toBe('2');
    expect(getSummaryFieldText(wrapper, 'total')).toBe('2');
    expect(getSummaryFieldText(wrapper, 'success')).toBe('1');
    expect(getSummaryFieldText(wrapper, 'skipped')).toBe('0');
    expect(getSummaryFieldText(wrapper, 'failed')).toBe('1');
    expect(getSummaryFieldText(wrapper, 'current-item')).toBe('Data Cable');
    expect(getSummaryFieldText(wrapper, 'stop-reason')).toBe('move failed');
    expect(wrapper.text()).toContain('move failed');
  });

  it('opens and closes the stock move list editor modal', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand, {
      listStockMoveLists: vi.fn(async () => ({ ok: true, value: [] })),
      saveStockMoveList: vi.fn(),
    });

    const wrapper = await mountPanel();
    expect(wrapper.find('[data-testid="stock-move-list-editor-modal"]').exists()).toBe(false);

    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    await wrapper.find('[data-testid="stock-move-open-list-editor"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-testid="stock-move-list-editor-modal"]').exists()).toBe(true);

    await wrapper.find('[data-testid="stock-move-list-editor-cancel"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-testid="stock-move-list-editor-modal"]').exists()).toBe(false);
  });

  it('refreshes saved lists after saving through the stock move list editor modal', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const listStockMoveLists = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({
        ok: true,
        value: [
          {
            id: 'saved-1',
            name: '常用车件',
            savedAt: '2026-06-05T03:04:05.000Z',
            itemCids: [1083009],
            items: [],
          },
        ],
      });
    const saveStockMoveList = vi.fn(async (payload) => ({
      ok: true,
      value: { id: 'saved-1', savedAt: '2026-06-05T03:04:05.000Z', ...payload },
    }));
    setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList });

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();
    await wrapper.find('[data-testid="stock-move-item-group-1083009"]').setValue(true);
    await wrapper.find('[data-testid="stock-move-open-list-editor"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="stock-move-list-editor-modal"]').exists()).toBe(true);

    await wrapper.find('[data-testid="stock-move-list-editor-name"]').setValue('常用车件');
    await wrapper.find('[data-testid="stock-move-list-editor-save"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(saveStockMoveList).toHaveBeenCalledWith({
      name: '常用车件',
      itemCids: [1083009],
      items: [
        {
          itemCid: 1083009,
          name: 'Intake Manifold',
          quality: 'blue',
          type: 'vehicle',
          sizeKey: '1x2',
        },
      ],
    });
    expect(listStockMoveLists).toHaveBeenCalledTimes(3);
    expect(wrapper.find('[data-testid="stock-move-apply-list-saved-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="stock-move-saved-list-kind-saved-1"]').text()).toBe('1');
    expect(wrapper.find('[data-testid="stock-move-saved-list-time-saved-1"]').text()).toBe(
      '2026-06-05T03:04:05.000Z',
    );
  });

  it('refreshes saved lists after loading stock containers', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const listStockMoveLists = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: [
          {
            id: 'saved-1',
            name: '旧列表',
            savedAt: '2026-06-05T01:02:03.000Z',
            itemCids: [1032006],
            items: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        value: [
          {
            id: 'saved-2',
            name: '新列表',
            savedAt: '2026-06-05T04:05:06.000Z',
            itemCids: [1083009, 1011001],
            items: [],
          },
        ],
      });
    setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList: vi.fn() });

    const wrapper = await mountPanel();
    expect(wrapper.find('[data-testid="stock-move-apply-list-saved-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="stock-move-apply-list-saved-2"]').exists()).toBe(false);

    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(listStockMoveLists).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="stock-move-apply-list-saved-1"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="stock-move-apply-list-saved-2"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="stock-move-saved-list-kind-saved-2"]').text()).toBe('2');
    expect(wrapper.find('[data-testid="stock-move-saved-list-time-saved-2"]').text()).toBe(
      '2026-06-05T04:05:06.000Z',
    );
  });

  it('ignores stale saved list refresh responses that resolve out of order', async () => {
    const snapshot = createSortableSnapshot();
    const firstRefresh = createDeferred();
    const secondRefresh = createDeferred();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const listStockMoveLists = vi.fn()
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise);
    setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList: vi.fn() });

    const wrapper = await mountPanel();
    expect(listStockMoveLists).toHaveBeenCalledTimes(1);

    const loadPromise = wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    expect(listStockMoveLists).toHaveBeenCalledTimes(2);

    secondRefresh.resolve({
      ok: true,
      value: [
        {
          id: 'saved-new',
          name: '最新列表',
          savedAt: '2026-06-05T08:09:10.000Z',
          itemCids: [1083009],
          items: [],
        },
      ],
    });
    await loadPromise;
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="stock-move-apply-list-saved-new"]').exists()).toBe(true);

    firstRefresh.resolve({
      ok: true,
      value: [
        {
          id: 'saved-old',
          name: '旧列表',
          savedAt: '2026-06-05T01:02:03.000Z',
          itemCids: [1032006],
          items: [],
        },
      ],
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="stock-move-apply-list-saved-new"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="stock-move-apply-list-saved-old"]').exists()).toBe(false);
  });

  it('applies only itemCids that exist in the current source container', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const listStockMoveLists = vi.fn(async () => ({
      ok: true,
      value: [
        {
          id: 'saved-1',
          name: '混合列表',
          savedAt: '2026-06-05T03:04:05.000Z',
          itemCids: [1083009, 9999999],
          items: [],
        },
      ],
    }));
    setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList: vi.fn() });

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();
    await wrapper.find('[data-testid="stock-move-apply-list-saved-1"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="stock-move-item-group-1083009"]').element.checked).toBe(true);
    expect(wrapper.find('[data-testid="stock-move-item-group-1032006"]').element.checked).toBe(false);
    expect(wrapper.find('[data-testid="stock-move-item-group-1011001"]').element.checked).toBe(false);
  });

  it('shows an error when an applied saved list has no matches in the current source container', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const listStockMoveLists = vi.fn(async () => ({
      ok: true,
      value: [
        {
          id: 'saved-1',
          name: '无匹配列表',
          savedAt: '2026-06-05T03:04:05.000Z',
          itemCids: [9999999],
          items: [],
        },
      ],
    }));
    setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList: vi.fn() });

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();
    await wrapper.find('[data-testid="stock-move-apply-list-saved-1"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="stock-move-saved-lists-error"]').text()).toContain('没有匹配');
  });

  it('renders the current source match count for each saved list', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') {
        return { ok: true, value: snapshot };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const listStockMoveLists = vi.fn(async () => ({
      ok: true,
      value: [
        {
          id: 'saved-1',
          name: '混合列表',
          savedAt: '2026-06-05T03:04:05.000Z',
          itemCids: [1083009, 9999999],
          items: [],
        },
      ],
    }));
    setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList: vi.fn() });

    const wrapper = await mountPanel();
    expect(wrapper.find('[data-testid="stock-move-saved-list-match-saved-1"]').text()).toBe('0');

    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();
    expect(wrapper.find('[data-testid="stock-move-saved-list-match-saved-1"]').text()).toBe('1');

    await wrapper.find('[data-testid="stock-move-source"]').setValue('2');
    await nextTick();
    expect(wrapper.find('[data-testid="stock-move-saved-list-match-saved-1"]').text()).toBe('0');
  });

  it('invert selection toggles checked state for visible groups and preserves hidden selections', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') return { ok: true, value: snapshot };
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    // Initially nothing is checked.
    expect(getCheckedCids(wrapper)).toEqual([]);

    // Click "Select All" — all visible groups should be checked.
    await wrapper.find('[data-testid="stock-move-select-all"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper).sort((a, b) => a - b)).toEqual([1011001, 1032006, 1083009].sort((a, b) => a - b));

    // Click "Invert" — all should become unchecked.
    await wrapper.find('[data-testid="stock-move-invert"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper)).toEqual([]);

    // Click "Invert" again — all should become checked (empty → full).
    await wrapper.find('[data-testid="stock-move-invert"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper).sort((a, b) => a - b)).toEqual([1011001, 1032006, 1083009].sort((a, b) => a - b));

    // Manually uncheck only the first group.
    await wrapper.find('[data-testid="stock-move-item-group-1032006"]').setValue(false);
    await nextTick();
    expect(getCheckedCids(wrapper).sort((a, b) => a - b)).toEqual([1011001, 1083009].sort((a, b) => a - b));

    // Invert: 1011001 and 1083009 become unchecked; 1032006 becomes checked.
    await wrapper.find('[data-testid="stock-move-invert"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper)).toEqual([1032006]);
  });

  it('invert selection with search filter preserves hidden selections', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') return { ok: true, value: snapshot };
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    // Select all groups.
    await wrapper.find('[data-testid="stock-move-select-all"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper).sort((a, b) => a - b)).toEqual([1011001, 1032006, 1083009].sort((a, b) => a - b));

    // Search to filter down to only 1032006 (Boots).
    await wrapper.find('[data-testid="stock-move-search"]').setValue('boot');
    await nextTick();
    expect(getVisibleGroupCids(wrapper)).toEqual(['1032006']);

    // Invert — 1032006 becomes unchecked; hidden rows are not in the DOM so getCheckedCids sees nothing.
    await wrapper.find('[data-testid="stock-move-invert"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper)).toEqual([]);

    // Clear search filter.
    await wrapper.find('[data-testid="stock-move-search"]').setValue('');
    await nextTick();
    expect(getVisibleGroupCids(wrapper).sort()).toEqual(['1032006', '1083009', '1011001'].sort());
    // 1011001 and 1083009 still checked (preserved), 1032006 is unchecked.
    expect(getCheckedCids(wrapper).sort((a, b) => a - b)).toEqual([1011001, 1083009].sort((a, b) => a - b));
  });

  it('invert selection button is disabled when no visible groups', async () => {
    const snapshot = createSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') return { ok: true, value: snapshot };
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    // Filter to a non-existent item — no visible groups.
    await wrapper.find('[data-testid="stock-move-search"]').setValue('nonexistent');
    await nextTick();
    expect(getVisibleGroupCids(wrapper)).toEqual([]);

    const invertButton = wrapper.find('[data-testid="stock-move-invert"]');
    expect(invertButton.attributes('disabled')).toBeDefined();

    // Clear filter — button should be enabled again.
    await wrapper.find('[data-testid="stock-move-search"]').setValue('');
    await nextTick();
    expect(invertButton.attributes('disabled')).toBeUndefined();
  });
});
