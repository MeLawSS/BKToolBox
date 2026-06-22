/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const topbarRuntime = vi.hoisted(() => ({
  monitorToggle: vi.fn(),
  agentToggle: vi.fn(),
  refreshStatus: vi.fn(),
  ensureStreamConnected: vi.fn(),
  refreshAgentState: vi.fn(),
  monitorStatus: { value: { running: false, state: 'idle', totalEvents: 0, lastError: null } },
  monitorStatusText: { value: '待机' },
  monitorErrorText: { value: '' },
  monitorBusy: { value: false },
  agentAvailable: { value: true },
  agentConnected: { value: false },
  agentStatusText: { value: '等待获取' },
  agentErrorText: { value: '' },
  agentBusy: { value: false },
}));

vi.mock('./useMonitorSwitch.js', () => ({
  useMonitorSwitch: () => ({
    status: topbarRuntime.monitorStatus,
    statusText: topbarRuntime.monitorStatusText,
    errorText: topbarRuntime.monitorErrorText,
    isBusy: topbarRuntime.monitorBusy,
    refreshStatus: topbarRuntime.refreshStatus,
    ensureStreamConnected: topbarRuntime.ensureStreamConnected,
    toggleMonitor: topbarRuntime.monitorToggle,
  }),
}));

vi.mock('./useAutoOperationAgentSwitch.js', () => ({
  useAutoOperationAgentSwitch: () => ({
    isAvailable: topbarRuntime.agentAvailable,
    isConnected: topbarRuntime.agentConnected,
    statusText: topbarRuntime.agentStatusText,
    errorText: topbarRuntime.agentErrorText,
    isBusy: topbarRuntime.agentBusy,
    refreshAgentState: topbarRuntime.refreshAgentState,
    toggleAgent: topbarRuntime.agentToggle,
  }),
}));

import TopBar from './TopBar.vue';

function mockMatchMedia(matches = false) {
  window.matchMedia = vi.fn(() => ({ matches, addEventListener: vi.fn() }));
}

function mountBar(activePage = 'home') {
  return mount(TopBar, { props: { activePage }, attachTo: document.body });
}

describe('TopBar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    mockMatchMedia(false);
    topbarRuntime.monitorToggle.mockReset();
    topbarRuntime.agentToggle.mockReset();
    topbarRuntime.refreshStatus.mockReset();
    topbarRuntime.ensureStreamConnected.mockReset();
    topbarRuntime.refreshAgentState.mockReset();
    topbarRuntime.monitorStatus.value = { running: false, state: 'idle', totalEvents: 0, lastError: null };
    topbarRuntime.monitorStatusText.value = '待机';
    topbarRuntime.monitorErrorText.value = '';
    topbarRuntime.monitorBusy.value = false;
    topbarRuntime.agentAvailable.value = true;
    topbarRuntime.agentConnected.value = false;
    topbarRuntime.agentStatusText.value = '等待获取';
    topbarRuntime.agentErrorText.value = '';
    topbarRuntime.agentBusy.value = false;
  });

  afterEach(() => {
    delete window.bidkingDesktop;
    vi.restoreAllMocks();
  });

  it('renders brand link and consolidated nav links', async () => {
    const w = mountBar();
    await flushPromises();

    expect(w.find('.brand').text()).toBe('BKToolBox');
    const links = w.findAll('.nav a').map(a => a.attributes('href'));
    expect(links).toEqual(['/', '/Tools', '/Monitor', '/Inject']);
    expect(w.find('.nav').text()).not.toContain('Ahmed');
    expect(w.find('.nav').text()).not.toContain('Ethan');
  });

  it('marks only the active page link', async () => {
    const w = mountBar('tools');
    await flushPromises();

    const active = w.findAll('.nav a').filter(a => a.classes('active'));
    expect(active).toHaveLength(1);
    expect(active[0].attributes('href')).toBe('/Tools');
  });

  it('prevents repeat navigation when clicking the active page link', async () => {
    const w = mountBar('inject');
    await flushPromises();
    await nextTick();

    const activeLink = w.findAll('.nav a').find((link) => link.classes('active'));
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    activeLink.element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps inactive page links navigable', async () => {
    const w = mountBar('inject');
    await flushPromises();
    await nextTick();

    const inactiveLink = w.findAll('.nav a').find((link) => link.attributes('href') === '/Monitor');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    inactiveLink.element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('dispatches a leave-tools event before navigating away from Tools', async () => {
    const w = mountBar('tools');
    await flushPromises();
    await nextTick();

    const handler = vi.fn();
    window.addEventListener('bidking:leave-tools', handler);

    const inactiveLink = w.findAll('.nav a').find((link) => link.attributes('href') === '/Monitor');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    inactiveLink.element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener('bidking:leave-tools', handler);
  });

  it('renders the shared monitor switch in the topbar', async () => {
    const w = mountBar();
    await flushPromises();
    await nextTick();

    expect(w.find('[data-testid="topbar-monitor-switch"]').exists()).toBe(true);
    expect(topbarRuntime.refreshStatus).toHaveBeenCalledTimes(1);
    expect(topbarRuntime.ensureStreamConnected).toHaveBeenCalledTimes(1);
  });

  it('hides the agent switch when desktop agent bridge is unavailable', async () => {
    topbarRuntime.agentAvailable.value = false;
    const w = mountBar();
    await flushPromises();
    await nextTick();

    expect(w.find('[data-testid="topbar-agent-switch"]').exists()).toBe(false);
    expect(topbarRuntime.refreshAgentState).not.toHaveBeenCalled();
  });

  it('calls the shared monitor and agent toggle handlers', async () => {
    const w = mountBar();
    await flushPromises();
    await nextTick();

    await w.find('[data-testid="topbar-monitor-switch"]').trigger('click');
    await w.find('[data-testid="topbar-agent-switch"]').trigger('click');

    expect(topbarRuntime.monitorToggle).toHaveBeenCalledTimes(1);
    expect(topbarRuntime.agentToggle).toHaveBeenCalledTimes(1);
    expect(topbarRuntime.refreshAgentState).toHaveBeenCalledTimes(1);
  });
});
