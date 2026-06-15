/* @vitest-environment happy-dom */
import fs from 'node:fs';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ElsaHeroPanel from './ElsaHeroPanel.vue';
import HeroEstimatorPanel from '../hero-estimator/HeroEstimatorPanel.vue';
import { elsaProfile } from '../hero-estimator/hero-profiles.js';

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

  static reset() {
    FakeEventSource.instances = [];
  }
}

FakeEventSource.instances = [];

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

describe('ElsaHeroPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    FakeEventSource.reset();
    mockFetch();
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    mountedWrappers.forEach((wrapper) => wrapper.unmount());
    mountedWrappers = [];
    vi.unstubAllGlobals();
  });

  it('wraps the shared estimator in embedded Elsa mode with separate white and green fields', async () => {
    const wrapper = mount(ElsaHeroPanel, {
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const estimator = wrapper.findComponent(HeroEstimatorPanel);

    expect(estimator.exists()).toBe(true);
    expect(estimator.props('profile')).toEqual(elsaProfile);
    expect(estimator.props('embedded')).toBe(true);
    expect(wrapper.find('.topbar').exists()).toBe(false);
    expect(wrapper.find('h1').text()).toBe('Elsa 期望价值估算');
    expect(wrapper.find('#elsa-estimate-form').exists()).toBe(true);
    expect(wrapper.find('#elsa-cells-white').exists()).toBe(true);
    expect(wrapper.find('#elsa-cells-green').exists()).toBe(true);
    expect(wrapper.find('#elsa-total-price-orange').exists()).toBe(true);
    expect(wrapper.find('#elsa-cells-wg').exists()).toBe(false);
    expect(wrapper.find('#elsa-monitor-board').exists()).toBe(true);
  });
});
