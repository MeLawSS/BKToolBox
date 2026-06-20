/* @vitest-environment happy-dom */
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { useElsaAutoOperation } from './useElsaAutoOperation.js';
import { elsaAutoBidKnownQualityKeys, elsaExpectedPrice } from './elsaEstimateState.js';

// Mutable monitor/agent state shared across tests
let monitorRunning = false;
let agentConnected = false;
const mockLoadAgent = vi.fn();
const mockUnloadAgent = vi.fn();
const mockStopMonitor = vi.fn();

vi.mock('./elsaEstimateState.js', async () => {
  const { ref } = await import('vue');
  const elsaExpectedPrice = ref(0);
  const elsaAutoBidKnownQualityKeys = ref([]);
  const penalties = {
    white: 0,
    green: 0.3,
    blue: 0.7,
    purple: 0.7,
    orange: 0.7,
    red: 0.7,
  };
  function computeElsaAutoBidPrice(expectedPrice, knownQualityKeys) {
    const price = Number(expectedPrice);
    if (!Number.isFinite(price) || price <= 0) return 0;
    const penalty = [...new Set(Array.isArray(knownQualityKeys) ? knownQualityKeys : [])]
      .reduce((sum, key) => sum + (penalties[key] ?? 0), 0);
    return Math.floor(price * Math.max(1, 2 - penalty));
  }
  return { elsaExpectedPrice, elsaAutoBidKnownQualityKeys, computeElsaAutoBidPrice };
});

vi.mock('../shared/useMonitorSwitch.js', () => ({
  useMonitorSwitch: () => ({
    status: { get value() { return { running: monitorRunning, state: monitorRunning ? 'capturing' : 'idle' }; } },
    stopMonitor: mockStopMonitor,
  }),
}));

vi.mock('../shared/useAutoOperationAgentSwitch.js', () => ({
  useAutoOperationAgentSwitch: () => ({
    isConnected: { get value() { return agentConnected; } },
    isBusy: ref(false),
    loadAgent: mockLoadAgent,
    unloadAgent: mockUnloadAgent,
  }),
}));

// Mount a wrapper component so lifecycle hooks work
function withSetup(fn) {
  let result;
  const Wrapper = defineComponent({
    setup() { result = fn(); return {}; },
    template: '<div/>',
  });
  const wrapper = mount(Wrapper, { attachTo: document.body });
  return { result, wrapper };
}

