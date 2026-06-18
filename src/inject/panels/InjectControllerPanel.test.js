/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import InjectControllerPanel from './InjectControllerPanel.vue';
import { LOCALE_STORAGE_KEY } from '../../shared/i18n.js';
import {
  __resetAutoOperationAgentSwitchRuntimeForTest,
  AGENT_CONNECTED_STORAGE_KEY,
} from '../../shared/useAutoOperationAgentSwitch.js';

async function mountPanel(props = {}) {
  const wrapper = mount(InjectControllerPanel, {
    attachTo: document.body,
    props: {
      isActive: false,
      ...props,
    },
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('InjectControllerPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));
  });

  afterEach(() => {
    __resetAutoOperationAgentSwitchRuntimeForTest();
    window.sessionStorage.clear();
    delete window.bidkingDesktop;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders localized readiness cards and the full controller console surface when the shared runtime is connected', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
    };

    const wrapper = await mountPanel({ isActive: false });

    expect(wrapper.text()).toContain('控制器');
    expect(wrapper.get('[data-testid="controller-status-desktop"]').text()).toContain('可用');
    expect(wrapper.get('[data-testid="controller-status-agentBridge"]').text()).toContain('可用');
    expect(wrapper.get('[data-testid="controller-status-agentConnection"]').text()).toContain('已连接');
    expect(wrapper.get('[data-testid="controller-status-transport"]').text()).toContain('可用');
    expect(wrapper.get('[data-testid="controller-command-input"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-args-input"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-quick-commands"]').text()).toContain('DumpPanelTree');
    expect(wrapper.get('[data-testid="controller-quick-commands"]').text()).toContain('SetInputText');
    expect(wrapper.get('[data-testid="controller-send-button"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="controller-clear-log-button"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="controller-inline-hint"]').text()).toContain('已就绪');
    expect(wrapper.get('[data-testid="controller-command-examples"]').text()).toContain('DumpPanelTree');
    expect(wrapper.get('[data-testid="controller-response-log"]').text()).toContain('尚无响应');
    expect(wrapper.get('[data-testid="controller-domain-character-scene"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-domain-movement-interaction"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-domain-inventory-warehouse"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-domain-trading-market"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-ui-operations"]').text()).toContain('UI 操作');

    await wrapper.get('[data-testid="controller-command-input"]').setValue('GetCurrentUI');
    expect(wrapper.get('[data-testid="controller-send-button"]').element.disabled).toBe(false);
  });

  it('renders the structured UI operations area without auto-refreshing while inactive', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    const runAutoOperationCommand = vi.fn();
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountPanel({ isActive: false });

    expect(wrapper.get('[data-testid="controller-ui-operations"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-ui-list-placeholder"]').text()).toContain('尚未刷新');
    expect(wrapper.find('[data-testid="controller-ui-detail-path"]').exists()).toBe(false);
    expect(runAutoOperationCommand).not.toHaveBeenCalled();
  });

  it('auto-refreshes the structured UI operations area once the panel becomes active', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'GetCurrentUI') {
        return { ok: true, result: { panel: 'UIMain' } };
      }
      if (command === 'GetVisiblePanels') {
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
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountPanel({ isActive: false });
    expect(runAutoOperationCommand).not.toHaveBeenCalled();

    await wrapper.setProps({ isActive: true });
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).toEqual([
      'GetCurrentUI',
      'GetVisiblePanels',
      'DumpPanelTree',
    ]);
    expect(wrapper.get('[data-testid="controller-ui-current-main"]').text()).toContain('UIMain');
  });

  it('reads the shared agent state passively, sends a generic controller command, and clears the response log', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      result: { panel: 'TradingExchange_Main' },
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountPanel({ isActive: false });

    const initialCommandCount = runAutoOperationCommand.mock.calls.length;

    await wrapper.get('[data-testid="controller-command-input"]').setValue('GetCurrentUI');
    await wrapper.get('[data-testid="controller-send-button"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenCalledTimes(initialCommandCount + 1);
    expect(runAutoOperationCommand).toHaveBeenLastCalledWith('GetCurrentUI', {});

    await flushPromises();
    await nextTick();
    expect(wrapper.get('[data-testid="controller-response-log"]').text()).toContain('GetCurrentUI');
    expect(wrapper.get('[data-testid="controller-response-log"]').text()).toContain('TradingExchange_Main');
    expect(wrapper.get('[data-testid="controller-clear-log-button"]').element.disabled).toBe(false);

    await wrapper.get('[data-testid="controller-clear-log-button"]').trigger('click');
    expect(wrapper.get('[data-testid="controller-response-log"]').text()).toContain('尚无响应');
    expect(wrapper.get('[data-testid="controller-clear-log-button"]').element.disabled).toBe(true);
  });

  it('keeps the generic controller command console working with the new prop contract', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCurrentUI') {
        return {
          ok: true,
          result: { panel: 'TradingExchange_Main' },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountPanel({
      isActive: false,
      commandLoading: 'Shared command lock',
    });

    expect(wrapper.get('[data-testid="controller-send-button"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="controller-inline-hint"]').text()).toContain('等待当前命令完成');

    await wrapper.setProps({ commandLoading: '' });
    await nextTick();
    await wrapper.get('[data-testid="controller-command-input"]').setValue('GetCurrentUI');
    await wrapper.get('[data-testid="controller-send-button"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenLastCalledWith('GetCurrentUI', {});
    expect(wrapper.emitted('command-loading-change').slice(-2)).toEqual([
      ['GetCurrentUI'],
      [''],
    ]);
  });

  it('fills the command form from a quick preset', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
    };

    const wrapper = await mountPanel({ isActive: false });

    await wrapper.get('[data-testid="controller-preset-DumpPanelTree"]').trigger('click');

    expect(wrapper.get('[data-testid="controller-command-input"]').element.value).toBe('DumpPanelTree');
    expect(wrapper.get('[data-testid="controller-args-input"]').element.value).toContain('"panel": "UIMain"');
    expect(wrapper.get('[data-testid="controller-send-button"]').element.disabled).toBe(false);
  });

  it('shows inline JSON validation and blocks submission when the payload is invalid', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    const runAutoOperationCommand = vi.fn();
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountPanel();

    await wrapper.get('[data-testid="controller-command-input"]').setValue('DumpPanelTree');
    await wrapper.get('[data-testid="controller-args-input"]').setValue('{');

    expect(wrapper.get('[data-testid="controller-send-button"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="controller-command-error"]').text()).toContain('JSON 参数格式无效');
    const initialCommandCount = runAutoOperationCommand.mock.calls.length;
    expect(runAutoOperationCommand).toHaveBeenCalledTimes(initialCommandCount);
  });

  it('renders English fallback copy when the desktop bridge is missing', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en-US');

    const wrapper = await mountPanel();

    expect(document.documentElement.lang).toBe('en-US');
    expect(wrapper.text()).toContain('Controller');
    expect(wrapper.get('[data-testid="controller-status-desktop"]').text()).toContain('Unavailable');
    expect(wrapper.get('[data-testid="controller-status-agentBridge"]').text()).toContain('Unavailable');
    expect(wrapper.get('[data-testid="controller-status-agentConnection"]').text()).toContain('Waiting');
    expect(wrapper.get('[data-testid="controller-status-transport"]').text()).toContain('Not ready');
    expect(wrapper.get('[data-testid="controller-inline-hint"]').text()).toContain('desktop app');
    expect(wrapper.get('[data-testid="controller-response-log"]').text()).toContain('not ready');
    expect(wrapper.get('[data-testid="controller-quick-commands"]').text()).toContain('DumpPanelTree');
    expect(wrapper.get('[data-testid="controller-command-examples"]').text()).toContain('DumpPanelTree');
  });
});
