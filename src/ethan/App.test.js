/* @vitest-environment happy-dom */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import App from './App.vue';
import {
  appendStreamRunSource,
  calculateEstimationResult,
  createStreamRun,
  finishStreamRun,
  runPriceMatchPhase,
} from './estimation-worker-core.js';
import { __resetMonitorSwitchRuntimeForTest } from '../shared/useMonitorSwitch.js';
import { __resetAutoOperationAgentSwitchRuntimeForTest } from '../shared/useAutoOperationAgentSwitch.js';

const require = createRequire(import.meta.url);
const { buildBidKingMonitorFacts } = require('../../lib/bidking-monitor-facts.js');
const {
  applyBidKingMonitorFacts,
  createEmptyBidKingMonitorState,
} = require('../../lib/bidking-monitor-store.js');
const STORAGE_KEY = 'bidking-page-state:v1:ethan';
const realAveragePrices = JSON.parse(fs.readFileSync('public/data/quality-size-average-prices.json', 'utf8'));
const realCollectibles = JSON.parse(fs.readFileSync('public/data/collectibles.json', 'utf8'));

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.close = vi.fn();
    this.listeners = new Map();
    FakeEventSource.instances.push(this);
  }

  emit(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emitEvent(type, message) {
    this.listeners.get(type)?.({ data: JSON.stringify(message) });
  }

  static reset() {
    FakeEventSource.instances = [];
  }
}

FakeEventSource.instances = [];

class FakeWorker {
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.messages = [];
    this.terminate = vi.fn();
    this.streamRuns = new Map();
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(structuredClone(message));
    if (!message?.type) return;

    // Stream protocol: start-stream-run / append-source / finish-stream-run
    if (message.type === 'start-stream-run') {
      this.streamRuns.set(message.runId, createStreamRun(message));
      return;
    }
    if (message.type === 'append-source') {
      const streamRun = this.streamRuns.get(message.runId);
      if (!streamRun) return;
      try {
        const rows = appendStreamRunSource(streamRun, message.text);
        rows.forEach((row, index) => {
          this.onmessage?.({
            data: {
              type: 'stream-row', runId: message.runId, streamMode: streamRun.streamMode,
              groupKey: streamRun.config.groupKey,
              count: streamRun.rows.length - rows.length + index + 1, row,
            },
          });
        });
      } catch (error) {
        this.streamRuns.delete(message.runId);
        this.onmessage?.({ data: { type: 'error', runId: message.runId, error: error?.message || String(error) } });
        this.onmessage?.({ data: { type: 'done', runId: message.runId } });
      }
      return;
    }
    if (message.type === 'finish-stream-run') {
      const streamRun = this.streamRuns.get(message.runId);
      if (!streamRun) return;
      try {
        const result = finishStreamRun(streamRun, message.reason);
        if (result.finalRow) {
          this.onmessage?.({
            data: {
              type: 'stream-row', runId: message.runId, streamMode: streamRun.streamMode,
              groupKey: streamRun.config.groupKey, count: streamRun.rows.length, row: result.finalRow,
            },
          });
        }
        this.onmessage?.({ data: { type: 'stream-complete', runId: message.runId, ...result } });
        this.onmessage?.({ data: { type: 'done', runId: message.runId } });
      } catch (error) {
        this.streamRuns.delete(message.runId);
        this.onmessage?.({ data: { type: 'error', runId: message.runId, error: error?.message || String(error) } });
        this.onmessage?.({ data: { type: 'done', runId: message.runId } });
      } finally {
        this.streamRuns.delete(message.runId);
      }
      return;
    }

    // Cancel
    if (message.type === 'cancel') {
      this.streamRuns.delete(message.runId);
      return;
    }

    // Direct estimation: start
    if (message.type !== 'start') return;
    const { runId, ...rest } = message;
    try {
      const result = calculateEstimationResult({ runId, ...rest });
      if (result.type === 'combined' || result.type === 'single') {
        const { type: mode, rows, ...startPayload } = result;
        this.onmessage?.({ data: { type: 'start', runId, mode, ...startPayload, count: rows.length } });
        rows.forEach((row, index) => {
          this.onmessage?.({
            data: { type: 'row', runId, mode, index: index + 1, groupKeys: result.groupKeys, groupKey: result.groupKey, ...row },
          });
        });
        runPriceMatchPhase({
          result,
          state: message.state,
          collectibleItemsByGroup: message.collectibleItemsByGroup,
          predictionGroupKeys: message.predictionGroupKeys,
          profile: message.profile,
          runId,
          postMessage: (msg) => this.onmessage?.({ data: msg }),
        });
      } else {
        this.onmessage?.({ data: { type: 'result', runId, result } });
        runPriceMatchPhase({
          result,
          state: message.state,
          collectibleItemsByGroup: message.collectibleItemsByGroup,
          predictionGroupKeys: message.predictionGroupKeys,
          profile: message.profile,
          runId,
          postMessage: (msg) => this.onmessage?.({ data: msg }),
        });
      }
      this.onmessage?.({ data: { type: 'done', runId } });
    } catch (error) {
      this.onmessage?.({ data: { type: 'error', runId, error: error?.message || String(error) } });
    }
  }

  emit(message) {
    this.onmessage?.({ data: message });
  }

  static reset() {
    FakeWorker.instances = [];
  }
}

FakeWorker.instances = [];
let mountedWrappers = [];

function averagePriceFixture() {
  return {
    白: {},
    绿: {},
    蓝: {},
    紫: {},
    金: {},
    红: {},
  };
}

function mockDataFetch({
  averagePrices = averagePriceFixture(),
  collectibles = [],
  monitorStatus = { state: 'idle', running: false, totalEvents: 0, lastError: null },
} = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const path = String(url);
    if (path === '/api/bidking-monitor/status') {
      return { ok: true, json: async () => monitorStatus };
    }
    if (path === '/api/bidking-monitor/start') {
      return { ok: true, json: async () => ({ state: 'capturing', running: true, totalEvents: 0, lastError: null }) };
    }
    if (path === '/api/bidking-monitor/stop') {
      return { ok: true, json: async () => ({ state: 'stopped', running: false, totalEvents: 0, lastError: null }) };
    }
    return {
      ok: true,
      json: async () => path.includes('/data/collectibles.json')
        ? collectibles
        : averagePrices,
      options,
    };
  }));
}

async function mountApp() {
  const wrapper = mount(App, { attachTo: document.body });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();
  return wrapper;
}

function getRunEventSource() {
  return FakeEventSource.instances.find((source) => String(source.url).startsWith('/run?'));
}

function createMonitorGroups(overrides = {}) {
  const emptyGroup = () => ({ totalCells: null, averageCells: null, averagePrice: null });
  return {
    wg: { ...emptyGroup(), ...overrides.wg },
    blue: { ...emptyGroup(), ...overrides.blue },
    purple: { ...emptyGroup(), ...overrides.purple },
    orange: { ...emptyGroup(), ...overrides.orange },
    red: { ...emptyGroup(), ...overrides.red },
  };
}

function createEnrichedMonitorPayload({
  key = 'skill:enriched',
  gameUid = 'game-1',
  rawEvent = {},
  groups = {},
  outlines = [],
  revealedTypes = [],
  minimumOccupied = null,
} = {}) {
  return {
    key,
    gameUid,
    ...rawEvent,
    rawEvent: {
      key,
      gameUid,
      ...rawEvent,
    },
    facts: [],
    state: {
      gameUid,
      round: 2,
      groups: createMonitorGroups(groups),
      outlines,
      qualityCells: [],
      revealedTypes,
      minimumOccupied,
      warnings: [],
    },
  };
}

function createLiveEnrichedMonitorPayload(rawEvent) {
  const facts = buildBidKingMonitorFacts(rawEvent);
  const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), facts);
  return {
    key: rawEvent.key,
    gameUid: rawEvent.gameUid,
    rawEvent,
    facts,
    state,
  };
}