describe('useElsaAutoOperation', () => {
  beforeEach(() => {
    monitorRunning = false;
    agentConnected = false;
    mockLoadAgent.mockResolvedValue(undefined);
    mockUnloadAgent.mockResolvedValue(undefined);
    mockStopMonitor.mockResolvedValue(undefined);
    elsaExpectedPrice.value = 0;
    elsaAutoBidKnownQualityKeys.value = [];
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand: vi.fn().mockResolvedValue({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 0 }, response: {} }),
      writeDataFile: vi.fn().mockResolvedValue(undefined),
      showNotification: vi.fn().mockResolvedValue({ ok: true, shown: true }),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts disabled with empty log', () => {
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    expect(result.isEnabled.value).toBe(false);
    expect(result.isBusy.value).toBe(false);
    expect(result.log.value).toHaveLength(0);
    wrapper.unmount();
  });

  it('enable() fails and stays disabled when monitor is not running', async () => {
    monitorRunning = false;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(false);
    expect(mockLoadAgent).not.toHaveBeenCalled();
    expect(result.log.value.some(e => e.level === 'error')).toBe(true);
    wrapper.unmount();
  });

  it('enable() fails and stays disabled when agent start fails', async () => {
    monitorRunning = true;
    mockLoadAgent.mockRejectedValue(new Error('no bridge'));
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(false);
    expect(result.log.value.some(e => e.level === 'error')).toBe(true);
    wrapper.unmount();
  });

  it('enable() succeeds when monitor running and agent starts', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    let resolveAuction;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') return new Promise((resolve) => { resolveAuction = resolve; });
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.log.value.some(e => e.message.includes('已连接'))).toBe(true);
    expect(result.isEnabled.value).toBe(true);
    await result.disable();
    await flushPromises();
    resolveAuction?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 0 }, response: {} });
    wrapper.unmount();
  });

  it('disable() unloads agent only when this mode started it', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    let resolveAuction;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') return new Promise(r => { resolveAuction = r; });
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    await result.disable();
    await flushPromises();
    expect(window.bidkingDesktop.runAutoOperationCommand).toHaveBeenCalledWith('CancelAutoAuction', {});
    expect(mockUnloadAgent).toHaveBeenCalledTimes(1);
    expect(mockStopMonitor).not.toHaveBeenCalled();
    expect(result.isEnabled.value).toBe(false);
    resolveAuction?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 0 }, response: {} });
    wrapper.unmount();
  });

  it('disable() does NOT unload agent when agent was already running before enable()', async () => {
    monitorRunning = true;
    agentConnected = true; // already running before enable
    let resolveAuction;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') return new Promise(r => { resolveAuction = r; });
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(mockLoadAgent).not.toHaveBeenCalled();
    await result.disable();
    await flushPromises();
    expect(window.bidkingDesktop.runAutoOperationCommand).toHaveBeenCalledWith('CancelAutoAuction', {});
    expect(mockUnloadAgent).not.toHaveBeenCalled();
    resolveAuction?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 0 }, response: {} });
    wrapper.unmount();
  });

  it('clearLog() empties the log', async () => {
    monitorRunning = false;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable(); // generates a log entry (error)
    await flushPromises();
    expect(result.log.value.length).toBeGreaterThan(0);
    result.clearLog();
    expect(result.log.value).toHaveLength(0);
    wrapper.unmount();
  });

  it('caps log at 200 entries', async () => {
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    for (let i = 0; i < 201; i++) {
      await result.enable();
      await flushPromises();
    }
    expect(result.log.value.length).toBeLessThanOrEqual(200);
    wrapper.unmount();
  });

  it('calls disable() when bidking:leave-tools fires', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    let resolveAuction;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') return new Promise(r => { resolveAuction = r; });
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(true); // still enabled before script completes
    window.dispatchEvent(new CustomEvent('bidking:leave-tools'));
    await flushPromises();
    expect(result.isEnabled.value).toBe(false);
    resolveAuction?.({ ok: true, value: { rounds: 0, expectedPrice: 0 }, response: {} });
    wrapper.unmount();
  });

  it('removes event listener on unmount', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { wrapper } = withSetup(() => useElsaAutoOperation());
    wrapper.unmount();
    expect(removeSpy).toHaveBeenCalledWith('bidking:leave-tools', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('writes price file immediately on enable with current price', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 55000;
    elsaAutoBidKnownQualityKeys.value = [];
    let resolveAuction;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') return new Promise(r => { resolveAuction = r; });
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(window.bidkingDesktop.writeDataFile).toHaveBeenCalledWith('Price', '110000');
    resolveAuction?.({ ok: true, value: { rounds: 0, expectedPrice: 0 }, response: {} });
    wrapper.unmount();
  });

  it('writes price file again when elsaExpectedPrice changes during auction', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 40000;
    elsaAutoBidKnownQualityKeys.value = ['green'];
    let resolveAuction;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') return new Promise(r => { resolveAuction = r; });
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(true);
    // Price updates mid-auction
    elsaExpectedPrice.value = 60000;
    await flushPromises();
    expect(window.bidkingDesktop.writeDataFile).toHaveBeenCalledWith('Price', '102000');
    resolveAuction?.({ ok: true, value: { rounds: 0, expectedPrice: 0 }, response: {} });
    wrapper.unmount();
  });

  it('rewrites the price file when the known-quality penalty changes during auction', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    elsaAutoBidKnownQualityKeys.value = [];
    let resolveAuction;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') return new Promise(r => { resolveAuction = r; });
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();

    elsaAutoBidKnownQualityKeys.value = ['green', 'blue', 'orange'];
    await flushPromises();

    expect(result.isEnabled.value).toBe(true);
    expect(window.bidkingDesktop.writeDataFile).toHaveBeenCalledWith('Price', '50000');
    resolveAuction?.({ ok: true, value: { rounds: 0, expectedPrice: 0 }, response: {} });
    wrapper.unmount();
  });

  it('does not write price file after disable stops the watcher', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 30000;
    let resolveAuction;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') return new Promise(r => { resolveAuction = r; });
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    await result.disable();
    await flushPromises();
    const callsBefore = window.bidkingDesktop.writeDataFile.mock.calls.length;
    elsaExpectedPrice.value = 99000;
    await flushPromises();
    expect(window.bidkingDesktop.writeDataFile.mock.calls.length).toBe(callsBefore);
    resolveAuction?.({ ok: true, value: { rounds: 0, expectedPrice: 0 }, response: {} });
    wrapper.unmount();
  });

  it('calls AutoAuction without SetExpectedPrice', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    const calls = window.bidkingDesktop.runAutoOperationCommand.mock.calls;
    expect(calls.some(([name]) => name === 'SetExpectedPrice')).toBe(false);
    expect(calls.some(([name]) => name === 'AutoAuction')).toBe(true);
    wrapper.unmount();
  });

  it('starts a new AutoAuction round after the previous round completes', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    const auctionResolvers = [];
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') {
        return new Promise((resolve) => {
          auctionResolvers.push(resolve);
        });
      }
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(window.bidkingDesktop.runAutoOperationCommand.mock.calls.filter(([name]) => name === 'AutoAuction')).toHaveLength(1);
    auctionResolvers[0]?.({ ok: true, value: { rounds: 2, expectedPrice: 50000 }, response: {} });
    await flushPromises();
    expect(window.bidkingDesktop.runAutoOperationCommand.mock.calls.filter(([name]) => name === 'AutoAuction')).toHaveLength(2);
    expect(result.isEnabled.value).toBe(true);
    expect(result.log.value.some(e => e.message.includes('竞拍完成'))).toBe(true);
    await result.disable();
    await flushPromises();
    auctionResolvers[1]?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 0 }, response: {} });
    wrapper.unmount();
  });

  it('logs a stopped message instead of completion when AutoAuction is canceled', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    window.bidkingDesktop.runAutoOperationCommand.mockResolvedValue({
      ok: true,
      value: { result: 'canceled', rounds: 1, expectedPrice: 50000 },
      response: {},
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.log.value.some(e => e.message.includes('自动竞拍已停止'))).toBe(true);
    expect(result.log.value.some(e => e.message.includes('竞拍完成'))).toBe(false);
    wrapper.unmount();
  });

  it('stops auto operation and shows a desktop notification when AutoAuction requires auth code', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    let autoAuctionCalls = 0;
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') {
        autoAuctionCalls += 1;
        if (autoAuctionCalls === 1) {
          return Promise.resolve({
            ok: true,
            value: { result: 'authcode_required', rounds: 0, expectedPrice: 50000 },
            response: {},
          });
        }
        return new Promise(() => {});
      }
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();

    expect(autoAuctionCalls).toBe(1);
    expect(result.isEnabled.value).toBe(false);
    expect(mockUnloadAgent).toHaveBeenCalledTimes(1);
    expect(window.bidkingDesktop.showNotification).toHaveBeenCalledWith(
      'BKToolBox',
      expect.stringContaining('验证'),
    );
    expect(result.log.value.some(e => e.message.includes('验证'))).toBe(true);
    wrapper.unmount();
  });
});
