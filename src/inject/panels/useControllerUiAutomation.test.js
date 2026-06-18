/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { useControllerUiAutomation } from './useControllerUiAutomation.js';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function mountUiAutomation(options = {}) {
  const isActive = ref(options.isActive ?? false);
  const transportReady = ref(options.transportReady ?? true);
  const commandLoading = ref(options.commandLoading ?? '');
  const loadingEvents = [];
  let api = null;

  const Probe = defineComponent({
    setup() {
      api = useControllerUiAutomation({
        isActive,
        transportReady,
        commandLoading,
        emitCommandLoadingChange(value) {
          loadingEvents.push(value);
        },
      });
      return api;
    },
    template: '<div />',
  });

  const wrapper = mount(Probe, { attachTo: document.body });
  return {
    wrapper,
    isActive,
    transportReady,
    commandLoading,
    loadingEvents,
    getApi() {
      return api;
    },
  };
}

describe('useControllerUiAutomation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.bidkingDesktop;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-refreshes only after an inactive-to-active transition and commits header/tree together', async () => {
    const dumpDeferred = createDeferred();
    const runAutoOperationCommand = vi.fn(async (command, args) => {
      if (command === 'GetCurrentUI') {
        return { ok: true, result: { panel: 'UIMain' } };
      }
      if (command === 'GetVisiblePanels') {
        return { ok: true, result: { panels: ['UIMain', 'TradingExchange_Main'] } };
      }
      if (command === 'DumpPanelTree') {
        expect(args).toEqual({
          panel: 'UIMain',
          rootPath: '',
          interactiveOnly: true,
          maxDepth: 4,
          nodeLimit: 200,
        });
        return dumpDeferred.promise;
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.bidkingDesktop = { runAutoOperationCommand };

    const harness = mountUiAutomation({ isActive: false, transportReady: true });
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).not.toHaveBeenCalled();

    harness.isActive.value = true;
    await flushPromises();
    await nextTick();

    const api = harness.getApi();
    expect(runAutoOperationCommand.mock.calls.map(([command]) => command)).toEqual([
      'GetCurrentUI',
      'GetVisiblePanels',
      'DumpPanelTree',
    ]);
    expect(api.currentMainPanel.value).toBe('');
    expect(api.visiblePanels.value).toEqual([]);
    expect(api.selectedPanel.value).toBe('');
    expect(api.interactiveNodes.value).toEqual([]);
    expect(api.hasLoadedUiAutomationOnce.value).toBe(false);

    dumpDeferred.resolve({
      ok: true,
      result: {
        panel: 'UIMain',
        rootPath: '',
        truncated: false,
        nodes: [
          {
            path: 'BtnTrade',
            name: 'BtnTrade',
            active: true,
            interactive: true,
            componentTypes: ['Button'],
          },
        ],
      },
    });
    await flushPromises();
    await nextTick();

    expect(api.currentMainPanel.value).toBe('UIMain');
    expect(api.visiblePanels.value).toEqual(['UIMain', 'TradingExchange_Main']);
    expect(api.selectedPanel.value).toBe('UIMain');
    expect(api.interactiveNodes.value).toEqual([
      expect.objectContaining({
        path: 'BtnTrade',
        componentTypes: ['Button'],
      }),
    ]);
    expect(api.hasLoadedUiAutomationOnce.value).toBe(true);
    expect(harness.loadingEvents[0]).not.toBe('');
    expect(harness.loadingEvents.at(-1)).toBe('');
  });

  it('stores a structured action result on click success', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [
            {
              path: 'BtnTrade',
              name: 'BtnTrade',
              active: true,
              interactive: true,
              componentTypes: ['Button'],
            },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true, result: { clicked: true, resolvedPath: 'BtnTrade' } });
    window.bidkingDesktop = { runAutoOperationCommand };

    const harness = mountUiAutomation({ isActive: true, transportReady: true });
    await flushPromises();
    await nextTick();

    const api = harness.getApi();
    api.setSelectedNode('BtnTrade');

    await api.clickSelectedNode();
    await flushPromises();
    await nextTick();

    expect(api.lastUiActionResult.value).toEqual({
      action: 'ClickNode',
      panel: 'UIMain',
      path: 'BtnTrade',
      payload: {
        clicked: true,
        resolvedPath: 'BtnTrade',
      },
    });
    expect(api.uiActionError.value).toBe('');
  });

  it('stores a structured action result on set-text failure', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [
            {
              path: 'InputRoot/PriceInput',
              name: 'PriceInput',
              active: true,
              interactive: true,
              componentTypes: ['TMP_InputField'],
            },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: false, error: 'input rejected' });
    window.bidkingDesktop = { runAutoOperationCommand };

    const harness = mountUiAutomation({ isActive: true, transportReady: true });
    await flushPromises();
    await nextTick();

    const api = harness.getApi();
    api.setSelectedNode('InputRoot/PriceInput');
    api.nodeInputDraft.value = '7799';
    api.nodeSubmitAfterInput.value = true;

    await api.setSelectedNodeText();
    await flushPromises();
    await nextTick();

    expect(api.uiActionError.value).toContain('input rejected');
    expect(api.lastUiActionResult.value).toEqual({
      action: 'SetInputText',
      panel: 'UIMain',
      path: 'InputRoot/PriceInput',
      payload: {
        ok: false,
        error: 'input rejected',
      },
    });
  });

  it('preserves the committed selected panel when manual refresh still finds it visible', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain', 'BidPop_Main'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'BtnOpenPop', name: 'BtnOpenPop', active: true, interactive: true, componentTypes: ['Button'] }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'BidPop_Main',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'InputRoot/PriceInput', name: 'PriceInput', active: true, interactive: true, componentTypes: ['TMP_InputField'] }],
        },
      })
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain', 'BidPop_Main'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'BidPop_Main',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'InputRoot/PriceInput', name: 'PriceInput', active: true, interactive: true, componentTypes: ['TMP_InputField'] }],
        },
      });
    window.bidkingDesktop = { runAutoOperationCommand };

    const harness = mountUiAutomation({ isActive: true, transportReady: true });
    await flushPromises();
    await nextTick();

    const api = harness.getApi();
    await api.switchPanel('BidPop_Main');
    await flushPromises();
    await nextTick();

    await api.refreshUi({ preserveSelectedPanel: true });
    await flushPromises();
    await nextTick();

    expect(api.selectedPanel.value).toBe('BidPop_Main');
    expect(api.interactiveNodes.value[0].path).toBe('InputRoot/PriceInput');
  });

  it('keeps the previous committed header and node list when a refresh dump fails', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'BtnTrade', name: 'BtnTrade', active: true, interactive: true, componentTypes: ['Button'] }],
        },
      })
      .mockResolvedValueOnce({ ok: true, result: { panel: 'TradingExchange_Main' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['TradingExchange_Main'] } })
      .mockResolvedValueOnce({ ok: false, error: 'panel not visible' });
    window.bidkingDesktop = { runAutoOperationCommand };

    const harness = mountUiAutomation({ isActive: true, transportReady: true });
    await flushPromises();
    await nextTick();

    const api = harness.getApi();
    expect(api.currentMainPanel.value).toBe('UIMain');
    expect(api.visiblePanels.value).toEqual(['UIMain']);
    expect(api.interactiveNodes.value[0].path).toBe('BtnTrade');

    await api.refreshUi({ preserveSelectedPanel: true });
    await flushPromises();
    await nextTick();

    expect(api.currentMainPanel.value).toBe('UIMain');
    expect(api.visiblePanels.value).toEqual(['UIMain']);
    expect(api.selectedPanel.value).toBe('UIMain');
    expect(api.interactiveNodes.value[0].path).toBe('BtnTrade');
    expect(api.uiAutomationError.value).toContain('panel not visible');
  });

  it('does not commit a new panel selection when the replacement dump fails', async () => {
    const runAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { panel: 'UIMain' } })
      .mockResolvedValueOnce({ ok: true, result: { panels: ['UIMain', 'BidPop_Main'] } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          panel: 'UIMain',
          rootPath: '',
          truncated: false,
          nodes: [{ path: 'BtnTrade', name: 'BtnTrade', active: true, interactive: true, componentTypes: ['Button'] }],
        },
      })
      .mockResolvedValueOnce({ ok: false, error: 'root path not found' });
    window.bidkingDesktop = { runAutoOperationCommand };

    const harness = mountUiAutomation({ isActive: true, transportReady: true });
    await flushPromises();
    await nextTick();

    const api = harness.getApi();
    await api.switchPanel('BidPop_Main');
    await flushPromises();
    await nextTick();

    expect(api.selectedPanel.value).toBe('UIMain');
    expect(api.interactiveNodes.value[0].path).toBe('BtnTrade');
    expect(api.uiAutomationError.value).toContain('root path not found');
  });
});
