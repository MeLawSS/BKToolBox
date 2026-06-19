/* @vitest-environment happy-dom */
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import ElsaAutoOperationPanel from './ElsaAutoOperationPanel.vue';

const mockEnable = vi.fn();
const mockDisable = vi.fn();
let isEnabled = ref(false);
let isBusy = ref(false);
let monitorStatus = ref('idle');
let agentConnected = ref(false);
let log = ref([]);

vi.mock('./useElsaAutoOperation.js', () => ({
  useElsaAutoOperation: () => ({
    isEnabled,
    isBusy,
    enable: mockEnable,
    disable: mockDisable,
    monitorStatus,
    agentConnected,
    log,
    clearLog: vi.fn(),
  }),
}));

vi.mock('../shared/i18n.js', () => ({
  useI18n: () => ({ t: (key) => key }),
}));

let mountedWrappers = [];

describe('ElsaAutoOperationPanel', () => {
  beforeEach(() => {
    isEnabled.value = false;
    isBusy.value = false;
    monitorStatus.value = 'idle';
    agentConnected.value = false;
    log.value = [];
  });

  afterEach(() => {
    mountedWrappers.forEach(w => w.unmount());
    mountedWrappers = [];
    vi.clearAllMocks();
  });

  it('renders the panel with testid', () => {
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    expect(wrapper.find('[data-testid="elsa-auto-operation-panel"]').exists()).toBe(true);
  });

  it('renders the upgraded panel chrome with summary cards and a log card', () => {
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);

    expect(wrapper.find('.elsa-auto-operation-toolbar').exists()).toBe(true);
    expect(wrapper.findAll('.elsa-auto-status-card')).toHaveLength(2);
    expect(wrapper.find('.elsa-auto-operation-log-card').exists()).toBe(true);
  });

  it('shows enable button when not enabled', () => {
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    const btn = wrapper.find('[data-testid="elsa-auto-operation-toggle"]');
    expect(btn.text()).toBe('tools.hero.elsaAutoOperationEnable');
    expect(btn.attributes('disabled')).toBeUndefined();
  });

  it('shows disable button when enabled', async () => {
    isEnabled.value = true;
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    const btn = wrapper.find('[data-testid="elsa-auto-operation-toggle"]');
    expect(btn.text()).toBe('tools.hero.elsaAutoOperationDisable');
  });

  it('shows busy button and disables it when busy', async () => {
    isBusy.value = true;
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    const btn = wrapper.find('[data-testid="elsa-auto-operation-toggle"]');
    expect(btn.text()).toBe('tools.hero.elsaAutoOperationBusy');
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('calls enable() when toggle clicked while disabled', async () => {
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await wrapper.find('[data-testid="elsa-auto-operation-toggle"]').trigger('click');
    expect(mockEnable).toHaveBeenCalledTimes(1);
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('calls disable() when toggle clicked while enabled', async () => {
    isEnabled.value = true;
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await wrapper.find('[data-testid="elsa-auto-operation-toggle"]').trigger('click');
    expect(mockDisable).toHaveBeenCalledTimes(1);
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it('shows empty log message when log is empty', () => {
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    expect(wrapper.find('[data-testid="elsa-auto-operation-log"]').text())
      .toContain('tools.hero.elsaAutoOperationLogEmpty');
  });

  it('renders log entries with level class', async () => {
    log.value = [{ time: '12:00:00', level: 'error', message: 'Test error' }];
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    const entry = wrapper.find('[data-testid="elsa-auto-operation-log-entry-0"]');
    expect(entry.exists()).toBe(true);
    expect(entry.classes()).toContain('is-error');
    expect(entry.text()).toContain('Test error');
  });

  it('shows monitor status from composable', async () => {
    monitorStatus.value = 'capturing';
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.find('[data-testid="elsa-auto-operation-monitor-status"]').text())
      .toContain('capturing');
  });

  it('shows agent connected label when connected', async () => {
    agentConnected.value = true;
    const wrapper = mount(ElsaAutoOperationPanel, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.find('[data-testid="elsa-auto-operation-agent-status"]').text())
      .toContain('tools.hero.elsaAutoOperationAgentConnected');
  });
});
