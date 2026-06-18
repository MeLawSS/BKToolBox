/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import App from './App.vue';
import { LOCALE_STORAGE_KEY } from '../shared/i18n.js';
import { __resetAutoOperationAgentSwitchRuntimeForTest } from '../shared/useAutoOperationAgentSwitch.js';

async function mountApp() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  await nextTick();
  return wrapper;
}

async function activatePanel(wrapper, panelId) {
  await wrapper.find(`[data-testid="inject-tab-${panelId}"]`).trigger('click');
  await flushPromises();
  await nextTick();
}

const listNowAdvice = {
  state: 'list_now',
  suggestedUnitPrice: 7799,
  netRevenuePerItem: 7019,
  expirationRisk: 'low',
  reason: 'recent gradient supports listing now',
};

function setupDesktopWithHighPriceConfirm() {
  const confirmHighPriceExchangeListing = vi.fn().mockResolvedValue({
    ok: true,
    value: { result: true },
  });
  window.bidkingDesktop = {
    isDesktop: true,
    queryCabinetReward: vi.fn(),
    claimCabinetReward: vi.fn(),
    startAutoOperationAgent: vi.fn(),
    runAutoOperationCommand: vi.fn(),
    confirmHighPriceExchangeListing,
  };
  return confirmHighPriceExchangeListing;
}

