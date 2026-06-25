/* @vitest-environment happy-dom */
import fs from 'node:fs';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import App from './App.vue';
import { __resetMonitorSwitchRuntimeForTest } from '../shared/useMonitorSwitch.js';

const realAveragePrices = JSON.parse(fs.readFileSync('public/data/quality-size-average-prices.json', 'utf8'));
const realCollectibles = JSON.parse(fs.readFileSync('public/data/collectibles.json', 'utf8'));
const TOOLS_PAGE_STATE_KEY = 'bidking-page-state:v2:elsa';
const LEGACY_TOOLS_PAGE_STATE_KEY = 'bidking-page-state:v1:elsa';
const ELSA_HERO_STATE_KEY = 'bidking-page-state:v1:elsa-hero';
const ETHAN_HERO_STATE_KEY = 'bidking-page-state:v1:ethan';
const AHMED_PAGE_STATE_KEY = 'bidking-page-state:v1:ahmed';
const LEAVE_TOOLS_EVENT = 'bidking:leave-tools';
let mountedWrappers = [];

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

  fail() {
    this.onerror?.();
  }

  static reset() {
    FakeEventSource.instances = [];
  }
}

FakeEventSource.instances = [];

class FakeToolsOutputWorker {
  constructor() {
    FakeToolsOutputWorker.starts += 1;
    FakeToolsOutputWorker.instances.push(this);
    this.onmessage = null;
    this.onerror = null;
    this.messages = [];
    this.runs = new Map();
  }

  postMessage(message) {
    this.messages.push(message);

    queueMicrotask(async () => {
      try {
        const core = await import('./tools-run-output-worker-core.js');
        if (message.type === 'cancel') {
          this.runs.delete(message.runId);
          return;
        }

        if (message.type === 'start') {
          this.runs.set(message.runId, core.createSolverOutputRunState(message));
          this.emitSnapshot(message.runId, core.buildSolverOutputSnapshot(this.runs.get(message.runId)));
          return;
        }

        const state = this.runs.get(message.runId);
        if (!state) return;
        const nextState = core.applySolverOutputMessage(state, message);
        this.runs.set(message.runId, nextState);
        this.emitSnapshot(message.runId, core.buildSolverOutputSnapshot(nextState));
      } catch (error) {
        this.onerror?.(error);
      }
    });
  }

  emitSnapshot(runId, snapshot) {
    this.onmessage?.({
      data: {
        type: 'snapshot',
        runId,
        ...snapshot,
      },
    });
  }

  terminate = vi.fn();

  static reset() {
    FakeToolsOutputWorker.starts = 0;
    FakeToolsOutputWorker.instances = [];
  }
}

FakeToolsOutputWorker.starts = 0;
FakeToolsOutputWorker.instances = [];

function mockMatchMedia(matches = false) {
  window.matchMedia = vi.fn(() => ({
    matches,
    addEventListener: vi.fn(),
  }));
}

async function mountApp() {
  const wrapper = mount(App, { attachTo: document.body });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();
  return wrapper;
}

function getRunSources() {
  return FakeEventSource.instances.filter((source) => String(source.url).startsWith('/run?'));
}

function getLatestRunSource() {
  const runSources = getRunSources();
  return runSources[runSources.length - 1] || null;
}

function getLatestToolsWorker() {
  return FakeToolsOutputWorker.instances[FakeToolsOutputWorker.instances.length - 1] || null;
}

async function selectTab(wrapper, index) {
  await wrapper.findAll('.tab-button')[index].trigger('click');
  await nextTick();
}

async function fillVisibleInputs(wrapper, fieldValues) {
  const inputs = wrapper.findAll('.form-grid input');
  for (const [index, value] of fieldValues.entries()) {
    await inputs[index].setValue(value);
  }
}

