/* @vitest-environment happy-dom */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import HeroEstimatorPanel from './HeroEstimatorPanel.vue';
import { elsaProfile, ethanProfile } from './hero-profiles.js';
import { elsaAutoBidKnownQualityKeys, elsaExpectedPrice } from '../elsa/elsaEstimateState.js';
import { __resetMonitorSwitchRuntimeForTest } from '../shared/useMonitorSwitch.js';
import {
  appendStreamRunSource,
  calculateEstimationResult,
  createStreamRun,
  finishStreamRun,
} from '../ethan/estimation-worker-core.js';

const require = createRequire(import.meta.url);
const { buildBidKingMonitorFacts } = require('../../lib/bidking-monitor-facts.js');
const {
  applyBidKingMonitorFacts,
  createEmptyBidKingMonitorState,
} = require('../../lib/bidking-monitor-store.js');
const realAveragePrices = JSON.parse(fs.readFileSync('public/data/quality-size-average-prices.json', 'utf8'));
const realCollectibles = JSON.parse(fs.readFileSync('public/data/collectibles.json', 'utf8'));
let mountedWrappers = [];

class FakeEventSource {
  constructor(url) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close = vi.fn();
  listeners = new Map();

  addEventListener = vi.fn((type, listener) => {
    this.listeners.set(type, listener);
  });

  emitEvent(type, message) {
    this.listeners.get(type)?.({ data: JSON.stringify(message) });
  }

  static reset() {
    FakeEventSource.instances = [];
  }
}

FakeEventSource.instances = [];

class FakeEstimationWorker {
  constructor() {
    FakeEstimationWorker.starts += 1;
    FakeEstimationWorker.instances.push(this);
    this.onmessage = null;
    this.onerror = null;
  }

  terminate = vi.fn();

  postMessage(message) {
    FakeEstimationWorker.messages.push(JSON.parse(JSON.stringify(message)));
    queueMicrotask(() => {
      try {
        if (message?.type === 'start-stream-run') {
          FakeEstimationWorker.streamRuns.set(message.runId, createStreamRun(message));
          return;
        }

        if (message?.type === 'append-source') {
          if (FakeEstimationWorker.failOnAppend) {
            this.onerror?.({ message: 'stream worker failed' });
            return;
          }
          const streamRun = FakeEstimationWorker.streamRuns.get(message.runId);
          if (!streamRun) return;
          const rows = appendStreamRunSource(streamRun, String(message.text ?? ''));
          rows.forEach((row, index) => {
            this.onmessage?.({
              data: {
                type: 'stream-row',
                runId: message.runId,
                streamMode: streamRun.streamMode,
                groupKey: streamRun.config.groupKey,
                count: streamRun.rows.length - rows.length + index + 1,
                row,
              },
            });
          });
          return;
        }

        if (message?.type === 'finish-stream-run') {
          const streamRun = FakeEstimationWorker.streamRuns.get(message.runId);
          if (!streamRun) return;
          const result = finishStreamRun(streamRun, message.reason);
          if (result.finalRow) {
            this.onmessage?.({
              data: {
                type: 'stream-row',
                runId: message.runId,
                streamMode: streamRun.streamMode,
                groupKey: streamRun.config.groupKey,
                count: streamRun.rows.length,
                row: result.finalRow,
              },
            });
          }
          this.onmessage?.({
            data: {
              type: 'stream-complete',
              runId: message.runId,
              ...result,
            },
          });
          this.onmessage?.({ data: { type: 'done', runId: message.runId } });
          FakeEstimationWorker.streamRuns.delete(message.runId);
          return;
        }

        if (message?.type === 'cancel') {
          FakeEstimationWorker.streamRuns.delete(message.runId);
          return;
        }

        const result = calculateEstimationResult(message);
        if (result.type === 'combined' || result.type === 'single') {
          const { type: mode, rows, ...startPayload } = result;
          this.onmessage?.({ data: { type: 'start', runId: message.runId, mode, ...startPayload, count: rows.length } });
          rows.forEach((row, index) => {
            this.onmessage?.({
              data: {
                type: 'row',
                runId: message.runId,
                mode,
                index: index + 1,
                groupKeys: result.groupKeys,
                groupKey: result.groupKey,
                ...row,
              },
            });
          });
          this.onmessage?.({ data: { type: 'done', runId: message.runId } });
          return;
        }

        this.onmessage?.({ data: { type: 'result', runId: message.runId, result } });
        this.onmessage?.({ data: { type: 'done', runId: message.runId } });
      } catch (error) {
        this.onerror?.(error);
      }
    });
  }

  static reset() {
    FakeEstimationWorker.starts = 0;
    FakeEstimationWorker.messages = [];
    FakeEstimationWorker.instances = [];
    FakeEstimationWorker.streamRuns = new Map();
    FakeEstimationWorker.failOnAppend = false;
  }
}

FakeEstimationWorker.starts = 0;
FakeEstimationWorker.messages = [];
FakeEstimationWorker.instances = [];
FakeEstimationWorker.streamRuns = new Map();
FakeEstimationWorker.failOnAppend = false;

function getRunSources() {
  return FakeEventSource.instances.filter((source) => String(source.url).startsWith('/run?'));
}

function getLatestRunSource() {
  const runSources = getRunSources();
  return runSources[runSources.length - 1] || null;
}

function getLatestEstimationWorker() {
  return FakeEstimationWorker.instances[FakeEstimationWorker.instances.length - 1] || null;
}

async function settleWorkerStream() {
  await flushPromises();
  await nextTick();
  await flushPromises();
  await nextTick();
}

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url) === '/api/bidking-monitor/status') {
      return { ok: true, json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }) };
    }
    return {
      ok: true,
      json: async () => String(url).includes('/data/collectibles.json') ? realCollectibles : realAveragePrices,
    };
  }));
}

