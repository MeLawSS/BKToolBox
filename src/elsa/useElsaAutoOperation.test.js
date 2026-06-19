/* @vitest-environment happy-dom */
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { useElsaAutoOperation } from './useElsaAutoOperation.js';
import { elsaExpectedPrice } from './elsaEstimateState.js';

// Mutable monitor/agent state shared across tests
let monitorRunning = false;
let agentConnected = false;
const mockLoadAgent = vi.fn();
const mockUnloadAgent = vi.fn();
const mockStopMonitor = vi.fn();

vi.mock('./elsaEstimateState.js', async () => {
  const { ref } = await import('vue');
  const elsaExpectedPrice = ref(0);
  return { elsaExpectedPrice };
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
    window.bidkingDesktop = {
      isDesktop: true,
      runAutoOperationCommand: vi.fn().mockResolvedValue({ ok: true, value: { rounds: 2, expectedPrice: 50000 }, response: {} }),
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
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.log.value.some(e => e.message.includes('已连接'))).toBe(true);
    expect(result.isEnabled.value).toBe(false); // auto-disabled after runScript completes
    wrapper.unmount();
  });

  it('disable() unloads agent only when this mode started it', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    await result.disable();
    await flushPromises();
    expect(mockUnloadAgent).toHaveBeenCalledTimes(1);
    expect(mockStopMonitor).not.toHaveBeenCalled();
    expect(result.isEnabled.value).toBe(false);
    wrapper.unmount();
  });

  it('disable() does NOT unload agent when agent was already running before enable()', async () => {
    monitorRunning = true;
    agentConnected = true; // already running before enable
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(mockLoadAgent).not.toHaveBeenCalled();
    await result.disable();
    await flushPromises();
    expect(mockUnloadAgent).not.toHaveBeenCalled();
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

  it('skips SetExpectedPrice and calls AutoAuction when price stays 0 after timeout', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 0;
    vi.useFakeTimers();
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    const enablePromise = result.enable();
    await flushPromises();
    vi.advanceTimersByTime(10000); // exhaust waitForPrice timeout
    await flushPromises();
    await enablePromise;
    await flushPromises();
    const calls = window.bidkingDesktop.runAutoOperationCommand.mock.calls;
    expect(calls.some(([name]) => name === 'SetExpectedPrice')).toBe(false);
    expect(calls.some(([name]) => name === 'AutoAuction')).toBe(true);
    expect(result.isEnabled.value).toBe(false);
    vi.useRealTimers();
    wrapper.unmount();
  });

  it('calls SetExpectedPrice then AutoAuction when price is already set', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    const calls = window.bidkingDesktop.runAutoOperationCommand.mock.calls;
    const priceIdx = calls.findIndex(([name]) => name === 'SetExpectedPrice');
    const auctionIdx = calls.findIndex(([name]) => name === 'AutoAuction');
    expect(priceIdx).toBeGreaterThanOrEqual(0);
    expect(auctionIdx).toBeGreaterThan(priceIdx);
    expect(calls[priceIdx][1]).toEqual({ price: 50000 });
    expect(calls[auctionIdx][1]).toMatchObject({ roomId: 101, useExpectedPrice: true });
    wrapper.unmount();
  });

  it('waits for price to appear then calls SetExpectedPrice before AutoAuction', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 0;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    const enablePromise = result.enable();
    await flushPromises();
    // Simulate price arriving after enable starts
    elsaExpectedPrice.value = 60000;
    await flushPromises();
    await enablePromise;
    await flushPromises();
    const calls = window.bidkingDesktop.runAutoOperationCommand.mock.calls;
    const priceIdx = calls.findIndex(([name]) => name === 'SetExpectedPrice');
    const auctionIdx = calls.findIndex(([name]) => name === 'AutoAuction');
    expect(priceIdx).toBeGreaterThanOrEqual(0);
    expect(calls[priceIdx][1]).toEqual({ price: 60000 });
    expect(auctionIdx).toBeGreaterThan(priceIdx);
    wrapper.unmount();
  });

  it('disable() is called automatically after runScript completes', async () => {
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    await result.enable();
    await flushPromises();
    expect(result.isEnabled.value).toBe(false);
    expect(result.log.value.some(e => e.message.includes('竞拍完成'))).toBe(true);
    wrapper.unmount();
  });
});
