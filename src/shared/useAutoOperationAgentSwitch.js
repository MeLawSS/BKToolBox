import { computed, onMounted, ref } from 'vue';
import { useI18n } from './i18n.js';

const AGENT_CONNECTED_STORAGE_KEY = 'bidking-auto-operation-agent-connected';

function getSessionStorage() {
  if (typeof window === 'undefined') return null;

  try {
    return window.sessionStorage || null;
  } catch (_error) {
    return null;
  }
}

function readPersistedConnectedState() {
  const storage = getSessionStorage();
  if (!storage) return false;

  try {
    return storage.getItem(AGENT_CONNECTED_STORAGE_KEY) === 'true';
  } catch (_error) {
    return false;
  }
}

function persistConnectedState(next) {
  const storage = getSessionStorage();
  if (!storage) return;

  try {
    storage.setItem(AGENT_CONNECTED_STORAGE_KEY, next ? 'true' : 'false');
  } catch (_error) {
    // Runtime state persistence is optional.
  }
}

function setConnected(next) {
  connected.value = next;
  persistConnectedState(next);
}

function hydrateConnectedState() {
  connected.value = readPersistedConnectedState();
}

const connected = ref(readPersistedConnectedState());
const errorText = ref('');
const busy = ref(false);

let refreshPromise = null;
let loadPromise = null;
let unloadPromise = null;

function getDesktopBridge() {
  if (typeof window === 'undefined') return null;
  return window.bidkingDesktop || null;
}

function isAvailableBridge() {
  const desktop = getDesktopBridge();
  return Boolean(
    desktop?.isDesktop &&
    typeof desktop.startAutoOperationAgent === 'function' &&
    typeof desktop.runAutoOperationCommand === 'function',
  );
}

function isOkResponse(response) {
  return Boolean(
    response?.ok === true ||
    response?.value?.pong === true ||
    response?.result?.pong === true,
  );
}

function getResponseError(response, fallbackMessage) {
  return new Error(response?.error || response?.message || fallbackMessage);
}

function isOfflineAgentError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('offline') ||
    message.includes('enoent') ||
    message.includes('connection closed') ||
    message.includes('econnreset') ||
    message.includes('broken pipe')
  );
}

function setBusy(next) {
  busy.value = next;
}

function clearPendingIfIdle() {
  if (!refreshPromise && !loadPromise && !unloadPromise) {
    setBusy(false);
  }
}

async function refreshAgentState() {
  if (!isAvailableBridge()) {
    setConnected(false);
    errorText.value = '';
    return false;
  }

  if (loadPromise) return loadPromise;
  if (unloadPromise) return unloadPromise;
  if (refreshPromise) return refreshPromise;

  const desktop = getDesktopBridge();
  refreshPromise = (async () => {
    try {
      const response = await desktop.runAutoOperationCommand('Ping', {});
      const ok = isOkResponse(response);
      setConnected(ok);
      errorText.value = '';
      return ok;
    } catch (_error) {
      setConnected(false);
      errorText.value = '';
      return false;
    }
  })().finally(() => {
    refreshPromise = null;
    clearPendingIfIdle();
  });

  return refreshPromise;
}

async function loadAgent() {
  if (!isAvailableBridge()) {
    const error = new Error('AutoOperation Agent is unavailable');
    errorText.value = error.message;
    return Promise.reject(error);
  }

  if (loadPromise) return loadPromise;
  if (unloadPromise) return unloadPromise;
  if (refreshPromise) {
    await refreshPromise.catch(() => {});
  }

  const desktop = getDesktopBridge();
  errorText.value = '';
  setBusy(true);

  loadPromise = (async () => {
    try {
      const response = await desktop.startAutoOperationAgent();
      if (!isOkResponse(response)) throw getResponseError(response, 'Failed to start AutoOperation Agent');
      setConnected(true);
      errorText.value = '';
      return response;
    } catch (error) {
      setConnected(false);
      errorText.value = error?.message || 'Failed to start AutoOperation Agent';
      throw error;
    }
  })().finally(() => {
    loadPromise = null;
    clearPendingIfIdle();
  });

  return loadPromise;
}

async function unloadAgent() {
  if (!isAvailableBridge()) {
    const error = new Error('AutoOperation Agent is unavailable');
    errorText.value = error.message;
    return Promise.reject(error);
  }

  if (unloadPromise) return unloadPromise;
  if (loadPromise) return loadPromise;
  if (refreshPromise) {
    await refreshPromise.catch(() => {});
  }

  const desktop = getDesktopBridge();
  errorText.value = '';
  setBusy(true);

  unloadPromise = (async () => {
    try {
      const response = await desktop.runAutoOperationCommand('UnloadAgent', {});
      if (!isOkResponse(response)) throw getResponseError(response, 'Failed to unload AutoOperation Agent');
      setConnected(false);
      errorText.value = '';
      return response;
    } catch (error) {
      if (isOfflineAgentError(error)) {
        setConnected(false);
        errorText.value = '';
        return {
          ok: true,
          value: {
            unloaded: false,
            alreadyOffline: true,
          },
        };
      }
      setConnected(true);
      errorText.value = error?.message || 'Failed to unload AutoOperation Agent';
      throw error;
    }
  })().finally(() => {
    unloadPromise = null;
    clearPendingIfIdle();
  });

  return unloadPromise;
}

async function toggleAgent() {
  return connected.value ? unloadAgent() : loadAgent();
}

export function useAutoOperationAgentSwitch() {
  const { t } = useI18n();
  hydrateConnectedState();

  onMounted(() => {
    if (isAvailableBridge()) {
      void refreshAgentState();
    } else {
      setConnected(false);
      errorText.value = '';
    }
  });

  return {
    isAvailable: computed(() => isAvailableBridge()),
    isConnected: connected,
    errorText,
    isBusy: busy,
    statusText: computed(() => {
      if (busy.value) return t('inject.autoOperationStarting');
      if (errorText.value) return t('inject.failed');
      return connected.value ? t('inject.autoOperationConnected') : t('inject.waiting');
    }),
    refreshAgentState,
    loadAgent,
    unloadAgent,
    toggleAgent,
  };
}

export function __resetAutoOperationAgentSwitchRuntimeForTest() {
  connected.value = false;
  errorText.value = '';
  busy.value = false;
  refreshPromise = null;
  loadPromise = null;
  unloadPromise = null;
}