function createLegacyEnrichedMonitorPayload(rawEvent, { stripProfileId = false } = {}) {
  const facts = buildBidKingMonitorFacts(rawEvent);
  const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), facts);
  const nextState = stripProfileId
    ? Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'profileId'))
    : state;
  return {
    ...rawEvent,
    rawEvent,
    facts,
    state: nextState,
  };
}

describe('HeroEstimatorPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    elsaExpectedPrice.value = 0;
    elsaAutoBidKnownQualityKeys.value = [];
    FakeEventSource.reset();
    FakeEstimationWorker.reset();
    mockFetch();
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    mountedWrappers.forEach((wrapper) => wrapper.unmount());
    mountedWrappers = [];
    __resetMonitorSwitchRuntimeForTest();
    vi.unstubAllGlobals();
  });

  it('renders Ethan groups in page mode', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    expect(wrapper.find('h1').text()).toBe('期望价值估算');
    expect(wrapper.find('#cells-wg').exists()).toBe(true);
    expect(wrapper.find('#cells-blue').exists()).toBe(true);
    expect(wrapper.find('#ethan-monitor-board').exists()).toBe(true);
  });

  it('does not render the old local monitor switch in Ethan page mode', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    expect(wrapper.find('#ethan-monitor-switch').exists()).toBe(false);
    expect(wrapper.find('#ethan-monitor-board').exists()).toBe(true);
  });

  it('renders Elsa groups in embedded mode with prefixed ids', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    expect(wrapper.find('.topbar').exists()).toBe(false);
    expect(wrapper.find('h1').text()).toBe('Elsa 期望价值估算');
    expect(wrapper.find('#elsa-cells-white').exists()).toBe(true);
    expect(wrapper.find('#elsa-cells-green').exists()).toBe(true);
    expect(wrapper.find('#elsa-monitor-board').exists()).toBe(true);
  });

  it('renders the before-monitor slot ahead of the live monitor panel', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      slots: {
        'before-monitor': '<div data-testid="before-monitor-slot">Before monitor</div>',
      },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const slotEl = wrapper.find('[data-testid="before-monitor-slot"]');
    const monitorEl = wrapper.find('.live-monitor-panel');

    expect(slotEl.exists()).toBe(true);
    expect(monitorEl.exists()).toBe(true);
    expect(slotEl.element.compareDocumentPosition(monitorEl.element) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('normalizes Elsa auto-derived total cells to the nearest feasible value and reuses that value for estimation', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-nearest-total-cells-hero',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-nearest-total-cells-hero-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: '11', itemQuility: 1, itemQuilityName: '白' },
          { boxId: 20, itemSlotType: '11', itemQuility: 1, itemQuilityName: '白' },
          { boxId: 40, itemSlotType: '24', itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    monitorSource.emitEvent('event', {
      key: 'elsa-nearest-total-cells-map',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'elsa-nearest-total-cells-map-skill',
        skillCid: 200014,
        allHitItemAvgBoxIndex: 2.5,
      },
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-total-cells-all').element.value).toBe('50');

    await wrapper.find('#elsa-cells-white').setValue('2');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const workerStart = FakeEstimationWorker.messages.filter((message) => message.type === 'start').at(-1);
    expect(workerStart?.state?.totalCells).toBe(50);
    expect(wrapper.find('#elsa-result-meta').classes()).not.toContain('status-error');
  });

  it('keeps the translated optional placeholder when Elsa has no monitor-derived total cells', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    expect(wrapper.find('#elsa-total-cells-all').attributes('placeholder')).toBe('可选');
  });

  it('keeps an already feasible Elsa monitor-derived total unchanged', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-feasible-total-cells-hero',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-feasible-total-cells-hero-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: '11', itemQuility: 1, itemQuilityName: '白' },
          { boxId: 20, itemSlotType: '11', itemQuility: 1, itemQuilityName: '白' },
          { boxId: 40, itemSlotType: '24', itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    monitorSource.emitEvent('event', {
      key: 'elsa-feasible-total-cells-map',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'elsa-feasible-total-cells-map-skill',
        skillCid: 200014,
        allHitItemAvgBoxIndex: 3,
      },
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-total-cells-all').element.value).toBe('48');
  });

  it('boots the shared estimation worker for Elsa and keeps Elsa totals correct', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-cells-white').setValue('2');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await flushPromises();
    await nextTick();

    expect(FakeEstimationWorker.starts).toBe(1);
    expect(wrapper.find('#elsa-total-estimate').text()).toBe('2,872');
  });

  it('ignores raw Elsa hero events on the Ethan profile', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-hero-raw-event',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-hero-raw-event-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 15, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(0);
  });

  it('does not run prediction estimation on the main thread when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('120');
    await wrapper.find('#avg-purple').setValue('3');
    await wrapper.find('#avg-orange').setValue('2.5');

    await wrapper.find('#estimate-form').trigger('submit');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('#result-meta').text()).toContain('当前环境不支持后台估值计算');
    expect(wrapper.find('#result-body').text()).toContain('无法估算');
    expect(wrapper.find('#result-body').text()).not.toContain('方案 1');
  });

  it('keeps Ethan direct estimation available without Worker when all prediction groups have explicit cells', async () => {
    vi.stubGlobal('Worker', undefined);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('20');
    await wrapper.find('#cells-purple').setValue('7');
    await wrapper.find('#cells-orange').setValue('5');

    await wrapper.find('#estimate-form').trigger('submit');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('#result-meta').text()).not.toContain('当前环境不支持后台估值计算');
    expect(wrapper.find('#total-estimate').text()).not.toBe('-');
  });

  it('shows formula pricing for prediction groups with priceAverage when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('7');
    await wrapper.find('#cells-purple').setValue('7');
    await wrapper.find('#price-purple').setValue('6800');

    await wrapper.find('#estimate-form').trigger('submit');
    await flushPromises();
    await nextTick();

    // Prediction groups (purple) no longer trigger the "needs Worker" gate;
    // runEstimationSync skips them so formula pricing is shown directly.
    expect(wrapper.find('#result-meta').text()).not.toContain('补充件数');
    expect(wrapper.find('#total-estimate').text()).toBe('17,374');
  });

  it('skips price-only stream search when an earlier prediction group also lacks cells', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    // Fill total cells
    await wrapper.find('#total-cells-all').setValue('120');
    // Fill purple avg only (cells empty)
    await wrapper.find('#avg-purple').setValue('3');
    // Fill orange priceAverage only (avg and cells empty)
    await wrapper.find('#price-orange').setValue('20000');

    await wrapper.find('#estimate-form').trigger('submit');
    await flushPromises();
    await nextTick();

    // The price-only stream search for orange should NOT have started
    // because purple (an earlier prediction group) also lacks cells.
    const runSources = getRunSources();
    const priceStreamSources = runSources.filter(
      (source) => String(source.url).includes('solve-gold-combo.js')
    );
    expect(priceStreamSources.length).toBe(0);

    // Purple individual predictions should be shown (not combined).
    const metaEl = wrapper.find('#result-meta');
    expect(metaEl.exists()).toBe(true);
    expect(metaEl.text()).not.toContain('、');
    expect(metaEl.text()).toContain('紫');
  });

  it('ignores Elsa hero events on the Ethan profile when the payload falls back to profile-less legacy state', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', createLegacyEnrichedMonitorPayload({
      key: 'elsa-hero-legacy-event',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-hero-legacy-event-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 15, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    }, { stripProfileId: true }));
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(0);
  });

  it('ignores raw Ethan hero events on the Elsa profile', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'ethan-hero-raw-event',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'ethan-hero-raw-event-skill',
        skillCid: 1002081,
        hitBoxList: [
          { boxId: 10, itemSlotType: 11 },
        ],
      },
    });
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(0);
  });

  it('colors Elsa outlines from quality ids even when hero payload omits itemQuilityName', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-id-only-quality',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-id-only-quality-skill',
        heroCid: 103,
        skillCid: 1001033,
        hitBoxList: [
          { boxId: 10, itemSlotType: 11, itemQuility: 2 },
        ],
      },
    });
    await nextTick();

    const outline = wrapper.find('.monitor-outline');
    expect(outline.exists()).toBe(true);
    expect(outline.classes()).toContain('quality-green');
    expect(outline.classes()).not.toContain('quality-unknown');
    expect(outline.attributes('data-outline-quality')).toBe('绿');
  });

  it('ignores same-game Ethan hero follow-up packets after Elsa has latched the current match', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-latch-event',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-latch-event-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);

    monitorSource.emitEvent('event', {
      key: 'ethan-follow-up-event',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'ethan-follow-up-event-skill',
        skillCid: 1002082,
        hitBoxList: [
          { boxId: 30, itemSlotType: 11 },
        ],
      },
    });
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);
  });

  it('ignores same-game unknown hero follow-up packets after Elsa has latched the current match', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-latch-unknown-hero',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-latch-unknown-hero-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);

    monitorSource.emitEvent('event', {
      key: 'unknown-hero-follow-up-event',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'unknown-hero-follow-up-event-skill',
        skillCid: 999999,
        hitBoxList: [
          { boxId: 40, itemSlotType: 11 },
        ],
      },
    });
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);
  });

  it('still accepts same-game generic map events after Elsa has latched the current match', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-latch-map-acceptance',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-latch-map-acceptance-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    await nextTick();

    monitorSource.emitEvent('event', {
      key: 'same-game-map-event',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'same-game-map-event-skill',
        skillCid: 200011,
        totalHitBoxIndex: 6,
      },
    });
    await nextTick();

    expect(wrapper.find('#elsa-cells-orange').attributes('placeholder')).toBe('6');
  });

  it('shows a zero white placeholder when Elsa white complete reveal hits an empty result set', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-empty-white-complete-reveal',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-empty-white-complete-reveal-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [],
      },
    });
    await nextTick();

    expect(wrapper.find('#elsa-cells-white').attributes('placeholder')).toBe('0');
    expect(wrapper.findAll('.monitor-outline')).toHaveLength(0);
  });

  it('does not restore Elsa results derived from monitor total-cells placeholder after remount without fresh monitor context', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-global-remount-hero',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-global-remount-hero-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 1, itemSlotType: 22, itemQuility: 1, itemQuilityName: '白' },
          { boxId: 3, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
          { boxId: 4, itemSlotType: 22, itemQuility: 1, itemQuilityName: '白' },
          { boxId: 20, itemSlotType: 51, itemQuility: 1, itemQuilityName: '白' },
          { boxId: 25, itemSlotType: 51, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-total-cells-all').element.value).toBe('');
    expect(wrapper.find('#elsa-total-cells-all').attributes('placeholder')).toBe('30');

    await wrapper.find('#elsa-cells-white').setValue('5');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const savedState = JSON.parse(window.localStorage.getItem(elsaProfile.storageKey));
    const previousMeta = wrapper.find('#elsa-result-meta').text();

    expect(savedState?.hasCalculated).toBe(false);
    expect(wrapper.find('#elsa-total-estimate').text()).not.toBe('-');
    expect(previousMeta).not.toBe('等待输入');

    wrapper.unmount();
    mountedWrappers = mountedWrappers.filter((item) => item !== wrapper);

    const remountedWrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(remountedWrapper);
    await flushPromises();
    await nextTick();

    expect(remountedWrapper.findAll('.monitor-outline')).toHaveLength(0);
    expect(remountedWrapper.find('#elsa-total-cells-all').element.value).toBe('');
    expect(remountedWrapper.find('#elsa-total-cells-all').attributes('placeholder')).not.toBe('30');
    expect(remountedWrapper.find('#elsa-result-body .empty').exists()).toBe(true);
    expect(remountedWrapper.find('#elsa-total-estimate').text()).toBe('-');
    expect(remountedWrapper.find('#elsa-result-meta').text()).not.toBe(previousMeta);
  });

  it('does not restore Elsa results derived from monitor total-average placeholder after remount without fresh monitor context', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-total-average-remount-hero',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-total-average-remount-hero-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    monitorSource.emitEvent('event', {
      key: 'elsa-total-average-remount-map',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'elsa-total-average-remount-map-skill',
        skillCid: 200014,
        allHitItemAvgBoxIndex: 1.75,
      },
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-avg-all').element.value).toBe('');
    expect(wrapper.find('#elsa-avg-all').attributes('placeholder')).toBe('1.75');

    await wrapper.find('#elsa-total-cells-all').setValue('7');
    await wrapper.find('#elsa-cells-white').setValue('2');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const savedState = JSON.parse(window.localStorage.getItem(elsaProfile.storageKey));
    const previousMeta = wrapper.find('#elsa-result-meta').text();

    expect(savedState?.hasCalculated).toBe(false);
    expect(wrapper.find('#elsa-total-estimate').text()).not.toBe('-');
    expect(previousMeta).not.toBe('等待输入');

    wrapper.unmount();
    mountedWrappers = mountedWrappers.filter((item) => item !== wrapper);

    const remountedWrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(remountedWrapper);
    await flushPromises();
    await nextTick();

    expect(remountedWrapper.findAll('.monitor-outline')).toHaveLength(0);
    expect(remountedWrapper.find('#elsa-total-cells-all').element.value).toBe('7');
    expect(remountedWrapper.find('#elsa-avg-all').element.value).toBe('');
    expect(remountedWrapper.find('#elsa-avg-all').attributes('placeholder')).not.toBe('1.75');
    expect(remountedWrapper.find('#elsa-cells-white').element.value).toBe('2');
    expect(remountedWrapper.find('#elsa-result-body .empty').exists()).toBe(true);
    expect(remountedWrapper.find('#elsa-total-estimate').text()).toBe('-');
    expect(remountedWrapper.find('#elsa-result-meta').text()).not.toBe(previousMeta);
  });

  it('does not restore placeholder-derived Elsa results after remount without fresh monitor context', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-remount-hero',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-remount-hero-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    monitorSource.emitEvent('event', {
      key: 'elsa-remount-map',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'elsa-remount-map-skill',
        skillCid: 200011,
        totalHitBoxIndex: 6,
      },
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-cells-orange').attributes('placeholder')).toBe('6');

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-cells-white').setValue('2');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const savedState = JSON.parse(window.localStorage.getItem(elsaProfile.storageKey));
    const previousMeta = wrapper.find('#elsa-result-meta').text();

    expect(savedState?.hasCalculated).toBe(false);
    expect(wrapper.findAll('#elsa-result-body tr').length).toBeGreaterThan(0);
    expect(wrapper.find('#elsa-total-estimate').text()).not.toBe('-');
    expect(previousMeta).not.toBe('数据已加载');

    wrapper.unmount();
    mountedWrappers = mountedWrappers.filter((item) => item !== wrapper);

    const remountedWrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(remountedWrapper);
    await flushPromises();
    await nextTick();

    expect(remountedWrapper.findAll('.monitor-outline')).toHaveLength(0);
    expect(remountedWrapper.find('#elsa-total-cells-all').element.value).toBe('10');
    expect(remountedWrapper.find('#elsa-cells-white').element.value).toBe('2');
    expect(remountedWrapper.find('#elsa-cells-orange').element.value).toBe('');
    expect(remountedWrapper.find('#elsa-cells-orange').attributes('placeholder')).not.toBe('6');
    expect(remountedWrapper.find('#elsa-result-body .empty').exists()).toBe(true);
    expect(remountedWrapper.find('#elsa-total-estimate').text()).toBe('-');
    expect(remountedWrapper.find('#elsa-result-meta').text()).not.toBe(previousMeta);
  });

  it('restores pure user-entered Elsa validation errors after remount', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('abc');
    await wrapper.find('#elsa-cells-white').setValue('2');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const previousMeta = wrapper.find('#elsa-result-meta').text();

    expect(previousMeta).toContain('不是有效数字');
    expect(wrapper.find('#elsa-result-meta').classes()).toContain('status-error');
    expect(wrapper.find('#elsa-result-body .empty').text()).toBe('无法估算');
    expect(wrapper.find('#elsa-total-estimate').text()).toBe('-');

    wrapper.unmount();
    mountedWrappers = mountedWrappers.filter((item) => item !== wrapper);

    const remountedWrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(remountedWrapper);
    await flushPromises();
    await nextTick();

    expect(remountedWrapper.find('#elsa-total-cells-all').element.value).toBe('abc');
    expect(remountedWrapper.find('#elsa-cells-white').element.value).toBe('2');
    expect(remountedWrapper.find('#elsa-result-meta').text()).toBe(previousMeta);
    expect(remountedWrapper.find('#elsa-result-meta').classes()).toContain('status-error');
    expect(remountedWrapper.find('#elsa-result-body .empty').text()).toBe('无法估算');
    expect(remountedWrapper.find('#elsa-total-estimate').text()).toBe('-');
  });

  it('restores pure user-entered Elsa validation errors even when unrelated monitor placeholders were present', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-validation-placeholder-hero',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-validation-placeholder-hero-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 12, itemSlotType: 11, itemQuility: 3, itemQuilityName: '蓝' },
        ],
      },
    });
    monitorSource.emitEvent('event', {
      key: 'elsa-validation-placeholder-map',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'elsa-validation-placeholder-map-skill',
        skillCid: 200011,
        totalHitBoxIndex: 6,
      },
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-cells-orange').attributes('placeholder')).toBe('6');

    await wrapper.find('#elsa-total-cells-all').setValue('abc');
    await wrapper.find('#elsa-cells-white').setValue('2');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const previousMeta = wrapper.find('#elsa-result-meta').text();

    expect(previousMeta).toContain('不是有效数字');
    expect(wrapper.find('#elsa-result-meta').classes()).toContain('status-error');

    wrapper.unmount();
    mountedWrappers = mountedWrappers.filter((item) => item !== wrapper);

    const remountedWrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(remountedWrapper);
    await flushPromises();
    await nextTick();

    expect(remountedWrapper.find('#elsa-total-cells-all').element.value).toBe('abc');
    expect(remountedWrapper.find('#elsa-cells-white').element.value).toBe('2');
    expect(remountedWrapper.find('#elsa-cells-orange').attributes('placeholder')).not.toBe('6');
    expect(remountedWrapper.find('#elsa-result-meta').text()).toBe(previousMeta);
    expect(remountedWrapper.find('#elsa-result-meta').classes()).toContain('status-error');
  });

  it('replaces a restored Elsa data-load failure banner after remount when loading succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === '/api/bidking-monitor/status') {
        return { ok: true, json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }) };
      }
      if (String(url).includes('/data/quality-size-average-prices.json')) {
        return { ok: false, status: 500, text: async () => 'broken average prices' };
      }
      return {
        ok: true,
        json: async () => realCollectibles,
      };
    }));

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await settleWorkerStream();

    const previousMeta = wrapper.find('#elsa-result-meta').text();
    expect(previousMeta).toContain('均价数据加载失败');
    expect(wrapper.find('#elsa-result-meta').classes()).toContain('status-error');

    window.dispatchEvent(new Event('pagehide'));

    wrapper.unmount();
    mountedWrappers = mountedWrappers.filter((item) => item !== wrapper);

    mockFetch();

    const remountedWrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(remountedWrapper);
    await settleWorkerStream();

    expect(remountedWrapper.find('#elsa-result-meta').text()).not.toBe(previousMeta);
    expect(remountedWrapper.find('#elsa-result-meta').text()).toBe('均价数据已加载');
    expect(remountedWrapper.find('#elsa-result-meta').classes()).not.toContain('status-error');
  });

  it('does not restore Elsa results that depended on a monitor total-cells placeholder after remount without fresh monitor context', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-monitor-validation-total-cells',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-monitor-validation-total-cells-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 1, itemSlotType: 22, itemQuility: 1, itemQuilityName: '白' },
          { boxId: 3, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
          { boxId: 4, itemSlotType: 22, itemQuility: 1, itemQuilityName: '白' },
          { boxId: 20, itemSlotType: 51, itemQuility: 1, itemQuilityName: '白' },
          { boxId: 25, itemSlotType: 51, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-total-cells-all').attributes('placeholder')).toBe('30');

    await wrapper.find('#elsa-cells-white').setValue('31');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const previousMeta = wrapper.find('#elsa-result-meta').text();

    expect(previousMeta).not.toBe('等待输入');
    expect(wrapper.find('#elsa-result-meta').classes()).not.toContain('status-error');
    expect(wrapper.find('#elsa-total-estimate').text()).not.toBe('-');

    wrapper.unmount();
    mountedWrappers = mountedWrappers.filter((item) => item !== wrapper);

    const remountedWrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(remountedWrapper);
    await settleWorkerStream();

    expect(remountedWrapper.find('#elsa-cells-white').element.value).toBe('31');
    expect(remountedWrapper.find('#elsa-total-cells-all').attributes('placeholder')).not.toBe('30');
    expect(remountedWrapper.find('#elsa-result-meta').text()).not.toBe(previousMeta);
    expect(remountedWrapper.find('#elsa-result-meta').text()).toBe('均价数据已加载');
    expect(remountedWrapper.find('#elsa-result-meta').classes()).not.toContain('status-error');
    expect(remountedWrapper.find('#elsa-result-body .empty').exists()).toBe(true);
    expect(remountedWrapper.find('#elsa-total-estimate').text()).toBe('-');
  });

  it('restores legacy explicit Elsa validation errors saved before error-kind narrowing', async () => {
    window.localStorage.setItem(elsaProfile.storageKey, JSON.stringify({
      inputs: {
        global: {
          totalCells: 'abc',
          totalAverage: '',
        },
        groups: {
          white: { avg: '', cells: '2', priceAverage: '', totalPrice: '' },
          green: { avg: '', cells: '', priceAverage: '', totalPrice: '' },
          blue: { avg: '', cells: '', priceAverage: '', totalPrice: '' },
          orange: { avg: '', cells: '', priceAverage: '', totalPrice: '' },
          red: { avg: '', cells: '', priceAverage: '', totalPrice: '' },
        },
      },
      hasCalculated: false,
      hasMonitorDerivedInputs: true,
      lastState: null,
      rows: [],
      summary: { total: null, low: null, high: null },
      meta: {
        text: '所有藏品总格数 不是有效数字',
        status: 'status-error',
        errorKind: 'validation-error',
      },
      monitorAuto: {
        gameUid: 'game-1',
      },
      savedAt: '2026-06-08T12:00:00.000Z',
    }));

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await settleWorkerStream();

    expect(wrapper.find('#elsa-total-cells-all').element.value).toBe('abc');
    expect(wrapper.find('#elsa-cells-white').element.value).toBe('2');
    expect(wrapper.find('#elsa-result-meta').text()).toBe('所有藏品总格数 不是有效数字');
    expect(wrapper.find('#elsa-result-meta').classes()).toContain('status-error');
    expect(wrapper.find('#elsa-total-estimate').text()).toBe('-');
  });

  it('restores legacy explicit Elsa validation errors saved without error-kind metadata', async () => {
    window.localStorage.setItem(elsaProfile.storageKey, JSON.stringify({
      inputs: {
        global: {
          totalCells: 'abc',
          totalAverage: '',
        },
        groups: {
          white: { avg: '', cells: '2', priceAverage: '', totalPrice: '' },
          green: { avg: '', cells: '', priceAverage: '', totalPrice: '' },
          blue: { avg: '', cells: '', priceAverage: '', totalPrice: '' },
          orange: { avg: '', cells: '', priceAverage: '', totalPrice: '' },
          red: { avg: '', cells: '', priceAverage: '', totalPrice: '' },
        },
      },
      hasCalculated: false,
      hasMonitorDerivedInputs: true,
      lastState: null,
      rows: [],
      summary: { total: null, low: null, high: null },
      meta: {
        text: '所有藏品总格数 不是有效数字',
        status: 'status-error',
      },
      monitorAuto: {
        gameUid: 'game-1',
      },
      savedAt: '2026-06-08T12:00:00.000Z',
    }));

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await settleWorkerStream();

    expect(wrapper.find('#elsa-total-cells-all').element.value).toBe('abc');
    expect(wrapper.find('#elsa-cells-white').element.value).toBe('2');
    expect(wrapper.find('#elsa-result-meta').text()).toBe('所有藏品总格数 不是有效数字');
    expect(wrapper.find('#elsa-result-meta').classes()).toContain('status-error');
    expect(wrapper.find('#elsa-result-meta').text()).not.toBe('均价数据已加载');
    expect(wrapper.find('#elsa-total-estimate').text()).toBe('-');
  });

  it('clears Elsa monitor caches on a new game and ignores late packets from the previous game', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-game-1-hero',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-game-1-hero-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    monitorSource.emitEvent('event', {
      key: 'elsa-game-1-map',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'elsa-game-1-map-skill',
        skillCid: 200011,
        totalHitBoxIndex: 6,
      },
    });
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);
    const firstGameOutlineBox = wrapper.find('.monitor-outline').attributes('data-outline-box');
    expect(wrapper.find('#elsa-cells-orange').attributes('placeholder')).toBe('6');

    monitorSource.emitEvent('event', {
      key: 'elsa-game-2-hero',
      gameUid: 'game-2',
      group: 'hero',
      skill: {
        uid: 'elsa-game-2-hero-skill',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 30, itemSlotType: 11, itemQuility: 3, itemQuilityName: '蓝' },
        ],
      },
    });
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);
    const secondGameOutlineBox = wrapper.find('.monitor-outline').attributes('data-outline-box');
    expect(secondGameOutlineBox).not.toBe(firstGameOutlineBox);
    expect(wrapper.find('#elsa-cells-orange').attributes('placeholder')).not.toBe('6');

    monitorSource.emitEvent('event', {
      key: 'elsa-game-1-late-map',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'elsa-game-1-late-map-skill',
        skillCid: 200011,
        totalHitBoxIndex: 8,
      },
    });
    await nextTick();

    expect(wrapper.findAll('.monitor-outline')).toHaveLength(1);
    expect(wrapper.find('.monitor-outline').attributes('data-outline-box')).toBe(secondGameOutlineBox);
    expect(wrapper.find('#elsa-cells-orange').attributes('placeholder')).not.toBe('8');
  });

  it('searches Elsa gold total-price candidates and renders the inferred total-cell plans', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-total-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    expect(getLatestRunSource()?.url).toBe('/run?script=solve-gold-total.js&args=25875&limit=30');
    expect(FakeEstimationWorker.messages).toContainEqual(expect.objectContaining({
      type: 'start-stream-run',
      streamMode: 'total-price',
    }));

    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({
        type: 'out',
        text: 'Count=1, TotalPrice=25875\n  TotalCells=2, TotalPrice=25875, Count=1: [候选A]\n',
      }),
    });
    await settleWorkerStream();

    expect(FakeEstimationWorker.messages).toContainEqual(expect.objectContaining({
      type: 'append-source',
      text: 'Count=1, TotalPrice=25875\n  TotalCells=2, TotalPrice=25875, Count=1: [候选A]\n',
    }));
    expect(wrapper.findAll('#elsa-result-body tr')).toHaveLength(1);

    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({
        type: 'out',
        text: '  TotalCells=4, TotalPrice=25875, Count=1: [候选B]\n',
      }),
    });
    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({ type: 'done', code: 0 }),
    });
    await settleWorkerStream();

    const rows = wrapper.findAll('#elsa-result-body tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('2');
    expect(rows[1].text()).toContain('4');
    expect(wrapper.find('#elsa-total-estimate').text()).toBe('26,867');
  });

  it('forwards Elsa price-only stream chunks to the worker and renders rows before the stream completes', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    expect(getLatestRunSource()?.url).toBe('/run?script=solve-gold-combo.js&args=25875+dedupe-total-cells&limit=30');
    expect(FakeEstimationWorker.messages).toContainEqual(expect.objectContaining({
      type: 'start-stream-run',
      streamMode: 'price-only',
    }));

    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({
        type: 'out',
        text: 'Count=1, TotalPrice=25875\n  TotalCells=2, TotalPrice=25875, Count=1: [候选A]\n',
      }),
    });
    await settleWorkerStream();

    expect(FakeEstimationWorker.messages).toContainEqual(expect.objectContaining({
      type: 'append-source',
      text: 'Count=1, TotalPrice=25875\n  TotalCells=2, TotalPrice=25875, Count=1: [候选A]\n',
    }));
    expect(wrapper.findAll('#elsa-result-body tr')).toHaveLength(1);

    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({ type: 'done', code: 0 }),
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-result-meta').text()).toContain('橙/金色平均价格搜索完成，已找到 1 个总格数结果');
  });

  it('filters Elsa gold total-price candidates by the entered gold average cells', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-avg-orange').setValue('4');
    await wrapper.find('#elsa-total-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({
        type: 'out',
        text: 'Count=1, TotalPrice=25875\n  TotalCells=2, TotalPrice=25875, Count=1: [候选A]\n  TotalCells=4, TotalPrice=25875, Count=1: [候选B]\n',
      }),
    });
    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({ type: 'done', code: 0 }),
    });
    await settleWorkerStream();

    const rows = wrapper.findAll('#elsa-result-body tr');
    expect(rows).toHaveLength(1);
    const cellsColumn = rows[0].findAll('td')[2];
    expect(cellsColumn?.text()).toBe('4');
    expect(wrapper.find('#elsa-total-estimate').text()).toBe('26,619');
  });

  it('filters Elsa gold total-price candidates by the entered gold average price', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-price-orange').setValue('25875');
    await wrapper.find('#elsa-total-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({
        type: 'out',
        text: 'Count=1, TotalPrice=25875\n  TotalCells=2, TotalPrice=25875, Count=1: [候选A]\n  TotalCells=4, TotalPrice=25875, Count=2: [候选B]\n',
      }),
    });
    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({ type: 'done', code: 0 }),
    });
    await settleWorkerStream();

    const rows = wrapper.findAll('#elsa-result-body tr');
    expect(rows).toHaveLength(1);
    const countColumn = rows[0].findAll('td')[1];
    const cellsColumn = rows[0].findAll('td')[2];
    expect(countColumn?.text()).toBe('1');
    expect(cellsColumn?.text()).toBe('2');
    expect(wrapper.find('#elsa-total-estimate').text()).toBe('26,867');
  });

  it('shows a conflict message when Elsa gold total price has no overlap with the current gold cell constraints', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-cells-orange').setValue('3');
    await wrapper.find('#elsa-total-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({
        type: 'out',
        text: 'Count=1, TotalPrice=25875\n  TotalCells=2, TotalPrice=25875, Count=1: [候选A]\n  TotalCells=4, TotalPrice=25875, Count=1: [候选B]\n',
      }),
    });
    getLatestRunSource()?.onmessage?.({
      data: JSON.stringify({ type: 'done', code: 0 }),
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-result-meta').text()).toContain('橙/金色总价格与当前格数约束没有交集');
  });

  it('ignores stale stream worker messages after rerunning Elsa total-price search', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-total-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const firstWorker = getLatestEstimationWorker();
    const firstRunId = FakeEstimationWorker.messages.find((message) => message.type === 'start-stream-run')?.runId;
    const firstRunSource = getLatestRunSource();

    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const secondRunSource = getLatestRunSource();
    expect(secondRunSource).not.toBe(firstRunSource);

    firstWorker?.onmessage?.({
      data: {
        type: 'stream-row',
        runId: firstRunId,
        streamMode: 'total-price',
        groupKey: 'orange',
        row: {
          kind: 'total-price',
          groupKey: 'orange',
          count: 9,
          cells: 9,
          avg: 1,
          low: 999,
          mean: 999,
          high: 999,
          remaining: 0,
          totalCount: null,
          isOverflow: false,
          overflowTotal: 0,
          hasPriceMatch: false,
        },
      },
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-result-body').text()).not.toContain('999');
    expect(wrapper.find('#elsa-result-meta').text()).toContain('正在搜索');

    secondRunSource?.onmessage?.({
      data: JSON.stringify({
        type: 'out',
        text: 'Count=1, TotalPrice=25875\n  TotalCells=2, TotalPrice=25875, Count=1: [current]\n',
      }),
    });
    secondRunSource?.onmessage?.({
      data: JSON.stringify({ type: 'done', code: 0 }),
    });
    await settleWorkerStream();

    expect(wrapper.findAll('#elsa-result-body tr')).toHaveLength(1);
    expect(wrapper.find('#elsa-result-body').text()).toContain('2');
  });

  it('does not cancel an active Elsa total-price search for ignored Ethan monitor payloads', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-total-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const runSource = getLatestRunSource();

    monitorSource.emitEvent('event', {
      key: 'ethan-ignore-active-stream',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'ethan-ignore-active-stream-skill',
        heroCid: 102,
        skillCid: 1001025,
        hitBoxList: [
          { boxId: 15, itemSlotType: 11, itemQuility: 4, itemQuilityName: '紫' },
        ],
      },
    });
    await settleWorkerStream();

    runSource?.onmessage?.({
      data: JSON.stringify({
        type: 'out',
        text: 'Count=1, TotalPrice=25875\n  TotalCells=2, TotalPrice=25875, Count=1: [kept]\n',
      }),
    });
    runSource?.onmessage?.({
      data: JSON.stringify({ type: 'done', code: 0 }),
    });
    await settleWorkerStream();

    expect(wrapper.findAll('#elsa-result-body tr')).toHaveLength(1);
    expect(wrapper.find('#elsa-result-body').text()).toContain('2');
  });

  it('ignores cancelled stream worker messages after clearing the Elsa panel', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-total-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const worker = getLatestEstimationWorker();
    const runId = FakeEstimationWorker.messages.find((message) => message.type === 'start-stream-run')?.runId;

    await wrapper.find('#elsa-clear-button').trigger('click');
    await settleWorkerStream();

    worker?.onmessage?.({
      data: {
        type: 'stream-row',
        runId,
        streamMode: 'total-price',
        groupKey: 'orange',
        row: {
          kind: 'total-price',
          groupKey: 'orange',
          count: 7,
          cells: 7,
          avg: 1,
          low: 777,
          mean: 777,
          high: 777,
          remaining: 0,
          totalCount: null,
          isOverflow: false,
          overflowTotal: 0,
          hasPriceMatch: false,
        },
      },
    });
    worker?.onmessage?.({
      data: {
        type: 'stream-complete',
        runId,
        streamMode: 'total-price',
        groupKey: 'orange',
        count: 1,
        reason: 'done',
        emptyReason: null,
        finalRow: null,
      },
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-total-price-orange').element.value).toBe('');
    expect(wrapper.find('#elsa-result-body').text()).not.toContain('777');
  });

  it('tears down the active Elsa total-price stream when the estimation worker errors', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);
    FakeEstimationWorker.failOnAppend = true;

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-total-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await settleWorkerStream();

    const runSource = getLatestRunSource();

    runSource?.onmessage?.({
      data: JSON.stringify({
        type: 'out',
        text: 'Count=1, TotalPrice=25875\n  TotalCells=2, TotalPrice=25875, Count=1: [broken]\n',
      }),
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-result-meta').text()).toContain('stream worker failed');
    expect(wrapper.find('#elsa-result-body').text()).not.toContain('broken');
    expect(runSource?.close).toHaveBeenCalled();

    runSource?.onmessage?.({
      data: JSON.stringify({
        type: 'out',
        text: 'Count=1, TotalPrice=25875\n  TotalCells=4, TotalPrice=25875, Count=1: [late]\n',
      }),
    });
    runSource?.onmessage?.({
      data: JSON.stringify({ type: 'done', code: 0 }),
    });
    await settleWorkerStream();

    expect(wrapper.find('#elsa-result-body').text()).not.toContain('late');
    expect(wrapper.find('#elsa-result-meta').text()).toContain('stream worker failed');
  });

  it('falls back to synchronous estimation when Elsa gold total price already has explicit cells and EventSource is unavailable', async () => {
    vi.stubGlobal('EventSource', undefined);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-cells-orange').setValue('4');
    await wrapper.find('#elsa-total-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('#elsa-result-meta').text()).not.toContain('当前环境不支持流式搜索');
    expect(wrapper.find('#elsa-total-estimate').text()).toBe('26,619');
  });

  it('keeps Elsa shared expected price aligned with the visible total estimate', async () => {
    vi.stubGlobal('EventSource', undefined);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#elsa-total-cells-all').setValue('10');
    await wrapper.find('#elsa-cells-orange').setValue('4');
    await wrapper.find('#elsa-total-price-orange').setValue('25875');
    await wrapper.find('#elsa-estimate-form').trigger('submit');
    await flushPromises();
    await nextTick();

    const visibleTotal = parseInt(wrapper.find('#elsa-total-estimate').text().replace(/,/g, ''), 10);

    expect(visibleTotal).toBe(26619);
    expect(elsaExpectedPrice.value).toBe(visibleTotal);
    expect(elsaAutoBidKnownQualityKeys.value).toEqual(['orange']);
  });

  it('applies price-match-update delta to direct result row and summary', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('7');
    await wrapper.find('#cells-purple').setValue('7');
    await wrapper.find('#price-purple').setValue('6800');

    await wrapper.find('#estimate-form').trigger('submit');
    await settleWorkerStream();

    // Formula: 7 × perCellExpected.purple (2482) = 17374
    expect(wrapper.find('#total-estimate').text()).toBe('17,374');

    const worker = getLatestEstimationWorker();
    const runId = FakeEstimationWorker.messages.at(-1)?.runId;
    worker.onmessage({ data: { type: 'price-match-update', runId, groupKey: 'purple', rowIndex: null, delta: 1000 } });
    await nextTick();

    expect(wrapper.find('#total-estimate').text()).toBe('18,374');
  });

  it('applies price-match-update delta to prediction row and updates summary when rowIndex is 0', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('20');
    await wrapper.find('#avg-purple').setValue('2');

    await wrapper.find('#estimate-form').trigger('submit');
    await settleWorkerStream();

    const initialTotal = parseInt(wrapper.find('#total-estimate').text().replace(/,/g, ''), 10);
    expect(Number.isFinite(initialTotal)).toBe(true);

    const worker = getLatestEstimationWorker();
    const runId = FakeEstimationWorker.messages.at(-1)?.runId;
    worker.onmessage({ data: { type: 'price-match-update', runId, groupKey: 'purple', rowIndex: 0, delta: 2000 } });
    await nextTick();

    const afterTotal = parseInt(wrapper.find('#total-estimate').text().replace(/,/g, ''), 10);
    expect(afterTotal - initialTotal).toBe(2000);
  });

  it('ignores price-match-update with a stale runId from a previous estimation', async () => {
    vi.stubGlobal('Worker', FakeEstimationWorker);

    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    await wrapper.find('#total-cells-all').setValue('7');
    await wrapper.find('#cells-purple').setValue('7');
    await wrapper.find('#price-purple').setValue('6800');

    // First submission
    await wrapper.find('#estimate-form').trigger('submit');
    await settleWorkerStream();
    const firstRunId = FakeEstimationWorker.messages.at(-1)?.runId;

    // Second submission
    await wrapper.find('#estimate-form').trigger('submit');
    await settleWorkerStream();

    const totalAfterSecond = wrapper.find('#total-estimate').text();

    // Stale message from first worker; estimationRunId is now higher
    const firstWorker = FakeEstimationWorker.instances[0];
    firstWorker.onmessage({ data: { type: 'price-match-update', runId: firstRunId, groupKey: 'purple', rowIndex: null, delta: 5000 } });
    await nextTick();

    expect(wrapper.find('#total-estimate').text()).toBe(totalAfterSecond);
  });
});
