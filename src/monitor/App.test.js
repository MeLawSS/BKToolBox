/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import App from './App.vue';
import { __resetMonitorSwitchRuntimeForTest } from '../shared/useMonitorSwitch.js';

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.close = vi.fn();
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  emit(type, payload) {
    this.listeners[type]?.({ data: JSON.stringify(payload) });
  }

  static reset() {
    FakeEventSource.instances = [];
  }
}

FakeEventSource.instances = [];

const defaultMarketLatest = [{
  observedAt: '2026-05-28T12:24:37.000Z',
  itemCid: 1022001,
  minPrice: 1155,
  maxPrice: 1502,
  totalCount: 355,
  tierCount: 8,
  source: 'tcp-passive',
}];

const defaultMarketHistory = {
  1022001: [{
    observedAt: '2026-05-28T12:24:37.000Z',
    itemCid: 1022001,
    minPrice: 1155,
    maxPrice: 1502,
    totalCount: 355,
    tierCount: 8,
    tiers: [
      { price: 1155, count: 105 },
      { price: 1502, count: 5 },
    ],
    source: 'tcp-passive',
  }],
};

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const marketLatest = globalThis.__marketLatest ?? defaultMarketLatest;
    const marketHistory = globalThis.__marketHistory ?? defaultMarketHistory;
    const marketHistoryResponses = globalThis.__marketHistoryResponses ?? {};
    const driverStatus = globalThis.__driverStatus ?? { state: 'missing', installed: false, usable: false, message: 'Npcap is not installed' };

    if (String(url).endsWith('/api/bidking-monitor/status')) {
      return {
        ok: true,
        json: async () => ({ state: 'idle', running: false, totalEvents: 0 }),
      };
    }

    if (String(url).endsWith('/api/capture-driver/status')) {
      return {
        ok: true,
        json: async () => driverStatus,
      };
    }

    if (String(url).endsWith('/data/collectibles.json')) {
      return {
        ok: true,
        json: async () => [{
          name: '急救毯',
          quality: '绿',
          type: '医疗用品',
          price: 770,
          image: '/assets/bidking/icons/icon_1022001.png',
          size: { width: 2, height: 2, key: '2x2' },
        }],
      };
    }

    if (String(url).endsWith('/api/market-prices/latest')) {
      return {
        ok: true,
        json: async () => ({
          items: marketLatest,
        }),
      };
    }

    if (String(url).includes('/api/market-prices/history')) {
      const itemCid = new URL(String(url), 'http://localhost').searchParams.get('itemCid');
      const delayedResponse = marketHistoryResponses[itemCid];
      return {
        ok: true,
        json: async () => delayedResponse
          ? delayedResponse
          : {
              itemCid: Number(itemCid),
              history: marketHistory[itemCid] ?? [],
            },
      };
    }

    if (String(url).endsWith('/api/capture-driver/install')) {
      return {
        ok: true,
        json: async () => ({ started: true, path: 'D:\\BKToolBox\\npcap.exe' }),
      };
    }

    if (String(url).endsWith('/api/capture-driver/uninstall')) {
      return {
        ok: true,
        json: async () => ({ started: true, path: 'C:\\Program Files\\Npcap\\uninstall.exe' }),
      };
    }

    if (String(url).endsWith('/api/bidking-monitor/start')) {
      return {
        ok: true,
        json: async () => ({
          state: 'capturing',
          running: true,
          totalEvents: 0,
          options: JSON.parse(options.body),
        }),
      };
    }

    if (String(url).endsWith('/api/bidking-monitor/stop')) {
      return {
        ok: true,
        json: async () => ({ state: 'stopped', running: false, totalEvents: 1 }),
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }));
}

