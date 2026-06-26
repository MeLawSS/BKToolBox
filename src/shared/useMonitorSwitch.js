import { computed, ref } from 'vue';
import { useI18n } from './i18n.js';

const MONITOR_SETTINGS_STORAGE_KEY = 'bidking-monitor-settings:v1';

function createDefaultStatus() {
  return {
    state: 'idle',
    running: false,
    totalEvents: 0,
    lastError: null,
  };
}

const status = ref(createDefaultStatus());
const errorText = ref('');
const isBusy = ref(false);
const listeners = new Set();

let eventSource = null;
let refreshPromise = null;
let startPromise = null;
let stopPromise = null;
let startOptionsResolver = null;
let streamConsumerCount = 0;

function closeEventSource(source) {
  if (!source || typeof source !== 'object') return;
  source.__bidkingClosed = true;
  source.close?.();
}

function isEventSourceUsable(source) {
  return Boolean(source) && source.__bidkingClosed !== true;
}

function getMonitorSettingsStorage(storage = undefined) {
  if (storage) return storage;
  return typeof window !== 'undefined' ? window.localStorage : null;
}

export function loadMonitorSettings(storage = getMonitorSettingsStorage()) {
  if (!storage) return { useInferenceV2: false };
  try {
    const parsed = JSON.parse(storage.getItem(MONITOR_SETTINGS_STORAGE_KEY) || '{}');
    return {
      useInferenceV2: parsed?.useInferenceV2 === true,
    };
  } catch (_error) {
    return { useInferenceV2: false };
  }
}

export function saveMonitorSettings(nextPatch = {}, storage = getMonitorSettingsStorage()) {
  const nextSettings = {
    ...loadMonitorSettings(storage),
    ...(nextPatch && typeof nextPatch === 'object' ? nextPatch : {}),
  };
  if (storage) {
    storage.setItem(MONITOR_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
  }
  return nextSettings;
}

function getErrorMessage(error) {
  return error?.message || String(error);
}

function updateStatus(nextStatus) {
  status.value = { ...status.value, ...nextStatus };
  return status.value;
}

function parsePayload(message) {
  if (!message?.data) return null;

  try {
    return JSON.parse(message.data);
  } catch (error) {
    errorText.value = getErrorMessage(error);
    return null;
  }
}

function notify(payload) {
  for (const listener of listeners) {
    listener(payload);
  }
}

function refreshStatus() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = fetch('/api/bidking-monitor/status')
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      errorText.value = '';
      return updateStatus(await response.json());
    })
    .catch((error) => {
      errorText.value = getErrorMessage(error);
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

function startMonitor(options = {}) {
  if (startPromise) return startPromise;

  const requestOptions = {
    ...(options && typeof options === 'object' ? options : {}),
  };
  if (requestOptions.useInferenceV2 === undefined) {
    requestOptions.useInferenceV2 = loadMonitorSettings().useInferenceV2;
  }

  errorText.value = '';
  isBusy.value = true;
  startPromise = fetch('/api/bidking-monitor/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestOptions),
  })
    .then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || response.statusText);
      }
      errorText.value = '';
      return updateStatus(await response.json());
    })
    .catch((error) => {
      errorText.value = getErrorMessage(error);
      throw error;
    })
    .finally(() => {
      isBusy.value = false;
      startPromise = null;
    });

  return startPromise;
}

function stopMonitor() {
  if (stopPromise) return stopPromise;

  errorText.value = '';
  isBusy.value = true;
  stopPromise = fetch('/api/bidking-monitor/stop', { method: 'POST' })
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      errorText.value = '';
      return updateStatus(await response.json());
    })
    .catch((error) => {
      errorText.value = getErrorMessage(error);
      throw error;
    })
    .finally(() => {
      isBusy.value = false;
      stopPromise = null;
    });

  return stopPromise;
}

function resolveStartOptions() {
  if (typeof startOptionsResolver !== 'function') return {};

  try {
    const options = startOptionsResolver();
    return options && typeof options === 'object' ? options : {};
  } catch (_error) {
    return {};
  }
}

function toggleMonitor() {
  return status.value.running ? stopMonitor() : startMonitor(resolveStartOptions());
}

function ensureStreamConnected() {
  if (isEventSourceUsable(eventSource) || typeof EventSource !== 'function') return eventSource;

  eventSource = new EventSource('/api/bidking-monitor/events');
  eventSource.addEventListener('status', (message) => {
    const payload = parsePayload(message);
    if (!payload) return;
    updateStatus(payload);
    notify({ kind: 'status', payload });
  });
  eventSource.addEventListener('error', (message) => {
    const payload = parsePayload(message);
    if (!payload) return;
    updateStatus(payload);
    notify({ kind: 'error', payload });
  });
  eventSource.addEventListener('event', (message) => {
    const payload = parsePayload(message);
    if (!payload) return;
    notify({ kind: 'event', payload });
  });

  return eventSource;
}

function subscribe(listener) {
  listeners.add(listener);
  streamConsumerCount += 1;
  ensureStreamConnected();
  return () => {
    listeners.delete(listener);
    streamConsumerCount = Math.max(0, streamConsumerCount - 1);
    if (streamConsumerCount === 0 && eventSource) {
      closeEventSource(eventSource);
      eventSource = null;
    }
  };
}

function setStartOptionsResolver(resolver) {
  startOptionsResolver = typeof resolver === 'function' ? resolver : null;
  return () => {
    if (startOptionsResolver === resolver) {
      startOptionsResolver = null;
    }
  };
}

export function useMonitorSwitch() {
  const { t } = useI18n();

  return {
    status,
    errorText,
    isBusy,
    statusText: computed(() => t(`monitor.states.${status.value.state}`)),
    refreshStatus,
    startMonitor,
    stopMonitor,
    toggleMonitor,
    ensureStreamConnected,
    subscribe,
    setStartOptionsResolver,
  };
}

export function __resetMonitorSwitchRuntimeForTest() {
  if (eventSource) {
    closeEventSource(eventSource);
    eventSource = null;
  }
  refreshPromise = null;
  startPromise = null;
  stopPromise = null;
  startOptionsResolver = null;
  streamConsumerCount = 0;
  listeners.clear();
  status.value = createDefaultStatus();
  errorText.value = '';
  isBusy.value = false;
}
