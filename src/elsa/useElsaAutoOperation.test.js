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

async function advanceInitialExpectedPriceSync() {
  await vi.advanceTimersByTimeAsync(4000);
  await flushPromises();
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
    vi.useRealTimers();
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

  it('starts AutoAuction after the initial SetExpectedPrice sync completes', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    let resolveAutoAuction;
    const autoAuctionPromise = new Promise((resolve) => { resolveAutoAuction = resolve; });
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name, args) => {
      if (name === 'SetExpectedPrice') {
        return Promise.resolve({ ok: true, value: { price: args.price }, response: {} });
      }
      if (name === 'AutoAuction') {
        return autoAuctionPromise;
      }
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    try {
      await result.enable();
      await flushPromises();

      expect(window.bidkingDesktop.runAutoOperationCommand.mock.calls.map(([name]) => name)).not.toContain('AutoAuction');

      await advanceInitialExpectedPriceSync();

      const calls = window.bidkingDesktop.runAutoOperationCommand.mock.calls;
      expect(calls.some(([name]) => name === 'SetExpectedPrice')).toBe(true);
      expect(calls.some(([name]) => name === 'AutoAuction')).toBe(true);
    } finally {
      resolveAutoAuction?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 100000 }, response: {} });
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('starts a new AutoAuction round after the previous round completes', async () => {
    vi.useFakeTimers();
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
    try {
      await result.enable();
      await flushPromises();
      await advanceInitialExpectedPriceSync();

      expect(window.bidkingDesktop.runAutoOperationCommand.mock.calls.filter(([name]) => name === 'AutoAuction')).toHaveLength(1);
      auctionResolvers[0]?.({ ok: true, value: { rounds: 2, expectedPrice: 50000 }, response: {} });
      await flushPromises();
      expect(window.bidkingDesktop.runAutoOperationCommand.mock.calls.filter(([name]) => name === 'AutoAuction')).toHaveLength(2);
      expect(result.isEnabled.value).toBe(true);
      expect(result.log.value.some(e => e.message.includes('竞拍完成'))).toBe(true);
      await result.disable();
      await flushPromises();
      auctionResolvers[1]?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 0 }, response: {} });
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('logs a stopped message instead of completion when AutoAuction is canceled', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    window.bidkingDesktop.runAutoOperationCommand.mockResolvedValue({
      ok: true,
      value: { result: 'canceled', rounds: 1, expectedPrice: 50000 },
      response: {},
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    try {
      await result.enable();
      await flushPromises();
      await advanceInitialExpectedPriceSync();
      expect(result.log.value.some(e => e.message.includes('自动竞拍已停止'))).toBe(true);
      expect(result.log.value.some(e => e.message.includes('竞拍完成'))).toBe(false);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('stops auto operation and shows a desktop notification when AutoAuction requires auth code', async () => {
    vi.useFakeTimers();
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
    try {
      await result.enable();
      await flushPromises();
      await advanceInitialExpectedPriceSync();

      expect(autoAuctionCalls).toBe(1);
      expect(result.isEnabled.value).toBe(false);
      expect(mockUnloadAgent).toHaveBeenCalledTimes(1);
      expect(window.bidkingDesktop.showNotification).toHaveBeenCalledWith(
        'BKToolBox',
        expect.stringContaining('验证'),
      );
      expect(result.log.value.some(e => e.message.includes('验证'))).toBe(true);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('logs a warning when the desktop notification request returns a non-ok result', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    window.bidkingDesktop.showNotification.mockResolvedValue({ ok: false, error: 'missing title' });
    window.bidkingDesktop.runAutoOperationCommand.mockResolvedValue({
      ok: true,
      value: { result: 'authcode_required', rounds: 0, expectedPrice: 50000 },
      response: {},
    });
    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    try {
      await result.enable();
      await flushPromises();
      await advanceInitialExpectedPriceSync();

      expect(result.log.value.some(
        e => e.level === 'warn' && e.message.includes('Windows 通知发送失败')
      )).toBe(true);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('waits for the first debounced SetExpectedPrice before starting AutoAuction', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    elsaAutoBidKnownQualityKeys.value = [];

    let resolveAutoAuction;
    const autoAuctionPromise = new Promise((resolve) => { resolveAutoAuction = resolve; });
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name, args) => {
      if (name === 'SetExpectedPrice') {
        return Promise.resolve({ ok: true, value: { price: args.price }, response: {} });
      }
      if (name === 'AutoAuction') {
        return autoAuctionPromise;
      }
      if (name === 'CancelAutoAuction') {
        return Promise.resolve({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 100000 }, response: {} });
      }
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    try {
      await result.enable();
      await flushPromises();

      expect(result.isEnabled.value).toBe(true);
      expect(result.isBusy.value).toBe(false);
      expect(window.bidkingDesktop.writeDataFile).toHaveBeenCalledWith('Price', '100000');
      const commandNamesBeforeDelay = window.bidkingDesktop.runAutoOperationCommand.mock.calls.map(([name]) => name);
      expect(commandNamesBeforeDelay).not.toContain('AutoAuction');

      await vi.advanceTimersByTimeAsync(3999);
      await flushPromises();
      const commandsBeforeFire = window.bidkingDesktop.runAutoOperationCommand.mock.calls.map(([name]) => name);
      expect(commandsBeforeFire).not.toContain('SetExpectedPrice');

      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();

      const setExpectedIndex = window.bidkingDesktop.runAutoOperationCommand.mock.calls.findIndex(([name]) => name === 'SetExpectedPrice');
      const autoAuctionIndex = window.bidkingDesktop.runAutoOperationCommand.mock.calls.findIndex(([name]) => name === 'AutoAuction');
      expect(setExpectedIndex).toBeGreaterThanOrEqual(0);
      expect(autoAuctionIndex).toBeGreaterThanOrEqual(0);
      expect(setExpectedIndex).toBeLessThan(autoAuctionIndex);
      expect(window.bidkingDesktop.runAutoOperationCommand.mock.calls[setExpectedIndex]).toEqual([
        'SetExpectedPrice',
        { price: 100000 },
      ]);
      expect(window.bidkingDesktop.runAutoOperationCommand.mock.calls[autoAuctionIndex]).toEqual([
        'AutoAuction',
        { roomId: 101, useExpectedPrice: true },
      ]);
    } finally {
      resolveAutoAuction?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 100000 }, response: {} });
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('lets disable cancel the initial debounce before SetExpectedPrice and AutoAuction fire', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 40000;
    elsaAutoBidKnownQualityKeys.value = [];

    let resolveAutoAuction;
    const autoAuctionPromise = new Promise((resolve) => { resolveAutoAuction = resolve; });
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'AutoAuction') {
        return autoAuctionPromise;
      }
      if (name === 'CancelAutoAuction') {
        return Promise.resolve({ ok: true, value: { cancelRequested: false, running: false }, response: {} });
      }
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    try {
      await result.enable();
      await flushPromises();

      expect(result.isBusy.value).toBe(false);
      await result.disable();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(4000);
      await flushPromises();

      const commandNames = window.bidkingDesktop.runAutoOperationCommand.mock.calls.map(([name]) => name);
      expect(commandNames).not.toContain('SetExpectedPrice');
      expect(commandNames).not.toContain('AutoAuction');
      expect(result.isEnabled.value).toBe(false);
    } finally {
      resolveAutoAuction?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 0 }, response: {} });
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('debounces consecutive price changes and only syncs the last SetExpectedPrice value', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    elsaAutoBidKnownQualityKeys.value = [];

    let resolveAutoAuction;
    const autoAuctionPromise = new Promise((resolve) => { resolveAutoAuction = resolve; });
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name, args) => {
      if (name === 'SetExpectedPrice') {
        return Promise.resolve({ ok: true, value: { price: args.price }, response: {} });
      }
      if (name === 'AutoAuction') return autoAuctionPromise;
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    try {
      await result.enable();
      await flushPromises();

      elsaExpectedPrice.value = 60000;
      await flushPromises();
      await vi.advanceTimersByTimeAsync(2000);
      elsaExpectedPrice.value = 70000;
      await flushPromises();
      await vi.advanceTimersByTimeAsync(3999);
      await flushPromises();

      const setExpectedCallsBeforeFire = window.bidkingDesktop.runAutoOperationCommand.mock.calls
        .filter(([name]) => name === 'SetExpectedPrice');
      expect(setExpectedCallsBeforeFire).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();

      const setExpectedCalls = window.bidkingDesktop.runAutoOperationCommand.mock.calls
        .filter(([name]) => name === 'SetExpectedPrice');
      expect(setExpectedCalls).toHaveLength(1);
      expect(setExpectedCalls[0]).toEqual(['SetExpectedPrice', { price: 140000 }]);
      expect(window.bidkingDesktop.writeDataFile).toHaveBeenLastCalledWith('Price', '140000');
    } finally {
      resolveAutoAuction?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 50000 }, response: {} });
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('stays disabled when the initial SetExpectedPrice sync fails', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    elsaAutoBidKnownQualityKeys.value = [];

    let resolveAutoAuction;
    const autoAuctionPromise = new Promise((resolve) => { resolveAutoAuction = resolve; });
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name) => {
      if (name === 'SetExpectedPrice') {
        return Promise.reject(new Error('pipe down'));
      }
      if (name === 'AutoAuction') {
        return autoAuctionPromise;
      }
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    try {
      await result.enable();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(4000);
      await flushPromises();

      expect(result.isEnabled.value).toBe(false);
      expect(window.bidkingDesktop.runAutoOperationCommand).not.toHaveBeenCalledWith(
        'AutoAuction',
        expect.anything(),
      );
      expect(result.log.value.some(
        e => e.level === 'error' && e.message.includes('初始化自动竞拍价格同步失败')
      )).toBe(true);
    } finally {
      resolveAutoAuction?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 0 }, response: {} });
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('logs a warn entry when a live SetExpectedPrice resync fails after AutoAuction has started', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    elsaAutoBidKnownQualityKeys.value = [];

    let setExpectedCount = 0;
    let resolveAutoAuction;
    const autoAuctionPromise = new Promise((resolve) => { resolveAutoAuction = resolve; });
    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name, args) => {
      if (name === 'SetExpectedPrice') {
        setExpectedCount += 1;
        if (setExpectedCount === 1) {
          return Promise.resolve({ ok: true, value: { price: args.price }, response: {} });
        }
        return Promise.reject(new Error('bridge lost'));
      }
      if (name === 'AutoAuction') return autoAuctionPromise;
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    try {
      await result.enable();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(4000);
      await flushPromises();

      const autoAuctionCallIndex = window.bidkingDesktop.runAutoOperationCommand.mock.calls.findIndex(([name]) => name === 'AutoAuction');
      expect(autoAuctionCallIndex).toBeGreaterThanOrEqual(0);

      elsaExpectedPrice.value = 65000;
      await flushPromises();
      await vi.advanceTimersByTimeAsync(4000);
      await flushPromises();

      expect(result.isEnabled.value).toBe(true);
      expect(result.log.value.some(
        e => e.level === 'warn' && e.message.includes('同步自动竞拍价格失败')
      )).toBe(true);
    } finally {
      resolveAutoAuction?.({ ok: true, value: { result: 'canceled', rounds: 0, expectedPrice: 50000 }, response: {} });
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('ignores a late session-A SetExpectedPrice completion while session-B is waiting for its own initial sync', async () => {
    vi.useFakeTimers();
    monitorRunning = true;
    mockLoadAgent.mockImplementation(() => { agentConnected = true; return Promise.resolve(); });
    elsaExpectedPrice.value = 50000;
    elsaAutoBidKnownQualityKeys.value = [];

    let resolveSessionASetExpectedPrice;
    let resolveSessionBSetExpectedPrice;
    let setExpectedPriceCallCount = 0;
    let autoAuctionCalls = 0;
    const sessionBSetExpectedPricePromise = new Promise((resolve) => {
      resolveSessionBSetExpectedPrice = resolve;
    });

    window.bidkingDesktop.runAutoOperationCommand.mockImplementation((name, args) => {
      if (name === 'SetExpectedPrice') {
        setExpectedPriceCallCount += 1;
        if (setExpectedPriceCallCount === 1) {
          return new Promise((resolve) => {
            resolveSessionASetExpectedPrice = resolve;
          });
        }
        if (setExpectedPriceCallCount === 2) {
          return sessionBSetExpectedPricePromise;
        }
      }
      if (name === 'AutoAuction') {
        autoAuctionCalls += 1;
        return Promise.resolve({
          ok: true,
          value: { result: 'canceled', rounds: 0, expectedPrice: args?.price ?? 100000 },
          response: {},
        });
      }
      if (name === 'CancelAutoAuction') {
        return Promise.resolve({ ok: true, value: { canceled: true }, response: {} });
      }
      return Promise.resolve({ ok: true, value: {}, response: {} });
    });

    const { result, wrapper } = withSetup(() => useElsaAutoOperation());
    try {
      await result.enable();
      await flushPromises();
      await advanceInitialExpectedPriceSync();

      expect(setExpectedPriceCallCount).toBe(1);
      expect(autoAuctionCalls).toBe(0);

      await result.disable();
      await flushPromises();

      await result.enable();
      await flushPromises();

      await resolveSessionASetExpectedPrice?.({ ok: true, value: { price: 100000 }, response: {} });
      await flushPromises();

      expect(result.isEnabled.value).toBe(true);
      expect(autoAuctionCalls).toBe(0);
      expect(result.log.value.some(
        e => e.level === 'error' && e.message.includes('初始化自动竞拍价格同步失败')
      )).toBe(false);

      await advanceInitialExpectedPriceSync();
      expect(setExpectedPriceCallCount).toBe(2);
      expect(autoAuctionCalls).toBe(0);

      resolveSessionBSetExpectedPrice?.({ ok: true, value: { price: 100000 }, response: {} });
      await flushPromises();

      expect(autoAuctionCalls).toBe(1);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });
});
