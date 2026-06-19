import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useMonitorSwitch } from '../shared/useMonitorSwitch.js';
import { useAutoOperationAgentSwitch } from '../shared/useAutoOperationAgentSwitch.js';
import { LEAVE_TOOLS_EVENT } from '../shared/tools-page-lifecycle.js';
import { elsaExpectedPrice } from './elsaEstimateState.js';

const MAX_LOG = 200;

export function useElsaAutoOperation() {
  const monitor = useMonitorSwitch();
  const agent = useAutoOperationAgentSwitch();

  const isEnabled = ref(false);
  const isBusy = ref(false);
  const log = ref([]);

  let scriptAbort = null;
  let weStartedAgent = false;
  const cmd = (name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args);

  function addLog(message, level = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), level, message };
    if (log.value.length >= MAX_LOG) log.value.shift();
    log.value.push(entry);
  }

  function clearLog() {
    log.value = [];
  }

  // Wait up to maxMs for elsaExpectedPrice to become non-zero.
  // Resolves immediately if already set; resolves with 0 on timeout.
  function waitForPrice(signal, maxMs = 10000) {
    const current = elsaExpectedPrice.value;
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        stopWatcher();
        clearTimeout(timer);
        resolve(value);
      };
      const stopWatcher = watch(elsaExpectedPrice, (price) => {
        if (price) settle(price);
      });
      const timer = setTimeout(() => settle(0), maxMs);
      signal.addEventListener('abort', () => settle(0), { once: true });
    });
  }

  async function runScript(signal) {
    if (signal.aborted) throw new Error('操作已取消');
    addLog('开始自动竞拍…');

    addLog(`当前估价: ${elsaExpectedPrice.value || '无，等待最多10秒…'}`);
    const price = await waitForPrice(signal);

    if (signal.aborted) throw new Error('操作已取消');

    if (price) {
      await cmd('SetExpectedPrice', { price });
      addLog(`估价已发送: ${price}`);
    } else {
      addLog('未获得估价，将使用底价');
    }

    const result = await cmd('AutoAuction', { roomId: 101, useExpectedPrice: true });
    const rounds = result?.value?.rounds ?? 0;
    const usedPrice = result?.value?.expectedPrice ?? 0;
    addLog(`竞拍完成，共出价 ${rounds} 轮，使用估价 ${usedPrice}`);
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
      runScript(controller.signal)
        .catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'))
        .finally(() => disable());
    } finally {
      isBusy.value = false;
    }
  }

  async function disable() {
    if (!isEnabled.value || isBusy.value) return;
    isBusy.value = true;
    if (scriptAbort) { scriptAbort.abort(); scriptAbort = null; }
    try {
      addLog('正在停止…');
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
