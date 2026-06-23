/* @vitest-environment happy-dom */
import fs from 'node:fs';
import path from 'node:path';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';

const projectRoot = path.resolve(__dirname, '..', '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function makeJsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  };
}

class FakeAhmedWorker {
  constructor() {
    this.messages = [];
    this.terminate = vi.fn(() => {
      this.terminated = true;
    });
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    this.constructor.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(JSON.parse(JSON.stringify(message)));
  }

  emit(message) {
    this.onmessage?.({
      data: JSON.parse(JSON.stringify(message)),
    });
  }

  reset() {
    FakeAhmedWorker.instances = [];
  }
}

FakeAhmedWorker.instances = [];

class ThrowOnceStartAhmedWorker extends FakeAhmedWorker {
  postMessage(message) {
    if (message?.type === 'start-run' && !ThrowOnceStartAhmedWorker.didThrow) {
      ThrowOnceStartAhmedWorker.didThrow = true;
      throw new Error('start-run postMessage crashed');
    }
    super.postMessage(message);
  }
}

ThrowOnceStartAhmedWorker.instances = [];
ThrowOnceStartAhmedWorker.didThrow = false;

class ThrowOnDetailAhmedWorker extends FakeAhmedWorker {
  postMessage(message) {
    if (message?.type === 'open-detail' && !this.detailThrowTriggered) {
      this.detailThrowTriggered = true;
      throw new Error('detail postMessage crashed');
    }
    super.postMessage(message);
  }
}

ThrowOnDetailAhmedWorker.instances = [];

function getLatestAhmedWorker() {
  return FakeAhmedWorker.instances[FakeAhmedWorker.instances.length - 1] ?? null;
}

async function waitFor(check, timeoutMs = 1500) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  throw lastError ?? new Error('Timed out waiting for condition');
}