describe('Ethan App', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    FakeEventSource.reset();
    FakeWorker.reset();
    vi.stubGlobal('Worker', FakeWorker);
    mockDataFetch();
  });

  afterEach(() => {
    mountedWrappers.forEach((wrapper) => wrapper.unmount());
    mountedWrappers = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
    __resetMonitorSwitchRuntimeForTest();
    __resetAutoOperationAgentSwitchRuntimeForTest();
  });

  it('loads price data and estimates from entered cells', async () => {
    const wrapper = await mountApp();

    expect(fetch).toHaveBeenCalledWith('/data/quality-size-average-prices.json', { cache: 'no-store' });
    expect(wrapper.find('#result-meta').text()).toBe('均价数据已加载');

    await wrapper.find('#total-cells-all').setValue('100');
    await wrapper.find('#cells-wg').setValue('20');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    // 20×232 (wg) + 80×889 (blue, lowest missing) = 75,760
    expect(wrapper.find('#total-estimate').text()).toBe('75,760');
    expect(wrapper.find('#result-meta').text()).toContain('已输入白+绿');
    expect(wrapper.find('#result-body').text()).toContain('白+绿');
    expect(wrapper.find('#result-body').text()).toContain('20');
  });

  it('renders static page chrome in English when locale is saved', async () => {
    window.localStorage.setItem('bidking-locale', 'en-US');
    const wrapper = await mountApp();

    expect(document.documentElement.lang).toBe('en-US');
    expect(wrapper.find('h1').text()).toBe('Expected Value Estimator');
    expect(wrapper.findAll('.nav a').map(link => link.attributes('href'))).toEqual([
      '/',
      '/Tools',
      '/Monitor',
      '/Inject',
    ]);
    expect(wrapper.find('#clear-button').text()).toBe('Clear');
    expect(wrapper.findAll('#result-body').length).toBe(1);
    expect(wrapper.findAll('thead th').map((cell) => cell.text()))
      .toEqual(['', 'Count', 'Total Cells', 'Average Cells', 'Low', 'Expected', 'High', 'Status']);
  });

  it('keeps the Ethan page chrome after the shared shell extraction', async () => {
    const wrapper = await mountApp();

    expect(wrapper.find('h1').text()).toBe('期望价值估算');
    expect(wrapper.find('#cells-wg').exists()).toBe(true);
    expect(wrapper.find('#ethan-monitor-board').exists()).toBe(true);
    expect(wrapper.find('.nav').exists()).toBe(true);
  });

  it('refreshes generated result text when switching language', async () => {
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('20');
    await wrapper.find('#avg-purple').setValue('2.5');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(wrapper.find('#result-meta').text()).toContain('紫色仅输入平均格数');
    expect(wrapper.find('#result-body').text()).toContain('方案 1');
    expect(wrapper.find('#result-body').text()).toContain('紫色预测');

    await wrapper.find('.lang-capsule').trigger('click');
    await nextTick();

    expect(document.documentElement.lang).toBe('en-US');
    expect(wrapper.find('#result-meta').text()).toContain('Purple average cells only');
    expect(wrapper.find('#result-meta').text()).not.toContain('紫色');
    expect(wrapper.find('#result-body').text()).toContain('Plan 1');
    expect(wrapper.find('#result-body').text()).toContain('Purple prediction');
    expect(wrapper.find('#result-body').text()).not.toContain('方案 1');
  });

  it('limits average-cell prediction rows to 30 groups', async () => {
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('120');
    await wrapper.find('#avg-purple').setValue('1');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    const labels = wrapper.findAll('#result-body tr')
      .map((row) => row.findAll('td')[0].text());
    expect(labels).toHaveLength(30);
    expect(labels).toContain('方案 30');
    expect(labels).not.toContain('方案 31');
  });

  it('shows prediction remaining cells from the explicit total cells', async () => {
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('72');
    await wrapper.find('#cells-wg').setValue('27');
    await wrapper.find('#cells-blue').setValue('15');
    await wrapper.find('#avg-purple').setValue('1.72');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    const targetRow = wrapper.findAll('#result-body tr')
      .find((row) =>
        row.findAll('td')[1]?.text() === '11' &&
        row.findAll('td')[2]?.text() === '19'
      );

    expect(targetRow?.text()).toContain('总剩余 11');
  });

  it('keeps the theme switch icon and state when switching language', async () => {
    window.localStorage.setItem('bidking-theme', 'light');
    const wrapper = await mountApp();
    const getIconState = () => {
      const icon = wrapper.find('.theme-toggle-icon');
      const svg = icon.find('svg');
      expect(icon.text()).toBe('');
      expect(svg.exists()).toBe(true);
      return svg.attributes('data-theme-icon');
    };

    expect(wrapper.find('.theme-toggle').classes()).toContain('is-light');
    expect(getIconState()).toBe('sun');

    await wrapper.find('.lang-capsule').trigger('click');
    await nextTick();

    expect(wrapper.find('.theme-toggle').classes()).toContain('is-light');
    expect(getIconState()).toBe('sun');
  });

  it('clears inputs and persisted estimate state', async () => {
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('100');
    await wrapper.find('#cells-wg').setValue('20');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();
    // 20×232 (wg) + 80×889 (blue, lowest missing) = 75,760
    expect(wrapper.find('#total-estimate').text()).toBe('75,760');

    await wrapper.find('#clear-button').trigger('click');
    await nextTick();

    expect(wrapper.find('#total-cells-all').element.value).toBe('');
    expect(wrapper.find('#cells-wg').element.value).toBe('');
    expect(wrapper.find('#total-estimate').text()).toBe('-');
    expect(wrapper.find('#result-meta').text()).toBe('等待输入');
  });

  it('switches total cells to feasible options after total average blur', async () => {
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('31');
    await wrapper.find('#avg-all').setValue('1.5');
    await wrapper.find('#avg-all').trigger('blur');
    await nextTick();

    const totalCellsSelect = wrapper.find('select#total-cells-all');
    expect(totalCellsSelect.exists()).toBe(true);
    expect(totalCellsSelect.element.value).toBe('');

    const optionValues = wrapper.findAll('select#total-cells-all option')
      .map((option) => option.element.value);
    expect(optionValues).toContain('30');
    expect(optionValues).not.toContain('31');

    await totalCellsSelect.setValue('30');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(wrapper.find('#result-meta').text()).toContain('推导总件数 20');
  });

  it('shows total average logic help beside the average input', async () => {
    const wrapper = await mountApp();

    expect(wrapper.find('.help-button').attributes('aria-describedby')).toBe('total-average-help');
    expect(wrapper.find('#total-average-help').text()).toContain('小于 300 的可行总格数选项');
    expect(wrapper.find('#total-average-help').text()).toContain('整数件数');
  });

  it('renders a 43 by 10 live monitor board', async () => {
    const wrapper = await mountApp();

    expect(wrapper.find('#ethan-monitor-board').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('根据英雄技能 1002081 的实时揭露结果显示藏品轮廓。');
    expect(wrapper.find('#ethan-monitor-types').exists()).toBe(false);
    expect(wrapper.findAll('.monitor-board-cell')).toHaveLength(430);
    expect(wrapper.findAll('.monitor-board-cell')[0].text()).toBe('1');
    expect(wrapper.findAll('.monitor-board-cell')[9].text()).toBe('10');
    expect(wrapper.findAll('.monitor-board-cell')[10].text()).toBe('11');
    expect(wrapper.findAll('.monitor-board-cell')[0].attributes('style')).toContain('grid-column: 1');
    expect(wrapper.findAll('.monitor-board-cell')[9].attributes('style')).toContain('grid-column: 10');
    expect(wrapper.findAll('.monitor-board-cell')[10].attributes('style')).toContain('grid-row: 2');
  });

  it('keeps board numbering fixed and hides numbers covered by outlines', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'outline-numbering',
      gameUid: 'game-1',
      skill: {
        uid: 'skill-numbering',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 0, itemSlotType: 22 }],
      },
    });
    await nextTick();

    const cells = wrapper.findAll('.monitor-board-cell');
    expect(cells[0].text()).toBe('');
    expect(cells[1].text()).toBe('');
    expect(cells[10].text()).toBe('');
    expect(cells[11].text()).toBe('');
    expect(cells[2].text()).toBe('3');
    expect(cells[2].attributes('style')).toContain('grid-column: 3');
  });

  it('starts and stops the backend monitor from the topbar switch', async () => {
    const wrapper = await mountApp();

    await wrapper.find('[data-testid="topbar-monitor-switch"]').trigger('click');
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/bidking-monitor/start', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(wrapper.find('[data-testid="topbar-monitor-switch"]').attributes('aria-pressed')).toBe('true');

    await wrapper.find('[data-testid="topbar-monitor-switch"]').trigger('click');
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/bidking-monitor/stop', { method: 'POST' });
    expect(wrapper.find('[data-testid="topbar-monitor-switch"]').attributes('aria-pressed')).toBe('false');
  });

  it('fills 1002081 outlines and shows revealed types from monitor events', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');
    expect(monitorSource).toBeTruthy();

    monitorSource.emitEvent('event', {
      key: 'outline-1',
      gameUid: 'game-1',
      skill: {
        uid: 'skill-1',
        skillCid: 1002081,
        hitItemTypeNames: ['武器装备', '家居日用'],
        hitBoxList: [
          { boxId: 0, itemSlotType: 11 },
          { boxId: 8, itemSlotType: 21 },
          { boxId: 11, itemSlotType: 22 },
        ],
      },
    });
    await nextTick();

    expect(wrapper.find('#ethan-monitor-types').text()).toContain('武器装备 / 家居日用');
    expect(wrapper.findAll('.monitor-outline')).toHaveLength(3);
    expect(wrapper.find('[data-outline-box="1"]').attributes('data-outline-size')).toBe('1x1');
    expect(wrapper.find('[data-outline-box="1"]').classes()).toContain('quality-unknown');
    expect(wrapper.find('[data-outline-box="9"]').attributes('data-outline-size')).toBe('2x1');
    expect(wrapper.find('[data-outline-box="12"]').attributes('data-outline-size')).toBe('2x2');
  });

  it('shows minimum possible occupied cells from live outlines', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    const hitBoxList = [
      { boxId: 0, itemSlotType: 11 },
      { boxId: 1, itemSlotType: 22 },
      { boxId: 3, itemSlotType: 11 },
      { boxId: 4, itemSlotType: 22 },
      { boxId: 20, itemSlotType: 51 },
      { boxId: 25, itemSlotType: 51 },
    ];
    monitorSource.emitEvent('event', {
      key: 'outline-minimum',
      gameUid: 'game-1',
      skill: {
        uid: 'outline-minimum-skill',
        skillCid: 1002081,
        hitBoxList,
      },
    });
    await nextTick();

    expect(wrapper.find('#ethan-monitor-minimum').text()).toContain('最小可能占用');
    expect(wrapper.find('#ethan-monitor-minimum').text()).toContain('30');
    expect(wrapper.find('#ethan-monitor-minimum').text()).toContain('6');
  });

  it('uses monitor minimum occupied cells as placeholder and fallback total cells', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'outline-autofill-1',
      gameUid: 'game-1',
      skill: {
        uid: 'outline-autofill-skill-1',
        skillCid: 1002081,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11 },
          { boxId: 1, itemSlotType: 22 },
          { boxId: 3, itemSlotType: 11 },
          { boxId: 4, itemSlotType: 22 },
          { boxId: 20, itemSlotType: 51 },
          { boxId: 25, itemSlotType: 51 },
        ],
      },
    });
    await nextTick();

    expect(wrapper.find('#total-cells-all').element.value).toBe('');
    expect(wrapper.find('#total-cells-all').attributes('placeholder')).toBe('30');

    await wrapper.find('#cells-wg').setValue('5');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    // wg=5 × 232 + 25 (remaining of 30) × 889 (blue, lowest missing) = 23,385
    expect(wrapper.find('#total-estimate').text()).toBe('23,385');

    await wrapper.find('#total-cells-all').setValue('99');
    monitorSource.emitEvent('event', {
      key: 'outline-autofill-2',
      gameUid: 'game-1',
      skill: {
        uid: 'outline-autofill-skill-2',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 70, itemSlotType: 22 }],
      },
    });
    await nextTick();

    expect(wrapper.find('#total-cells-all').element.value).toBe('99');
    expect(wrapper.find('#total-cells-all').attributes('placeholder')).not.toBe('99');
  });

  it('fills quality total and average cell inputs from enriched monitor state', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'blue-scan',
      gameUid: 'game-1',
      rawEvent: { skill: {
        uid: 'blue-scan-skill',
        skillCid: 202,
        itemCid: 100105,
        itemName: '良品扫描',
        totalHitBoxIndex: 44,
      } },
      groups: { blue: { totalCells: 44 } },
    }));
    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'purple-average',
      gameUid: 'game-1',
      rawEvent: { skill: {
        uid: 'purple-average-skill',
        skillCid: 303,
        itemCid: 100112,
        itemName: '优品均格',
        allHitItemAvgBoxIndex: 2.8,
      } },
      groups: { purple: { averageCells: 2.8 } },
    }));
    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'gold-average',
      gameUid: 'game-1',
      rawEvent: { skill: {
        uid: 'gold-average-skill',
        skillCid: 304,
        itemCid: 100113,
        itemName: '极品均格',
        allHitItemAvgBoxIndex: 3,
      } },
      groups: { orange: { averageCells: 3 } },
    }));
    await nextTick();

    expect(wrapper.find('#cells-blue').element.value).toBe('');
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('44');
    expect(wrapper.find('#avg-purple').element.value).toBe('');
    expect(wrapper.find('#avg-purple').attributes('placeholder')).toBe('2.8');
    expect(wrapper.find('#avg-orange').element.value).toBe('');
    expect(wrapper.find('#avg-orange').attributes('placeholder')).toBe('3');
  });

  it('truncates monitor-filled decimal values to two decimals in the UI', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'purple-average-precision',
      gameUid: 'game-1',
      rawEvent: { skill: {
        uid: 'purple-average-precision-skill',
        skillCid: 200013,
        allHitItemAvgBoxIndex: 2.4565454545,
      } },
      groups: { purple: { averageCells: 2.4565454545 } },
    }));
    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'orange-average-precision',
      gameUid: 'game-1',
      rawEvent: { skill: {
        uid: 'orange-average-precision-skill',
        skillCid: 200015,
        allHitItemAvgBoxIndex: 2.3393333333,
      } },
      groups: { orange: { averageCells: 2.3393333333, averagePrice: 50303.33903125 } },
    }));
    await nextTick();

    expect(wrapper.find('#avg-purple').element.value).toBe('');
    expect(wrapper.find('#avg-purple').attributes('placeholder')).toBe('2.45');
    expect(wrapper.find('#avg-orange').element.value).toBe('');
    expect(wrapper.find('#avg-orange').attributes('placeholder')).toBe('2.33');
    expect(wrapper.find('#price-orange').element.value).toBe('');
    expect(wrapper.find('#price-orange').attributes('placeholder')).toBe('50303.33');
  });

  it('fills inputs and monitor board from enriched monitor state payloads', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'skill:blue-scan',
      gameUid: 'game-1',
      rawEvent: {
        key: 'skill:blue-scan',
        gameUid: 'game-1',
        skill: { uid: 'blue-scan', itemName: '良品扫描', totalHitBoxIndex: 29 },
      },
      facts: [{ type: 'group.totalCellsKnown', group: 'blue', value: 29 }],
      state: {
        gameUid: 'game-1',
        round: 2,
        groups: createMonitorGroups({
          blue: { totalCells: 29 },
          purple: { averageCells: 2.8 },
          orange: { averagePrice: 30472 },
        }),
        outlines: [{ boxId: 1, cells: [1], width: 1, height: 1, label: '1x1' }],
        qualityCells: [],
        revealedTypes: ['家居日用'],
        minimumOccupied: { minTotalCells: 1, order: [1], holeCells: [] },
        warnings: [],
      },
    });
    await nextTick();

    expect(wrapper.find('#cells-blue').element.value).toBe('');
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('29');
    expect(wrapper.find('#avg-purple').element.value).toBe('');
    expect(wrapper.find('#avg-purple').attributes('placeholder')).toBe('2.8');
    expect(wrapper.find('#price-orange').element.value).toBe('');
    expect(wrapper.find('#price-orange').attributes('placeholder')).toBe('30472');
    expect(wrapper.text()).toContain('家居日用');
  });

  it('fills quality aggregate inputs from raw-only monitor payloads during migration', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'raw-blue-scan',
      gameUid: 'game-1',
      skill: {
        uid: 'raw-blue-scan-skill',
        itemName: '良品扫描',
        totalHitBoxIndex: 29,
      },
    });
    monitorSource.emitEvent('event', {
      key: 'raw-purple-average',
      gameUid: 'game-1',
      skill: {
        uid: 'raw-purple-average-skill',
        itemName: '优品均格',
        allHitItemAvgBoxIndex: 2.8,
      },
    });
    monitorSource.emitEvent('event', {
      key: 'raw-orange-price',
      gameUid: 'game-1',
      skill: {
        uid: 'raw-orange-price-skill',
        skillCid: 200037,
        itemName: '极品均价',
        allHitItemAvgPrice: 30472,
      },
    });
    await nextTick();

    expect(wrapper.find('#cells-blue').element.value).toBe('');
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('29');
    expect(wrapper.find('#avg-purple').element.value).toBe('');
    expect(wrapper.find('#avg-purple').attributes('placeholder')).toBe('2.8');
    expect(wrapper.find('#price-orange').element.value).toBe('');
    expect(wrapper.find('#price-orange').attributes('placeholder')).toBe('30472');
  });

  it('uses enriched monitor state for quality fills without raw id inference', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'generic-blue-scan',
      gameUid: 'game-1',
      rawEvent: { group: 'item', skill: {
        uid: 'generic-blue-scan-skill',
        skillCid: 201,
        itemCid: 100105,
        totalHitBoxIndex: 44,
      } },
      groups: { blue: { totalCells: 44 } },
    }));
    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'generic-purple-average',
      gameUid: 'game-1',
      rawEvent: { group: 'item', skill: {
        uid: 'generic-purple-average-skill',
        skillCid: 301,
        itemCid: 100112,
        allHitItemAvgBoxIndex: 2.8,
      } },
      groups: { purple: { averageCells: 2.8 } },
    }));
    await nextTick();

    expect(wrapper.find('#cells-blue').element.value).toBe('');
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('44');
    expect(wrapper.find('#cells-wg').element.value).toBe('');
    expect(wrapper.find('#cells-wg').attributes('placeholder')).not.toBe('44');
    expect(wrapper.find('#avg-purple').element.value).toBe('');
    expect(wrapper.find('#avg-purple').attributes('placeholder')).toBe('2.8');
    expect(wrapper.find('#avg-wg').element.value).toBe('');
    expect(wrapper.find('#avg-wg').attributes('placeholder')).not.toBe('2.8');
  });

  it('fills orange average price from enriched map aggregate state', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'orange-map-average-price',
      gameUid: 'game-1',
      rawEvent: { group: 'map', skill: {
        uid: 'orange-map-average-price-skill',
        skillCid: 200037,
        allHitItemAvgPrice: 50303.33203125,
      } },
      groups: { orange: { averagePrice: 50303.33203125 } },
    }));
    await nextTick();

    expect(wrapper.find('#price-orange').element.value).toBe('');
    expect(wrapper.find('#price-orange').attributes('placeholder')).toBe('50303.33');
  });

  it('fills total average cells instead of orange average cells from raw map aggregate skill 200014', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'map-total-average-200014',
      gameUid: '2102:1274128099869123',
      group: 'map',
      skill: {
        uid: 'map-total-average-200014-skill',
        skillCid: 200014,
        mapCid: 2102,
        allHitItemAvgBoxIndex: 1.75,
      },
    });
    await nextTick();

    expect(wrapper.find('#avg-all').element.value).toBe('');
    expect(wrapper.find('#avg-all').attributes('placeholder')).toBe('1.75');
    expect(wrapper.find('#avg-orange').element.value).toBe('');
    expect(wrapper.find('#avg-orange').attributes('placeholder')).toBe('可选');
  });

  it('fills known map aggregate quality fields from enriched state', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');
    const cases = [
      { skillCid: 200011, groupKey: 'orange', stateKey: 'totalCells', fieldId: '#cells-orange', valueKey: 'totalHitBoxIndex', value: 21, expected: '21' },
      { skillCid: 200012, groupKey: 'red', stateKey: 'totalCells', fieldId: '#cells-red', valueKey: 'totalHitBoxIndex', value: 6, expected: '6' },
      { skillCid: 200015, groupKey: 'orange', stateKey: 'averageCells', fieldId: '#avg-orange', valueKey: 'allHitItemAvgBoxIndex', value: 3.2, expected: '3.2' },
      { skillCid: 200016, groupKey: 'red', stateKey: 'averageCells', fieldId: '#avg-red', valueKey: 'allHitItemAvgBoxIndex', value: 4.5, expected: '4.5' },
      { skillCid: 200036, groupKey: 'purple', stateKey: 'averagePrice', fieldId: '#price-purple', valueKey: 'allHitItemAvgPrice', value: 10806, expected: '10806' },
      { skillCid: 200038, groupKey: 'red', stateKey: 'averagePrice', fieldId: '#price-red', valueKey: 'allHitItemAvgPrice', value: 77700.25, expected: '77700.25' },
    ];

    for (const item of cases) {
      monitorSource.emitEvent('event', createEnrichedMonitorPayload({
        key: `map-aggregate-${item.skillCid}`,
        gameUid: 'game-1',
        rawEvent: { group: 'map', skill: {
          uid: `map-aggregate-skill-${item.skillCid}`,
          skillCid: item.skillCid,
          [item.valueKey]: item.value,
        } },
        groups: { [item.groupKey]: { [item.stateKey]: item.value } },
      }));
    }
    await nextTick();

    for (const item of cases) {
      expect(wrapper.find(item.fieldId).element.value).toBe('');
      expect(wrapper.find(item.fieldId).attributes('placeholder')).toBe(item.expected);
    }
  });

  it('fills zero orange total cells as a placeholder from map aggregate state', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'orange-zero-total',
      gameUid: '2101:1274128138819884',
      rawEvent: {
        group: 'map',
        skill: {
          uid: 'orange-zero-total-skill',
          skillCid: 200011,
          totalHitBoxIndex: 0,
        },
      },
      groups: { orange: { totalCells: 0 } },
    }));
    await nextTick();

    expect(wrapper.find('#cells-orange').element.value).toBe('');
    expect(wrapper.find('#cells-orange').attributes('placeholder')).toBe('0');
  });

  it('fills zero orange total cells from single-quality aggregate payloads', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'quality-only-orange-zero',
      gameUid: '2101:1274128138819884',
      group: 'map',
      skill: {
        uid: 'quality-only-orange-zero-skill',
        totalHitBoxIndex: 0,
        hitItemQuilityList: [5],
      },
    });
    await nextTick();

    expect(wrapper.find('#cells-orange').element.value).toBe('');
    expect(wrapper.find('#cells-orange').attributes('placeholder')).toBe('0');
  });

  it('fills purple total cells from enriched map aggregate state', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'purple-map-total',
      gameUid: 'game-1',
      rawEvent: { group: 'map', skill: {
        uid: 'purple-map-total-skill',
        skillCid: 200010,
        totalHitBoxIndex: 4,
      } },
      groups: { purple: { totalCells: 4 } },
    }));
    await nextTick();

    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('4');
  });

  it('keeps restored inputs when the first monitor event establishes the current game', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      inputs: {
        global: { totalCells: '80', totalAverage: '' },
        groups: {},
      },
      hasCalculated: false,
      rows: [],
      summary: { total: null, low: null, high: null },
      meta: { text: 'saved', status: '' },
    }));
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    expect(wrapper.find('#total-cells-all').element.value).toBe('80');

    monitorSource.emitEvent('event', {
      key: 'first-current-game-event',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'first-current-game-skill',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 0, itemSlotType: 11 }],
      },
    });
    await nextTick();

    expect(wrapper.find('#total-cells-all').element.value).toBe('80');
  });

  it('clears Ethan inputs and results when a new game starts', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'purple-map-total',
      gameUid: 'game-1',
      rawEvent: { group: 'map', skill: {
        uid: 'purple-map-total-skill',
        skillCid: 200010,
        totalHitBoxIndex: 4,
      } },
      groups: { purple: { totalCells: 4 } },
    }));
    await nextTick();
    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('4');

    await wrapper.find('#total-cells-all').setValue('20');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();
    expect(wrapper.find('#total-estimate').text()).not.toBe('-');

    monitorSource.emitEvent('event', {
      key: 'new-game-outline',
      gameUid: 'game-2',
      group: 'hero',
      skill: {
        uid: 'new-game-outline-skill',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 0, itemSlotType: 11 }],
      },
    });
    await nextTick();

    expect(wrapper.find('#total-cells-all').element.value).toBe('');
    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).not.toBe('4');
    expect(wrapper.find('#total-estimate').text()).toBe('-');
    expect(wrapper.find('#result-body').text()).toContain('暂无结果');
  });

  it('fills purple average cells from map aggregate skill 200013 after clearing previous game totals', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'previous-purple-map-total',
      gameUid: 'game-1',
      rawEvent: { group: 'map', skill: {
        uid: 'previous-purple-map-total-skill',
        skillCid: 200010,
        totalHitBoxIndex: 21,
      } },
      groups: { purple: { totalCells: 21 } },
    }));
    await nextTick();
    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('21');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'purple-map-average',
      gameUid: 'game-2',
      rawEvent: { group: 'map', skill: {
        uid: 'purple-map-average-skill',
        skillCid: 200013,
        allHitItemAvgBoxIndex: 3.2,
      } },
      groups: { purple: { averageCells: 3.2 } },
    }));
    await nextTick();

    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).not.toBe('21');
    expect(wrapper.find('#avg-purple').element.value).toBe('');
    expect(wrapper.find('#avg-purple').attributes('placeholder')).toBe('3.2');
  });

  it('fills quality total cells from a complete quality outline event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'purple-profile',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'purple-profile-skill',
        skillCid: 200001,
        hitBoxList: [
          { boxId: 67, itemSlotType: 12, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 26, itemSlotType: 11, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 61, itemSlotType: 12, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 33, itemSlotType: 11, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 58, itemSlotType: 22, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 14, itemSlotType: 12, itemQuility: 4, itemQuilityName: '紫' },
        ],
      },
    });
    await nextTick();

    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('12');
  });

  it('fills quality total cells from enriched outline aggregate payloads', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'enriched-purple-profile',
      gameUid: 'game-1',
      rawEvent: {
        group: 'map',
        skill: {
          uid: 'enriched-purple-profile-skill',
          skillCid: 200001,
          hitBoxList: [
            { boxId: 58, itemSlotType: 22, itemQuility: 4, itemQuilityName: '紫' },
            { boxId: 33, itemSlotType: 11, itemQuility: 4, itemQuilityName: '紫' },
          ],
        },
      },
      outlines: [
        { boxId: 59, cells: [59, 60, 69, 70], width: 2, height: 2, label: '2x2', qualityName: '紫', qualityGroup: 'purple' },
        { boxId: 34, cells: [34], width: 1, height: 1, label: '1x1', qualityName: '紫', qualityGroup: 'purple' },
      ],
    }));
    await nextTick();

    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('5');
  });

  it('uses known outline values for a fully covered quality group estimate', async () => {
    mockDataFetch({ collectibles: realCollectibles });
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'purple-profile',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'purple-profile-skill',
        skillCid: 200001,
        hitBoxList: [
          { boxId: 67, itemSlotType: 12, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 26, itemSlotType: 11, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 61, itemSlotType: 12, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 33, itemSlotType: 11, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 58, itemSlotType: 22, itemQuility: 4, itemQuilityName: '紫' },
          { boxId: 14, itemSlotType: 12, itemQuility: 4, itemQuilityName: '紫' },
        ],
      },
    });
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('80');
    await wrapper.find('#cells-wg').setValue('36');
    await wrapper.find('#cells-blue').setValue('29');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('12');
    expect(wrapper.find('#total-estimate').text()).toBe('93,493');
    expect(wrapper.find('#result-body').text()).toContain('31,676');
    expect(wrapper.find('#result-body').text()).toContain('已按已知轮廓/精确藏品估值');
  });

  it('prices partial known outlines and exact items with per-cell remainder', async () => {
    mockDataFetch({ collectibles: realCollectibles });
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'partial-purple-outline',
      gameUid: 'game-1',
      skill: {
        uid: 'partial-purple-outline-skill',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 0, itemSlotType: 12, itemQuility: 4, itemQuilityName: '紫' }],
      },
    });
    monitorSource.emitEvent('event', {
      key: 'exact-purple-item',
      gameUid: 'game-1',
      skill: {
        uid: 'exact-purple-item-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 5,
          itemCid: 109999,
          itemSlotType: 11,
          itemQuility: 4,
          itemQuilityName: '紫',
          itemPrice: 13000,
        }],
      },
    });
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('12');
    await wrapper.find('#cells-purple').setValue('12');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    // (12 - 2 known-outline cells - 1 exact-item cell) * 2482 + 5058 + 13000 = 40,396
    expect(wrapper.find('#total-estimate').text()).toBe('40,396');
    expect(wrapper.find('#result-body').text()).toContain('40,396');
  });

  it('shows monitor-filled quality fields as placeholder and clears them on reload', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    let wrapper = await mountApp();
    let monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'blue-scan-first',
      gameUid: 'game-1',
      rawEvent: { skill: {
        uid: 'blue-scan-skill-first',
        skillCid: 202,
        itemCid: 100105,
        itemName: '良品扫描',
        totalHitBoxIndex: 44,
      } },
      groups: { blue: { totalCells: 44 } },
    }));
    await nextTick();
    expect(wrapper.find('#cells-blue').element.value).toBe('');
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('44');

    wrapper.unmount();
    mountedWrappers = mountedWrappers.filter((mounted) => mounted !== wrapper);
    FakeEventSource.reset();
    wrapper = await mountApp();
    monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    // Placeholder is ephemeral — not persisted across reload
    expect(wrapper.find('#cells-blue').element.value).toBe('');
    expect(wrapper.find('#cells-blue').attributes('placeholder')).not.toBe('44');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'blue-scan-second',
      gameUid: 'game-2',
      rawEvent: { skill: {
        uid: 'blue-scan-skill-second',
        skillCid: 202,
        itemCid: 100105,
        itemName: '良品扫描',
        totalHitBoxIndex: 48,
      } },
      groups: { blue: { totalCells: 48 } },
    }));
    await nextTick();

    expect(wrapper.find('#cells-blue').element.value).toBe('');
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('48');
  });

  it('shows inferred outline quality from overlapping quality reveal cells', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'quality-1',
      gameUid: 'game-1',
      skill: {
        uid: 'quality-skill-1',
        skillCid: 702,
        hitBoxList: [{ boxId: 1, itemQuility: 4, itemQuilityName: '紫' }],
      },
    });
    monitorSource.emitEvent('event', {
      key: 'outline-1',
      gameUid: 'game-1',
      skill: {
        uid: 'outline-skill-1',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 0, itemSlotType: 22 }],
      },
    });
    await nextTick();

    const outline = wrapper.find('[data-outline-box="1"]');
    expect(outline.attributes('data-outline-quality')).toBe('紫');
    expect(outline.classes()).toContain('quality-purple');
    expect(outline.text()).toBe('');
  });

  it('draws full item skill hit boxes with price on the monitor board', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'full-blue-item',
      gameUid: 'game-1',
      skill: {
        uid: 'full-blue-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 25,
          itemCid: 1033001,
          itemSlotType: 22,
          itemQuility: 3,
          itemQuilityName: '蓝',
          itemPrice: 3851,
        }],
      },
    });
    await nextTick();

    const outline = wrapper.find('[data-outline-box="26"]');
    expect(outline.exists()).toBe(true);
    expect(outline.attributes('data-outline-size')).toBe('2x2');
    expect(outline.attributes('data-outline-quality')).toBe('蓝');
    expect(outline.classes()).toContain('quality-blue');
    expect(outline.text()).toBe('3,851');
  });

  it('draws exact item prices from enriched monitor state for concrete item reveals', async () => {
    mockDataFetch({ collectibles: realCollectibles });
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createLiveEnrichedMonitorPayload({
      key: 'enriched-exact-blue-outline',
      gameUid: 'game-1',
      round: 2,
      group: 'itemSkillLog',
      skill: {
        uid: 'enriched-exact-blue-outline-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 25,
          itemCid: 1033001,
          itemName: '测试藏品',
          itemSlotType: 22,
          itemQuility: 3,
          itemQuilityName: '蓝',
          itemPrice: 3851,
        }],
      },
    }));
    await nextTick();

    const outline = wrapper.find('[data-outline-box="26"]');
    expect(outline.exists()).toBe(true);
    expect(outline.attributes('data-outline-price')).toBe('3851');
    expect(outline.text()).toBe('3,851');
    expect(outline.text()).not.toBe('3,711');
  });

  it('shows median estimate and candidate details for known quality outlines', async () => {
    mockDataFetch({ collectibles: realCollectibles });
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'blue-outline-estimate',
      gameUid: 'game-1',
      skill: {
        uid: 'blue-outline-estimate-skill',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 25, itemSlotType: 22, itemQuility: 3, itemQuilityName: '蓝' }],
      },
    });
    await nextTick();

    const outline = wrapper.find('[data-outline-box="26"]');
    expect(outline.text()).toBe('3,711');
    expect(wrapper.find('#cells-blue').element.value).toBe('');

    await outline.trigger('click');
    await nextTick();

    expect(wrapper.find('#monitor-outline-detail').exists()).toBe(true);
    expect(wrapper.find('#monitor-outline-detail').text()).toContain('候选数');
    expect(wrapper.find('#monitor-outline-detail').text()).toContain('26');
    expect(wrapper.find('#monitor-outline-detail').text()).toContain('中位数');
    expect(wrapper.find('#monitor-outline-detail').text()).toContain('3,711');
    expect(wrapper.find('#monitor-outline-detail').text()).toContain('均值');
    expect(wrapper.find('#monitor-outline-detail').text()).toContain('3,636');
    expect(wrapper.find('#monitor-outline-detail').text()).toContain('兔兔背包');
    expect(wrapper.find('#monitor-outline-detail').text()).toContain('岫岩玉原石');
  });

  it('uses the minimum candidate price for red outline estimates', async () => {
    mockDataFetch({ collectibles: realCollectibles });
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'red-outline-estimate',
      gameUid: 'game-1',
      skill: {
        uid: 'red-outline-estimate-skill',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 25, itemSlotType: 11, itemQuility: 6, itemQuilityName: '红' }],
      },
    });
    await nextTick();

    const outline = wrapper.find('[data-outline-box="26"]');
    expect(outline.text()).toBe('52,500');
    expect(outline.text()).not.toBe('87,000');

    await wrapper.find('#total-cells-all').setValue('1');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(wrapper.find('#total-estimate').text()).toBe('52,500');
  });

  it('uses exact item price when a concrete item reveal updates an estimated outline', async () => {
    mockDataFetch({ collectibles: realCollectibles });
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'estimated-blue-outline',
      gameUid: 'game-1',
      skill: {
        uid: 'estimated-blue-outline-skill',
        skillCid: 1002081,
        hitBoxList: [{ boxId: 25, itemSlotType: 22, itemQuility: 3, itemQuilityName: '蓝' }],
      },
    });
    await nextTick();

    expect(wrapper.find('[data-outline-box="26"]').text()).toBe('3,711');

    monitorSource.emitEvent('event', {
      key: 'exact-blue-outline',
      gameUid: 'game-1',
      skill: {
        uid: 'exact-blue-outline-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 25,
          itemSlotType: 22,
          itemQuility: 3,
          itemQuilityName: '蓝',
          itemPrice: 3851,
        }],
      },
    });
    await nextTick();

    expect(wrapper.find('[data-outline-box="26"]').text()).toBe('3,851');

    await wrapper.find('[data-outline-box="26"]').trigger('click');
    await nextTick();

    expect(wrapper.find('#monitor-outline-detail').text()).toContain('精确价格');
    expect(wrapper.find('#monitor-outline-detail').text()).toContain('3,851');
  });

  it('clears previous monitor outlines when a new game arrives and ignores unrelated skills', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'outline-1',
      gameUid: 'game-1',
      skill: {
        uid: 'skill-1',
        skillCid: 1002081,
        hitItemTypeNames: ['武器装备'],
        hitBoxList: [{ boxId: 0, itemSlotType: 11 }],
      },
    });
    await nextTick();
    expect(wrapper.find('[data-outline-box="1"]').exists()).toBe(true);

    monitorSource.emitEvent('event', {
      key: 'ignored',
      gameUid: 'game-1',
      skill: {
        skillCid: 702,
        hitBoxList: [{ boxId: 2 }],
      },
    });
    await nextTick();
    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);

    monitorSource.emitEvent('event', {
      key: 'outline-2',
      gameUid: 'game-2',
      skill: {
        uid: 'skill-2',
        skillCid: 1002081,
        hitItemTypeNames: ['交通工具'],
        hitBoxList: [{ boxId: 19, itemSlotType: 11 }],
      },
    });
    await nextTick();

    expect(wrapper.find('[data-outline-box="1"]').exists()).toBe(false);
    expect(wrapper.find('[data-outline-box="20"]').exists()).toBe(true);
    expect(wrapper.find('#ethan-monitor-types').text()).toContain('交通工具');
  });

  it('tags purple average predictions when real collectibles match the entered average price', async () => {
    mockDataFetch({
      averagePrices: realAveragePrices,
      collectibles: realCollectibles,
    });
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('20');
    await wrapper.find('#avg-purple').setValue('2.33');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(wrapper.find('#result-body').text()).toContain('方案 1');
    expect(wrapper.find('#result-body').text()).not.toContain('价格误差');

    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    await nextTick();

    expect(wrapper.find('.result-tag').text()).toBe('均价匹配');
  });

  it('uses a matching average-price combo when average price and total cells are both filled', async () => {
    mockDataFetch({
      averagePrices: realAveragePrices,
      collectibles: realCollectibles,
    });
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('7');
    await wrapper.find('#cells-purple').setValue('7');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(wrapper.find('#total-estimate').text()).toBe('20,400');
    expect(wrapper.find('#result-body').text()).toContain('3');
    expect(wrapper.find('#result-body').text()).not.toContain('17,374');
  });

  it('does not fall back to per-cell expected when no average-price combo matches filled cells', async () => {
    mockDataFetch({
      averagePrices: realAveragePrices,
      collectibles: realCollectibles,
    });
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('7');
    await wrapper.find('#cells-purple').setValue('7');
    await wrapper.find('#price-purple').setValue('1');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(wrapper.find('#total-estimate').text()).toBe('-');
    expect(wrapper.find('#result-meta').text()).toContain('紫色平均价格没有匹配到总格数 7 的组合');
    expect(wrapper.find('#result-body').text()).not.toContain('17,374');
  });

  it('streams purple price-only matches into result rows', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('200');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    const runSource = getRunEventSource();
    expect(runSource.url)
      .toBe('/run?script=solve-purple-combo.js&args=6800+dedupe-total-cells&limit=30');
    expect(wrapper.find('#result-meta').text()).toContain('正在搜索可行总格数');

    runSource.emit({
      type: 'out',
      text: '  TotalCells=14, TotalPrice=40800, Count=6: [A]\n',
    });
    await nextTick();

    expect(wrapper.find('#result-body').text()).toContain('方案 1');
    expect(wrapper.find('#result-body').text()).toContain('14');
    expect(wrapper.find('#result-body').text()).toContain('均价匹配');

    runSource.emit({ type: 'done', code: 0 });
    await nextTick();

    expect(runSource.close).toHaveBeenCalled();
    expect(wrapper.find('#result-meta').text()).toContain('搜索完成');
  });

  it('limits streamed average-price prediction rows to 30 groups', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('200');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    getRunEventSource().emit({
      type: 'out',
      text: Array.from({ length: 31 }, (_, index) =>
        `  TotalCells=${index * 4 + 1}, TotalPrice=${6800 * (index + 1)}, Count=1: [A]`
      ).join('\n'),
    });
    await nextTick();

    const labels = wrapper.findAll('#result-body tr')
      .map((row) => row.findAll('td')[0].text());
    expect(labels).toHaveLength(30);
    expect(labels).toContain('方案 30');
    expect(labels).not.toContain('方案 31');

    const runSource = getRunEventSource();
    expect(runSource.close).toHaveBeenCalled();

    runSource.emit({
      type: 'out',
      text: '  TotalCells=200, TotalPrice=6800, Count=1: [stale]\n',
    });
    await nextTick();

    expect(wrapper.findAll('#result-body tr')).toHaveLength(30);
  });

  it('shows only average-price result rows at least 4 cells away from any displayed row', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('75');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    getRunEventSource().emit({
      type: 'out',
      text: [
        '  TotalCells=5, TotalPrice=34000, Count=5: [A]',
        '  TotalCells=7, TotalPrice=47600, Count=7: [B]',
        '  TotalCells=8, TotalPrice=54400, Count=8: [C]',
        '  TotalCells=9, TotalPrice=61200, Count=9: [D]',
        '  TotalCells=13, TotalPrice=88400, Count=13: [E]',
      ].join('\n'),
    });
    await nextTick();

    const cells = wrapper.findAll('#result-body tr')
      .map((row) => row.findAll('td')[2].text());

    expect(cells).toEqual(['5', '9', '13']);
  });

  it('updates monitor placeholders while a price-only search is still running', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    await wrapper.find('#total-cells-all').setValue('75');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(getRunEventSource()).toBeTruthy();
    expect(wrapper.find('#result-meta').text()).toContain('正在搜索可行总格数');

    monitorSource.emitEvent('event', {
      key: 'blue-scan-during-search',
      gameUid: 'game-1',
      group: 'item',
      skill: {
        uid: 'blue-scan-during-search-skill',
        skillCid: 202,
        itemCid: 100105,
        itemName: '良品扫描',
        totalHitBoxIndex: 23,
      },
    });
    await nextTick();

    expect(wrapper.find('#cells-blue').element.value).toBe('');
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('23');
  });

  it('restarts an in-progress price-only search when monitor placeholders change', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    await wrapper.find('#total-cells-all').setValue('75');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    const firstRunSource = getRunEventSource();
    expect(firstRunSource).toBeTruthy();

    monitorSource.emitEvent('event', {
      key: 'blue-scan-restarts-search',
      gameUid: 'game-1',
      group: 'item',
      skill: {
        uid: 'blue-scan-restarts-search-skill',
        skillCid: 202,
        itemCid: 100105,
        itemName: '良品扫描',
        totalHitBoxIndex: 23,
      },
    });
    await nextTick();

    expect(firstRunSource.close).toHaveBeenCalled();
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('23');
    expect(FakeEventSource.instances.filter((source) => String(source.url).startsWith('/run?')))
      .toHaveLength(1);

    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    await nextTick();

    const runSources = FakeEventSource.instances.filter((source) => String(source.url).startsWith('/run?'));
    expect(runSources).toHaveLength(2);
  });

  it('cancels pending average-price match tagging as soon as any monitor event arrives', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    mockDataFetch({ collectibles: realCollectibles });
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'set-active-game',
      gameUid: 'game-1',
      group: 'noop',
      skill: { uid: 'set-active-game-skill' },
    });
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('4');
    await wrapper.find('#avg-purple').setValue('4');
    await wrapper.find('#price-purple').setValue('8974');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(wrapper.find('#result-body').text()).toContain('方案 1');
    expect(wrapper.find('#result-body').text()).not.toContain('均价匹配');

    monitorSource.emitEvent('event', {
      key: 'noop-during-average-match',
      gameUid: 'game-1',
      group: 'noop',
      skill: {
        uid: 'noop-during-average-match-skill',
      },
    });
    vi.runOnlyPendingTimers();
    await nextTick();

    expect(wrapper.find('#result-body').text()).not.toContain('均价匹配');
  });

  it('terminates an active estimation worker and restarts it with monitor-updated inputs', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    mockDataFetch({
      averagePrices: realAveragePrices,
      collectibles: realCollectibles,
    });
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    await wrapper.find('#total-cells-all').setValue('93');
    await wrapper.find('#avg-all').setValue('3.3214');
    await wrapper.find('#cells-wg').setValue('36');
    await wrapper.find('#avg-purple').setValue('4');
    await wrapper.find('#avg-orange').setValue('6');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    const firstWorker = FakeWorker.instances[0];
    expect(firstWorker).toBeTruthy();
    const firstRunId = firstWorker.messages[0].runId;
    expect(firstWorker.messages[0]).toMatchObject({
      type: 'start',
      limit: 30,
      state: {
        groups: {
          blue: { cells: null },
        },
      },
    });

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'blue-cells-during-worker',
      gameUid: 'game-1',
      rawEvent: {
        group: 'item',
        skill: {
          uid: 'blue-cells-during-worker-skill',
          skillCid: 202,
          itemCid: 100105,
          itemName: '良品扫描',
          totalHitBoxIndex: 13,
        },
      },
      groups: { blue: { totalCells: 13 } },
    }));
    await nextTick();

    expect(firstWorker.terminate).toHaveBeenCalled();
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('13');
    expect(FakeWorker.instances).toHaveLength(1);

    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    await nextTick();

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].messages[0]).toMatchObject({
      type: 'start',
      limit: 30,
      state: {
        groups: {
          blue: { cells: 13 },
        },
      },
    });

    firstWorker.emit({ type: 'error', runId: firstRunId, error: 'stale worker error' });
    await nextTick();

    expect(wrapper.find('#result-meta').text()).not.toContain('stale worker error');
  });

  it('terminates an active estimation worker when clear button is clicked', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    mockDataFetch({
      averagePrices: realAveragePrices,
      collectibles: realCollectibles,
    });
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('93');
    await wrapper.find('#avg-purple').setValue('4');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#avg-orange').setValue('6');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    const worker = FakeWorker.instances[0];
    expect(worker).toBeTruthy();

    await wrapper.find('#clear-button').trigger('click');
    await nextTick();

    expect(worker.terminate).toHaveBeenCalled();
    expect(wrapper.find('#result-meta').text()).toContain('等待输入');
  });

  it('updates empty placeholders while purple price-only search is running with wg and blue filled', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    await wrapper.find('#cells-wg').setValue('21');
    await wrapper.find('#cells-blue').setValue('44');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(getRunEventSource()).toBeTruthy();
    expect(wrapper.find('#result-meta').text()).toContain('正在搜索可行总格数');

    monitorSource.emitEvent('event', {
      key: 'gold-scan-during-purple-search',
      gameUid: 'game-1',
      group: 'item',
      skill: {
        uid: 'gold-scan-during-purple-search-skill',
        skillCid: 204,
        itemCid: 100107,
        itemName: '极品扫描',
        totalHitBoxIndex: 12,
      },
    });
    await nextTick();

    expect(wrapper.find('#cells-orange').element.value).toBe('');
    expect(wrapper.find('#cells-orange').attributes('placeholder')).toBe('12');
  });

  it('updates placeholder attributes for filled inputs during purple price-only search even though the value stays visible', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    await wrapper.find('#cells-wg').setValue('21');
    await wrapper.find('#cells-blue').setValue('44');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    monitorSource.emitEvent('event', {
      key: 'blue-scan-during-purple-search-filled-field',
      gameUid: 'game-1',
      group: 'item',
      skill: {
        uid: 'blue-scan-during-purple-search-filled-field-skill',
        skillCid: 202,
        itemCid: 100105,
        itemName: '良品扫描',
        totalHitBoxIndex: 29,
      },
    });
    await nextTick();

    expect(wrapper.find('#cells-blue').element.value).toBe('44');
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('29');
  });

  it('streams orange price-only matches into result rows', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('75');
    await wrapper.find('#price-orange').setValue('22800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    const runSource = getRunEventSource();
    expect(runSource.url)
      .toBe('/run?script=solve-gold-combo.js&args=22800+dedupe-total-cells&limit=30');
    expect(wrapper.find('#result-meta').text()).toContain('橙/金色仅输入平均价格');

    runSource.emit({
      type: 'out',
      text: '  TotalCells=5, TotalPrice=45600, Count=2: [A]\n',
    });
    await nextTick();

    expect(wrapper.find('#result-body').text()).toContain('方案 1');
    expect(wrapper.find('#result-body').text()).toContain('5');
    expect(wrapper.find('#result-body').text()).toContain('均价匹配');
  });

  it('streams orange price-only matches without total cells', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();

    await wrapper.find('#price-orange').setValue('37928.2');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    const runSource = getRunEventSource();
    expect(runSource.url)
      .toBe('/run?script=solve-gold-combo.js&args=37928.2+dedupe-total-cells&limit=30');
    expect(wrapper.find('#result-meta').text()).toContain('橙/金色仅输入平均价格');

    runSource.emit({
      type: 'out',
      text: '  TotalCells=18, TotalPrice=189641, Count=5: [A]\n',
    });
    await nextTick();

    expect(wrapper.find('#result-body').text()).toContain('方案 1');
    expect(wrapper.find('#result-body').text()).toContain('18');
    expect(wrapper.find('#result-body').text()).toContain('均价匹配');
  });

  it('uses purple average candidates when streaming orange price-only matches', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('119');
    await wrapper.find('#cells-wg').setValue('21');
    await wrapper.find('#cells-blue').setValue('44');
    await wrapper.find('#avg-purple').setValue('2.8');
    await wrapper.find('#price-orange').setValue('30472');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    getRunEventSource().emit({
      type: 'out',
      text: '  TotalCells=11, TotalPrice=91416, Count=3: [A]\n',
    });
    await nextTick();

    const rowText = wrapper.find('#result-body').text();
    expect(rowText).toContain('方案 1');
    expect(rowText).toContain('紫色');
    // purple=14 leaves 29 red cells; purple=28 leaves 15; purple=39 leaves 4; purple=42 leaves 1.
    expect(rowText).toContain('279,648');
    expect(rowText).toContain('701,726');
    expect(rowText).toContain('1,330,152');
    expect(wrapper.find('#total-estimate').text()).toBe('701,726');
  });

  it('expands summary range across multiple orange price-only stream rows', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('119');
    await wrapper.find('#cells-wg').setValue('21');
    await wrapper.find('#cells-blue').setValue('44');
    await wrapper.find('#avg-purple').setValue('2.8');
    await wrapper.find('#price-orange').setValue('30472');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    getRunEventSource().emit({
      type: 'out',
      text: [
        '  TotalCells=11, TotalPrice=91416, Count=3: [A]',
        '  TotalCells=7, TotalPrice=152360, Count=5: [B]',
      ].join('\n'),
    });
    await nextTick();

    expect(wrapper.find('#result-body').text()).toContain('方案 2');
    // Row1 low=279,648; Row2 low=500,592; summary low = min = 279,648
    expect(wrapper.find('#low-estimate').text()).toBe('279,648');
    // summary total = Row1 mean across the purple companion candidates.
    expect(wrapper.find('#total-estimate').text()).toBe('701,726');
    // Row1 high=1,330,152; Row2 high=1,551,096; summary high = max = 1,551,096
    expect(wrapper.find('#high-estimate').text()).toBe('1,551,096');
  });

  it('tags orange average predictions when real collectibles match the entered average price', async () => {
    mockDataFetch({
      averagePrices: realAveragePrices,
      collectibles: realCollectibles,
    });
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('20');
    await wrapper.find('#avg-orange').setValue('2.5');
    await wrapper.find('#price-orange').setValue('22800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    expect(wrapper.find('#result-body').text()).toContain('方案 1');
    expect(wrapper.find('#result-body').text()).not.toContain('价格误差');

    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    await nextTick();

    expect(wrapper.find('.result-tag').text()).toBe('均价匹配');
  });

  it('combines purple and orange average predictions instead of ignoring orange candidates', async () => {
    mockDataFetch({
      averagePrices: realAveragePrices,
      collectibles: realCollectibles,
    });
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('20');
    await wrapper.find('#avg-purple').setValue('2.33');
    await wrapper.find('#price-purple').setValue('6800');
    await wrapper.find('#avg-orange').setValue('2.5');
    await wrapper.find('#price-orange').setValue('22800');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    const resultText = wrapper.find('#result-body').text();
    expect(wrapper.find('#result-meta').text()).toContain('紫色、橙/金色平均格数组合');
    expect(resultText).toContain('组合预测');
    expect(resultText).toContain('紫色 3件/7格');
    expect(resultText).toContain('橙/金色 2件/5格');
    expect(resultText).toContain('12');

    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    await nextTick();

    const tags = wrapper.findAll('.result-tag').map((tag) => tag.text());
    expect(tags).toContain('紫色均价匹配');
    expect(tags).toContain('橙/金色均价匹配');
  });

  it('prioritizes exact total-cell combined average predictions in the UI', async () => {
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('93');
    await wrapper.find('#avg-all').setValue('3.3214');
    await wrapper.find('#cells-wg').setValue('36');
    await wrapper.find('#cells-blue').setValue('13');
    await wrapper.find('#avg-purple').setValue('4');
    await wrapper.find('#avg-orange').setValue('6');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    const firstRowText = wrapper.findAll('#result-body tr')[0].text();
    expect(wrapper.find('#result-meta').text()).toContain('紫色、橙/金色平均格数组合');
    expect(firstRowText).toContain('371,973');
    expect(firstRowText).toContain('总剩余 0');
    expect(firstRowText).not.toContain('1,444,934');
  });

  it('marks overflow rows with status-over class and 总格数 tag', async () => {
    const wrapper = await mountApp();

    await wrapper.find('#total-cells-all').setValue('20');
    await wrapper.find('#cells-wg').setValue('5');
    await wrapper.find('#cells-blue').setValue('5');
    await wrapper.find('#avg-purple').setValue('3');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    // knownCells = 10, effectiveMax = 40, maxGroupCells = 30
    // candidates: 3, 6, 9, 12, ..., 30 — cells > 10 push knownCells over totalCells=20
    const overflowTds = wrapper.findAll('td.status-over');
    expect(overflowTds.length).toBeGreaterThan(0);
    const tag = overflowTds[0].find('.result-tag');
    expect(tag.exists()).toBe(true);
    expect(tag.text()).toContain('总格数');
  });

  it('restores legacy control state from localStorage', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      controls: {
        'total-cells-all': { value: '100' },
        'avg-all': { value: '2' },
        'cells-wg': { value: '20' },
      },
    }));

    const wrapper = await mountApp();

    expect(wrapper.find('#total-cells-all').element.value).toBe('100');
    expect(wrapper.find('#avg-all').element.value).toBe('2');
    expect(wrapper.find('#cells-wg').element.value).toBe('20');
  });

  it('shows monitor quality fills as placeholder without writing to input value', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'placeholder-fill',
      gameUid: 'game-1',
      rawEvent: { group: 'map', skill: {
        uid: 'placeholder-fill-skill',
        skillCid: 200010,
        totalHitBoxIndex: 15,
      } },
      groups: { purple: { totalCells: 15, averageCells: 2.5, averagePrice: 8000 } },
    }));
    await nextTick();

    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('15');
    expect(wrapper.find('#avg-purple').element.value).toBe('');
    expect(wrapper.find('#avg-purple').attributes('placeholder')).toBe('2.5');
    expect(wrapper.find('#price-purple').element.value).toBe('');
    expect(wrapper.find('#price-purple').attributes('placeholder')).toBe('8000');
  });

  it('uses quality placeholder values as fallback when user has not filled them', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'placeholder-fallback',
      gameUid: 'game-1',
      rawEvent: { skill: {
        uid: 'placeholder-fallback-skill',
        skillCid: 202,
        totalHitBoxIndex: 15,
      } },
      groups: { blue: { totalCells: 15 } },
    }));
    await nextTick();

    expect(wrapper.find('#cells-blue').element.value).toBe('');
    expect(wrapper.find('#cells-blue').attributes('placeholder')).toBe('15');

    await wrapper.find('#total-cells-all').setValue('35');
    await wrapper.find('#cells-wg').setValue('10');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    // wg=10×232 + blue=15 (from placeholder)×889 + 10 remaining × lowest-missing
    // = 2,320 + 13,335 + 10×1001 (red per-cell) = 25,665
    expect(wrapper.find('#total-estimate').text()).not.toBe('-');
    // Verify blue cells from placeholder contributed: remaining = 35-10-15 = 10
    expect(wrapper.find('#result-meta').text()).toContain('已输入白+绿');
    expect(wrapper.find('#result-meta').text()).toContain('蓝色');
    expect(wrapper.find('#result-meta').text()).toContain('剩余格数 10');
  });

  it('clears quality placeholders and monitor matrix when clear button is clicked', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'fill-before-clear',
      gameUid: 'game-1',
      rawEvent: { group: 'map', skill: {
        uid: 'fill-before-clear-skill',
        skillCid: 200010,
        totalHitBoxIndex: 8,
      } },
      groups: { purple: { totalCells: 8 } },
      outlines: [{ boxId: 1, cells: [1], width: 1, height: 1, label: '1x1', qualityName: '紫' }],
    }));
    await nextTick();

    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('8');
    expect(wrapper.findAll('.monitor-outline').length).toBeGreaterThan(0);

    await wrapper.find('#clear-button').trigger('click');
    await nextTick();

    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).not.toBe('8');
    expect(wrapper.findAll('.monitor-outline')).toHaveLength(0);
    expect(wrapper.find('#ethan-monitor-types').exists()).toBe(false);
  });

  it('ignores same-game monitor events after clear button is clicked', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'fill-before-clear-2',
      gameUid: 'game-1',
      rawEvent: { group: 'map', skill: {
        uid: 'fill-before-clear-skill-2',
        skillCid: 200010,
        totalHitBoxIndex: 8,
      } },
      groups: { purple: { totalCells: 8 } },
      outlines: [{ boxId: 1, cells: [1], width: 1, height: 1, label: '1x1', qualityName: '紫' }],
    }));
    await nextTick();

    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('8');

    await wrapper.find('#clear-button').trigger('click');
    await nextTick();

    // Same already-applied game-1 event arrives after clear — should be ignored
    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'fill-before-clear-2',
      gameUid: 'game-1',
      rawEvent: { group: 'map', skill: {
        uid: 'fill-before-clear-skill-2',
        skillCid: 200010,
        totalHitBoxIndex: 99,
      } },
      groups: { purple: { totalCells: 99 } },
      outlines: [{ boxId: 2, cells: [1], width: 1, height: 1, label: '1x1', qualityName: '紫' }],
    }));
    await nextTick();

    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).not.toBe('99');
    expect(wrapper.findAll('.monitor-outline')).toHaveLength(0);
  });

  it('ignores new same-game scan events after clear button is clicked', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'fill-before-same-game-clear',
      gameUid: 'game-1',
      rawEvent: { group: 'map', skill: {
        uid: 'fill-before-same-game-clear-skill',
        skillCid: 200010,
        totalHitBoxIndex: 8,
      } },
      groups: { purple: { totalCells: 8 } },
    }));
    await nextTick();

    await wrapper.find('#clear-button').trigger('click');
    await nextTick();

    monitorSource.emitEvent('event', {
      key: 'same-game-common-scan-after-clear',
      gameUid: 'game-1',
      group: 'item',
      skill: {
        uid: 'same-game-common-scan-after-clear-skill',
        skillCid: 201,
        itemCid: 100104,
        itemName: '普品扫描',
        totalHitBoxIndex: 9,
      },
    });
    await nextTick();

    expect(wrapper.find('#cells-wg').element.value).toBe('');
    expect(wrapper.find('#cells-wg').attributes('placeholder')).not.toBe('9');
  });

  it('shows new-game monitor events after clear button is clicked', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'fill-game-1',
      gameUid: 'game-1',
      rawEvent: { group: 'map', skill: {
        uid: 'fill-game-1-skill',
        skillCid: 200010,
        totalHitBoxIndex: 8,
      } },
      groups: { purple: { totalCells: 8 } },
      outlines: [{ boxId: 1, cells: [1], width: 1, height: 1, label: '1x1', qualityName: '紫' }],
    }));
    await nextTick();

    await wrapper.find('#clear-button').trigger('click');
    await nextTick();

    // New game-2 event arrives after clear — should be displayed
    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'fill-game-2',
      gameUid: 'game-2',
      rawEvent: { group: 'map', skill: {
        uid: 'fill-game-2-skill',
        skillCid: 200010,
        totalHitBoxIndex: 20,
      } },
      groups: { purple: { totalCells: 20 } },
      outlines: [{ boxId: 2, cells: [1], width: 1, height: 1, label: '1x1', qualityName: '紫' }],
    }));
    await nextTick();

    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('20');
    expect(wrapper.findAll('.monitor-outline').length).toBeGreaterThan(0);
  });

  it('subtracts confirmed monitor outline cells from remaining and adds their exact value', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'outline-value-test',
      gameUid: 'game-1',
      outlines: [
        { boxId: 1, cells: [1, 2, 3], width: 1, height: 3, label: '1x3', qualityName: '蓝', qualityStatus: 'confirmed', price: 5000 },
        { boxId: 2, cells: [4, 5, 6, 7], width: 1, height: 4, label: '1x4', qualityName: '蓝', qualityStatus: 'confirmed', price: 8000 },
      ],
    }));
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('50');
    await wrapper.find('#cells-wg').setValue('10');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    // wg: 10×232=2320, blue outlines 7 cells=13000, remaining 33×889=29337
    expect(wrapper.find('#total-estimate').text()).toBe('44,657');
    expect(wrapper.find('#result-meta').text()).toContain('另有矩阵轮廓贡献7格');
  });

  it('uses only outline cells with known values when some outlines have no price data', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'partial-outline-test',
      gameUid: 'game-1',
      outlines: [
        { boxId: 1, cells: [1, 2, 3], width: 1, height: 3, label: '1x3', qualityName: '蓝', qualityStatus: 'confirmed', price: 5000 },
        { boxId: 2, cells: [4, 5, 6, 7], width: 1, height: 4, label: '1x4', qualityName: '蓝', qualityStatus: 'confirmed' },
      ],
    }));
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('50');
    await wrapper.find('#cells-wg').setValue('10');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    // Only the 3-cell outline (price=5000) contributes; 4-cell outline has no value
    // wg: 10×232=2320, blue outline 3 cells=5000, remaining 37×889=32893
    expect(wrapper.find('#total-estimate').text()).toBe('40,213');
    expect(wrapper.find('#result-meta').text()).toContain('另有矩阵轮廓贡献3格');
  });

  it('applies outline contributions for multiple quality groups above the baseline', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'multi-quality-outline-test',
      gameUid: 'game-1',
      outlines: [
        { boxId: 1, cells: [1, 2, 3, 4, 5], width: 1, height: 5, label: '1x5', qualityName: '蓝', qualityStatus: 'confirmed', price: 10000 },
        { boxId: 2, cells: [6, 7, 8], width: 1, height: 3, label: '1x3', qualityName: '紫', qualityStatus: 'confirmed', price: 8000 },
      ],
    }));
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('50');
    await wrapper.find('#cells-wg').setValue('10');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    // wg: 10×232=2320, blue outlines 5 cells=10000, purple outlines 3 cells=8000
    // remaining: 50-10-5-3=32, ×889=28448
    expect(wrapper.find('#total-estimate').text()).toBe('48,768');
    expect(wrapper.find('#result-meta').text()).toContain('另有矩阵轮廓贡献8格');
  });

  it('uses partial outline values in Case 1 when some blue outlines lack price data but user provided cells', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createEnrichedMonitorPayload({
      key: 'case1-partial-test',
      gameUid: 'game-1',
      outlines: [
        { boxId: 1, cells: [1, 2, 3], width: 1, height: 3, label: '1x3', qualityName: '蓝', qualityStatus: 'confirmed', price: 5000 },
        { boxId: 2, cells: [4, 5, 6, 7], width: 1, height: 4, label: '1x4', qualityName: '蓝', qualityStatus: 'confirmed' },
      ],
    }));
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('50');
    await wrapper.find('#cells-wg').setValue('10');
    await wrapper.find('#cells-blue').setValue('10');
    await wrapper.find('#estimate-form').trigger('submit');
    await nextTick();

    // blue value: 5000 (3 exact cells) + 7×889 (remaining 7 at per-cell) = 5000+6223=11223
    // wg: 10×232=2320, remaining: 50-10-10=30 at 2482 (purple)=74460
    // total = 2320+11223+74460=88003
    // without fix: 10×889=8890 → 2320+8890+74460=85670
    expect(wrapper.find('#total-estimate').text()).toBe('88,003');
  });
});
