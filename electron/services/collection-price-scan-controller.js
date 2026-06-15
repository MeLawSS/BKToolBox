const {
  startAutoOperationAgent: defaultStartAutoOperationAgent,
  runAutoOperationCommand: defaultRunAutoOperationCommand,
} = require('./inject-service');
const {
  recordCollectionCids: defaultRecordCollectionCids,
  recordTradeInfoSnapshot: defaultRecordTradeInfoSnapshot,
} = require('../../lib/trade-info-history-recorder');

const DEFAULT_CONFIG = {
  scanIntervalMinutes: 60,
  itemDelaySeconds: 5,
  itemJitterSeconds: 5,
};

const ACTIVE_STATES = new Set(['running', 'waiting_item', 'waiting_cycle', 'stopping']);

function normalizeInteger(value, min, max, fallback) {
  let number;
  try {
    number = Number(value);
  } catch {
    return fallback;
  }
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}

function normalizeConfig(config = {}) {
  return {
    scanIntervalMinutes: normalizeInteger(
      config.scanIntervalMinutes,
      1,
      1440,
      DEFAULT_CONFIG.scanIntervalMinutes,
    ),
    itemDelaySeconds: normalizeInteger(
      config.itemDelaySeconds,
      0,
      3600,
      DEFAULT_CONFIG.itemDelaySeconds,
    ),
    itemJitterSeconds: normalizeInteger(
      config.itemJitterSeconds,
      0,
      3600,
      DEFAULT_CONFIG.itemJitterSeconds,
    ),
  };
}

function emptyProgress() {
  return {
    itemCount: 0,
    currentIndex: 0,
    currentCid: null,
    completedCount: 0,
    writtenCount: 0,
    failedCount: 0,
    nextItemAt: null,
    nextRunAt: null,
    lastResult: null,
    lastError: '',
  };
}

function getErrorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

function getCidsFromResponse(response) {
  return Array.isArray(response?.value?.cids) ? response.value.cids : [];
}

