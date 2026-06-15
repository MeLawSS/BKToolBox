/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCollectionPriceScanController,
  normalizeConfig,
} from './collection-price-scan-controller.js';

let controller;
let runAutoOperationCommand;
let startAutoOperationAgent;
let recordCollectionCids;
let recordTradeInfoSnapshot;

function createController(overrides = {}) {
  controller = createCollectionPriceScanController({
    startAutoOperationAgent,
    runAutoOperationCommand,
    recordCollectionCids,
    recordTradeInfoSnapshot,
    random: () => 0,
    ...overrides,
  });
  return controller;
}

async function flushAsyncWork() {
  await vi.advanceTimersByTimeAsync(0);
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  runAutoOperationCommand = vi.fn()
    .mockResolvedValueOnce({ ok: true, value: { cids: [1032006, 1013007], count: 2 } })
    .mockResolvedValueOnce({ ok: true, value: { itemCid: 1032006, tiers: [{ price: 6200, count: 3 }] } })
    .mockResolvedValueOnce({ ok: true, value: { itemCid: 1013007, tiers: [{ price: 100, count: 1 }] } });
  startAutoOperationAgent = vi.fn().mockResolvedValue({ ok: true });
  recordCollectionCids = vi.fn().mockReturnValue({ written: true, itemCids: [1032006, 1013007] });
  recordTradeInfoSnapshot = vi.fn((snapshot) => ({
    ok: true,
    itemCid: snapshot.itemCid,
    minPrice: snapshot.tiers[0].price,
    tierCount: 1,
    totalCount: snapshot.tiers[0].count,
  }));
  createController();
});

