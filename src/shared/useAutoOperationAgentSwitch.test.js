/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, isReadonly, nextTick } from 'vue';
import {
  __resetAutoOperationAgentSwitchRuntimeForTest,
  useAutoOperationAgentRuntimeState,
  useAutoOperationAgentSwitch,
} from './useAutoOperationAgentSwitch.js';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function mountHook() {
  const Probe = defineComponent({
    setup() {
      return useAutoOperationAgentSwitch();
    },
    template: '<div />',
  });

  return mount(Probe, { attachTo: document.body });
}

function mountPassiveHook() {
  const Probe = defineComponent({
    setup() {
      return useAutoOperationAgentRuntimeState();
    },
    template: '<div />',
  });

  return mount(Probe, { attachTo: document.body });
}

function capturePassiveHook() {
  let runtimeState = null;
  const Probe = defineComponent({
    setup() {
      runtimeState = useAutoOperationAgentRuntimeState();
      return runtimeState;
    },
    template: '<div />',
  });

  const wrapper = mount(Probe, { attachTo: document.body });
  return {
    wrapper,
    getRuntimeState() {
      return runtimeState;
    },
  };
}

describe('useAutoOperationAgentSwitch', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    __resetAutoOperationAgentSwitchRuntimeForTest();
    window.sessionStorage.clear();
    delete window.bidkingDesktop;
    vi.restoreAllMocks();
  });

  it('reports unavailable when desktop bridge is missing', async () => {
    const wrapper = mountHook();
    await flushPromises();
    await nextTick();

    expect(wrapper.vm.isAvailable).toBe(false);
    expect(wrapper.vm.isConnected).toBe(false);
    expect(wrapper.vm.errorText).toBe('');
  });

  it('probes the agent once and marks the switch on when Ping succeeds', async () => {
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = mountHook();
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('Ping', {});
    expect(runAutoOperationCommand).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.isAvailable).toBe(true);
    expect(wrapper.vm.isConnected).toBe(true);
    expect(wrapper.vm.errorText).toBe('');
  });

  it('treats an initial Ping failure as off without surfacing an error', async () => {
    const runAutoOperationCommand = vi.fn().mockRejectedValue(new Error('connect ENOENT'));
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = mountHook();
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('Ping', {});
    expect(wrapper.vm.isAvailable).toBe(true);
    expect(wrapper.vm.isConnected).toBe(false);
    expect(wrapper.vm.errorText).toBe('');
  });

  it('loads the agent and reuses the shared in-flight request across consumers', async () => {
    const startAutoOperationAgent = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent,
      runAutoOperationCommand,
    };

    const first = mountHook();
    const second = mountHook();
    await flushPromises();
    await nextTick();

    const loadA = first.vm.loadAgent();
    const loadB = second.vm.loadAgent();
    await Promise.all([loadA, loadB]);
    await flushPromises();
    await nextTick();

    expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('Ping', {});
    expect(first.vm.isConnected).toBe(true);
    expect(second.vm.isConnected).toBe(true);
    expect(first.vm.errorText).toBe('');
  });

  it('unloads the agent through the shared command path and keeps consumers in sync', async () => {
    const startAutoOperationAgent = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { pong: true } })
      .mockResolvedValueOnce({ ok: true, value: { unloading: true } });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent,
      runAutoOperationCommand,
    };

    const first = mountHook();
    const second = mountHook();
    await flushPromises();
    await nextTick();

    await first.vm.loadAgent();
    await flushPromises();
    await nextTick();
    expect(first.vm.isConnected).toBe(true);

    const unloadA = first.vm.unloadAgent();
    const unloadB = second.vm.unloadAgent();
    await Promise.all([unloadA, unloadB]);
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('UnloadAgent', {});
    expect(runAutoOperationCommand).toHaveBeenCalledTimes(2);
    expect(first.vm.isConnected).toBe(false);
    expect(second.vm.isConnected).toBe(false);
  });

  it('treats an unload failure caused by process exit as already offline', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { pong: true } })
      .mockRejectedValueOnce(new Error('connect ENOENT \\\\.\\pipe\\BKAutoOp'));
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = mountHook();
    await flushPromises();
    await nextTick();

    expect(wrapper.vm.isConnected).toBe(true);

    await expect(wrapper.vm.unloadAgent()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          alreadyOffline: true,
        }),
      }),
    );
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('UnloadAgent', {});
    expect(wrapper.vm.isConnected).toBe(false);
    expect(wrapper.vm.errorText).toBe('');
  });

  it('keeps only one pending refresh across multiple consumers', async () => {
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const first = mountHook();
    const second = mountHook();
    await Promise.all([first.vm.refreshAgentState(), second.vm.refreshAgentState()]);
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledTimes(1);
    expect(first.vm.isConnected).toBe(true);
    expect(second.vm.isConnected).toBe(true);
  });

  it('restores the last known connected state before a fresh Ping settles after remount', async () => {
    const initialPing = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: initialPing,
    };

    const first = mountHook();
    await flushPromises();
    await nextTick();

    expect(first.vm.isConnected).toBe(true);

    first.unmount();
    __resetAutoOperationAgentSwitchRuntimeForTest();

    const deferredPing = createDeferred();
    const pendingPing = vi.fn().mockImplementation(() => deferredPing.promise);
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: pendingPing,
    };

    const second = mountHook();

    expect(second.vm.isConnected).toBe(true);

    deferredPing.resolve({ ok: true, value: { pong: true } });
    await flushPromises();
    await nextTick();

    expect(pendingPing).toHaveBeenCalledWith('Ping', {});
    expect(second.vm.isConnected).toBe(true);
  });

  it('does not expose the passive initial Ping probe as a busy state', async () => {
    const deferredPing = createDeferred();
    const runAutoOperationCommand = vi.fn().mockImplementation(() => deferredPing.promise);
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = mountHook();

    expect(wrapper.vm.isBusy).toBe(false);

    deferredPing.resolve({ ok: true, value: { pong: true } });
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('Ping', {});
    expect(wrapper.vm.isBusy).toBe(false);
  });

  it('exposes a passive runtime view without probing the agent on mount', async () => {
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = mountPassiveHook();
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).not.toHaveBeenCalled();
    expect(wrapper.vm.isAvailable).toBe(true);
    expect(wrapper.vm.isConnected).toBe(false);
    expect(wrapper.vm.statusText).toBe('等待获取');
  });

  it('lets passive consumers observe shared agent state after an active probe', async () => {
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const activeWrapper = mountHook();
    await flushPromises();
    await nextTick();

    const passiveWrapper = mountPassiveHook();
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledTimes(1);
    expect(activeWrapper.vm.isConnected).toBe(true);
    expect(passiveWrapper.vm.isAvailable).toBe(true);
    expect(passiveWrapper.vm.isConnected).toBe(true);
    expect(passiveWrapper.vm.statusText).toBe('已连接');
  });

  it('exposes passive runtime state as readonly refs', async () => {
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
    };

    const { wrapper, getRuntimeState } = capturePassiveHook();
    await flushPromises();
    await nextTick();

    const runtimeState = getRuntimeState();

    expect(isReadonly(runtimeState.isConnected)).toBe(true);
    expect(isReadonly(runtimeState.errorText)).toBe(true);
    expect(isReadonly(runtimeState.isBusy)).toBe(true);

    wrapper.unmount();
  });
});
