/* @vitest-environment happy-dom */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/ahmed/App.vue';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function getRealCollectible(predicate = () => true) {
  const item = readJson('public/data/collectibles.json').find(predicate);
  if (!item) throw new Error('Missing matching collectible fixture');
  return item;
}

function makeJsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function cloneMessagePayload(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeAhmedWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.handlerPromise = null;
    FakeAhmedWorker.instances.push(this);
  }

  postMessage(message) {
    if (this.terminated) return;
    this.handlerPromise ??= import('../../src/ahmed/ahmed-worker-core.js')
      .then(({ createAhmedWorkerMessageHandler }) => createAhmedWorkerMessageHandler((payload) => {
        setTimeout(() => {
          if (this.terminated) return;
          this.onmessage?.({ data: cloneMessagePayload(payload) });
        }, 0);
      }));

    this.handlerPromise
      .then((handleMessage) => {
        setTimeout(() => {
          if (this.terminated) return;
          Promise.resolve(handleMessage(cloneMessagePayload(message))).catch((error) => {
            this.onerror?.(error);
          });
        }, 0);
      })
      .catch((error) => {
        this.onerror?.(error);
      });
  }

  terminate() {
    this.terminated = true;
  }
}

FakeAhmedWorker.instances = [];

function stubDataFetch() {
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
    if (url === '/data/collectibles.json') return Promise.resolve(makeJsonResponse(collectibles));
    if (url === '/data/quality-size-average-prices.json') return Promise.resolve(makeJsonResponse(averagePrices));
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }));
}

function stubFailingDataFetch() {
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
      return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
    }
    if (url === '/data/quality-size-average-prices.json') {
      return Promise.resolve(makeJsonResponse({}));
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }));
}