async function mountApp() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('Monitor App', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    delete globalThis.__marketLatest;
    delete globalThis.__marketHistory;
    delete globalThis.__marketHistoryResponses;
    delete globalThis.__driverStatus;
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    mockFetch();
  });

  afterEach(() => {
    __resetMonitorSwitchRuntimeForTest();
    vi.unstubAllGlobals();
  });

  it('starts the monitor with configured options', async () => {
    const wrapper = await mountApp();

    await wrapper.find('#monitor-game-root').setValue('D:\\SteamLibrary\\steamapps\\common\\BidKing');
    await wrapper.find('#monitor-start').trigger('click');
    await nextTick();

    expect(fetch).toHaveBeenCalledWith('/api/bidking-monitor/start', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        remoteAddress: '',
        port: 10000,
        batchSeconds: 2,
        gameRoot: 'D:\\SteamLibrary\\steamapps\\common\\BidKing',
        outputDir: '',
      }),
    }));
    expect(wrapper.find('[data-testid="monitor-state"]').text()).toContain('抓包中');
  });

  it('updates the page status when the shared topbar monitor switch starts capture', async () => {
    const wrapper = await mountApp();

    await wrapper.find('#monitor-game-root').setValue('D:\\SteamLibrary\\steamapps\\common\\BidKing');
    await wrapper.find('[data-testid="topbar-monitor-switch"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(fetch).toHaveBeenCalledWith('/api/bidking-monitor/start', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        remoteAddress: '',
        port: 10000,
        batchSeconds: 2,
        gameRoot: 'D:\\SteamLibrary\\steamapps\\common\\BidKing',
        outputDir: '',
      }),
    }));
    expect(wrapper.find('[data-testid="monitor-state"]').text()).toContain('抓包中');
  });

  it('uses generic information monitor copy', async () => {
    const wrapper = await mountApp();

    expect(wrapper.text()).toContain('信息监控');
    expect(wrapper.text()).toContain('监控 BidKing 信息流，展示捕获到的事件、交易所价格和解析状态。');
    expect(wrapper.text()).toContain('事件');
    expect(wrapper.text()).not.toContain('实时对局监控');
    expect(wrapper.text()).not.toContain('通过 Windows pktmon 分批抓取 BidKing TCP 明文流，解析对局中的技能揭露信息。');
  });

  it('shows packet capture driver status and launches install/uninstall actions', async () => {
    const wrapper = await mountApp();

    expect(wrapper.find('[data-testid="capture-driver-status"]').text()).toContain('未安装');

    await wrapper.find('#capture-driver-install').trigger('click');
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith('/api/capture-driver/install', { method: 'POST' });
    expect(wrapper.text()).toContain('已启动安装程序');

    await wrapper.find('#capture-driver-uninstall').trigger('click');
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith('/api/capture-driver/uninstall', { method: 'POST' });
    expect(wrapper.text()).toContain('已启动卸载程序');
  });

  it('renders long capture-driver errors in a separate wrapped block', async () => {
    globalThis.__driverStatus = {
      state: 'missing',
      installed: false,
      usable: false,
      message: 'Command failed: C:\\\\Tools\\\\BidKing\\\\dumpcap.exe -D Unable to load Npcap (wpcap.dll); see https://npcap.com/',
    };

    const wrapper = await mountApp();

    expect(wrapper.find('[data-testid="capture-driver-status"]').text()).toBe('未安装');
    expect(wrapper.find('[data-testid="capture-driver-message"]').text()).toContain('dumpcap.exe -D');
    expect(wrapper.find('[data-testid="capture-driver-message"]').text()).toContain('https://npcap.com/');
  });

  it('renders SSE skill events and selected hit box details', async () => {
    const wrapper = await mountApp();

    expect(FakeEventSource.instances[0].url).toBe('/api/bidking-monitor/events');
    FakeEventSource.instances[0].emit('event', {
      key: 'skill:1',
      msgId: 39,
      sourceKind: 'game_use_item',
      gameUid: 123,
      round: 2,
      group: 1,
      skill: {
        skillCid: 200023,
        itemCid: 5001,
        hitBoxCount: 2,
        hitBoxes: [
          {
            itemCid: 5001,
            name: '航空碳纤维鱼竿',
            quality: '金',
            price: 50604,
            width: 1,
            height: 4,
            boxIndex: 17,
          },
        ],
      },
    });
    await nextTick();

    expect(wrapper.find('#monitor-events').text()).toContain('200023');
    expect(wrapper.find('#monitor-events').text()).toContain('航空碳纤维鱼竿');
    expect(wrapper.find('#monitor-detail').text()).toContain('box 17');
    expect(wrapper.find('#monitor-detail').text()).toContain('50,604');
  });

  it('clears displayed event records without stopping the monitor', async () => {
    const wrapper = await mountApp();

    FakeEventSource.instances[0].emit('event', {
      key: 'skill:clear-me',
      msgId: 39,
      sourceKind: 'game_use_item',
      gameUid: 123,
      skill: {
        skillCid: 200023,
        hitBoxes: [{ name: '航空碳纤维鱼竿', quality: '金', price: 50604, boxIndex: 17 }],
      },
    });
    await nextTick();

    expect(wrapper.find('#monitor-events').text()).toContain('航空碳纤维鱼竿');

    await wrapper.find('#monitor-clear-events').trigger('click');
    await nextTick();

    expect(wrapper.find('#monitor-events').text()).toContain('暂无事件');
    expect(wrapper.find('#monitor-events').text()).not.toContain('航空碳纤维鱼竿');
    expect(wrapper.find('#monitor-detail').text()).toContain('选择一条事件查看明细。');
    expect(fetch).not.toHaveBeenCalledWith('/api/bidking-monitor/stop', expect.anything());
  });

  it('renders quality-only protocol hitBoxList positions and qualities', async () => {
    const wrapper = await mountApp();

    FakeEventSource.instances[0].emit('event', {
      key: 'skill:quality-only',
      msgId: 39,
      sourceKind: 'game_use_item',
      gameUid: 123,
      round: 1,
      group: 'itemSkillLog',
      skill: {
        skillCid: 702,
        hitBoxCount: 2,
        qualityOnlyHitBoxCount: 2,
        hitBoxList: [
          { boxId: 8, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 17, itemQuility: 5, itemQuilityName: '金' },
        ],
      },
    });
    await nextTick();

    expect(wrapper.find('#monitor-events').text()).toContain('702');
    expect(wrapper.find('#monitor-events').text()).toContain('紫/金');
    expect(wrapper.find('#monitor-events').text()).toContain('2/2');
    expect(wrapper.find('#monitor-detail').text()).toContain('box 8');
    expect(wrapper.find('#monitor-detail').text()).toContain('box 17');
    expect(wrapper.find('#monitor-detail').text()).toContain('紫');
    expect(wrapper.find('#monitor-detail').text()).toContain('金');
  });

  it('renders aggregate average-cell skill events without hit boxes', async () => {
    const wrapper = await mountApp();

    FakeEventSource.instances[0].emit('event', {
      key: 'skill:avg-cells',
      msgId: 45,
      sourceKind: 'game_over',
      gameUid: '2103:1178745632081515',
      round: 3,
      group: 'item',
      skill: {
        skillCid: 303,
        itemCid: 100112,
        itemName: '优品均格',
        hitBoxCount: 0,
        allHitItemAvgBoxIndex: 2.5,
      },
    });
    await nextTick();

    expect(wrapper.find('#monitor-events').text()).toContain('303');
    expect(wrapper.find('#monitor-events').text()).toContain('优品均格');
    expect(wrapper.find('#monitor-events').text()).toContain('2.5');
    expect(wrapper.find('#monitor-detail').text()).toContain('平均格数');
    expect(wrapper.find('#monitor-detail').text()).toContain('2.5');
  });

  it('renders facts and state from enriched SSE payloads', async () => {
    const wrapper = await mountApp();

    FakeEventSource.instances[0].emit('event', {
      key: 'skill:1',
      gameUid: 'game-1',
      rawEvent: {
        key: 'skill:1',
        msgId: 39,
        sourceKind: 'game_use_item',
        round: 2,
        group: 'itemSkillLog',
        skill: {
          skillCid: 1002081,
          itemName: '测试藏品',
          hitBoxes: [
            {
              name: '测试藏品',
              quality: '蓝',
              price: 12345,
              width: 1,
              height: 1,
              boxIndex: 1,
            },
          ],
        },
      },
      facts: [{ type: 'item.outlineRevealed', cells: [1], width: 1, height: 1 }],
      state: { gameUid: 'game-1', outlines: [{ cells: [1] }] },
    });
    await nextTick();

    expect(wrapper.text()).toContain('item.outlineRevealed');
    expect(wrapper.text()).toContain('game-1');
    expect(wrapper.find('#monitor-detail').text()).toContain('事实');
    expect(wrapper.find('#monitor-detail').text()).toContain('状态');
    expect(wrapper.find('#monitor-events').text()).toContain('1002081');
    expect(wrapper.find('#monitor-events').text()).toContain('测试藏品');
    expect(wrapper.find('#monitor-events').text()).toContain('蓝');
    expect(wrapper.find('#monitor-detail').text()).toContain('box 1');
    expect(wrapper.find('#monitor-detail').text()).toContain('12,345');

    await wrapper.find('input[type="search"]').setValue('1002081');
    await nextTick();

    expect(wrapper.find('#monitor-events').text()).toContain('1002081');
    expect(wrapper.find('#monitor-events').text()).toContain('测试藏品');
  });

  it('renders latest market sale prices and selected price tiers', async () => {
    const wrapper = await mountApp();

    expect(fetch).toHaveBeenCalledWith('/api/market-prices/latest');
    expect(fetch).toHaveBeenCalledWith('/data/collectibles.json');
    expect(wrapper.find('#market-price-table').text()).toContain('交易所售卖价');
    expect(wrapper.find('#market-price-table').text()).toContain('急救毯');
    expect(wrapper.find('#market-price-table').text()).not.toContain('1022001');
    expect(wrapper.find('#market-price-table').text()).toContain('1,155');
    expect(wrapper.find('#market-price-table').text()).toContain('1,502');
    expect(wrapper.find('#market-price-detail').text()).toContain('售卖价');
    expect(wrapper.find('#market-price-detail').text()).toContain('105');
  });

  it('fetches market sale price history when selecting another latest row', async () => {
    globalThis.__marketLatest = [
      ...defaultMarketLatest,
      {
        observedAt: '2026-05-28T12:30:00.000Z',
        itemCid: 1022002,
        itemName: '钛合金工具箱',
        minPrice: 2200,
        maxPrice: 2750,
        totalCount: 44,
        tierCount: 2,
        source: 'tcp-passive',
      },
    ];
    globalThis.__marketHistory = {
      ...defaultMarketHistory,
      1022002: [{
        observedAt: '2026-05-28T12:30:00.000Z',
        itemCid: 1022002,
        itemName: '钛合金工具箱',
        minPrice: 2200,
        maxPrice: 2750,
        totalCount: 44,
        tierCount: 2,
        tiers: [
          { price: 2200, count: 33 },
          { price: 2750, count: 11 },
        ],
        source: 'tcp-passive',
      }],
    };
    const wrapper = await mountApp();

    const rows = wrapper.findAll('#market-price-table tbody tr');
    await rows[1].trigger('click');
    await flushPromises();
    await nextTick();

    expect(fetch).toHaveBeenCalledWith('/api/market-prices/history?itemCid=1022002&limit=50');
    expect(wrapper.find('#market-price-detail').text()).toContain('钛合金工具箱');
    expect(wrapper.find('#market-price-detail').text()).toContain('售卖价');
    expect(wrapper.find('#market-price-detail').text()).toContain('2,200');
    expect(wrapper.find('#market-price-detail').text()).toContain('33');
    expect(wrapper.find('#market-price-detail').text()).toContain('2,750');
    expect(wrapper.find('#market-price-detail').text()).toContain('44');
  });

  it('does not let stale market sale price history overwrite the current selection', async () => {
    const staleHistory = createDeferred();
    globalThis.__marketLatest = [
      ...defaultMarketLatest,
      {
        observedAt: '2026-05-28T12:30:00.000Z',
        itemCid: 1022002,
        itemName: '钛合金工具箱',
        minPrice: 2200,
        maxPrice: 2750,
        totalCount: 44,
        tierCount: 2,
        source: 'tcp-passive',
      },
    ];
    globalThis.__marketHistoryResponses = {
      1022001: staleHistory.promise,
      1022002: Promise.resolve({
        itemCid: 1022002,
        history: [{
          observedAt: '2026-05-28T12:30:00.000Z',
          itemCid: 1022002,
          itemName: '钛合金工具箱',
          minPrice: 2200,
          maxPrice: 2750,
          totalCount: 44,
          tierCount: 2,
          tiers: [
            { price: 2200, count: 33 },
            { price: 2750, count: 11 },
          ],
          source: 'tcp-passive',
        }],
      }),
    };
    const wrapper = await mountApp();

    await wrapper.findAll('#market-price-table tbody tr')[1].trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('#market-price-detail').text()).toContain('钛合金工具箱');
    expect(wrapper.find('#market-price-detail').text()).toContain('2,200');
    expect(wrapper.find('#market-price-detail').text()).toContain('33');

    staleHistory.resolve({
      itemCid: 1022001,
      history: defaultMarketHistory[1022001],
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('#market-price-detail').text()).toContain('钛合金工具箱');
    expect(wrapper.find('#market-price-detail').text()).toContain('2,200');
    expect(wrapper.find('#market-price-detail').text()).toContain('33');
    expect(wrapper.find('#market-price-detail').text()).not.toContain('1,155');
    expect(wrapper.find('#market-price-detail').text()).not.toContain('105');
  });

  it('refreshes latest market sale prices when a market price SSE event arrives', async () => {
    const wrapper = await mountApp();
    const initialLatestFetches = fetch.mock.calls.filter(([url]) => url === '/api/market-prices/latest').length;

    FakeEventSource.instances[0].emit('event', {
      key: 'market:1022001:99',
      rawEvent: {
        type: 'market_price',
        key: 'market:1022001:99',
        itemCid: 1022001,
        itemName: '急救毯',
      },
    });
    await flushPromises();
    await nextTick();

    const latestFetches = fetch.mock.calls.filter(([url]) => url === '/api/market-prices/latest');
    expect(latestFetches).toHaveLength(initialLatestFetches + 1);
    expect(wrapper.find('#market-price-table').text()).toContain('交易所售卖价');
    expect(wrapper.find('#monitor-events').text()).toContain('急救毯');
    expect(wrapper.find('#monitor-events').text()).not.toContain('1022001');
  });

  it('keeps same raw event keys from different games visible and selectable', async () => {
    const wrapper = await mountApp();

    FakeEventSource.instances[0].emit('event', {
      key: 'skill:shared',
      gameUid: 'game-a',
      rawEvent: {
        key: 'skill:shared',
        gameUid: 'game-a',
        msgId: 41,
        sourceKind: 'game_use_item',
        round: 1,
        group: 'itemSkillLog',
        skill: {
          skillCid: 200022,
          hitBoxes: [{
            itemCid: 5001,
            name: '第一局藏品',
            quality: '蓝',
            price: 3851,
            width: 1,
            height: 1,
            boxIndex: 8,
          }],
        },
      },
      facts: [],
      state: { gameUid: 'game-a', outlines: [] },
    });
    FakeEventSource.instances[0].emit('event', {
      key: 'skill:shared',
      gameUid: 'game-b',
      rawEvent: {
        key: 'skill:shared',
        gameUid: 'game-b',
        msgId: 42,
        sourceKind: 'game_use_item',
        round: 1,
        group: 'itemSkillLog',
        skill: {
          skillCid: 200022,
          hitBoxes: [{
            itemCid: 5002,
            name: '第二局藏品',
            quality: '金',
            price: 50604,
            width: 1,
            height: 1,
            boxIndex: 9,
          }],
        },
      },
      facts: [],
      state: { gameUid: 'game-b', outlines: [] },
    });
    await nextTick();

    let rows = wrapper.findAll('#monitor-events tbody tr');
    expect(rows).toHaveLength(2);
    expect(wrapper.find('#monitor-events').text()).toContain('第一局藏品');
    expect(wrapper.find('#monitor-events').text()).toContain('第二局藏品');

    await rows[1].trigger('click');
    await nextTick();
    expect(wrapper.find('#monitor-detail').text()).toContain('第一局藏品');
    expect(wrapper.find('#monitor-detail').text()).toContain('3,851');

    FakeEventSource.instances[0].emit('event', {
      key: 'skill:shared',
      gameUid: 'game-a',
      rawEvent: {
        key: 'skill:shared',
        gameUid: 'game-a',
        msgId: 43,
        sourceKind: 'game_use_item',
        skill: {
          skillCid: 200022,
          hitBoxes: [{ name: '重复藏品', price: 9999, boxIndex: 10 }],
        },
      },
    });
    await nextTick();

    rows = wrapper.findAll('#monitor-events tbody tr');
    expect(rows).toHaveLength(2);
    expect(wrapper.find('#monitor-events').text()).not.toContain('重复藏品');
  });
});
