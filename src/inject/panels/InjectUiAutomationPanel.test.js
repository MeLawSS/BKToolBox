/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import InjectUiAutomationPanel from './InjectUiAutomationPanel.vue';

function createRefreshPayload() {
  return {
    currentUi: { ok: true, result: { panel: 'UIMain' } },
    visiblePanels: { ok: true, result: { panels: ['UIMain', 'BidPop_Main'] } },
    dump: {
      ok: true,
      result: {
        panel: 'UIMain',
        rootPath: '',
        truncated: true,
        nodes: [
          {
            path: 'BtnTrade',
            name: 'BtnTrade',
            active: true,
            interactive: true,
            componentTypes: ['Button'],
          },
          {
            path: 'InputRoot/PriceInput',
            name: 'PriceInput',
            active: true,
            interactive: true,
            componentTypes: ['TMP_InputField'],
          },
        ],
      },
    },
  };
}

async function mountPanel(options = {}) {
  const payload = createRefreshPayload();
  const runAutoOperationCommand = options.runAutoOperationCommand || vi.fn(async (command, args) => {
    if (command === 'GetCurrentUI') {
      return payload.currentUi;
    }
    if (command === 'GetVisiblePanels') {
      return payload.visiblePanels;
    }
    if (command === 'DumpPanelTree') {
      expect(args).toEqual({
        panel: 'UIMain',
        rootPath: '',
        interactiveOnly: true,
        maxDepth: 4,
        nodeLimit: 200,
      });
      return payload.dump;
    }
    if (command === 'ClickNode') {
      return {
        ok: true,
        result: {
          clicked: true,
          path: args.path,
        },
      };
    }
    if (command === 'SetInputText') {
      return {
        ok: true,
        result: {
          submitted: args.submit,
          text: args.text,
          path: args.path,
        },
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  window.bidkingDesktop = { runAutoOperationCommand };

  const wrapper = mount(InjectUiAutomationPanel, {
    attachTo: document.body,
    props: {
      isActive: options.isActive ?? false,
      commandLoading: options.commandLoading ?? '',
      transportReady: options.transportReady ?? true,
      transportHint: options.transportHint ?? 'Controller ready',
    },
  });

  await flushPromises();
  await nextTick();

  return { wrapper, runAutoOperationCommand };
}

describe('InjectUiAutomationPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.bidkingDesktop;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.bidkingDesktop;
  });

  it('renders dedicated transport-not-ready placeholders instead of the ordinary empty state', async () => {
    const { wrapper, runAutoOperationCommand } = await mountPanel({
      isActive: true,
      transportReady: false,
      transportHint: 'bridge missing',
    });

    expect(runAutoOperationCommand).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="controller-ui-operations"]').text()).toContain('UI 操作');
    expect(wrapper.get('[data-testid="controller-ui-list-placeholder"]').text()).toContain('通道未就绪');
    expect(wrapper.get('[data-testid="controller-ui-detail-placeholder"]').text()).toContain('通道未就绪');
    expect(wrapper.text()).not.toContain('尚未刷新');
  });

  it('renders the not-refreshed placeholders on both sides before the first activation refresh', async () => {
    const { wrapper, runAutoOperationCommand } = await mountPanel({ isActive: false, transportReady: true });

    expect(runAutoOperationCommand).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="controller-ui-list-placeholder"]').text()).toContain('尚未刷新');
    expect(wrapper.get('[data-testid="controller-ui-detail-placeholder"]').text()).toContain('尚未刷新');
  });

  it('renders the refreshing placeholders on both sides while the activation refresh is still running', async () => {
    let resolveDump;
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCurrentUI') {
        return { ok: true, result: { panel: 'UIMain' } };
      }
      if (command === 'GetVisiblePanels') {
        return { ok: true, result: { panels: ['UIMain'] } };
      }
      if (command === 'DumpPanelTree') {
        return new Promise((resolve) => {
          resolveDump = resolve;
        });
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const { wrapper } = await mountPanel({
      isActive: false,
      transportReady: true,
      runAutoOperationCommand,
    });

    await wrapper.setProps({ isActive: true });
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="controller-ui-list-placeholder"]').text()).toContain('正在刷新');
    expect(wrapper.get('[data-testid="controller-ui-detail-placeholder"]').text()).toContain('正在刷新');

    resolveDump({
      ok: true,
      result: {
        panel: 'UIMain',
        rootPath: '',
        truncated: false,
        nodes: [],
      },
    });
    await flushPromises();
    await nextTick();
  });

  it('renders the no-visible-panels placeholders on both sides after a refresh with no visible panels', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetCurrentUI') {
        return { ok: true, result: { panel: '' } };
      }
      if (command === 'GetVisiblePanels') {
        return { ok: true, result: { panels: [] } };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const { wrapper } = await mountPanel({
      isActive: true,
      transportReady: true,
      runAutoOperationCommand,
    });

    expect(wrapper.get('[data-testid="controller-ui-list-placeholder"]').text()).toContain('没有可见 Panel');
    expect(wrapper.get('[data-testid="controller-ui-detail-placeholder"]').text()).toContain('没有可见 Panel');
  });

  it('renders the empty-selected-panel placeholders on both sides when the selected panel has no interactive nodes', async () => {
    const runAutoOperationCommand = vi.fn(async (command) => {
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
    const { wrapper } = await mountPanel({
      isActive: true,
      transportReady: true,
      runAutoOperationCommand,
    });

    expect(wrapper.get('[data-testid="controller-ui-list-placeholder"]').text()).toContain('没有可交互节点');
    expect(wrapper.get('[data-testid="controller-ui-detail-placeholder"]').text()).toContain('没有可交互节点');
  });

  it('auto-refreshes only after activation and renders interactive nodes with a truncated hint', async () => {
    const { wrapper, runAutoOperationCommand } = await mountPanel({ isActive: false });

    expect(runAutoOperationCommand).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="controller-ui-list-placeholder"]').text()).toContain('尚未刷新');

    await wrapper.setProps({ isActive: true });
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).toEqual([
      'GetCurrentUI',
      'GetVisiblePanels',
      'DumpPanelTree',
    ]);
    expect(wrapper.get('[data-testid="controller-ui-current-main"]').text()).toContain('UIMain');
    expect(wrapper.get('[data-testid="controller-ui-truncated"]').text()).toContain('结果已截断');
    expect(wrapper.get('[data-testid="controller-ui-node-row-0"]').text()).toContain('BtnTrade');
    expect(wrapper.get('[data-testid="controller-ui-node-row-1"]').text()).toContain('PriceInput');
    expect(wrapper.get('[data-testid="controller-ui-detail-placeholder"]').text()).toContain('请选择一个节点');
  });

  it('updates the detail area when the selected row changes', async () => {
    const { wrapper } = await mountPanel({ isActive: true });

    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');

    expect(wrapper.get('[data-testid="controller-ui-detail-path"]').text()).toContain('InputRoot/PriceInput');
    expect(wrapper.get('[data-testid="controller-ui-detail-types"]').text()).toContain('TMP_InputField');
  });

  it('runs the ClickNode action path for button nodes', async () => {
    const { wrapper, runAutoOperationCommand } = await mountPanel({ isActive: true });

    await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('click');
    await wrapper.get('[data-testid="controller-ui-click-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenLastCalledWith('ClickNode', {
      panel: 'UIMain',
      rootPath: '',
      path: 'BtnTrade',
      pathMode: 'exact',
      component: 'auto',
    });
    expect(wrapper.get('[data-testid="controller-ui-action-result-label"]').text()).toContain('UI 操作结果');
    expect(wrapper.get('[data-testid="controller-ui-action-result"]').text()).toContain('ClickNode');
    expect(wrapper.get('[data-testid="controller-ui-action-result"]').text()).toContain('BtnTrade');
  });

  it('runs the SetInputText action path for input nodes', async () => {
    const { wrapper, runAutoOperationCommand } = await mountPanel({ isActive: true });

    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');
    await wrapper.get('[data-testid="controller-ui-input-draft"]').setValue('7799');
    await wrapper.get('[data-testid="controller-ui-submit-toggle"]').setValue(true);
    await wrapper.get('[data-testid="controller-ui-set-text-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenLastCalledWith('SetInputText', {
      panel: 'UIMain',
      rootPath: '',
      path: 'InputRoot/PriceInput',
      pathMode: 'exact',
      text: '7799',
      submit: true,
    });
    expect(wrapper.get('[data-testid="controller-ui-action-result"]').text()).toContain('SetInputText');
    expect(wrapper.get('[data-testid="controller-ui-action-result"]').text()).toContain('7799');
  });

  it('clears the previous action result when a different node is selected', async () => {
    const { wrapper } = await mountPanel({ isActive: true });

    await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('click');
    await wrapper.get('[data-testid="controller-ui-click-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="controller-ui-action-result"]').exists()).toBe(true);

    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="controller-ui-action-result-label"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="controller-ui-action-result"]').exists()).toBe(false);
  });

  it('resets the input draft when selection changes', async () => {
    const { wrapper } = await mountPanel({ isActive: true });

    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');
    await wrapper.get('[data-testid="controller-ui-input-draft"]').setValue('stale value');

    await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('click');
    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');

    expect(wrapper.get('[data-testid="controller-ui-input-draft"]').element.value).toBe('');
  });

  it('disables refresh, panel switching, and node actions when shared commandLoading is active', async () => {
    const { wrapper } = await mountPanel({
      isActive: false,
      commandLoading: 'Controller:UI Refresh',
    });

    expect(wrapper.get('[data-testid="controller-ui-refresh-button"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="controller-ui-panel-select"]').element.disabled).toBe(true);

    await wrapper.setProps({ commandLoading: '' });
    await wrapper.setProps({ isActive: true });
    await flushPromises();
    await nextTick();

    await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('click');
    await wrapper.setProps({ commandLoading: 'Controller:UI ClickNode' });
    await nextTick();
    expect(wrapper.get('[data-testid="controller-ui-click-button"]').element.disabled).toBe(true);

    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');
    await wrapper.setProps({ commandLoading: 'Controller:UI SetInputText' });
    await nextTick();
    expect(wrapper.get('[data-testid="controller-ui-set-text-button"]').element.disabled).toBe(true);
  });
});
