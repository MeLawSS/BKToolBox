/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import InjectUiAutomationPanel from './InjectUiAutomationPanel.vue';

function createDumpNodes() {
  return [
    {
      path: 'BtnTrade',
      name: 'Trade',
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
  ];
}

function createRefreshPayload(nodes = createDumpNodes()) {
  return {
    currentUi: { ok: true, result: { panel: 'UIMain' } },
    visiblePanels: { ok: true, result: { panels: ['UIMain', 'BidPop_Main'] } },
    dump: {
      ok: true,
      result: {
        panel: 'UIMain',
        rootPath: '',
        truncated: true,
        nodes,
      },
    },
  };
}

function createRunAutoOperationCommandMock(options = {}) {
  const payload = options.payload ?? createRefreshPayload(options.nodes);

  return vi.fn(async (command, args) => {
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
      return options.clickNodeResponse ?? {
        ok: true,
        result: {
          clicked: true,
          path: args.path,
        },
      };
    }
    if (command === 'SetInputText') {
      return options.setInputTextResponse ?? {
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
}

async function mountPanel(options = {}) {
  const fetchMock = options.fetch ?? vi.fn(async () => ({
    ok: true,
    json: async () => options.nodeLabelMap || {},
  }));
  const runAutoOperationCommand = options.runAutoOperationCommand
    || createRunAutoOperationCommandMock(options);

  vi.stubGlobal('fetch', fetchMock);
  window.bidkingDesktop = { runAutoOperationCommand };

  const wrapper = mount(InjectUiAutomationPanel, {
    attachTo: document.body,
    props: {
      isActive: options.isActive ?? true,
      commandLoading: options.commandLoading ?? '',
      transportReady: options.transportReady ?? true,
      transportHint: options.transportHint ?? 'Controller ready',
    },
  });

  await flushPromises();
  await nextTick();

  return { wrapper, runAutoOperationCommand, fetchMock };
}

function getRenderedRows(wrapper) {
  return wrapper.findAll('[data-testid^="controller-ui-node-row-"]');
}

function getClickCalls(runAutoOperationCommand) {
  return runAutoOperationCommand.mock.calls.filter(([command]) => command === 'ClickNode');
}

describe('InjectUiAutomationPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.bidkingDesktop;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete window.bidkingDesktop;
  });

  it('mapped labels come first, and unmapped rows fall back to the full path', async () => {
    const { wrapper, fetchMock } = await mountPanel({
      nodeLabelMap: {
        BtnTrade: '主界面.竞拍',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith('/data/controller-ui-node-labels.json', { cache: 'no-store' });

    const rows = getRenderedRows(wrapper);
    expect(rows).toHaveLength(2);
    expect(rows[0].find('strong').text()).toBe('主界面.竞拍');
    expect(rows[0].find('code').text()).toBe('BtnTrade');
    expect(rows[1].find('strong').text()).toBe('InputRoot/PriceInput');
  });

  it('keeps the detail area collapsed until a row is selected', async () => {
    const { wrapper } = await mountPanel();

    expect(wrapper.find('[data-testid="controller-ui-detail-placeholder"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="controller-ui-detail-path"]').exists()).toBe(false);

    await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="controller-ui-detail-path"]').exists()).toBe(true);
  });

  it('filters by mapped label and path, and keeps the search term after refresh', async () => {
    const { wrapper } = await mountPanel({
      nodeLabelMap: {
        BtnTrade: '主界面.竞拍',
      },
    });

    const searchInput = wrapper.get('[data-testid="controller-ui-search-input"]');
    await searchInput.setValue('竞拍');
    await nextTick();

    expect(getRenderedRows(wrapper)).toHaveLength(1);
    expect(getRenderedRows(wrapper)[0].find('strong').text()).toBe('主界面.竞拍');

    await searchInput.setValue('InputRoot/PriceInput');
    await nextTick();

    const pathFilteredRows = getRenderedRows(wrapper);
    expect(pathFilteredRows).toHaveLength(1);
    expect(pathFilteredRows[0].find('strong').text()).toBe('InputRoot/PriceInput');

    await wrapper.get('[data-testid="controller-ui-refresh-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(searchInput.element.value).toBe('InputRoot/PriceInput');
    expect(getRenderedRows(wrapper)).toHaveLength(1);
    expect(getRenderedRows(wrapper)[0].find('strong').text()).toBe('InputRoot/PriceInput');
  });

  it('single click only selects, while double click triggers exactly one ClickNode', async () => {
    const { wrapper, runAutoOperationCommand } = await mountPanel();
    const row = wrapper.get('[data-testid="controller-ui-node-row-0"]');

    await row.trigger('click');
    await flushPromises();
    await nextTick();

    expect(row.classes()).toContain('is-selected');
    expect(wrapper.find('[data-testid="controller-ui-detail-path"]').exists()).toBe(true);
    expect(getClickCalls(runAutoOperationCommand)).toHaveLength(0);

    await row.trigger('dblclick');
    await flushPromises();
    await nextTick();

    expect(getClickCalls(runAutoOperationCommand)).toHaveLength(1);
  });

  it('double click sends the full ClickNode args for BtnTrade', async () => {
    const { wrapper, runAutoOperationCommand } = await mountPanel();

    await wrapper.get('[data-testid="controller-ui-node-row-0"]').trigger('dblclick');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('ClickNode', {
      panel: 'UIMain',
      rootPath: '',
      path: 'BtnTrade',
      pathMode: 'exact',
      component: 'auto',
    });
  });

  it('double click on a non-clickable node surfaces feedback and does not call ClickNode', async () => {
    const { wrapper, runAutoOperationCommand } = await mountPanel();

    await wrapper.get('[data-testid="controller-ui-node-row-1"]').trigger('dblclick');
    await flushPromises();
    await nextTick();

    expect(getClickCalls(runAutoOperationCommand)).toHaveLength(0);
    expect(wrapper.get('[data-testid="controller-ui-node-row-1"]').classes()).toContain('is-blocked');
    expect(wrapper.find('[data-testid="controller-ui-action-error"]').exists()).toBe(true);
  });

  it('clears row-level failure styling after 1.5s', async () => {
    vi.useFakeTimers();

    const runAutoOperationCommand = createRunAutoOperationCommandMock({
      clickNodeResponse: {
        ok: false,
        error: 'click failed',
      },
    });
    const { wrapper } = await mountPanel({ runAutoOperationCommand });
    const row = wrapper.get('[data-testid="controller-ui-node-row-0"]');

    await row.trigger('dblclick');
    await flushPromises();
    await nextTick();

    expect(row.classes()).toContain('is-error');

    await vi.advanceTimersByTimeAsync(1500);
    await flushPromises();
    await nextTick();

    expect(row.classes()).not.toContain('is-error');
  });

  it('busy state blocks row double click but still allows typing in search', async () => {
    const { wrapper, runAutoOperationCommand } = await mountPanel();

    const row = wrapper.get('[data-testid="controller-ui-node-row-0"]');

    const searchInput = wrapper.get('[data-testid="controller-ui-search-input"]');

    await wrapper.setProps({ commandLoading: 'Controller:UI Refresh' });
    await nextTick();

    await searchInput.setValue('trade');
    await nextTick();
    expect(searchInput.element.value).toBe('trade');

    await row.trigger('dblclick');
    await flushPromises();
    await nextTick();

    expect(getClickCalls(runAutoOperationCommand)).toHaveLength(0);
  });
});
