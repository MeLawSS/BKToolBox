import { ref, computed, onBeforeUnmount } from 'vue';
import { useMonitorSwitch } from '../shared/useMonitorSwitch.js';
import { useAutoOperationAgentSwitch } from '../shared/useAutoOperationAgentSwitch.js';
import { LEAVE_TOOLS_EVENT } from '../shared/tools-page-lifecycle.js';

const MAX_LOG = 200;

export function useElsaAutoOperation() {
  const monitor = useMonitorSwitch();
  const agent = useAutoOperationAgentSwitch();

  const isEnabled = ref(false);
  const isBusy = ref(false);
  const log = ref([]);

  let scriptAbort = null;
  let weStartedAgent = false;

  function addLog(message, level = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), level, message };
    if (log.value.length >= MAX_LOG) log.value.shift();
    log.value.push(entry);
  }

  function clearLog() {
    log.value = [];
  }

  async function runScript(/* signal */) {
    addLog('自动竞拍脚本已启动');
    // TODO: bidding logic
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
      runScript(controller.signal).catch(e => addLog(`脚本异常: ${e?.message || e}`, 'error'));
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