function createCollectionPriceScanController(deps = {}) {
  const runtimeDeps = {
    startAutoOperationAgent: deps.startAutoOperationAgent || defaultStartAutoOperationAgent,
    runAutoOperationCommand: deps.runAutoOperationCommand || defaultRunAutoOperationCommand,
    recordCollectionCids: deps.recordCollectionCids || defaultRecordCollectionCids,
    recordTradeInfoSnapshot: deps.recordTradeInfoSnapshot || defaultRecordTradeInfoSnapshot,
    random: deps.random || Math.random,
    setTimeout: deps.setTimeout || setTimeout,
    clearTimeout: deps.clearTimeout || clearTimeout,
    now: deps.now || Date.now,
  };

  let config = normalizeConfig(deps.initialConfig);
  let enabled = false;
  let state = 'idle';
  let timer = null;
  let pendingDelayResolve = null;
  let stopRequested = false;
  let activeCycleId = 0;
  let current = emptyProgress();
  const listeners = new Set();

  function getState() {
    return {
      enabled,
      state,
      config: { ...config },
      ...current,
    };
  }

  function publish() {
    const snapshot = getState();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // Subscribers are UI/event consumers; one bad listener must not break the scanner.
      }
    }
  }

  function clearScheduled() {
    if (timer) {
      runtimeDeps.clearTimeout(timer);
    }
    const resolvePendingDelay = pendingDelayResolve;
    pendingDelayResolve = null;
    timer = null;
    current.nextItemAt = null;
    current.nextRunAt = null;
    if (resolvePendingDelay) {
      resolvePendingDelay();
    }
  }

  function finishStopped() {
    clearScheduled();
    enabled = false;
    stopRequested = false;
    state = 'stopped';
    publish();
  }

  function waitForItemDelay() {
    const jitterRangeMs = config.itemJitterSeconds * 1000 + 1;
    const jitterMs = Math.floor(runtimeDeps.random() * jitterRangeMs);
    const delayMs = config.itemDelaySeconds * 1000 + jitterMs;
    clearScheduled();
    return new Promise((resolve) => {
      pendingDelayResolve = resolve;
      timer = runtimeDeps.setTimeout(() => {
        timer = null;
        pendingDelayResolve = null;
        current.nextItemAt = null;
        resolve();
      }, delayMs);
      state = 'waiting_item';
      current.nextItemAt = runtimeDeps.now() + delayMs;
      publish();
    });
  }

  function scheduleNextCycle(cycleId) {
    const delayMs = config.scanIntervalMinutes * 60 * 1000;
    clearScheduled();
    timer = runtimeDeps.setTimeout(() => {
      timer = null;
      current.nextRunAt = null;
      runCycle(cycleId);
    }, delayMs);
    state = 'waiting_cycle';
    current.nextRunAt = runtimeDeps.now() + delayMs;
    publish();
  }

  function finishIfStopped(cycleId) {
    if (cycleId !== activeCycleId) {
      return true;
    }
    if (!enabled || stopRequested) {
      finishStopped();
      return true;
    }
    return false;
  }

  async function runCycle(cycleId) {
    if (finishIfStopped(cycleId)) return;

    clearScheduled();
    state = 'running';
    current = emptyProgress();
    publish();
    if (finishIfStopped(cycleId)) return;

    try {
      await runtimeDeps.startAutoOperationAgent();
      if (finishIfStopped(cycleId)) return;

      const cidResponse = await runtimeDeps.runAutoOperationCommand('GetCollectionItemCids', {});
      if (finishIfStopped(cycleId)) return;

      const cids = getCidsFromResponse(cidResponse);
      runtimeDeps.recordCollectionCids(cids);
      current.itemCount = cids.length;
      publish();

      for (let index = 0; index < cids.length; index++) {
        if (finishIfStopped(cycleId)) return;

        current.currentIndex = index + 1;
        current.currentCid = cids[index];
        state = 'running';
        publish();
        if (finishIfStopped(cycleId)) return;

        try {
          const tradeResponse = await runtimeDeps.runAutoOperationCommand('GetItemTradeInfo', { itemCid: cids[index] });
          const written = runtimeDeps.recordTradeInfoSnapshot(tradeResponse?.value);
          current.lastResult = written;
          if (written?.ok) {
            current.writtenCount++;
          } else {
            current.failedCount++;
            current.lastError = written?.error || 'failed to record trade info snapshot';
          }
        } catch (error) {
          current.failedCount++;
          current.lastError = getErrorMessage(error);
        }

        current.completedCount++;
        publish();

        if (index + 1 < cids.length) {
          if (finishIfStopped(cycleId)) return;
          await waitForItemDelay();
          if (finishIfStopped(cycleId)) return;
        }
      }

      if (finishIfStopped(cycleId)) return;

      scheduleNextCycle(cycleId);
    } catch (error) {
      if (cycleId !== activeCycleId) return;
      if (stopRequested || !enabled) {
        finishStopped();
        return;
      }
      clearScheduled();
      enabled = false;
      stopRequested = false;
      state = 'failed';
      current.lastError = getErrorMessage(error);
      publish();
    }
  }

  function start(nextConfig = {}) {
    if (state === 'stopping' || stopRequested) {
      publish();
      return getState();
    }

    config = normalizeConfig({ ...config, ...nextConfig });
    if (enabled && ACTIVE_STATES.has(state)) {
      publish();
      return getState();
    }

    enabled = true;
    stopRequested = false;
    activeCycleId++;
    runCycle(activeCycleId);
    publish();
    return getState();
  }

  function stop() {
    stopRequested = true;
    enabled = false;
    clearScheduled();

    if (state === 'running') {
      state = 'stopping';
      publish();
      return getState();
    }

    finishStopped();
    return getState();
  }

  function updateConfig(nextConfig = {}) {
    // Config changes affect future scheduling; existing waits keep their original due time.
    config = normalizeConfig({ ...config, ...nextConfig });
    publish();
    return getState();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    start,
    stop,
    updateConfig,
    getState,
    subscribe,
  };
}

module.exports = {
  createCollectionPriceScanController,
  normalizeConfig,
};