describe('Tools App', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    window.history.replaceState({}, '', '/Tools');
    FakeEventSource.reset();
    FakeToolsOutputWorker.reset();
    mockMatchMedia(false);
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === '/api/bidking-monitor/status') {
        return { ok: true, json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }) };
      }
      return {
        ok: true,
        json: async () => String(url).includes('/data/collectibles.json') ? realCollectibles : realAveragePrices,
      };
    }));
  });

  afterEach(() => {
    mountedWrappers.forEach((wrapper) => wrapper.unmount());
    mountedWrappers = [];
    __resetMonitorSwitchRuntimeForTest();
    vi.unstubAllGlobals();
  });

  it('renders the calculator tabs and validates required inputs', async () => {
    const wrapper = await mountApp();

    expect(wrapper.find('h1').text()).toBe('Tools 组合计算器');
    expect(wrapper.findAll('.nav a').map(link => link.attributes('href'))).toEqual([
      '/',
      '/Tools',
      '/Monitor',
      '/Price',
      '/Inject',
    ]);
    expect(wrapper.findAll('.tab-button')).toHaveLength(13);
    expect(wrapper.findAll('.tab-button').slice(0, 4).map((button) => button.text())).toEqual([
      'Elsa · 期望价值',
      'Ethan · 期望价值',
      'Ahmed · 组合计算器',
      'V2 最小格数 · 调试器',
    ]);
    expect(wrapper.findAll('.tab-button').map(button => button.text())).toContain('红色 · 平均格数');
    expect(wrapper.findAll('.tab-button').map(button => button.text())).toContain('紫色 · 总价格');
    expect(wrapper.findAll('.tab-button').map(button => button.text())).toContain('Elsa · 期望价值');
    expect(wrapper.find('.elsa-head p').text()).toBe('Elsa · 期望价值');
    expect(wrapper.find('.help-button').attributes('aria-describedby')).toBe('global-limit-help');
    expect(wrapper.find('#global-limit-help').text()).toContain('每个 Count 分组最多输出多少条组合');
    expect(wrapper.find('#global-limit-help').text()).toContain('默认 Count 不超过 15 输出 60 条');

    expect(FakeEventSource.instances.filter((source) => String(source.url).startsWith('/run?'))).toHaveLength(0);
    expect(wrapper.find('#elsa-estimate-form').exists()).toBe(true);
    expect(wrapper.find('.action-button').exists()).toBe(false);
    expect(wrapper.find('.run-status').exists()).toBe(false);
  });

  it('renders the default Elsa panel tab without using the solver /run flow', async () => {
    const wrapper = await mountApp();

    expect(wrapper.findAll('.tab-button')).toHaveLength(13);
    expect(wrapper.findAll('.tab-button').map((button) => button.text())).toContain('Elsa · 期望价值');

    expect(wrapper.find('#elsa-cells-white').exists()).toBe(true);
    expect(wrapper.find('#elsa-cells-green').exists()).toBe(true);
    expect(wrapper.find('#elsa-price-orange').exists()).toBe(true);
    expect(wrapper.find('#elsa-price-red').exists()).toBe(true);
    expect(FakeEventSource.instances.filter((source) => String(source.url).startsWith('/run?'))).toHaveLength(0);
  });

  it('keeps the three purple solver tabs grouped together in the tab list', async () => {
    const wrapper = await mountApp();

    expect(wrapper.findAll('.tab-button').slice(4).map((button) => button.text())).toEqual([
      '金色 · 平均价格',
      '金色 · 总价格',
      '金色 · 平均格数',
      '紫色 · 平均格数',
      '紫色 · 平均价格',
      '紫色 · 总价格',
      '红色 · 平均格数',
      '类目 · 平均价格',
      'X件 · 平均价格',
    ]);
  });

  it('keeps legacy v1 purple-average tab migration mapped to the old index order', async () => {
    window.localStorage.setItem(LEGACY_TOOLS_PAGE_STATE_KEY, JSON.stringify({
      activeTabIndex: 7,
    }));

    const wrapper = await mountApp();

    expect(wrapper.find('.elsa-head p').text()).toBe('紫色 · 平均价格');
  });

  it('selects the Ethan panel from the location query before saved state', async () => {
    window.history.replaceState({}, '', '/Tools?tab=ethan');
    window.localStorage.setItem(TOOLS_PAGE_STATE_KEY, JSON.stringify({
      activeTabId: 'elsa',
    }));

    const wrapper = await mountApp();

    expect(wrapper.find('#ethan-estimate-form').exists()).toBe(true);
    expect(wrapper.find('.elsa-head p').text()).toBe('Ethan · 期望价值');
    expect(FakeEventSource.instances.filter((source) => String(source.url).startsWith('/run?'))).toHaveLength(0);
  });

  it('selects the Ahmed panel from the location query', async () => {
    window.history.replaceState({}, '', '/Tools?tab=ahmed');

    const wrapper = await mountApp();

    expect(wrapper.find('#combo-form').exists()).toBe(true);
    expect(wrapper.find('#calculate-button').exists()).toBe(true);
    expect(wrapper.find('.elsa-head p').text()).toBe('Ahmed · 组合计算器');
  });

  it('updates the location query when switching panel tabs', async () => {
    const wrapper = await mountApp();

    await selectTab(wrapper, 2);

    expect(window.location.search).toBe('?tab=ahmed');

    await selectTab(wrapper, 1);

    expect(window.location.search).toBe('?tab=ethan');
  });

  it('keeps Elsa monitor placeholders and outline matrix when switching away and back', async () => {
    const wrapper = await mountApp();
    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-tab-preserve-event',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-tab-preserve-event-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    await nextTick();

    monitorSource.emitEvent('event', {
      key: 'elsa-tab-preserve-map-event',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'elsa-tab-preserve-map-event-skill',
        skillCid: 200011,
        totalHitBoxIndex: 6,
      },
    });
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);
    expect(wrapper.find('#elsa-cells-orange').attributes('placeholder')).toBe('6');

    await selectTab(wrapper, 4);
    expect(wrapper.find('.action-button').exists()).toBe(true);

    await selectTab(wrapper, 0);

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);
    expect(wrapper.find('#elsa-cells-orange').attributes('placeholder')).toBe('6');
  });

  it('clears solver, hero, and Ahmed panel caches when leaving Tools', async () => {
    const wrapper = await mountApp();

    await selectTab(wrapper, 1);
    await wrapper.get('#ethan-total-cells-all').setValue('32');
    await nextTick();

    await selectTab(wrapper, 2);
    await wrapper.get('#total-count').setValue('9');
    await nextTick();

    await selectTab(wrapper, 4);
    await wrapper.findAll('.form-grid input')[0].setValue('7800');
    await wrapper.findAll('.form-grid input')[1].setValue('2');
    await nextTick();

    await selectTab(wrapper, 0);
    await wrapper.get('#elsa-total-cells-all').setValue('40');
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-tools-leave-hero',
      gameUid: 'leave-tools-game',
      group: 'hero',
      skill: {
        uid: 'elsa-tools-leave-hero-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    await nextTick();

    monitorSource.emitEvent('event', {
      key: 'elsa-tools-leave-map',
      gameUid: 'leave-tools-game',
      group: 'map',
      skill: {
        uid: 'elsa-tools-leave-map-skill',
        skillCid: 200011,
        totalHitBoxIndex: 6,
      },
    });
    await nextTick();

    window.localStorage.setItem(LEGACY_TOOLS_PAGE_STATE_KEY, JSON.stringify({ activeTabIndex: 0 }));
    window.localStorage.setItem(AHMED_PAGE_STATE_KEY, JSON.stringify({
      controls: {
        'total-count': { type: 'value', value: '9' },
      },
    }));

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);
    expect(wrapper.get('#elsa-cells-orange').attributes('placeholder')).toBe('6');
    expect(window.localStorage.getItem(TOOLS_PAGE_STATE_KEY)).toBeTruthy();
    expect(window.localStorage.getItem(ELSA_HERO_STATE_KEY)).toBeTruthy();
    expect(window.localStorage.getItem(ETHAN_HERO_STATE_KEY)).toBeTruthy();
    expect(window.localStorage.getItem(AHMED_PAGE_STATE_KEY)).toBeTruthy();

    window.dispatchEvent(new CustomEvent(LEAVE_TOOLS_EVENT));
    await flushPromises();
    await nextTick();

    expect(window.localStorage.getItem(TOOLS_PAGE_STATE_KEY)).toBeNull();
    expect(window.localStorage.getItem(ELSA_HERO_STATE_KEY)).toBeNull();
    expect(window.localStorage.getItem(ETHAN_HERO_STATE_KEY)).toBeNull();
    expect(window.localStorage.getItem(AHMED_PAGE_STATE_KEY)).toBeNull();

    expect(wrapper.get('#elsa-total-cells-all').element.value).toBe('');
    expect(wrapper.get('#elsa-cells-orange').attributes('placeholder')).not.toBe('6');
    expect(wrapper.findAll('.monitor-outline')).toHaveLength(0);

    await selectTab(wrapper, 1);
    expect(wrapper.get('#ethan-total-cells-all').element.value).toBe('');

    await selectTab(wrapper, 2);
    expect(wrapper.get('#total-count').element.value).toBe('');
    expect(wrapper.get('#known-list').text()).toBe('暂无约束');
  });

  it('runs the all-item average price tab with count and average price', async () => {
    const wrapper = await mountApp();
    const tabs = wrapper.findAll('.tab-button');

    await tabs[12].trigger('click');
    await nextTick();

    const inputs = wrapper.findAll('.form-grid input');
    await inputs[0].setValue('2');
    await inputs[1].setValue('7800');
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    expect(getRunSources()).toHaveLength(1);
    expect(getLatestRunSource()?.url).toBe('/run?script=solve-average-price-combo.js&args=2+7800');
  });

  it('passes the gold red dedupe flag for the all-item average price tab', async () => {
    const wrapper = await mountApp();
    const tabs = wrapper.findAll('.tab-button');

    await tabs[12].trigger('click');
    await nextTick();

    const inputs = wrapper.findAll('.form-grid input');
    await inputs[0].setValue('2');
    await inputs[1].setValue('7800');
    await wrapper.find('.form-grid input[type="checkbox"]').setValue(true);
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    expect(getRunSources()).toHaveLength(1);
    expect(getLatestRunSource()?.url).toBe('/run?script=solve-average-price-combo.js&args=2+7800+dedupe-gold-red');
  });

  it('passes the total-cells dedupe flag for the purple average price tab', async () => {
    const wrapper = await mountApp();
    const tabs = wrapper.findAll('.tab-button');

    await tabs[8].trigger('click');
    await nextTick();

    const inputs = wrapper.findAll('.form-grid input');
    await inputs[0].setValue('10380');
    await inputs[1].setValue('2');
    await wrapper.find('.form-grid input[type="checkbox"]').setValue(true);
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    expect(getRunSources()).toHaveLength(1);
    expect(getLatestRunSource()?.url).toBe('/run?script=solve-purple-combo.js&args=10380+2+dedupe-total-cells');
  });

  it('runs the purple total price tab with total price', async () => {
    const wrapper = await mountApp();
    const tabs = wrapper.findAll('.tab-button');

    await tabs[9].trigger('click');
    await nextTick();

    const inputs = wrapper.findAll('.form-grid input');
    await inputs[0].setValue('10380');
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    expect(getRunSources()).toHaveLength(1);
    expect(getLatestRunSource()?.url).toBe('/run?script=solve-purple-total.js&args=10380');
  });

  it('sorts streamed purple dedupe results by total cells in the frontend', async () => {
    const wrapper = await mountApp();
    const tabs = wrapper.findAll('.tab-button');

    await tabs[8].trigger('click');
    await nextTick();

    const inputs = wrapper.findAll('.form-grid input');
    await inputs[0].setValue('5400');
    await inputs[1].setValue('2');
    await wrapper.find('.form-grid input[type="checkbox"]').setValue(true);
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    const output = wrapper.find('.table-output').element;
    Object.defineProperty(output, 'scrollHeight', { value: 1000, configurable: true });
    output.scrollTop = 120;

    const runSource = getLatestRunSource();
    runSource.emit({ type: 'out', text: 'Count=2, TotalPrice=10800\n' });
    runSource.emit({ type: 'out', text: '  TotalCells=3, TotalPrice=10800, Count=2: [A]\n' });
    runSource.emit({ type: 'out', text: '  TotalCells=5, TotalPrice=10800, Count=2: [B]\n' });
    runSource.emit({ type: 'out', text: '  TotalCells=4, TotalPrice=10800, Count=2: [C]\n' });
    await nextTick();
    await nextTick();

    const resultLines = wrapper.findAll('.result-table tbody tr')
      .map(row => row.findAll('td')[1].text());

    expect(resultLines).toEqual(['3', '4', '5']);
    expect(output.scrollTop).toBe(120);
  });

  it('boots a solver output worker for solver-tab runs', async () => {
    vi.stubGlobal('Worker', FakeToolsOutputWorker);

    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    await fillVisibleInputs(wrapper, ['27197.45']);
    await wrapper.find('.action-button').trigger('click');
    await flushPromises();
    await nextTick();

    expect(FakeToolsOutputWorker.starts).toBe(1);
    expect(getLatestToolsWorker()?.messages[0]).toMatchObject({
      type: 'start',
      resultMode: 'table',
    });
  });

  it('renders incremental solver rows from worker snapshots instead of renderer-side parsing', async () => {
    vi.stubGlobal('Worker', FakeToolsOutputWorker);

    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    await fillVisibleInputs(wrapper, ['7800', '2']);
    await wrapper.find('.action-button').trigger('click');
    await flushPromises();
    await nextTick();

    const worker = getLatestToolsWorker();
    const runSource = getLatestRunSource();

    runSource.emit({
      type: 'out',
      text: 'Count=2, TotalPrice=15600\n  TotalCells=5, TotalPrice=15600, Count=2: [B]\n',
    });
    await flushPromises();
    await nextTick();

    expect(worker.messages.at(-1)).toMatchObject({
      type: 'append-source',
      message: {
        type: 'out',
      },
    });
    expect(wrapper.findAll('.result-table tbody tr')).toHaveLength(1);
    expect(wrapper.find('.result-table').text()).toContain('[B]');

    runSource.emit({
      type: 'out',
      text: '  TotalCells=3, TotalPrice=15600, Count=2: [A]\n',
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.findAll('.result-table tbody tr')).toHaveLength(2);
    expect(wrapper.find('.result-table').text()).toContain('[A]');
  });

  it('sends solver sort and filter requests to the worker', async () => {
    vi.stubGlobal('Worker', FakeToolsOutputWorker);

    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    await fillVisibleInputs(wrapper, ['7800', '2']);
    await wrapper.find('.action-button').trigger('click');
    await flushPromises();
    await nextTick();

    const worker = getLatestToolsWorker();
    getLatestRunSource().emit({
      type: 'out',
      text: [
        'Count=2, TotalPrice=15600',
        '  TotalCells=5, TotalPrice=15600, Count=2: [B]',
        '  TotalCells=3, TotalPrice=15600, Count=2: [A]',
        '',
      ].join('\n'),
    });
    await flushPromises();
    await nextTick();

    await wrapper.find('.filter-control input').setValue('[A]');
    await flushPromises();
    await nextTick();

    expect(worker.messages.at(-1)).toMatchObject({
      type: 'set-filter',
      filter: '[A]',
    });
    expect(wrapper.findAll('.result-table tbody tr')).toHaveLength(1);
    expect(wrapper.find('.result-table').text()).toContain('[A]');

    await wrapper.find('.filter-control input').setValue('');
    await flushPromises();
    await nextTick();
    await wrapper.findAll('.result-table th button')[1].trigger('click');
    await flushPromises();
    await nextTick();

    expect(worker.messages.at(-1)).toMatchObject({
      type: 'set-sort',
      sort: { key: 'totalCells', direction: 'asc' },
    });
    expect(wrapper.findAll('.result-table tbody tr').map((row) => row.findAll('td')[1].text())).toEqual(['3', '5']);
  });

  it('keeps purple dedupe-total-cells rows ordered by total cells in worker state', async () => {
    const core = await import('./tools-run-output-worker-core.js');
    let state = core.createSolverOutputRunState({
      runId: 1,
      resultMode: 'table',
      script: 'solve-purple-combo.js',
      args: '5400 2 dedupe-total-cells',
    });

    state = core.applySolverOutputMessage(state, {
      type: 'append-source',
      message: { type: 'out', text: 'Count=2, TotalPrice=10800\n' },
    });
    state = core.applySolverOutputMessage(state, {
      type: 'append-source',
      message: { type: 'out', text: '  TotalCells=3, TotalPrice=10800, Count=2: [A]\n' },
    });
    state = core.applySolverOutputMessage(state, {
      type: 'append-source',
      message: { type: 'out', text: '  TotalCells=5, TotalPrice=10800, Count=2: [B]\n' },
    });
    state = core.applySolverOutputMessage(state, {
      type: 'append-source',
      message: { type: 'out', text: '  TotalCells=4, TotalPrice=10800, Count=2: [C]\n' },
    });

    expect(core.buildSolverOutputSnapshot(state).rows.map((row) => row.totalCells)).toEqual([3, 4, 5]);
  });

  it('cancels stale solver runs so old worker snapshots do not leak into reruns or other tabs', async () => {
    vi.stubGlobal('Worker', FakeToolsOutputWorker);

    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    await fillVisibleInputs(wrapper, ['7800', '1']);
    await wrapper.find('.action-button').trigger('click');
    await flushPromises();
    await nextTick();

    const firstWorker = getLatestToolsWorker();
    const firstRunId = firstWorker.messages[0].runId;
    const firstRunSource = getLatestRunSource();

    firstRunSource.emit({
      type: 'out',
      text: 'Count=1, TotalPrice=7800\n  TotalCells=1, TotalPrice=7800, Count=1: [first]\n',
    });
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.result-table').text()).toContain('[first]');

    await wrapper.find('.action-button').trigger('click');
    await flushPromises();
    await nextTick();

    const cancelMessage = firstWorker.messages.find((message) => message.type === 'cancel');
    expect(cancelMessage).toMatchObject({ runId: firstRunId });

    const rerunId = firstWorker.messages.at(-1).runId;
    expect(rerunId).not.toBe(firstRunId);

    firstWorker.emitSnapshot(firstRunId, {
      rawLines: [{ text: 'stale rerun line', className: '' }],
      rows: [{
        id: 'stale-rerun',
        text: 'TotalCells=9, TotalPrice=9000, Count=1: [stale-rerun]',
        totalCells: 9,
        totalPrice: 9000,
        count: 1,
        combo: '[stale-rerun]',
      }],
      lines: [],
      statusText: '搜索中',
      statusKind: 'running',
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('.table-output').text()).not.toContain('[stale-rerun]');

    await selectTab(wrapper, 5);
    await fillVisibleInputs(wrapper, ['15600']);
    await wrapper.find('.action-button').trigger('click');
    await flushPromises();
    await nextTick();

    firstWorker.emitSnapshot(rerunId, {
      rawLines: [{ text: 'stale tab line', className: '' }],
      rows: [{
        id: 'stale-tab',
        text: 'TotalCells=8, TotalPrice=15600, Count=2: [stale-tab]',
        totalCells: 8,
        totalPrice: 15600,
        count: 2,
        combo: '[stale-tab]',
      }],
      lines: [],
      statusText: '搜索中',
      statusKind: 'running',
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('.elsa-head p').text()).toBe('金色 · 总价格');
    expect(wrapper.find('.table-output').text()).not.toContain('[stale-tab]');
  });

  it('ignores terminal events from stale SSE runs after a rerun starts', async () => {
    vi.stubGlobal('Worker', FakeToolsOutputWorker);

    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    await fillVisibleInputs(wrapper, ['7800', '1']);
    await wrapper.find('.action-button').trigger('click');
    await flushPromises();
    await nextTick();

    const firstRunSource = getLatestRunSource();

    await wrapper.find('.action-button').trigger('click');
    await flushPromises();
    await nextTick();

    const secondRunSource = getLatestRunSource();
    expect(secondRunSource).not.toBe(firstRunSource);

    firstRunSource.emit({ type: 'done', code: 0 });
    firstRunSource.fail();
    await flushPromises();
    await nextTick();

    expect(wrapper.find('.run-status').text()).toBe('搜索中');
    expect(wrapper.find('.ghost-button').attributes('disabled')).toBeUndefined();
    expect(secondRunSource.close).not.toHaveBeenCalled();
  });

  it('cancels the active solver worker when stopping a run', async () => {
    vi.stubGlobal('Worker', FakeToolsOutputWorker);

    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    await fillVisibleInputs(wrapper, ['7800', '1']);
    await wrapper.find('.action-button').trigger('click');
    await flushPromises();
    await nextTick();

    const worker = getLatestToolsWorker();
    const runId = worker.messages[0].runId;

    await wrapper.find('.ghost-button').trigger('click');
    await flushPromises();
    await nextTick();

    expect(worker.messages.find((message) => message.type === 'cancel')).toMatchObject({ runId });

    worker.emitSnapshot(runId, {
      rawLines: [{ text: 'late worker line', className: '' }],
      rows: [{
        id: 'late-worker',
        text: 'TotalCells=9, TotalPrice=9000, Count=1: [late-worker]',
        totalCells: 9,
        totalPrice: 9000,
        count: 1,
        combo: '[late-worker]',
      }],
      lines: [],
      statusText: '搜索中',
      statusKind: 'running',
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('.run-status').text()).toBe('已停止');
    expect(wrapper.find('.table-output').text()).not.toContain('[late-worker]');
  });

  it('falls back to renderer parsing when the solver output worker cannot be constructed', async () => {
    class BrokenWorker {
      constructor() {
        throw new Error('worker construction failed');
      }
    }

    vi.stubGlobal('Worker', BrokenWorker);

    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    await fillVisibleInputs(wrapper, ['7800', '1']);

    await expect(wrapper.find('.action-button').trigger('click')).resolves.toBeUndefined();
    await flushPromises();
    await nextTick();

    expect(getRunSources()).toHaveLength(1);

    getLatestRunSource().emit({
      type: 'out',
      text: 'Count=1, TotalPrice=7800\n  TotalCells=1, TotalPrice=7800, Count=1: [fallback]\n',
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.findAll('.result-table tbody tr')).toHaveLength(1);
    expect(wrapper.find('.result-table').text()).toContain('[fallback]');
  });

  it('restores switch values from saved state', async () => {
    window.localStorage.setItem(TOOLS_PAGE_STATE_KEY, JSON.stringify({
      activeTabId: 'count-average',
      valuesByTabId: {
        'count-average': { count: '2', avg: '7800', dedupeGoldRed: true },
      },
    }));

    const wrapper = await mountApp();

    expect(wrapper.find('.elsa-head p').text()).toBe('X件 · 平均价格');
    expect(wrapper.find('.form-grid input[type="checkbox"]').element.checked).toBe(true);
  });

  it('migrates legacy v1 Elsa tab selection to the Elsa hero tab', async () => {
    window.localStorage.setItem(LEGACY_TOOLS_PAGE_STATE_KEY, JSON.stringify({
      activeTabIndex: 9,
    }));

    const wrapper = await mountApp();

    expect(wrapper.find('.elsa-head p').text()).toBe('Elsa · 期望价值');
    expect(wrapper.find('#elsa-estimate-form').exists()).toBe(true);
    expect(wrapper.find('.action-button').exists()).toBe(false);
  });

  it('migrates legacy v1 solver state by tab order into the current Tools layout', async () => {
    window.localStorage.setItem(LEGACY_TOOLS_PAGE_STATE_KEY, JSON.stringify({
      activeTabIndex: 0,
      globalLimit: '1',
      filters: ['legacy'],
      values: [{ avg: '7800', count: '1' }],
      outputs: [[
        { text: 'TotalCells=5, TotalPrice=7800, Count=1: [legacy line]', className: '' },
      ]],
    }));

    const wrapper = await mountApp();

    expect(wrapper.find('.elsa-head p').text()).toBe('金色 · 平均价格');
    expect(wrapper.find('.limit-control input').element.value).toBe('1');
    expect(wrapper.findAll('.form-grid input')[0].element.value).toBe('7800');
    expect(wrapper.findAll('.form-grid input')[1].element.value).toBe('1');
    expect(wrapper.find('.filter-control input').element.value).toBe('legacy');
    expect(wrapper.find('.table-output').text()).toContain('legacy line');
  });

  it('runs the red average cells tab with optional count', async () => {
    const wrapper = await mountApp();
    const tabs = wrapper.findAll('.tab-button');

    await tabs[10].trigger('click');
    await nextTick();

    expect(wrapper.find('.elsa-head p').text()).toBe('红色 · 平均格数');

    const inputs = wrapper.findAll('.form-grid input');
    await inputs[0].setValue('3.5');
    await inputs[1].setValue('2');
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    expect(getRunSources()).toHaveLength(1);
    expect(getLatestRunSource()?.url).toBe('/run?script=solve-red-grid.js&args=3.5+2');
  });

  it('starts EventSource runs and renders streamed output', async () => {
    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    const inputs = wrapper.findAll('.form-grid input');

    await inputs[0].setValue('7800');
    await inputs[1].setValue('1');
    await wrapper.find('.limit-control input').setValue('1');
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    expect(getRunSources()).toHaveLength(1);
    expect(getLatestRunSource()?.url).toBe('/run?script=solve-gold-combo.js&args=7800+1&limit=1');

    const output = wrapper.find('.table-output').element;
    Object.defineProperty(output, 'scrollHeight', { value: 1000, configurable: true });
    output.scrollTop = 80;

    const runSource = getLatestRunSource();
    runSource.emit({ type: 'out', text: 'TotalCells=1, TotalPrice=7800, Count=1: [A]\n' });
    runSource.emit({ type: 'done', code: 0 });
    await nextTick();
    await nextTick();

    expect(wrapper.find('.result-table').text()).toContain('1');
    expect(wrapper.find('.result-table').text()).toContain('7800');
    expect(wrapper.find('.run-status').text()).toBe('搜索完毕');
    expect(runSource.close).toHaveBeenCalled();
    expect(output.scrollTop).toBe(80);
  });

  it('renders gold average price results as a table', async () => {
    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    const inputs = wrapper.findAll('.form-grid input');

    await inputs[0].setValue('7800');
    await inputs[1].setValue('1');
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    const runSource = getLatestRunSource();
    runSource.emit({
      type: 'out',
      text: 'Count=1, TotalPrice=7800\n  TotalCells=1, TotalPrice=7800, Count=1: [金色藏品(1x1)]\n',
    });
    runSource.emit({ type: 'done', code: 0 });
    await nextTick();
    await nextTick();

    expect(wrapper.find('.result-table').exists()).toBe(true);
    expect(wrapper.find('.output').exists()).toBe(false);

    const headers = wrapper.findAll('.result-table th').map(header => header.text());
    expect(headers).toEqual(['Count', 'TotalCells', 'TotalPrice', '组合']);
    expect(wrapper.findAll('.result-table th').slice(0, 3).every(header =>
      header.classes().includes('sortable-header')
    )).toBe(true);
    expect(wrapper.findAll('.result-table th')[3].classes()).not.toContain('sortable-header');

    const cells = wrapper.findAll('.result-table tbody td').map(cell => cell.text());
    expect(cells).toEqual(['1', '1', '7800', '[金色藏品(1x1)]']);
    expect(wrapper.find('.run-status').text()).toBe('搜索完毕');
  });

  it('sorts gold average price table results by numeric columns', async () => {
    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    const inputs = wrapper.findAll('.form-grid input');

    await inputs[0].setValue('7800');
    await inputs[1].setValue('2');
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    getLatestRunSource().emit({
      type: 'out',
      text: [
        'Count=2, TotalPrice=15600',
        '  TotalCells=5, TotalPrice=15600, Count=2: [B]',
        '  TotalCells=3, TotalPrice=15600, Count=2: [A]',
        '  TotalCells=7, TotalPrice=15600, Count=2: [C]',
        '',
      ].join('\n'),
    });
    await nextTick();
    await nextTick();

    const getTotalCells = () => wrapper.findAll('.result-table tbody tr')
      .map(row => row.findAll('td')[1].text());

    expect(getTotalCells()).toEqual(['5', '3', '7']);

    await wrapper.findAll('.result-table th button')[1].trigger('click');
    await nextTick();
    expect(getTotalCells()).toEqual(['3', '5', '7']);

    await wrapper.findAll('.result-table th button')[1].trigger('click');
    await nextTick();
    expect(getTotalCells()).toEqual(['7', '5', '3']);
  });

  it('keeps a font-independent theme icon when switching language', async () => {
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

  it('marks theme changes so color transitions can be suppressed', async () => {
    window.localStorage.setItem('bidking-theme', 'light');
    const wrapper = await mountApp();

    expect(document.documentElement.dataset.themeSwitching).toBeUndefined();

    await wrapper.find('.theme-toggle').trigger('click');
    await nextTick();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeSwitching).toBe('true');
  });

  it('keeps table status outside the result table and hides empty count lines', async () => {
    const wrapper = await mountApp();
    await selectTab(wrapper, 4);
    const inputs = wrapper.findAll('.form-grid input');

    await inputs[0].setValue('7800');
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    expect(wrapper.find('.run-status').text()).toBe('搜索中');

    getLatestRunSource().emit({
      type: 'out',
      text: [
        'Count=1, TotalPrice=7800',
        '  (no combination found)',
        'Count=2, TotalPrice=15600',
        '  TotalCells=5, TotalPrice=15600, Count=2: [B]',
        '',
      ].join('\n'),
    });
    await nextTick();
    await nextTick();

    expect(wrapper.find('.table-output').text()).not.toContain('no combination found');
    expect(wrapper.find('.table-output').text()).not.toContain('搜索中');
    expect(wrapper.find('.table-output').text()).not.toContain('已停止');

    await wrapper.find('.ghost-button').trigger('click');
    await nextTick();

    expect(wrapper.find('.run-status').text()).toBe('已停止');
    expect(wrapper.find('.table-output').text()).not.toContain('已停止');
  });

  it('switches Tools chrome and table UI to English without translating solver category args', async () => {
    window.localStorage.setItem('bidking-locale', 'en-US');
    const wrapper = await mountApp();

    expect(document.documentElement.lang).toBe('en-US');
    expect(wrapper.find('h1').text()).toBe('Tools Calculator');
    expect(wrapper.find('.elsa-head p').text()).toBe('Elsa · Expected Value');
    await selectTab(wrapper, 4);
    expect(wrapper.find('.elsa-head p').text()).toBe('Gold · Average Price');
    expect(wrapper.find('.action-button').text()).toBe('Calculate');
    expect(wrapper.find('.ghost-button').text()).toBe('Stop');

    await selectTab(wrapper, 11);
    expect(wrapper.find('.elsa-head p').text()).toBe('Category · Average Price');
    expect(wrapper.find('.form-grid select option').text()).toBe('Household');

    const inputs = wrapper.findAll('.form-grid input');
    await inputs[0].setValue('12222');
    await inputs[1].setValue('5');
    await wrapper.find('.action-button').trigger('click');
    await nextTick();

    expect(getLatestRunSource()?.url)
      .toBe('/run?script=solve-type-combo.js&args=%E5%AE%B6%E5%B1%85%E6%97%A5%E7%94%A8+12222+5');
    expect(wrapper.find('.run-status').text()).toBe('Searching');

    getLatestRunSource().emit({
      type: 'out',
      text: '  TotalCells=15, TotalPrice=61110, Count=5: [数据线(160 1x1)]\n',
    });
    getLatestRunSource().emit({ type: 'done', code: 0 });
    await nextTick();
    await nextTick();

    expect(wrapper.findAll('.result-table th').map(header => header.text()))
      .toEqual(['Count', 'TotalCells', 'TotalPrice', 'Combination']);
    expect(wrapper.find('.run-status').text()).toBe('Done');
  });

  for (const tableCase of [
    { index: 5, title: '金色 · 总价格', values: ['15600'] },
    { index: 6, title: '金色 · 平均格数', values: ['3.5', '2'] },
    { index: 7, title: '紫色 · 平均格数', values: ['3.5', '2'] },
    { index: 8, title: '紫色 · 平均价格', values: ['7800', '2'] },
    { index: 9, title: '紫色 · 总价格', values: ['10380'] },
    { index: 10, title: '红色 · 平均格数', values: ['3.5', '2'] },
    { index: 11, title: '类目 · 平均价格', values: ['7800', '2'] },
    { index: 12, title: 'X件 · 平均价格', values: ['2', '7800'] },
  ]) {
    it(`renders ${tableCase.title} results with the shared table layout`, async () => {
      const wrapper = await mountApp();

      await selectTab(wrapper, tableCase.index);
      await fillVisibleInputs(wrapper, tableCase.values);
      await wrapper.find('.action-button').trigger('click');
      await nextTick();

      getLatestRunSource().emit({
        type: 'out',
        text: [
          'Count=2, TotalPrice=15600',
          `  TotalCells=5, TotalPrice=15600, Count=2: [${tableCase.title}结果]`,
          '',
        ].join('\n'),
      });
      getLatestRunSource().emit({ type: 'done', code: 0 });
      await nextTick();
      await nextTick();

      expect(wrapper.find('.result-table').exists()).toBe(true);
      expect(wrapper.find('.output').exists()).toBe(false);
      expect(wrapper.find('.result-table').text()).toContain(tableCase.title);
      expect(wrapper.find('.run-status').text()).toBe('搜索完毕');
    });
  }

  it('restores saved tab state and output filters', async () => {
    window.localStorage.setItem(TOOLS_PAGE_STATE_KEY, JSON.stringify({
      activeTabId: 'gold-total',
      globalLimit: '1',
      filtersByTabId: {
        'gold-total': 'done',
      },
      valuesByTabId: {
        'gold-total': { total: '15345' },
      },
      outputsByTabId: {
        'gold-total': [
          { text: 'TotalCells=5, TotalPrice=15345, Count=1: [done line]', className: '' },
          { text: 'TotalCells=7, TotalPrice=15345, Count=1: [hidden line]', className: '' },
        ],
      },
    }));

    const wrapper = await mountApp();

    expect(wrapper.find('.elsa-head p').text()).toBe('金色 · 总价格');
    expect(wrapper.find('.limit-control input').element.value).toBe('1');
    expect(wrapper.find('.form-grid input').element.value).toBe('15345');
    expect(wrapper.find('.filter-control input').element.value).toBe('done');
    expect(wrapper.find('.table-output').text()).toContain('done line');
    expect(wrapper.find('.table-output').text()).not.toContain('hidden line');
  });

  describe('minimum cells debugger tab', () => {
    const DEBUGGER_HISTORY_KEY = 'bidking-tools-min-cells-debugger-history:v1';

    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    function mountDebuggerApp() {
      return mount(App, {
        attachTo: document.body,
        global: {
          stubs: {
            TopBar: { template: '<header class="topbar-stub"></header>' },
            ElsaHeroPanel: { template: '<div class="elsa-hero-stub">Elsa Panel</div>' },
            EthanHeroPanel: { template: '<div class="ethan-hero-stub">Ethan Panel</div>' },
            AhmedPanel: { template: '<div class="ahmed-stub">Ahmed Panel</div>' },
            ToolsMinimumCellsDebuggerPanel: false,
          },
        },
      });
    }

    it('renders the debugger tab button in the Tools tab list', () => {
      const wrapper = mountDebuggerApp();
      const buttons = wrapper.findAll('.tab-button');
      const debuggerButton = buttons.find((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
      expect(debuggerButton).toBeTruthy();
      mountedWrappers.push(wrapper);
    });

    it('switches to the debugger tab and renders the matrix', async () => {
      const wrapper = mountDebuggerApp();
      mountedWrappers.push(wrapper);
      const buttons = wrapper.findAll('.tab-button');
      const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
      expect(tabButtons.length).toBeGreaterThan(0);
      await tabButtons[0].trigger('click');
      await nextTick();
      // Matrix should be visible
      expect(wrapper.find('.debugger-matrix').exists()).toBe(true);
      // Cell count should be 43*10 = 430
      expect(wrapper.findAll('.debugger-cell').length).toBe(430);
    });

    it('shows validation message when calculating with no outlines', async () => {
      const wrapper = mountDebuggerApp();
      mountedWrappers.push(wrapper);
      const buttons = wrapper.findAll('.tab-button');
      const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
      await tabButtons[0].trigger('click');
      await nextTick();
      // Click Calculate without adding outlines
      const calculateBtn = wrapper.find('.debugger-actions .action-button');
      await calculateBtn.trigger('click');
      await nextTick();
      // Validation message should appear
      expect(wrapper.find('.debugger-validation').exists()).toBe(true);
    });

    it('adds an outline via drag simulation, calculates, and shows result', async () => {
      const wrapper = mountDebuggerApp();
      mountedWrappers.push(wrapper);
      const buttons = wrapper.findAll('.tab-button');
      const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
      await tabButtons[0].trigger('click');
      await nextTick();

      // Access the panel component's exposed composable methods to bypass
      // happy-dom PointerEvent limitations. The panel exposes addOutlineFromDrag,
      // calculate, outlines, result, and history via defineExpose.
      const panel = wrapper.findComponent({ name: 'ToolsMinimumCellsDebuggerPanel' });
      panel.vm.addOutlineFromDrag(0, 0, 1, 1);
      await nextTick();

      // An outline should be created (2×2 at boxId 1)
      expect(wrapper.findAll('.debugger-outline-item').length).toBe(1);

      // Calculate
      const calculateBtn = wrapper.find('.debugger-actions .action-button');
      await calculateBtn.trigger('click');
      await nextTick();

      // Result should be displayed
      expect(wrapper.find('.debugger-result').exists()).toBe(true);
    });

    it('persists calculation to history in local storage', async () => {
      const wrapper = mountDebuggerApp();
      mountedWrappers.push(wrapper);
      const buttons = wrapper.findAll('.tab-button');
      const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
      await tabButtons[0].trigger('click');
      await nextTick();

      // Add outline and calculate
      const panel = wrapper.findComponent({ name: 'ToolsMinimumCellsDebuggerPanel' });
      panel.vm.addOutlineFromDrag(0, 0, 1, 1);
      await nextTick();

      const calculateBtn = wrapper.find('.debugger-actions .action-button');
      await calculateBtn.trigger('click');
      await nextTick();

      // History should be written to localStorage
      const raw = localStorage.getItem(DEBUGGER_HISTORY_KEY);
      expect(raw).toBeTruthy();
      const history = JSON.parse(raw);
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].outlines).toBeDefined();
      expect(history[0].result).toBeDefined();
    });

    it('debugger history survives leave-tools cache clearing', () => {
      // Pre-populate debugger history in storage
      const entry = {
        id: 'test-entry',
        createdAt: new Date().toISOString(),
        version: 1,
        grid: { rows: 43, columns: 10 },
        outlines: [],
        result: null,
        summary: 'test',
      };
      localStorage.setItem(DEBUGGER_HISTORY_KEY, JSON.stringify([entry]));

      // Dispatch leave-tools event (the same event TopBar dispatches)
      window.dispatchEvent(new CustomEvent('bidking:leave-tools'));

      // Debugger history key should NOT be cleared
      const raw = localStorage.getItem(DEBUGGER_HISTORY_KEY);
      expect(raw).toBeTruthy();
      const history = JSON.parse(raw);
      expect(history.length).toBe(1);
      expect(history[0].id).toBe('test-entry');

      // Tools page state keys SHOULD be cleared
      expect(localStorage.getItem('bidking-page-state:v2:elsa')).toBeNull();
    });

    it('history entry can be restored into the matrix', async () => {
      // Pre-populate with a known history entry
      const entry = {
        id: 'hist-restore-test',
        createdAt: new Date().toISOString(),
        version: 1,
        grid: { rows: 43, columns: 10 },
        outlines: [
          { boxId: 5, width: 2, height: 2, cells: [5, 6, 15, 16] },
        ],
        result: { valid: true, minTotalCells: 4, knownOutlineCellCount: 4, unknownBlockingCellCount: 0, unknownBlockingCells: [], order: [5], holeCells: [] },
        summary: '1 items / 4 known cells / min 4',
      };
      localStorage.setItem(DEBUGGER_HISTORY_KEY, JSON.stringify([entry]));

      const wrapper = mountDebuggerApp();
      mountedWrappers.push(wrapper);
      const buttons = wrapper.findAll('.tab-button');
      const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
      await tabButtons[0].trigger('click');
      await nextTick();

      // Should see the history entry
      const historyItems = wrapper.findAll('.debugger-history-item');
      expect(historyItems.length).toBe(1);

      // Click Restore
      const restoreBtn = historyItems[0].find('.debugger-history-actions button:first-child');
      await restoreBtn.trigger('click');
      await nextTick();

      // Outline should appear in the matrix
      expect(wrapper.findAll('.debugger-outline-item').length).toBe(1);
    });

    it('debugger labels render translated text, not raw i18n keys', async () => {
      const wrapper = mountDebuggerApp();
      mountedWrappers.push(wrapper);
      const buttons = wrapper.findAll('.tab-button');
      const tabButtons = buttons.filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
      await tabButtons[0].trigger('click');
      await nextTick();

      // The heading should not show the raw key
      const heading = wrapper.find('.debugger-head h2');
      expect(heading.text()).not.toBe('tools.debugger.title');
      // The calculate button should show text, not a key
      const calcBtn = wrapper.find('.debugger-actions .action-button');
      expect(calcBtn.text()).not.toBe('tools.debugger.calculate');
      // The empty-outlines message should show text, not a key
      const emptyMsg = wrapper.find('.debugger-outlines .debugger-empty');
      expect(emptyMsg.text()).not.toBe('tools.debugger.noOutlines');
    });
  });
});
