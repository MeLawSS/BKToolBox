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

  it('renders localized readiness cards and a disabled controller command skeleton', async () => {
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand: vi.fn(),
    };

    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain('控制器');
    expect(wrapper.get('[data-testid="controller-status-desktop"]').text()).toContain('桌面环境');
    expect(wrapper.get('[data-testid="controller-status-agentBridge"]').text()).toContain('可用');
    expect(wrapper.get('[data-testid="controller-status-agentConnection"]').text()).toContain('等待获取');
    expect(wrapper.get('[data-testid="controller-status-transport"]').text()).toContain('未接入');
    expect(wrapper.get('[data-testid="controller-command-input"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-args-input"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-send-button"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="controller-transport-not-ready"]').text()).toContain('Controller 通道尚未接入');
    expect(wrapper.get('[data-testid="controller-response-log"]').text()).toContain('Controller 通道接入后将在这里显示响应');
    expect(wrapper.get('[data-testid="controller-domain-character-scene"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-domain-movement-interaction"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-domain-inventory-warehouse"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="controller-domain-trading-market"]').exists()).toBe(true);
  });

  it('reads shared agent state passively without issuing Ping on mount', async () => {
    window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
    const runAutoOperationCommand = vi.fn();
    window.bidkingDesktop = {
      isDesktop: true,
      startAutoOperationAgent: vi.fn(),
      runAutoOperationCommand,
    };

    const wrapper = await mountPanel();

    expect(runAutoOperationCommand).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="controller-status-agentConnection"]').text()).toContain('已连接');
  });

  it('renders the controller panel fallback copy in English when the desktop bridge is missing', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en-US');

    const wrapper = await mountPanel();

    expect(document.documentElement.lang).toBe('en-US');
    expect(wrapper.text()).toContain('Controller');
    expect(wrapper.get('[data-testid="controller-status-desktop"]').text()).toContain('Unavailable');
    expect(wrapper.get('[data-testid="controller-status-agentBridge"]').text()).toContain('Unavailable');
    expect(wrapper.get('[data-testid="controller-status-agentConnection"]').text()).toContain('Waiting');
    expect(wrapper.get('[data-testid="controller-status-transport"]').text()).toContain('Not connected');
    expect(wrapper.get('[data-testid="controller-transport-not-ready"]').text()).toContain('Controller transport');
  });
});
