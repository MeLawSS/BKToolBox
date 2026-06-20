import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useMonitorSwitch } from '../shared/useMonitorSwitch.js';
import { useAutoOperationAgentSwitch } from '../shared/useAutoOperationAgentSwitch.js';
import { LEAVE_TOOLS_EVENT } from '../shared/tools-page-lifecycle.js';
import {
  computeElsaAutoBidPrice,
  elsaAutoBidKnownQualityKeys,
  elsaExpectedPrice,
} from './elsaEstimateState.js';

const MAX_LOG = 200;
const AUTO_AUCTION_AUTH_CODE_RESULT = 'authcode_required';
const AUTO_AUCTION_AUTH_CODE_MESSAGE = '检测到验证界面，已停止自动竞拍，请手动完成验证。';
const AUTO_AUCTION_NOTIFICATION_TITLE = 'BKToolBox';

export function useElsaAutoOperation() {
  const monitor = useMonitorSwitch();
  const agent = useAutoOperationAgentSwitch();

  const isEnabled = ref(false);
  const isBusy = ref(false);
  const log = ref([]);

  let scriptAbort = null;
  let weStartedAgent = false;
  let stopPriceWatcher = null;
  let pendingExpectedPriceTimer = null;
  let pendingExpectedPriceValue = 0;
  let initialExpectedPriceSync = null;
  let resolveInitialExpectedPriceSync = null;
  let rejectInitialExpectedPriceSync = null;
  let hasSettledInitialExpectedPriceSync = false;
  const cmd = (name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args);
  const autoBidPrice = computed(() =>
    computeElsaAutoBidPrice(elsaExpectedPrice.value, elsaAutoBidKnownQualityKeys.value)
  );

  function addLog(message, level = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), level, message };
    if (log.value.length >= MAX_LOG) log.value.shift();
    log.value.push(entry);
  }

  function clearLog() {
    log.value = [];
  }

  function writePriceFile(price) {
    window.bidkingDesktop.writeDataFile('Price', String(price || 0))
      .catch(e => addLog(`价格文件写入失败: ${e?.message || e}`, 'warn'));
  }

  function clearPendingExpectedPriceTimer() {
    if (pendingExpectedPriceTimer) {
      clearTimeout(pendingExpectedPriceTimer);
      pendingExpectedPriceTimer = null;
    }
  }

  function resetInitialExpectedPriceSync() {
    initialExpectedPriceSync = null;
    resolveInitialExpectedPriceSync = null;
    rejectInitialExpectedPriceSync = null;
    hasSettledInitialExpectedPriceSync = false;
  }

  function createInitialExpectedPriceSyncPromise() {
    hasSettledInitialExpectedPriceSync = false;
    initialExpectedPriceSync = new Promise((resolve, reject) => {
      resolveInitialExpectedPriceSync = resolve;
      rejectInitialExpectedPriceSync = reject;
    });
  }

  function settleInitialExpectedPriceSync(kind, value) {
    if (hasSettledInitialExpectedPriceSync) return;
    hasSettledInitialExpectedPriceSync = true;
    if (kind === 'resolve') {
      resolveInitialExpectedPriceSync?.(value);
    } else {
      rejectInitialExpectedPriceSync?.(value);
    }
  }

  async function syncExpectedPrice(price, { isInitial } = {}) {
    await cmd('SetExpectedPrice', { price });
    if (isInitial) {
      settleInitialExpectedPriceSync('resolve');
    }
  }

  function scheduleExpectedPriceSync(price, { isInitial } = {}) {
    pendingExpectedPriceValue = Number(price) || 0;
    clearPendingExpectedPriceTimer();
    pendingExpectedPriceTimer = setTimeout(async () => {
      pendingExpectedPriceTimer = null;
      if (!isEnabled.value) return;
      try {
        await syncExpectedPrice(pendingExpectedPriceValue, { isInitial });
      } catch (error) {
        if (isInitial) {
          settleInitialExpectedPriceSync('reject', error);
        } else {
          addLog(`同步自动竞拍价格失败: ${error?.message || error}`, 'warn');
        }
      }
    }, 4000);
  }

  async function waitForInitialExpectedPriceSync(signal) {
    if (!initialExpectedPriceSync) {
      throw new Error('initial expected price sync not initialized');
    }
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    let abortHandler = null;
    const abortPromise = new Promise((_, reject) => {
      abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abortHandler, { once: true });
    });
    try {
      await Promise.race([initialExpectedPriceSync, abortPromise]);
    } finally {
      if (abortHandler) {
        signal?.removeEventListener('abort', abortHandler);
      }
    }
  }

  async function showDesktopNotification(title, body) {
    const notify = window.bidkingDesktop?.showNotification;
    if (typeof notify !== 'function') return;
    try {
      const result = await notify(title, body);
      if (!result?.ok) {
        addLog(`Windows 通知发送失败: ${result?.error || 'unknown error'}`, 'warn');
      }
    } catch (e) {
      addLog(`Windows 通知发送失败: ${e?.message || e}`, 'warn');
    }
  }

  async function stopAutomation(options = {}) {
    const { requestCancel = true } = options;
    if (!isEnabled.value || isBusy.value) return;
    isBusy.value = true;
    if (stopPriceWatcher) { stopPriceWatcher(); stopPriceWatcher = null; }
    clearPendingExpectedPriceTimer();
    resetInitialExpectedPriceSync();
    if (scriptAbort) { scriptAbort.abort(); scriptAbort = null; }
    try {
      if (requestCancel) {
        addLog('正在停止…');
        await cmd('CancelAutoAuction', {}).catch(e => addLog(`停止自动竞拍失败: ${e?.message || e}`, 'warn'));
      }
      if (weStartedAgent) {
        await agent.unloadAgent().catch(e => addLog(`Agent 卸载失败: ${e?.message || e}`, 'error'));
        weStartedAgent = false;
      }
      addLog('已停止');
      isEnabled.value = false;
    } finally {
      isBusy.value = false;
    }
  }

  async function runScript(signal) {
    try {
      await waitForInitialExpectedPriceSync(signal);
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') {
        return;
      }
      addLog(`初始化自动竞拍价格同步失败: ${error?.message || error}`, 'error');
      await stopAutomation({ requestCancel: false });
      return;
    }

    while (!signal.aborted) {
      addLog('开始自动竞拍…');
      addLog(`当前估价: ${elsaExpectedPrice.value || '无，将使用底价'}`);
      addLog(`当前自动出价: ${autoBidPrice.value || '无，将使用底价'}`);

      const result = await cmd('AutoAuction', { roomId: 101, useExpectedPrice: true });
      const status = result?.value?.result || '';
      const rounds = result?.value?.rounds ?? 0;
      const usedPrice = result?.value?.expectedPrice ?? 0;
      if (signal.aborted || status === 'canceled') {
        addLog(`自动竞拍已停止，共出价 ${rounds} 轮，最近出价 ${usedPrice}`);
        return;
      }
      if (status === AUTO_AUCTION_AUTH_CODE_RESULT) {
        addLog(AUTO_AUCTION_AUTH_CODE_MESSAGE, 'warn');
        await stopAutomation({ requestCancel: false });
        await showDesktopNotification(AUTO_AUCTION_NOTIFICATION_TITLE, AUTO_AUCTION_AUTH_CODE_MESSAGE);
        return;
      }
      addLog(`竞拍完成，共出价 ${rounds} 轮，使用出价 ${usedPrice}`);
    }
  }

  async function enable() {
    if (isEnabled.value || isBusy.value) return;
    isBusy.value = true;
    try {
      if (!monitor.status.value?.running) {
        addLog('Monitor 未运行，请先在 Monitor 页启动监控', 'error');
        return;
      }
      addLog('Monitor 已在运行');

      if (!agent.isConnected.value) {
        let agentOk = true;
        await agent.loadAgent().catch(e => {
          agentOk = false;
          addLog(`Agent 启动失败: ${e?.message || e}`, 'error');
        });
        if (!agentOk) return;
        weStartedAgent = true;
        addLog('Agent 已连接');
      } else {
        addLog('Agent 已在运行');
      }

      isEnabled.value = true;
      const controller = new AbortController();
      scriptAbort = controller;
      createInitialExpectedPriceSyncPromise();

      stopPriceWatcher = watch(
        autoBidPrice,
        (price) => {
          writePriceFile(price);
          scheduleExpectedPriceSync(price, { isInitial: !hasSettledInitialExpectedPriceSync });
        },
        { immediate: true },
      );

      runScript(controller.signal)
        .catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'))
        .finally(() => {
          if (scriptAbort === controller) {
            scriptAbort = null;
          }
          if (isEnabled.value && !controller.signal.aborted) {
            disable();
          }
        });
    } finally {
      isBusy.value = false;
    }
  }

  async function disable() {
    await stopAutomation({ requestCancel: true });
  }

  function onLeaveTools() {
    if (isEnabled.value) disable();
  }

  window.addEventListener(LEAVE_TOOLS_EVENT, onLeaveTools);

  onBeforeUnmount(() => {
    window.removeEventListener(LEAVE_TOOLS_EVENT, onLeaveTools);
    if (isEnabled.value) disable();
  });

  const monitorStatus = computed(() => monitor.status.value?.state ?? 'idle');
  const agentConnected = computed(() => agent.isConnected.value);

  return { isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, log, clearLog };
}
