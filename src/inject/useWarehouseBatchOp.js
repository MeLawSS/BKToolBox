import { ref } from 'vue';

const MAX_LOG = 200;

export function useWarehouseBatchOp() {
  const isRunning = ref(false);
  const log = ref([]);

  let abortController = null;

  function addLog(message, level = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), level, message };
    if (log.value.length >= MAX_LOG) log.value.shift();
    log.value.push(entry);
  }

  function clearLog() {
    log.value = [];
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('已取消'));
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('已取消')); }, { once: true });
    });
  }

  function checkAbort(signal) {
    if (signal?.aborted) throw new Error('已取消');
  }

  async function runScript(signal) {
    const cmd = (name, args) => window.bidkingDesktop.runAutoOperationCommand(name, args);

    async function goToMainLobby() {
      for (let attempt = 0; attempt < 10; attempt++) {
        checkAbort(signal);
        const screenResp = await cmd('GetCurrentScreen', {});
        if (screenResp?.screen === 'main_lobby') return;
        await cmd('CloseCurrentOverlay', {});
        await delay(1500, signal);
      }
    }

    // 获取物品箱数量
    addLog('获取仓库数据…');
    const containersResp = await cmd('GetStockContainers', {});
    if (containersResp?.ok === false) throw new Error(containersResp.error || '获取仓库失败');
    const raw = containersResp?.value ?? containersResp;
    const allContainers = Array.isArray(raw?.containers) ? raw.containers : Array.isArray(raw) ? raw : [];
    if (!allContainers.length) throw new Error('仓库数据为空');

    const sorted = [...allContainers].sort((a, b) => (b.width * b.height) - (a.width * a.height));
    const mainStockId = sorted[0].stockId;
    const boxStockIds = allContainers
      .filter(c => c.stockId !== mainStockId)
      .map(c => c.stockId);
    addLog(`主仓库 stockId=${mainStockId}，物品箱: [${boxStockIds.join(', ')}]`);

    // 打开仓库
    addLog('导航到主界面…');
    await goToMainLobby();

    addLog('打开仓库页面…');
    await cmd('ClickNode', { panel: 'UIMain', path: 'MainPanel/Btns2/Button_1' });
    await delay(1500, signal);

    // 主仓库自动排序（打开时默认选中）
    addLog('自动排序主仓库…');
    await cmd('ClickNode', { panel: 'UIMain', path: 'WareHousePanel/WareHouse/Down/paixuBtn' });
    await delay(1000, signal);

    // 逐个物品箱自动排序
    for (let idx = 0; idx < boxStockIds.length; idx++) {
      checkAbort(signal);
      addLog(`自动排序物品箱 ${idx + 1}/${boxStockIds.length}…`);
      await cmd('ClickNode', {
        panel: 'UIMain',
        path: `WareHousePanel/WareHouse/Middle/right/layout/stockItem(Clone)[${idx}]`,
      });
      await delay(800, signal);
      await cmd('ClickNode', { panel: 'UIMain', path: 'WareHousePanel/WareHouse/Down/paixuBtn' });
      await delay(1000, signal);
    }

    // 关闭仓库，返回主界面
    await cmd('ClickNode', { panel: 'UIMain', path: 'WareHousePanel/Top/Close' });
    await delay(1000, signal);

    addLog('返回主界面…');
    await goToMainLobby();

    addLog('自动排序完成');
  }

  async function start() {
    if (isRunning.value) return;
    if (!window.bidkingDesktop?.isDesktop) {
      addLog('桌面桥接不可用', 'error');
      return;
    }
    isRunning.value = true;
    abortController = new AbortController();
    const signal = abortController.signal;
    runScript(signal).catch(e => {
      addLog(`脚本异常: ${e?.message || e}`, 'error');
    }).finally(() => {
      isRunning.value = false;
      abortController = null;
    });
  }

  function stop() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  return { isRunning, log, clearLog, start, stop };
}