function setFieldValue(selector, value) {
  const input = document.querySelector(selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillReportedAverageCellInputs() {
  document.getElementById('total-count').value = '38';
  document.getElementById('avg-wg').value = '2';
  document.getElementById('avg-blue').value = '2';
  document.getElementById('avg-purple').value = '2';
  document.getElementById('avg-orange').value = '2';
}

function submitComboForm() {
  document.getElementById('combo-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function getAhmedPanelRoot() {
  const root = document.querySelector('[data-testid="ahmed-panel-root"]');
  if (!root) throw new Error('Ahmed panel root not found');
  return root;
}

async function mountController() {
  const { mountAhmedController } = await import('./ahmed.js');
  return mountAhmedController(getAhmedPanelRoot());
}

async function waitFor(check, timeoutMs = 1000) {
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

  throw lastError || new Error('Timed out waiting for condition');
}

describe('Ahmed legacy controller', () => {
  let cleanupController = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.resetModules();
    FakeAhmedWorker.instances = [];
    vi.stubGlobal('Worker', FakeAhmedWorker);
  });

  afterEach(() => {
    cleanupController?.();
    cleanupController = null;
    vi.unstubAllGlobals();
    delete window.BidKingPageState;
  });

  it('loads real collectibles data without falling back to built-in cell values', async () => {
    stubDataFetch();

    const wrapper = mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    expect(wrapper.find('#calculate-button').element.disabled).toBe(false);
    expect(wrapper.find('#result-meta').text()).not.toContain('接口未加载');
    expect(fetch).toHaveBeenCalledWith('/data/collectibles.json', { cache: 'no-store' });
  });

  it('falls back to built-in cell values when collectible data fails to load', async () => {
    stubFailingDataFetch();

    const wrapper = mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();

    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toContain('使用内置藏品格数数据');
    });

    expect(wrapper.find('#result-meta').text()).toContain('collectibles HTTP 503');
    expect(wrapper.find('#calculate-button').element.disabled).toBe(false);
    expect(wrapper.find('#result-body').text()).toContain('暂无结果');
    expect(fetch).toHaveBeenCalledWith('/data/collectibles.json', { cache: 'no-store' });
    expect(fetch).toHaveBeenCalledWith('/data/quality-size-average-prices.json', { cache: 'no-store' });
  });

  it('adds and removes a known outline constraint from real collectible data', async () => {
    const item = getRealCollectible((entry) => entry.quality === '白');
    stubDataFetch();
    const wrapper = mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();
    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    setFieldValue('#known-quality', item.quality);
    setFieldValue('#known-width', String(item.size.width));
    setFieldValue('#known-height', String(item.size.height));
    document.getElementById('add-outline-constraint').click();

    await waitFor(() => {
      expect(wrapper.find('#known-list').text()).toContain(item.quality);
    });
    expect(wrapper.find('#known-list').text()).toContain(item.size.key);
    expect(document.getElementById('known-width').value).toBe('');
    expect(document.getElementById('known-height').value).toBe('');

    wrapper.find('[data-remove-known]').element.click();

    await waitFor(() => {
      expect(wrapper.find('#known-list').text()).toBe('暂无约束');
    });
  });

  it('adds duplicate exact known collectibles from real collectible data', async () => {
    const item = getRealCollectible((entry) => entry.quality !== '红');
    stubDataFetch();
    const wrapper = mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();
    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    wrapper.find('[data-known-mode="exact"]').element.click();
    setFieldValue('#known-item-search', item.name);

    await waitFor(() => {
      expect(wrapper.find('#known-item-options').text()).toContain(item.name);
    });

    document.getElementById('add-exact-constraint').click();
    await waitFor(() => {
      expect(wrapper.find('#known-list').text()).toContain(item.name);
    });
    expect(document.getElementById('known-item-search').value).toBe('');

    setFieldValue('#known-item-search', item.name);
    document.getElementById('add-exact-constraint').click();

    await waitFor(() => {
      const occurrences = wrapper.find('#known-list').text().split(item.name).length - 1;
      expect(occurrences).toBe(2);
    });
    expect(wrapper.find('#result-meta').text()).not.toContain('该精确藏品已添加');
  });

  it('adds an exact known collectible by clicking a real-data suggestion', async () => {
    const item = getRealCollectible((entry) => entry.quality === '蓝');
    stubDataFetch();
    const wrapper = mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();
    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    wrapper.find('[data-known-mode="exact"]').element.click();
    setFieldValue('#known-item-search', item.name.slice(0, 2));

    await waitFor(() => {
      expect(wrapper.find('#known-item-options').text()).toContain(item.name);
    });

    const suggestion = [...document.querySelectorAll('[data-known-item-id]')]
      .find(button => button.textContent.includes(item.name));
    suggestion.click();

    await waitFor(() => {
      expect(wrapper.find('#known-list').text()).toContain(item.name);
    });
    expect(document.getElementById('known-item-search').value).toBe('');
  });

  it('calculates the reported average-cell inputs without stack overflow', async () => {
    stubDataFetch();
    const wrapper = mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();
    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillReportedAverageCellInputs();
    submitComboForm();

    expect(wrapper.find('#result-meta').text()).not.toContain('Maximum call stack size exceeded');
    expect(wrapper.find('#result-body').text()).not.toContain('无法计算');
  });

  it('opens and closes result detail modal from a calculated row', async () => {
    stubDataFetch();
    const wrapper = mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();
    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    fillReportedAverageCellInputs();
    submitComboForm();

    await waitFor(() => {
      expect(wrapper.find('[data-detail-index]').exists()).toBe(true);
    });

    wrapper.find('[data-detail-index]').element.click();
    await waitFor(() => {
      expect(wrapper.find('#detail-modal').element.hidden).toBe(false);
    });
    expect(wrapper.find('#detail-summary').text()).toContain('白+绿');
    expect(wrapper.find('#detail-body').text()).toContain('红色轮廓参考');

    wrapper.find('#close-detail').element.click();
    expect(wrapper.find('#detail-modal').element.hidden).toBe(true);

    wrapper.find('[data-detail-index]').element.click();
    await waitFor(() => {
      expect(wrapper.find('#detail-modal').element.hidden).toBe(false);
    });
    wrapper.find('[data-close-detail]').element.click();
    expect(wrapper.find('#detail-modal').element.hidden).toBe(true);

    wrapper.find('[data-detail-index]').element.click();
    await waitFor(() => {
      expect(wrapper.find('#detail-modal').element.hidden).toBe(false);
    });
    getAhmedPanelRoot().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.find('#detail-modal').element.hidden).toBe(true);
  });

  it('clears inputs and known constraints from the clear button', async () => {
    const item = getRealCollectible((entry) => entry.quality === '白');
    stubDataFetch();
    const wrapper = mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();
    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    setFieldValue('#known-quality', item.quality);
    setFieldValue('#known-width', String(item.size.width));
    setFieldValue('#known-height', String(item.size.height));
    document.getElementById('add-outline-constraint').click();
    setFieldValue('#total-count', '38');
    setFieldValue('#result-limit', '20');

    await waitFor(() => {
      expect(wrapper.find('#known-list').text()).toContain(item.size.key);
    });

    document.getElementById('clear-results').click();

    expect(document.getElementById('total-count').value).toBe('');
    expect(document.getElementById('result-limit').value).toBe('100');
    expect(wrapper.find('#known-list').text()).toBe('暂无约束');
    expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    expect(wrapper.find('#result-body').text()).toContain('暂无结果');
  });

  it('inserts a decimal point with the backquote input shortcut', async () => {
    stubDataFetch();
    mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();
    await waitFor(() => {
      expect(document.getElementById('result-meta').textContent).toBe('等待输入');
    });

    const input = document.getElementById('avg-wg');
    input.value = '12';
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: '`',
      code: 'Backquote',
      bubbles: true,
      cancelable: true,
    }));

    expect(input.value).toBe('1.2');
  });

  it('saves page state from controller input and mode-change events', async () => {
    const save = vi.fn();
    const collectControls = vi.fn(() => ({ marker: { type: 'value', value: 'saved' } }));
    window.BidKingPageState = {
      create: vi.fn(() => ({
        load: vi.fn(() => null),
        save,
        collectControls,
        restoreControls: vi.fn(),
      })),
    };
    stubDataFetch();
    const wrapper = mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();
    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    setFieldValue('#total-count', '38');
    wrapper.find('[data-known-mode="exact"]').element.click();
    window.dispatchEvent(new Event('pagehide'));

    expect(window.BidKingPageState.create).toHaveBeenCalledWith('ahmed');
    expect(collectControls).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      controls: { marker: { type: 'value', value: 'saved' } },
      currentKnownMode: 'exact',
    }));
  });

  it('detaches controller listeners on cleanup', async () => {
    const save = vi.fn();
    const collectControls = vi.fn(() => ({ marker: { type: 'value', value: 'saved' } }));
    window.BidKingPageState = {
      create: vi.fn(() => ({
        load: vi.fn(() => null),
        save,
        collectControls,
        restoreControls: vi.fn(),
      })),
    };
    stubDataFetch();
    mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    cleanupController = await mountController();
    await waitFor(() => {
      expect(document.getElementById('result-meta').textContent).toBe('等待输入');
    });

    cleanupController();
    cleanupController = null;
    save.mockClear();

    const input = document.getElementById('total-count');
    input.value = '38';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    window.dispatchEvent(new Event('pagehide'));

    expect(save).not.toHaveBeenCalled();

    cleanupController = await mountController();
    await waitFor(() => {
      expect(document.getElementById('result-meta').textContent).toBe('等待输入');
    });
    save.mockClear();

    input.value = '39';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('ignores stale successful loadData completion after cleanup and remount', async () => {
    const firstCollectibles = createDeferred();
    const firstAveragePrices = createDeferred();
    let collectiblesRequestCount = 0;
    let averagePricesRequestCount = 0;
    const staleCollectibles = [
      { name: '旧藏宝枪', quality: '白', price: 100, size: { width: 1, height: 1, key: '1x1' } },
    ];
    const activeCollectibles = [
      { name: '新藏宝刀', quality: '白', price: 200, size: { width: 1, height: 1, key: '1x1' } },
    ];
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
        collectiblesRequestCount += 1;
        return collectiblesRequestCount === 1
          ? firstCollectibles.promise
          : Promise.resolve(makeJsonResponse(activeCollectibles));
      }
      if (url === '/data/quality-size-average-prices.json') {
        averagePricesRequestCount += 1;
        return averagePricesRequestCount === 1
          ? firstAveragePrices.promise
          : Promise.resolve(makeJsonResponse(averagePrices));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));

    const wrapper = mount(App, {
      attachTo: document.body,
      props: {
        bootController: false,
      },
    });

    const firstCleanup = await mountController();
    firstCleanup();

    cleanupController = await mountController();
    await waitFor(() => {
      expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    });

    wrapper.find('[data-known-mode="exact"]').element.click();
    setFieldValue('#known-item-search', '新藏宝');
    await waitFor(() => {
      expect(wrapper.find('#known-item-options').text()).toContain('新藏宝刀');
    });

    firstCollectibles.resolve(makeJsonResponse(staleCollectibles));
    firstAveragePrices.resolve(makeJsonResponse(averagePrices));
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(wrapper.find('#result-meta').text()).toBe('等待输入');
    setFieldValue('#known-item-search', '旧藏宝');
    expect(wrapper.find('#known-item-options').text()).not.toContain('旧藏宝枪');

    setFieldValue('#known-item-search', '新藏宝');
    expect(wrapper.find('#known-item-options').text()).toContain('新藏宝刀');
  });
});