describe('Inject App', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
    }));
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  afterEach(() => {
    __resetAutoOperationAgentSwitchRuntimeForTest();
    window.sessionStorage.clear();
    delete window.bidkingDesktop;
    delete global.fetch;
    vi.restoreAllMocks();
  });

  it('shows a cabinet reward button and renders the value returned by the desktop API', async () => {
    const queryCabinetReward = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        observedAt: '2026-06-01T03:04:05.000Z',
        awardCount: 12345,
      },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward,
      claimCabinetReward: vi.fn(),
    };

    const wrapper = await mountApp();
    const button = wrapper.find('[data-testid="cabinet-reward-button"]');
    expect(button.exists()).toBe(true);

    await button.trigger('click');
    expect(queryCabinetReward).toHaveBeenCalledTimes(1);

    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="cabinet-reward-value"]').text()).toContain('12,345');
  });

  it('shows a claim button and refreshes the displayed reward after claiming', async () => {
    const claimCabinetReward = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        observedAt: '2026-06-01T03:05:06.000Z',
        awardCount: 0,
      },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward,
    };

    const wrapper = await mountApp();
    const button = wrapper.find('[data-testid="cabinet-claim-button"]');
    expect(button.exists()).toBe(true);

    await button.trigger('click');
    expect(claimCabinetReward).toHaveBeenCalledTimes(1);

    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="cabinet-reward-value"]').text()).toContain('0');
  });

  it('starts the AutoOperation Agent and renders the ping result', async () => {
    const startAutoOperationAgent = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'Ping') throw new Error('offline');
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent,
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'agent');
    const button = wrapper.find('[data-testid="auto-op-agent-button"]');
    expect(button.exists()).toBe(true);

    await button.trigger('click');
    expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);

    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="auto-op-agent-status"]').text()).toContain('已连接');
  });

  it('updates the inject agent status when the shared topbar agent switch loads the agent', async () => {
    const startAutoOperationAgent = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'Ping') throw new Error('offline');
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent,
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'agent');

    await wrapper.find('[data-testid="topbar-agent-switch"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="auto-op-agent-status"]').text()).toContain('已连接');
  });

  it('adds a controller tab to the basic inject group and mounts the panel on demand', async () => {
    const wrapper = await mountApp();

    expect(wrapper.find('[data-testid="inject-nav-group-basic"]').text()).toContain('控制器');
    expect(wrapper.find('[data-testid="inject-panel-controller"]').exists()).toBe(false);

    await activatePanel(wrapper, 'controller');

    expect(wrapper.find('[data-testid="inject-panel-controller"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="controller-send-button"]').element.disabled).toBe(true);
    expect(wrapper.find('[data-testid="controller-command-examples"]').text()).toContain('DumpPanelTree');
  });

  it('renders the controller navigation label in English when locale is saved', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en-US');

    const wrapper = await mountApp();

    expect(document.documentElement.lang).toBe('en-US');
    expect(wrapper.find('[data-testid="inject-nav-group-basic"]').text()).toContain('Controller');
  });

  it('does not trigger an extra Ping when opening the controller panel', async () => {
    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'Ping') {
        return { ok: true, value: { pong: true } };
      }
      if (command === 'GetCurrentUI') {
        expect(args).toEqual({});
        return { ok: true, result: { panel: 'UIMain' } };
      }
      if (command === 'GetVisiblePanels') {
        expect(args).toEqual({});
        return { ok: true, result: { panels: ['UIMain'] } };
      }
      if (command === 'DumpPanelTree') {
        expect(args).toEqual({
          panel: 'UIMain',
          rootPath: '',
          interactiveOnly: true,
          maxDepth: 4,
          nodeLimit: 200,
        });
        return {
          ok: true,
          result: {
            panel: 'UIMain',
            rootPath: '',
            truncated: false,
            nodes: [],
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledTimes(1);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('Ping', {});

    await activatePanel(wrapper, 'controller');

    expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).toEqual([
      'Ping',
      'GetCurrentUI',
      'GetVisiblePanels',
      'DumpPanelTree',
    ]);
  });

  it('auto-refreshes controller UI on first open and again on re-open without re-pinging', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'Ping') {
        return { ok: true, value: { pong: true } };
      }
      if (command === 'GetCurrentUI') {
        return { ok: true, result: { panel: 'UIMain' } };
      }
      if (command === 'GetVisiblePanels') {
        return { ok: true, result: { panels: ['UIMain'] } };
      }
      if (command === 'DumpPanelTree') {
        return {
          ok: true,
          result: {
            panel: 'UIMain',
            rootPath: '',
            truncated: false,
            nodes: [],
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    const commandHistoryBeforeOpen = runAutoOperationCommand.mock.calls.map(([command]) => command);

    expect(wrapper.find('[data-testid="inject-panel-controller"]').exists()).toBe(false);
    expect(commandHistoryBeforeOpen.filter((command) => command === 'Ping')).toHaveLength(1);

    await activatePanel(wrapper, 'controller');
    expect(runAutoOperationCommand.mock.calls.map(([command]) => command).slice(commandHistoryBeforeOpen.length)).toEqual([
      'GetCurrentUI',
      'GetVisiblePanels',
      'DumpPanelTree',
    ]);

    await activatePanel(wrapper, 'cabinet');
    const commandHistoryAfterClose = runAutoOperationCommand.mock.calls.map(([command]) => command);

    await activatePanel(wrapper, 'controller');
    expect(runAutoOperationCommand.mock.calls.map(([command]) => command).slice(commandHistoryAfterClose.length)).toEqual([
      'GetCurrentUI',
      'GetVisiblePanels',
      'DumpPanelTree',
    ]);
    expect(runAutoOperationCommand.mock.calls.map(([command]) => command).filter((command) => command === 'Ping')).toHaveLength(1);
  });

  it('shows the shared agent status in the controller panel after the topbar switch loads the agent', async () => {
    const startAutoOperationAgent = vi.fn().mockResolvedValue({
      ok: true,
      value: { pong: true },
    });
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'Ping') throw new Error('offline');
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent,
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();

    await wrapper.find('[data-testid="topbar-agent-switch"]').trigger('click');
    await flushPromises();
    await nextTick();
    await activatePanel(wrapper, 'controller');

    expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="controller-status-agentConnection"]').text()).toContain('已连接');
    await wrapper.find('[data-testid="controller-command-input"]').setValue('GetCurrentUI');
    expect(wrapper.find('[data-testid="controller-send-button"]').element.disabled).toBe(false);
  });

  it('runs a controller command through the shared inject command bridge', async () => {
    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'Ping') return { ok: true, value: { pong: true } };
      if (command === 'DumpPanelTree') {
        return {
          ok: true,
          result: {
            panel: 'UIMain',
            rootPath: '',
            truncated: false,
            nodes: [],
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'controller');
    await wrapper.find('[data-testid="controller-command-input"]').setValue('DumpPanelTree');
    await wrapper.find('[data-testid="controller-args-input"]').setValue('{"panel":"UIMain"}');
    await wrapper.find('[data-testid="controller-send-button"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenLastCalledWith('DumpPanelTree', { panel: 'UIMain' });

    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="controller-response-log"]').text()).toContain('DumpPanelTree');
    expect(wrapper.find('[data-testid="controller-response-log"]').text()).toContain('UIMain');
  });

  it('preserves and then clears controller inputs with the existing inject lifecycle', async () => {
    const wrapper = await mountApp();

    await activatePanel(wrapper, 'controller');
    await wrapper.find('[data-testid="controller-command-input"]').setValue('MoveToNpc');

    await activatePanel(wrapper, 'cabinet');
    await activatePanel(wrapper, 'controller');

    expect(wrapper.find('[data-testid="controller-command-input"]').element.value).toBe('MoveToNpc');

    window.dispatchEvent(new CustomEvent('bidking:leave-inject'));
    await nextTick();

    expect(wrapper.find('[data-testid="inject-panel-controller"]').exists()).toBe(false);

    await activatePanel(wrapper, 'controller');

    expect(wrapper.find('[data-testid="controller-command-input"]').element.value).toBe('');
  });

  it('marks the shared agent state offline after a manual Ping command fails', async () => {
    let pingOnline = true;
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'Ping') {
        if (pingOnline) return { ok: true, value: { pong: true } };
        throw new Error('offline');
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    expect(wrapper.find('[data-testid="topbar-agent-switch"]').attributes('aria-pressed')).toBe('true');
    await activatePanel(wrapper, 'agent');

    pingOnline = false;
    await wrapper.find('[data-testid="auto-op-command-Ping"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="topbar-agent-switch"]').attributes('aria-pressed')).toBe('false');
  });

  it('lists supported AutoOperation commands and runs a selected command', async () => {
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: { panel: 'TradingExchange_Main' },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'agent');

    for (const command of ['Ping', 'GetCurrentUI', 'GetVisiblePanels', 'OpenPanel', 'ClosePanel', 'CollectionPrices', 'InvokeMethod', 'UnloadAgent']) {
      expect(wrapper.find(`[data-testid="auto-op-command-${command}"]`).exists()).toBe(true);
    }

    await wrapper.find('[data-testid="auto-op-command-GetCurrentUI"]').trigger('click');
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetCurrentUI', {});

    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="auto-op-command-result"]').text()).toContain('TradingExchange_Main');
  });

  it('queries stock collectible counts and filters non-collectible items', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          itemCid: 1011001,
          name: '数据线',
          quality: '白',
          type: '家居日用',
          price: 160,
          size: { key: '1x1' },
        },
        {
          itemCid: 1032006,
          name: '裸靴',
          quality: '绿',
          type: '时尚潮流',
          price: 532,
          size: { key: '2x2' },
        },
      ],
    });
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        count: 3,
        items: [
          { itemCid: 1011001, count: 3 },
          { itemCid: 1099001, count: 1 },
          { itemCid: 1032006, count: 5 },
        ],
      },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'warehouse');
    await wrapper.find('[data-testid="warehouse-items-button"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetStockCollectibleCounts', {});

    await flushPromises();
    await nextTick();
    const panelText = wrapper.find('[data-testid="warehouse-items-panel"]').text();
    expect(panelText).toContain('数据线');
    expect(panelText).toContain('白');
    expect(panelText).toContain('家居日用');
    expect(panelText).toContain('1011001');
    expect(panelText).toContain('3');
    expect(panelText).toContain('裸靴');
    expect(panelText).toContain('绿');
    expect(panelText).toContain('时尚潮流');
    expect(panelText).toContain('1032006');
    expect(panelText).toContain('5');
    expect(panelText).not.toContain('1099001');
  });

  it('shows the stock move panel in desktop mode when AutoOperation commands are available', async () => {
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
    };

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'stockMove');
    expect(wrapper.find('[data-testid="stock-move-panel"]').exists()).toBe(true);
  });

  it('hides the stock move panel outside desktop mode', async () => {
    const wrapper = await mountApp();
    await activatePanel(wrapper, 'stockMove');
    expect(wrapper.find('[data-testid="stock-move-panel"]').exists()).toBe(false);
  });

  it('selects a collectible candidate by name and submits an ExchangeItem command', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          itemCid: 1011001,
          name: '数据线',
          quality: '白',
          type: '家居日用',
          price: 160,
          size: { key: '1x1' },
        },
      ],
    });
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: { result: true },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'listing');
    await wrapper.find('[data-testid="exchange-item-query"]').setValue('数据');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="exchange-item-candidate-1011001"]').trigger('click');
    await wrapper.find('[data-testid="exchange-item-count"]').setValue('2');
    await wrapper.find('[data-testid="exchange-item-unit-price"]').setValue('300');
    await wrapper.find('[data-testid="exchange-item-button"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenCalledWith('ExchangeItem', {
      itemCid: 1011001,
      count: 2,
      unitPrice: 300,
    });
  });

  it('submits an ExchangeItem command when the collectible field is a raw cid', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: { result: true },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'listing');
    await wrapper.find('[data-testid="exchange-item-query"]').setValue('1011001');
    await wrapper.find('[data-testid="exchange-item-count"]').setValue('1');
    await wrapper.find('[data-testid="exchange-item-unit-price"]').setValue('500');
    await wrapper.find('[data-testid="exchange-item-button"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenCalledWith('ExchangeItem', {
      itemCid: 1011001,
      count: 1,
      unitPrice: 500,
    });
  });

  it('starts and cancels a delayed price query for the selected collectible', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          itemCid: 1083009,
          name: '进气歧管',
          quality: '蓝',
          type: '交通工具',
          price: 4208,
          size: { key: '2x2' },
        },
      ],
    });
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'Ping') return { ok: true, value: { pong: true } };
      if (command === 'StartDelayedPriceQuery') {
        return {
          ok: true,
          value: {
            taskId: 'delayed-price-1',
            state: 'scheduled',
            itemCid: 1083009,
            actualDelaySeconds: 647,
            remainingSeconds: 647,
          },
        };
      }
      if (command === 'CancelDelayedPriceQuery') {
        return {
          ok: true,
          value: {
            taskId: 'delayed-price-1',
            state: 'canceled',
            itemCid: 1083009,
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'delayedPrice');
    await wrapper.find('[data-testid="delayed-price-query-input"]').setValue('进气');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="delayed-price-candidate-1083009"]').trigger('click');
    await wrapper.find('[data-testid="delayed-price-delay"]').setValue('600');
    await wrapper.find('[data-testid="delayed-price-jitter"]').setValue('90');
    await wrapper.find('[data-testid="delayed-price-start"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenCalledWith('StartDelayedPriceQuery', {
      itemCid: 1083009,
      delaySeconds: 600,
      jitterSeconds: 90,
    });

    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="delayed-price-status"]').text()).toContain('scheduled');
    expect(wrapper.find('[data-testid="delayed-price-window"]').text()).toContain('510');
    expect(wrapper.find('[data-testid="delayed-price-window"]').text()).toContain('690');

    await wrapper.find('[data-testid="delayed-price-cancel"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenLastCalledWith('CancelDelayedPriceQuery', {
      taskId: 'delayed-price-1',
    });
  });

  it('starts and stops the collection price scan from Inject page', async () => {
    const startCollectionPriceScan = vi.fn().mockResolvedValue({
      enabled: true,
      state: 'running',
      config: { scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 5 },
    });
    const stopCollectionPriceScan = vi.fn().mockResolvedValue({ enabled: false, state: 'stopped' });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
      startCollectionPriceScan,
      stopCollectionPriceScan,
      getCollectionPriceScanStatus: vi.fn().mockResolvedValue({
        enabled: false,
        state: 'idle',
        config: { scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 5 },
      }),
      onCollectionPriceScanState: vi.fn().mockReturnValue(() => {}),
    };

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'collectionScan');
    await wrapper.find('[data-testid="collection-scan-interval"]').setValue('30');
    await wrapper.find('[data-testid="collection-scan-item-delay"]').setValue('7');
    await wrapper.find('[data-testid="collection-scan-item-jitter"]').setValue('3');
    await wrapper.find('[data-testid="collection-scan-start"]').trigger('click');

    expect(startCollectionPriceScan).toHaveBeenCalledWith({
      scanIntervalMinutes: 30,
      itemDelaySeconds: 7,
      itemJitterSeconds: 3,
    });

    await wrapper.find('[data-testid="collection-scan-stop"]').trigger('click');
    expect(stopCollectionPriceScan).toHaveBeenCalledTimes(1);
  });

  it('restores collection scan status on remount', async () => {
    const unsubscribe = vi.fn();
    const getCollectionPriceScanStatus = vi.fn().mockResolvedValue({
      enabled: true,
      state: 'waiting_item',
      itemCount: 128,
      currentIndex: 37,
      currentCid: 1032006,
      completedCount: 36,
      writtenCount: 35,
      failedCount: 2,
      config: { scanIntervalMinutes: 60, itemDelaySeconds: 5, itemJitterSeconds: 5 },
      lastResult: { itemCid: 1032006, minPrice: 6200, tierCount: 2, totalCount: 7 },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
      claimCabinetReward: vi.fn(),
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
      startCollectionPriceScan: vi.fn(),
      stopCollectionPriceScan: vi.fn(),
      getCollectionPriceScanStatus,
      onCollectionPriceScanState: vi.fn().mockReturnValue(unsubscribe),
    };

    const firstWrapper = await mountApp();
    await activatePanel(firstWrapper, 'collectionScan');
    firstWrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'collectionScan');
    const panelText = wrapper.find('[data-testid="collection-price-scan-panel"]').text();
    expect(panelText).toContain('waiting_item');
    expect(panelText).toContain('37 / 128');
    expect(panelText).toContain('1032006');
    expect(panelText).toContain('6,200');
    expect(getCollectionPriceScanStatus).toHaveBeenCalledTimes(2);
  });

  it('refreshes listing advice and confirms high price listing through the desktop helper', async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).startsWith('/api/exchange-listing-advice/1083009')) {
        return Promise.resolve({
          ok: true,
          json: async () => listNowAdvice,
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });
    const confirmHighPriceExchangeListing = setupDesktopWithHighPriceConfirm();

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'listing');
    await wrapper.find('[data-testid="exchange-item-query"]').setValue('1083009');
    await wrapper.find('[data-testid="exchange-item-count"]').setValue('1');
    await wrapper.find('[data-testid="refresh-listing-advice"]').trigger('click');

    await flushPromises();
    await nextTick();
    expect(global.fetch).toHaveBeenCalledWith('/api/exchange-listing-advice/1083009?count=1&hours=24');
    expect(wrapper.find('[data-testid="exchange-listing-advice"]').text()).toContain('list_now');
    expect(wrapper.find('[data-testid="exchange-listing-advice"]').text()).toContain('7,799');

    await wrapper.find('[data-testid="confirm-high-price-listing"]').trigger('click');

    expect(confirmHighPriceExchangeListing).toHaveBeenCalledWith({
      itemCid: 1083009,
      count: 1,
      expectedUnitPrice: 7799,
      hours: 24,
    });
  });

  it('disables high price confirmation when the item changes after advice refresh', async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).startsWith('/api/exchange-listing-advice/1083009')) {
        return Promise.resolve({
          ok: true,
          json: async () => listNowAdvice,
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            itemCid: 1083009,
            name: '旧藏品',
            quality: '紫',
            type: '家居日用',
            price: 1000,
            size: { key: '1x1' },
          },
          {
            itemCid: 1083010,
            name: '新藏品',
            quality: '紫',
            type: '家居日用',
            price: 1000,
            size: { key: '1x1' },
          },
        ],
      });
    });
    const confirmHighPriceExchangeListing = setupDesktopWithHighPriceConfirm();

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'listing');
    await wrapper.find('[data-testid="exchange-item-query"]').setValue('1083009');
    await wrapper.find('[data-testid="exchange-item-count"]').setValue('1');
    await wrapper.find('[data-testid="refresh-listing-advice"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="exchange-item-query"]').setValue('新藏品');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="exchange-item-candidate-1083010"]').trigger('click');
    await nextTick();

    const button = wrapper.find('[data-testid="confirm-high-price-listing"]');
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    expect(confirmHighPriceExchangeListing).not.toHaveBeenCalled();
  });

  it('disables high price confirmation when the count changes after advice refresh', async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).startsWith('/api/exchange-listing-advice/1083009')) {
        return Promise.resolve({
          ok: true,
          json: async () => listNowAdvice,
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });
    const confirmHighPriceExchangeListing = setupDesktopWithHighPriceConfirm();

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'listing');
    await wrapper.find('[data-testid="exchange-item-query"]').setValue('1083009');
    await wrapper.find('[data-testid="exchange-item-count"]').setValue('1');
    await wrapper.find('[data-testid="refresh-listing-advice"]').trigger('click');
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-testid="exchange-item-count"]').setValue('2');
    await nextTick();

    const button = wrapper.find('[data-testid="confirm-high-price-listing"]');
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    expect(confirmHighPriceExchangeListing).not.toHaveBeenCalled();
  });

  it('clears confirmable advice when advice refresh fails', async () => {
    let adviceCalls = 0;
    global.fetch = vi.fn((url) => {
      if (String(url).startsWith('/api/exchange-listing-advice/1083009')) {
        adviceCalls += 1;
        return Promise.resolve(
          adviceCalls === 1
            ? {
              ok: true,
              json: async () => listNowAdvice,
            }
            : {
              ok: false,
              json: async () => ({}),
            },
        );
      }

      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });
    const confirmHighPriceExchangeListing = setupDesktopWithHighPriceConfirm();

    const wrapper = await mountApp();
    await activatePanel(wrapper, 'listing');
    await wrapper.find('[data-testid="exchange-item-query"]').setValue('1083009');
    await wrapper.find('[data-testid="exchange-item-count"]').setValue('1');
    await wrapper.find('[data-testid="refresh-listing-advice"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="confirm-high-price-listing"]').attributes('disabled')).toBeUndefined();

    await wrapper.find('[data-testid="refresh-listing-advice"]').trigger('click');
    await flushPromises();
    await nextTick();

    const button = wrapper.find('[data-testid="confirm-high-price-listing"]');
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    expect(confirmHighPriceExchangeListing).not.toHaveBeenCalled();
  });

  it('disables cabinet actions when the desktop claim API is unavailable', async () => {
    window.bidkingDesktop = {
      isDesktop: true,
      queryCabinetReward: vi.fn(),
    };

    const wrapper = await mountApp();

    expect(wrapper.find('[data-testid="cabinet-reward-button"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="cabinet-claim-button"]').attributes('disabled')).toBeDefined();
  });

  it('describes the page as a general automation workspace', async () => {
    const wrapper = await mountApp();

    expect(wrapper.text()).toContain('自动化操作');
    expect(wrapper.text()).toContain('展示柜收益');
  });
});
