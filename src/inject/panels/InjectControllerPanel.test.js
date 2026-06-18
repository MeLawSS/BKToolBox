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

async function mountPanel() {
  const wrapper = mount(InjectControllerPanel, { attachTo: document.body });
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('InjectControllerPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    __resetAutoOperationAgentSwitchRuntimeForTest();
    window.sessionStorage.clear();
    delete window.bidkingDesktop;
    vi.restoreAllMocks();
  });

  it('renders localized readiness cards and the full controller console surface when the shared runtime is connected', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
    };

    const wrapper = await mountPanel();

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

    await wrapper.get('[data-testid="controller-command-input"]').setValue('GetCurrentUI');
    expect(wrapper.get('[data-testid="controller-send-button"]').element.disabled).toBe(false);
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

    const wrapper = await mountPanel();

    expect(runAutoOperationCommand).not.toHaveBeenCalled();

    await wrapper.get('[data-testid="controller-command-input"]').setValue('GetCurrentUI');
    await wrapper.get('[data-testid="controller-send-button"]').trigger('click');

    expect(runAutoOperationCommand).toHaveBeenCalledTimes(1);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetCurrentUI', {});

    await flushPromises();
    await nextTick();
    expect(wrapper.get('[data-testid="controller-response-log"]').text()).toContain('GetCurrentUI');
    expect(wrapper.get('[data-testid="controller-response-log"]').text()).toContain('TradingExchange_Main');
    expect(wrapper.get('[data-testid="controller-clear-log-button"]').element.disabled).toBe(false);

    await wrapper.get('[data-testid="controller-clear-log-button"]').trigger('click');
    expect(wrapper.get('[data-testid="controller-response-log"]').text()).toContain('尚无响应');
    expect(wrapper.get('[data-testid="controller-clear-log-button"]').element.disabled).toBe(true);
  });

  it('fills the command form from a quick preset', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
    };

    const wrapper = await mountPanel();

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
    expect(runAutoOperationCommand).not.toHaveBeenCalled();
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