function stubAhmedDataFetch() {
  const collectibles = readJson('public/data/collectibles.json');
  const averagePrices = readJson('public/data/quality-size-average-prices.json');

  vi.stubGlobal('fetch', vi.fn((url) => {
    if (url === '/api/bidking-monitor/status') {
      return Promise.resolve(makeJsonResponse({
        state: 'idle',
        running: false,
        totalEvents: 0,
        lastError: null,
      }));
    }
    if (url === '/data/collectibles.json') {
      return Promise.resolve(makeJsonResponse(collectibles));
    }
    if (url === '/data/quality-size-average-prices.json') {
      return Promise.resolve(makeJsonResponse(averagePrices));
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }));
}

function fillAhmedAverageInputs() {
  const values = {
    '#total-count': '38',
    '#avg-wg': '2',
    '#avg-blue': '2',
    '#avg-purple': '2',
    '#avg-orange': '2',
  };

  Object.entries(values).forEach(([selector, value]) => {
    const input = document.querySelector(selector);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function mountApp(props = {}) {
  return mount(App, {
    attachTo: document.body,
    props: {
      bootController: false,
      ...props,
    },
  });
}

function getAhmedPanelRoot() {
  const root = document.querySelector('[data-testid="ahmed-panel-root"]');
  if (!root) throw new Error('Ahmed panel root not found');
  return root;
}

async function mountController() {
  const { mountAhmedController } = await import('../../public/ahmed/ahmed.js');
  return mountAhmedController(getAhmedPanelRoot());
}

describe('Ahmed App', () => {
  let cleanupController = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.resetModules();
    window.localStorage.clear();
    window.history.replaceState({}, '', '/Ahmed');
    FakeAhmedWorker.instances = [];
    ThrowOnceStartAhmedWorker.instances = [];
    ThrowOnceStartAhmedWorker.didThrow = false;
    ThrowOnDetailAhmedWorker.instances = [];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }),
    })));
  });

  afterEach(() => {
    cleanupController?.();
    cleanupController = null;
    vi.unstubAllGlobals();
  });

  it('renders the legacy-controller DOM contract', () => {
    const wrapper = mountApp();

    expect(wrapper.find('h1').text()).toBe('藏品件数组合');
    expect(wrapper.findAll('.nav a').map(link => link.attributes('href'))).toEqual([
      '/',
      '/Tools',
      '/Monitor',
      '/Price',
      '/Inject',
    ]);
    expect(wrapper.find('#combo-form').exists()).toBe(true);
    expect(wrapper.find('#calculate-button').exists()).toBe(true);
    expect(wrapper.find('#result-body').exists()).toBe(true);
    expect(wrapper.find('#known-outline-form').exists()).toBe(true);
    expect(wrapper.find('#known-exact-form').exists()).toBe(true);
    expect(wrapper.find('#detail-modal').exists()).toBe(true);
    expect(wrapper.find('[data-known-mode="outline"]').exists()).toBe(true);
    expect(wrapper.find('[data-known-mode="exact"]').exists()).toBe(true);
    expect(wrapper.find('[data-close-detail]').exists()).toBe(true);
  });

  it('keeps expected input and result table structure', () => {
    const wrapper = mountApp();

    [
      '#total-count',
      '#avg-all',
      '#total-cells-all',
      '#avg-wg',
      '#count-blue',
      '#total-cells-purple',
      '#avg-price-orange',
      '#count-red',
      '#result-limit',
    ].forEach((selector) => {
      expect(wrapper.find(selector).exists()).toBe(true);
    });

    const headers = wrapper.findAll('thead th').map((cell) => cell.text());
    expect(headers).toEqual(['白+绿', '蓝', '紫', '橙/金', '红', '不含红', '红色', '总价格', '操作']);
  });

  it('renders static page chrome in English when locale is saved', () => {
    window.localStorage.setItem('bidking-locale', 'en-US');
    const wrapper = mountApp();

    expect(document.documentElement.lang).toBe('en-US');
    expect(wrapper.find('h1').text()).toBe('Collectible Count Combinations');
    expect(wrapper.find('#calculate-button').text()).toBe('Calculate');
    expect(wrapper.find('#clear-results').text()).toBe('Clear');
    expect(wrapper.find('[data-known-mode="outline"]').text()).toBe('Quality Profile');
    expect(wrapper.findAll('thead th').map((cell) => cell.text()))
      .toEqual(['White+Green', 'Blue', 'Purple', 'Orange/Gold', 'Red', 'No Red', 'Red Items', 'Total Price', 'Actions']);
  });

  it('keeps the Tools link navigable on the standalone Ahmed shell', () => {
    const wrapper = mountApp();
    const toolsLink = wrapper.findAll('.nav a').find((link) => link.attributes('href') === '/Tools');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    toolsLink.element.dispatchEvent(event);

    expect(toolsLink.classes()).not.toContain('active');
    expect(toolsLink.attributes('aria-current')).toBeUndefined();
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps the theme switch icon and state when switching language', async () => {
    window.localStorage.setItem('bidking-theme', 'light');
    const wrapper = mountApp();
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

    expect(wrapper.find('.theme-toggle').classes()).toContain('is-light');
    expect(getIconState()).toBe('sun');
  });

  it('streams Ahmed submit results from a worker and ignores stale rerun messages', async () => {
    vi.stubGlobal('Worker', FakeAhmedWorker);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    const firstWorker = getLatestAhmedWorker();
    expect(firstWorker).toBeTruthy();
    expect(firstWorker.messages[0]).toMatchObject({
      type: 'start-run',
      search: {
        totalCount: 38,
      },
    });

    const firstRunId = firstWorker.messages[0].runId;
    firstWorker.emit({
      type: 'run-rows',
      runId: firstRunId,
      rows: [{
        wg: 10,
        blue: 10,
        purple: 10,
        orange: 8,
        red: 0,
        redTargetCells: 0,
        expectedTotal: 1200,
        redExpectedTotal: 0,
      }],
      totalMatches: 1,
    });

    await waitFor(() => {
      expect(wrapper.find('#result-body').text()).toContain('10');
    });
    expect(wrapper.find('[data-detail-index]').exists()).toBe(true);

    await wrapper.find('#combo-form').trigger('submit');

    expect(firstWorker.messages).toContainEqual(expect.objectContaining({
      type: 'cancel-run',
      runId: firstRunId,
    }));

    const secondRunId = firstWorker.messages[firstWorker.messages.length - 1].runId;
    expect(firstWorker.messages[firstWorker.messages.length - 1]).toMatchObject({
      type: 'start-run',
      runId: secondRunId,
    });

    firstWorker.emit({
      type: 'run-rows',
      runId: firstRunId,
      rows: [{
        wg: 999,
        blue: 0,
        purple: 0,
        orange: 0,
        red: 0,
        redTargetCells: 0,
        expectedTotal: 999,
        redExpectedTotal: 0,
      }],
      totalMatches: 2,
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(wrapper.find('#result-body').text()).not.toContain('999');

    firstWorker.emit({
      type: 'run-rows',
      runId: secondRunId,
      rows: [{
        wg: 9,
        blue: 10,
        purple: 10,
        orange: 9,
        red: 0,
        redTargetCells: 0,
        expectedTotal: 1300,
        redExpectedTotal: 0,
      }],
      totalMatches: 1,
    });
    firstWorker.emit({
      type: 'run-complete',
      runId: secondRunId,
      totalMatches: 1,
      stoppedEarly: false,
    });

    await waitFor(() => {
      expect(wrapper.find('#result-body').text()).toContain('1,300');
    });
  });

  it('updates Ahmed submit meta from worker progress messages before rows arrive', async () => {
    vi.stubGlobal('Worker', FakeAhmedWorker);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    const worker = getLatestAhmedWorker();
    const runId = worker.messages[0].runId;

    worker.emit({
      type: 'run-progress',
      runId,
      red: 0,
      redEnd: 38,
      totalMatches: 3,
      rows: 0,
    });

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toContain('当前已命中 3 条');
    });
    expect(wrapper.find('#result-body').text()).toContain('暂无结果');
  });

  it('clears an active Ahmed worker run by cancelling and releasing the worker context', async () => {
    vi.stubGlobal('Worker', FakeAhmedWorker);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    const worker = getLatestAhmedWorker();
    const runId = worker.messages[0].runId;

    await wrapper.find('#clear-results').trigger('click');

    expect(worker.messages).toContainEqual({
      type: 'cancel-run',
      runId,
    });
    expect(worker.messages).toContainEqual({
      type: 'release-run',
      runId,
    });
    expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    expect(wrapper.find('#result-body').text()).toContain('暂无结果');
    expect(wrapper.find('[data-detail-index]').exists()).toBe(false);
  });

  it('requests Ahmed row detail from the worker before opening the modal', async () => {
    vi.stubGlobal('Worker', FakeAhmedWorker);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    const worker = getLatestAhmedWorker();
    const runId = worker.messages[0].runId;
    const row = {
      wg: 10,
      blue: 10,
      purple: 10,
      orange: 8,
      red: 0,
      redTargetCells: 0,
      expectedTotal: 1200,
      redExpectedTotal: 0,
    };

    worker.emit({
      type: 'run-rows',
      runId,
      rows: [row],
      totalMatches: 1,
    });
    worker.emit({
      type: 'run-complete',
      runId,
      totalMatches: 1,
      stoppedEarly: false,
    });

    await waitFor(() => {
      expect(wrapper.find('[data-detail-index]').exists()).toBe(true);
    });

    await wrapper.find('[data-detail-index]').trigger('click');

    expect(worker.messages.at(-1)).toMatchObject({
      type: 'open-detail',
      runId,
      row,
    });
    expect(wrapper.find('#detail-modal').element.hidden).toBe(true);

    worker.emit({
      type: 'detail-result',
      runId: runId + 1,
      requestId: 1,
      row,
      detail: {
        sections: [],
        totalPrice: 0,
        totalCells: 0,
      },
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(wrapper.find('#detail-modal').element.hidden).toBe(true);

    worker.emit({
      type: 'detail-result',
      runId,
      requestId: 1,
      row,
      detail: {
        sections: [{
          label: '白+绿',
          count: 10,
          target: 20,
          items: [{
            id: '1',
            name: '测试藏品',
            quality: '白',
            sizeKey: '1x1',
            cells: 1,
            price: 100,
            expectedPrice: 100,
          }],
          price: 100,
          cells: 1,
          expectedPrice: 100,
        }],
        totalPrice: 100,
        totalCells: 1,
      },
    });

    await waitFor(() => {
      expect(wrapper.find('#detail-modal').element.hidden).toBe(false);
    });
    expect(wrapper.find('#detail-summary').text()).toContain('白+绿');
    expect(wrapper.find('#detail-body').text()).toContain('测试藏品');
  });

  it('keeps an in-flight Ahmed detail request valid when run completion arrives first', async () => {
    vi.stubGlobal('Worker', FakeAhmedWorker);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    const worker = getLatestAhmedWorker();
    const runId = worker.messages[0].runId;
    const row = {
      wg: 10,
      blue: 10,
      purple: 10,
      orange: 8,
      red: 0,
      redTargetCells: 0,
      expectedTotal: 1200,
      redExpectedTotal: 0,
    };

    worker.emit({
      type: 'run-rows',
      runId,
      rows: [row],
      totalMatches: 1,
    });

    await waitFor(() => {
      expect(wrapper.find('[data-detail-index]').exists()).toBe(true);
    });

    await wrapper.find('[data-detail-index]').trigger('click');
    expect(worker.messages.at(-1)).toMatchObject({
      type: 'open-detail',
      runId,
      requestId: 1,
      row,
    });

    worker.emit({
      type: 'run-complete',
      runId,
      totalMatches: 1,
      stoppedEarly: false,
    });
    worker.emit({
      type: 'detail-result',
      runId,
      requestId: 1,
      row,
      detail: {
        sections: [{
          label: '白+绿',
          count: 10,
          target: 20,
          items: [{
            id: '1',
            name: '延迟详情',
            quality: '白',
            sizeKey: '1x1',
            cells: 1,
            price: 100,
            expectedPrice: 100,
          }],
          price: 100,
          cells: 1,
          expectedPrice: 100,
        }],
        totalPrice: 100,
        totalCells: 1,
      },
    });

    await waitFor(() => {
      expect(wrapper.find('#detail-modal').element.hidden).toBe(false);
    });
    expect(wrapper.find('#detail-body').text()).toContain('延迟详情');
  });

  it('keeps the Ahmed detail modal closed after the user closes an in-flight detail refresh', async () => {
    vi.stubGlobal('Worker', FakeAhmedWorker);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    const worker = getLatestAhmedWorker();
    const runId = worker.messages[0].runId;
    const firstRow = {
      wg: 10,
      blue: 10,
      purple: 10,
      orange: 8,
      red: 0,
      redTargetCells: 0,
      expectedTotal: 1200,
      redExpectedTotal: 0,
    };
    const secondRow = {
      wg: 9,
      blue: 11,
      purple: 10,
      orange: 8,
      red: 0,
      redTargetCells: 0,
      expectedTotal: 1210,
      redExpectedTotal: 0,
    };

    worker.emit({
      type: 'run-rows',
      runId,
      rows: [firstRow, secondRow],
      totalMatches: 2,
    });
    worker.emit({
      type: 'run-complete',
      runId,
      totalMatches: 2,
      stoppedEarly: false,
    });

    await waitFor(() => {
      expect(wrapper.findAll('[data-detail-index]').length).toBe(2);
    });

    await wrapper.findAll('[data-detail-index]')[0].trigger('click');
    expect(worker.messages.at(-1)).toMatchObject({
      type: 'open-detail',
      runId,
      requestId: 1,
      row: firstRow,
    });

    worker.emit({
      type: 'detail-result',
      runId,
      requestId: 1,
      row: firstRow,
      detail: {
        sections: [{
          label: '白+绿',
          count: 10,
          target: 20,
          items: [{
            id: '1',
            name: '第一件',
            quality: '白',
            sizeKey: '1x1',
            cells: 1,
            price: 100,
            expectedPrice: 100,
          }],
          price: 100,
          cells: 1,
          expectedPrice: 100,
        }],
        totalPrice: 100,
        totalCells: 1,
      },
    });

    await waitFor(() => {
      expect(wrapper.find('#detail-modal').element.hidden).toBe(false);
    });

    await wrapper.findAll('[data-detail-index]')[1].trigger('click');
    expect(worker.messages.at(-1)).toMatchObject({
      type: 'open-detail',
      runId,
      requestId: 2,
      row: secondRow,
    });

    await wrapper.find('#close-detail').trigger('click');
    expect(wrapper.find('#detail-modal').element.hidden).toBe(true);

    worker.emit({
      type: 'detail-result',
      runId,
      requestId: 2,
      row: secondRow,
      detail: {
        sections: [{
          label: '蓝',
          count: 11,
          target: 22,
          items: [{
            id: '2',
            name: '第二件',
            quality: '蓝',
            sizeKey: '1x2',
            cells: 2,
            price: 200,
            expectedPrice: 200,
          }],
          price: 200,
          cells: 2,
          expectedPrice: 200,
        }],
        totalPrice: 200,
        totalCells: 2,
      },
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(wrapper.find('#detail-modal').element.hidden).toBe(true);
    expect(wrapper.find('#detail-body').text()).toBe('');
    expect(wrapper.find('#detail-summary').text()).toBe('');
  });

  it('clears stale Ahmed detail content when a refreshed detail request fails', async () => {
    vi.stubGlobal('Worker', FakeAhmedWorker);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    const worker = getLatestAhmedWorker();
    const runId = worker.messages[0].runId;
    const firstRow = {
      wg: 10,
      blue: 10,
      purple: 10,
      orange: 8,
      red: 0,
      redTargetCells: 0,
      expectedTotal: 1200,
      redExpectedTotal: 0,
    };
    const secondRow = {
      wg: 9,
      blue: 11,
      purple: 10,
      orange: 8,
      red: 0,
      redTargetCells: 0,
      expectedTotal: 1210,
      redExpectedTotal: 0,
    };

    worker.emit({
      type: 'run-rows',
      runId,
      rows: [firstRow, secondRow],
      totalMatches: 2,
    });
    worker.emit({
      type: 'run-complete',
      runId,
      totalMatches: 2,
      stoppedEarly: false,
    });

    await waitFor(() => {
      expect(wrapper.findAll('[data-detail-index]').length).toBe(2);
    });

    await wrapper.findAll('[data-detail-index]')[0].trigger('click');
    worker.emit({
      type: 'detail-result',
      runId,
      requestId: 1,
      row: firstRow,
      detail: {
        sections: [{
          label: '白+绿',
          count: 10,
          target: 20,
          items: [{
            id: '1',
            name: '旧详情',
            quality: '白',
            sizeKey: '1x1',
            cells: 1,
            price: 100,
            expectedPrice: 100,
          }],
          price: 100,
          cells: 1,
          expectedPrice: 100,
        }],
        totalPrice: 100,
        totalCells: 1,
      },
    });

    await waitFor(() => {
      expect(wrapper.find('#detail-modal').element.hidden).toBe(false);
    });
    expect(wrapper.find('#detail-body').text()).toContain('旧详情');

    await wrapper.findAll('[data-detail-index]')[1].trigger('click');

    expect(wrapper.find('#detail-modal').element.hidden).toBe(true);
    expect(wrapper.find('#detail-body').text()).toBe('');
    expect(wrapper.find('#detail-summary').text()).toBe('');

    worker.emit({
      type: 'detail-error',
      runId,
      requestId: 2,
      error: 'detail failed',
    });

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toContain('detail failed');
    });
    expect(wrapper.find('#detail-modal').element.hidden).toBe(true);
    expect(wrapper.find('#detail-body').text()).toBe('');
  });

  it('recreates the Ahmed worker after a runtime worker failure', async () => {
    vi.stubGlobal('Worker', FakeAhmedWorker);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    const firstWorker = getLatestAhmedWorker();
    expect(FakeAhmedWorker.instances).toHaveLength(1);

    firstWorker.onerror?.(new Error('worker crashed'));

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toContain('worker crashed');
    });
    expect(wrapper.find('#result-body').text()).toContain('无法计算');

    await wrapper.find('#combo-form').trigger('submit');

    await waitFor(() => {
      expect(FakeAhmedWorker.instances).toHaveLength(2);
    });

    const secondWorker = getLatestAhmedWorker();
    expect(secondWorker).not.toBe(firstWorker);
    expect(secondWorker.messages[0]).toMatchObject({
      type: 'start-run',
    });
  });

  it('retries Ahmed submit on a fresh worker when start-run postMessage throws synchronously', async () => {
    vi.stubGlobal('Worker', ThrowOnceStartAhmedWorker);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    await waitFor(() => {
      expect(ThrowOnceStartAhmedWorker.instances).toHaveLength(2);
    });

    const retriedWorker = ThrowOnceStartAhmedWorker.instances.at(-1);
    expect(retriedWorker.messages[0]).toMatchObject({
      type: 'start-run',
      search: {
        totalCount: 38,
      },
    });

    retriedWorker.emit({
      type: 'run-rows',
      runId: retriedWorker.messages[0].runId,
      rows: [{
        wg: 9,
        blue: 10,
        purple: 10,
        orange: 9,
        red: 0,
        redTargetCells: 0,
        expectedTotal: 1300,
        redExpectedTotal: 0,
      }],
      totalMatches: 1,
    });
    retriedWorker.emit({
      type: 'run-complete',
      runId: retriedWorker.messages[0].runId,
      totalMatches: 1,
      stoppedEarly: false,
    });

    await waitFor(() => {
      expect(wrapper.find('#result-body').text()).toContain('1,300');
    });
  });

  it('fails Ahmed detail requests safely when open-detail postMessage throws synchronously', async () => {
    vi.stubGlobal('Worker', ThrowOnDetailAhmedWorker);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    const worker = ThrowOnDetailAhmedWorker.instances[0];
    const runId = worker.messages[0].runId;
    const row = {
      wg: 10,
      blue: 10,
      purple: 10,
      orange: 8,
      red: 0,
      redTargetCells: 0,
      expectedTotal: 1200,
      redExpectedTotal: 0,
    };

    worker.emit({
      type: 'run-rows',
      runId,
      rows: [row],
      totalMatches: 1,
    });
    worker.emit({
      type: 'run-complete',
      runId,
      totalMatches: 1,
      stoppedEarly: false,
    });

    await waitFor(() => {
      expect(wrapper.find('[data-detail-index]').exists()).toBe(true);
    });

    await wrapper.find('[data-detail-index]').trigger('click');

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toContain('无法计算');
    });
    expect(wrapper.find('#result-body').text()).toContain('无法计算');
    expect(wrapper.find('#detail-modal').element.hidden).toBe(true);
  });

  it('does not fallback Ahmed submit computation to the main thread when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    stubAhmedDataFetch();
    const wrapper = mountApp();
    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillAhmedAverageInputs();
    await wrapper.find('#combo-form').trigger('submit');

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toContain('无法计算');
    });
    expect(wrapper.find('#result-body').text()).toContain('无法计算');
    expect(wrapper.find('[data-detail-index]').exists()).toBe(false);
  });
});
