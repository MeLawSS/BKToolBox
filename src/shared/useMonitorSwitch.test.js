/* @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetMonitorSwitchRuntimeForTest,
  useMonitorSwitch,
} from './useMonitorSwitch.js';

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.close = vi.fn();
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, payload) {
    this.listeners.get(type)?.({ data: JSON.stringify(payload) });
  }
}

FakeEventSource.instances = [];

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createJsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

describe('useMonitorSwitch', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    __resetMonitorSwitchRuntimeForTest();
    vi.unstubAllGlobals();
  });

  it('shares one status fetch and one event source across consumers', async () => {
    const statusRequest = createDeferred();
    const fetch = vi.fn(async (url) => {
      if (String(url) === '/api/bidking-monitor/status') {
        return statusRequest.promise;
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);

    const a = useMonitorSwitch();
    const b = useMonitorSwitch();
    const eventsA = [];
    const eventsB = [];
    a.subscribe((message) => eventsA.push(message));
    b.subscribe((message) => eventsB.push(message));

    const refreshA = a.refreshStatus();
    const refreshB = b.refreshStatus();

    expect(a.status).toBe(b.status);
    expect(refreshA).toBe(refreshB);
    expect(fetch).toHaveBeenCalledTimes(1);

    statusRequest.resolve(createJsonResponse({
      state: 'idle',
      running: false,
      totalEvents: 0,
      lastError: null,
    }));
    await Promise.all([refreshA, refreshB]);

    a.ensureStreamConnected();
    b.ensureStreamConnected();

    expect(FakeEventSource.instances).toHaveLength(1);

    const source = FakeEventSource.instances[0];
    source.emit('status', { state: 'capturing', running: true, totalEvents: 2 });
    source.emit('error', { state: 'error', running: false, lastError: 'stream failed' });
    source.emit('event', { key: 'skill:1', gameUid: 'game-1' });

    expect(a.status.value).toMatchObject({
      state: 'error',
      running: false,
      totalEvents: 2,
      lastError: 'stream failed',
    });
    expect(eventsA).toEqual([
      { kind: 'status', payload: { state: 'capturing', running: true, totalEvents: 2 } },
      { kind: 'error', payload: { state: 'error', running: false, lastError: 'stream failed' } },
      { kind: 'event', payload: { key: 'skill:1', gameUid: 'game-1' } },
    ]);
    expect(eventsB).toEqual(eventsA);

    __resetMonitorSwitchRuntimeForTest();
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(useMonitorSwitch().status.value).toEqual({
      state: 'idle',
      running: false,
      totalEvents: 0,
      lastError: null,
    });
  });

  it('starts with custom payload and stops through shared actions', async () => {
    const startRequest = createDeferred();
    const stopRequest = createDeferred();
    const fetch = vi.fn(async (url, options = {}) => {
      if (String(url) === '/api/bidking-monitor/start') {
        expect(options).toMatchObject({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(options.body)).toMatchObject({
          remoteAddress: '127.0.0.1',
          port: 10000,
        });
        return startRequest.promise;
      }
      if (String(url) === '/api/bidking-monitor/stop') {
        expect(options).toEqual({ method: 'POST' });
        return stopRequest.promise;
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);

    const monitor = useMonitorSwitch();

    const firstStart = monitor.startMonitor({ remoteAddress: '127.0.0.1', port: 10000 });
    const secondStart = monitor.startMonitor({ remoteAddress: '127.0.0.1', port: 10000 });

    expect(firstStart).toBe(secondStart);
    expect(monitor.isBusy.value).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    startRequest.resolve(createJsonResponse({
      state: 'capturing',
      running: true,
      totalEvents: 0,
      lastError: null,
    }));
    await firstStart;

    expect(monitor.isBusy.value).toBe(false);
    expect(monitor.status.value).toMatchObject({
      state: 'capturing',
      running: true,
    });

    const firstStop = monitor.stopMonitor();
    const secondStop = monitor.stopMonitor();

    expect(firstStop).toBe(secondStop);
    expect(monitor.isBusy.value).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);

    stopRequest.resolve(createJsonResponse({
      state: 'stopped',
      running: false,
      totalEvents: 0,
      lastError: null,
    }));
    await firstStop;

    expect(monitor.isBusy.value).toBe(false);
    expect(monitor.status.value).toMatchObject({
      state: 'stopped',
      running: false,
    });
  });

  it('closes the shared event source after the last subscriber leaves and recreates it for new subscribers', () => {
    const monitor = useMonitorSwitch();
    const unsubscribeA = monitor.subscribe(() => {});
    const unsubscribeB = monitor.subscribe(() => {});

    expect(FakeEventSource.instances).toHaveLength(1);
    const first = FakeEventSource.instances[0];

    unsubscribeA();
    expect(first.close).not.toHaveBeenCalled();

    unsubscribeB();
    expect(first.close).toHaveBeenCalledTimes(1);

    const unsubscribeNext = monitor.subscribe(() => {});
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]).not.toBe(first);
    unsubscribeNext();
  });

  it('merges the persisted inference flag into monitor start payloads', async () => {
    window.localStorage.setItem('bidking-monitor-settings:v1', JSON.stringify({
      useInferenceV2: true,
    }));
    const startRequest = createDeferred();
    const fetch = vi.fn(async (url, options = {}) => {
      if (String(url) === '/api/bidking-monitor/start') {
        expect(JSON.parse(options.body)).toMatchObject({
          remoteAddress: '127.0.0.1',
          port: 10000,
          useInferenceV2: true,
        });
        return startRequest.promise;
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);

    const monitor = useMonitorSwitch();
    const start = monitor.startMonitor({ remoteAddress: '127.0.0.1', port: 10000 });

    startRequest.resolve(createJsonResponse({
      state: 'capturing',
      running: true,
      totalEvents: 0,
      lastError: null,
    }));
    await start;

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
