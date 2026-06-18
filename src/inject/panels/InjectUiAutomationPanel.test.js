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

  it('resets the input draft when selection changes', async () => {
    const { wrapper } = await mountPanel({ isActive: true });

    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');
    await wrapper.get('[data-testid="controller-ui-input-draft"]').setValue('stale value');

    await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('click');
    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('click');

    expect(wrapper.get('[data-testid="controller-ui-input-draft"]').element.value).toBe('');
  });
});