afterEach(() => {
  controller?.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('collection price scan controller', () => {
  it('starts by loading cids and querying each item with configured delay', async () => {
    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await flushAsyncWork();

    expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetCollectionItemCids', {});
    expect(recordCollectionCids).toHaveBeenCalledWith([1032006, 1013007]);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1032006 });
    expect(recordTradeInfoSnapshot).toHaveBeenCalledWith({ itemCid: 1032006, tiers: [{ price: 6200, count: 3 }] });
    expect(controller.getState()).toMatchObject({ state: 'waiting_item', completedCount: 1, writtenCount: 1 });

    await vi.advanceTimersByTimeAsync(4999);
    expect(runAutoOperationCommand).not.toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });

    await vi.advanceTimersByTimeAsync(1);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });
    await flushAsyncWork();
    expect(recordTradeInfoSnapshot).toHaveBeenCalledWith({ itemCid: 1013007, tiers: [{ price: 100, count: 1 }] });
    expect(controller.getState()).toMatchObject({ state: 'waiting_cycle', completedCount: 2, writtenCount: 2 });
  });

  it('stops during wait and prevents the next item query', async () => {
    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await flushAsyncWork();

    controller.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(runAutoOperationCommand).not.toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });
    expect(controller.getState().state).toBe('stopped');
  });

  it('cleans up item wait when a subscriber stops during waiting_item publish', async () => {
    let stoppedFromSubscriber = false;
    controller.subscribe((snapshot) => {
      if (snapshot.state === 'waiting_item' && !stoppedFromSubscriber) {
        stoppedFromSubscriber = true;
        controller.stop();
      }
    });

    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await flushAsyncWork();

    expect(stoppedFromSubscriber).toBe(true);
    expect(controller.getState()).toMatchObject({ state: 'stopped', enabled: false });
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(5000);

    expect(runAutoOperationCommand).not.toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });
  });

  it('does not start the Agent when a subscriber stops during initial running publish', async () => {
    let stoppedFromSubscriber = false;
    controller.subscribe((snapshot) => {
      if (snapshot.state === 'running' && snapshot.currentCid === null && !stoppedFromSubscriber) {
        stoppedFromSubscriber = true;
        controller.stop();
      }
    });

    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await flushAsyncWork();

    expect(stoppedFromSubscriber).toBe(true);
    expect(startAutoOperationAgent).not.toHaveBeenCalled();
    expect(runAutoOperationCommand).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({ state: 'stopped', enabled: false });
  });

  it('does not query an item when a subscriber stops during item running publish', async () => {
    let stoppedFromSubscriber = false;
    controller.subscribe((snapshot) => {
      if (snapshot.state === 'running' && snapshot.currentCid === 1032006 && !stoppedFromSubscriber) {
        stoppedFromSubscriber = true;
        controller.stop();
      }
    });

    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await flushAsyncWork();

    expect(stoppedFromSubscriber).toBe(true);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetCollectionItemCids', {});
    expect(runAutoOperationCommand).not.toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1032006 });
    expect(controller.getState()).toMatchObject({ state: 'stopped', enabled: false });
  });

  it('does not restart while stopping an in-flight item query', async () => {
    let resolveFirstTradeInfo;
    runAutoOperationCommand = vi.fn((command, args) => {
      if (command === 'GetCollectionItemCids') {
        return Promise.resolve({ ok: true, value: { cids: [1032006, 1013007], count: 2 } });
      }
      if (command === 'GetItemTradeInfo' && args.itemCid === 1032006) {
        return new Promise((resolve) => {
          resolveFirstTradeInfo = resolve;
        });
      }
      return Promise.resolve({ ok: true, value: { itemCid: args.itemCid, tiers: [{ price: 100, count: 1 }] } });
    });
    createController();

    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 1, itemJitterSeconds: 0 });
    await flushAsyncWork();
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1032006 });

    controller.stop();
    const restartState = controller.start({ scanIntervalMinutes: 30, itemDelaySeconds: 0, itemJitterSeconds: 0 });

    expect(restartState).toMatchObject({ state: 'stopping', enabled: false });
    expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);
    expect(runAutoOperationCommand).toHaveBeenCalledTimes(2);

    resolveFirstTradeInfo({ ok: true, value: { itemCid: 1032006, tiers: [{ price: 6200, count: 3 }] } });
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(1000);

    expect(runAutoOperationCommand).not.toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });
    expect(controller.getState()).toMatchObject({ state: 'stopped', enabled: false });
  });

  it('finishes stopped when startup rejects after stop was requested', async () => {
    const startup = createDeferred();
    startAutoOperationAgent = vi.fn().mockReturnValue(startup.promise);
    createController();

    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 1, itemJitterSeconds: 0 });
    await flushAsyncWork();

    controller.stop();
    startup.reject(new Error('agent unavailable'));
    await flushAsyncWork();

    expect(runAutoOperationCommand).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({ state: 'stopped', enabled: false });
  });

  it('finishes stopped when collection cid loading rejects after stop was requested', async () => {
    const cidLoad = createDeferred();
    runAutoOperationCommand = vi.fn((command) => {
      if (command === 'GetCollectionItemCids') return cidLoad.promise;
      return Promise.resolve({ ok: true, value: { itemCid: 1032006, tiers: [{ price: 6200, count: 3 }] } });
    });
    createController();

    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 1, itemJitterSeconds: 0 });
    await flushAsyncWork();

    controller.stop();
    cidLoad.reject(new Error('cid load failed'));
    await flushAsyncWork();

    expect(runAutoOperationCommand).not.toHaveBeenCalledWith('GetItemTradeInfo', expect.anything());
    expect(controller.getState()).toMatchObject({ state: 'stopped', enabled: false });
  });

  it('cancels waiting_item so a restarted scan is not affected by the old cycle', async () => {
    const delayedCallbacks = [];
    runAutoOperationCommand = vi.fn((command, args) => {
      if (command === 'GetCollectionItemCids') {
        const calls = runAutoOperationCommand.mock.calls.filter(([calledCommand]) => calledCommand === 'GetCollectionItemCids').length;
        const cids = calls === 1 ? [1032006, 1013007] : [2020001];
        return Promise.resolve({ ok: true, value: { cids, count: cids.length } });
      }
      return Promise.resolve({ ok: true, value: { itemCid: args.itemCid, tiers: [{ price: 6200, count: 3 }] } });
    });
    createController({
      setTimeout(fn) {
        delayedCallbacks.push(fn);
        return delayedCallbacks.length;
      },
      clearTimeout: vi.fn(),
    });

    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await flushAsyncWork();
    expect(controller.getState().state).toBe('waiting_item');

    controller.stop();
    controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await flushAsyncWork();

    delayedCallbacks[0]();
    await flushAsyncWork();

    expect(runAutoOperationCommand).not.toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 2020001 });
  });

  it('runs another scan after the configured cycle interval', async () => {
    runAutoOperationCommand = vi.fn((command) => {
      if (command === 'GetCollectionItemCids') {
        return Promise.resolve({ ok: true, value: { cids: [1032006], count: 1 } });
      }
      return Promise.resolve({ ok: true, value: { itemCid: 1032006, tiers: [{ price: 6200, count: 3 }] } });
    });
    createController();

    await controller.start({ scanIntervalMinutes: 1, itemDelaySeconds: 0, itemJitterSeconds: 0 });
    await flushAsyncWork();
    expect(controller.getState().state).toBe('waiting_cycle');
    expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'GetCollectionItemCids')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(59999);
    expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'GetCollectionItemCids')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await flushAsyncWork();
    expect(runAutoOperationCommand.mock.calls.filter(([command]) => command === 'GetCollectionItemCids')).toHaveLength(2);
    expect(runAutoOperationCommand).toHaveBeenCalledTimes(4);
  });

  it('adds deterministic jitter to the inter-item delay', async () => {
    createController({ random: () => 0.5 });

    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 2 });
    await flushAsyncWork();

    expect(controller.getState()).toMatchObject({ state: 'waiting_item', completedCount: 1 });

    await vi.advanceTimersByTimeAsync(5999);
    expect(runAutoOperationCommand).not.toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });

    await vi.advanceTimersByTimeAsync(1);
    await flushAsyncWork();
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });
  });

  it('isolates subscriber errors and continues notifying listeners', () => {
    const throwingSubscriber = vi.fn(() => {
      throw new Error('listener failed');
    });
    const receivingSubscriber = vi.fn();
    controller.subscribe(throwingSubscriber);
    controller.subscribe(receivingSubscriber);

    expect(() => controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 })).not.toThrow();

    expect(throwingSubscriber).toHaveBeenCalled();
    expect(receivingSubscriber).toHaveBeenCalled();
  });

  it('returns current state for remounted UI', async () => {
    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 });
    await flushAsyncWork();

    const state = controller.getState();

    expect(state).toMatchObject({
      enabled: true,
      state: 'waiting_item',
      currentCid: 1032006,
      itemCount: 2,
      completedCount: 1,
      config: { scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 0 },
    });
  });

  it('continues after a single item failure', async () => {
    runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { cids: [1032006, 1013007], count: 2 } })
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce({ ok: true, value: { itemCid: 1013007, tiers: [{ price: 100, count: 1 }] } });
    createController();

    await controller.start({ scanIntervalMinutes: 60, itemDelaySeconds: 1, itemJitterSeconds: 0 });
    await flushAsyncWork();

    expect(controller.getState()).toMatchObject({
      state: 'waiting_item',
      failedCount: 1,
      completedCount: 1,
      lastError: 'network failed',
    });

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsyncWork();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1013007 });
    expect(controller.getState()).toMatchObject({
      state: 'waiting_cycle',
      writtenCount: 1,
      failedCount: 1,
      completedCount: 2,
    });
  });

  it('normalizes scan interval, item delay, and jitter config', () => {
    expect(normalizeConfig({
      scanIntervalMinutes: '120',
      itemDelaySeconds: 0,
      itemJitterSeconds: '7',
    })).toEqual({
      scanIntervalMinutes: 120,
      itemDelaySeconds: 0,
      itemJitterSeconds: 7,
    });

    expect(normalizeConfig({
      scanIntervalMinutes: 0,
      itemDelaySeconds: -1,
      itemJitterSeconds: 3601,
    })).toEqual({
      scanIntervalMinutes: 60,
      itemDelaySeconds: 5,
      itemJitterSeconds: 5,
    });

    expect(normalizeConfig({
      scanIntervalMinutes: 1440,
      itemDelaySeconds: 3600,
      itemJitterSeconds: 3600,
    })).toEqual({
      scanIntervalMinutes: 1440,
      itemDelaySeconds: 3600,
      itemJitterSeconds: 3600,
    });
  });
});
