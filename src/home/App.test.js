/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import App from './App.vue';

function mockMatchMedia(matches = false) {
  window.matchMedia = vi.fn(() => ({
    matches,
    addEventListener: vi.fn(),
  }));
}

async function mountApp() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('Home App', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    mockMatchMedia(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }),
    })));
  });

  afterEach(() => {
    delete window.bidkingDesktop;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders launcher links without screenshot controls', async () => {
    const wrapper = await mountApp();

    expect(wrapper.find('h1').text()).toBe('BKToolBox 工作台');
    expect(wrapper.find('.hero-mark img').exists()).toBe(true);
    expect(wrapper.find('.hero-mark').text()).toBe('');
    expect(wrapper.find('.hero-copy').text()).toContain('选择要使用的工具模块');
    expect(wrapper.findAll('.launcher-link').map((link) => link.attributes('href'))).toEqual([
      '/Tools',
      '/Monitor',
      '/Price',
      '/Inject',
    ]);
    expect(wrapper.find('.launcher').text()).toContain('Tools');
    expect(wrapper.find('.launcher').text()).not.toContain('Ahmed');
    expect(wrapper.find('.launcher').text()).not.toContain('Ethan');
    expect(wrapper.find('.launcher').text()).toContain('Monitor');
    expect(wrapper.find('.launcher').text()).toContain('Price');
    expect(wrapper.find('.launcher').text()).toContain('Inject');
    expect(wrapper.find('.capture').exists()).toBe(false);
    expect(wrapper.find('.action-button').exists()).toBe(false);
  });

  it('switches UI language to English and restores the saved locale', async () => {
    const wrapper = await mountApp();

    await wrapper.find('.lang-capsule').trigger('click');
    await nextTick();

    expect(document.documentElement.lang).toBe('en-US');
    expect(window.localStorage.getItem('bidking-locale')).toBe('en-US');
    expect(wrapper.find('h1').text()).toBe('BKToolBox Workspace');
    expect(wrapper.find('.hero-copy').text()).toContain('Choose a tool module');
    expect(wrapper.find('.nav').text()).toContain('Home');

    wrapper.unmount();
    const restored = await mountApp();

    expect(restored.find('h1').text()).toBe('BKToolBox Workspace');
    expect(restored.find('.lang-capsule-opt.active').text()).toBe('EN');
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

  it('does not call desktop screenshot APIs when present', async () => {
    const desktopApi = {
      isDesktop: true,
      getScreenshotStatus: vi.fn(),
      getLatestScreenshot: vi.fn(),
      startRegionSelection: vi.fn(),
      onScreenshotCaptured: vi.fn(),
      onScreenshotCaptureFailed: vi.fn(),
    };
    window.bidkingDesktop = desktopApi;
    const wrapper = await mountApp();

    expect(wrapper.find('.capture').exists()).toBe(false);
    expect(desktopApi.getScreenshotStatus).not.toHaveBeenCalled();
    expect(desktopApi.getLatestScreenshot).not.toHaveBeenCalled();
    expect(desktopApi.startRegionSelection).not.toHaveBeenCalled();
    expect(desktopApi.onScreenshotCaptured).not.toHaveBeenCalled();
    expect(desktopApi.onScreenshotCaptureFailed).not.toHaveBeenCalled();
  });

  it('does not render the old desktop injection button', async () => {
    const queryTradeInfo = vi.fn().mockResolvedValue({ ok: true, output: 'Written' });
    window.bidkingDesktop = {
      isDesktop: true,
      queryTradeInfo,
    };
    const wrapper = await mountApp();

    expect(wrapper.find('[data-testid="home-inject-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-inject-status"]').exists()).toBe(false);
    expect(queryTradeInfo).not.toHaveBeenCalled();
  });

});
