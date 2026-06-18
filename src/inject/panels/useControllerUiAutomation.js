import { computed, ref, watch } from 'vue';

const DUMP_PANEL_TREE_DEFAULTS = Object.freeze({
  rootPath: '',
  interactiveOnly: true,
  maxDepth: 4,
  nodeLimit: 200,
});

function getRunner() {
  const run = window.bidkingDesktop?.runAutoOperationCommand;
  if (typeof run !== 'function') {
    throw new Error('runAutoOperationCommand unavailable');
  }
  return run;
}

function unwrapResponsePayload(response) {
  if (response?.ok === false) {
    throw new Error(response.error || response.message || 'AutoOperation command failed');
  }
  return response?.result ?? response?.value ?? response ?? {};
}

function normalizeDumpNodes(payload) {
  if (!Array.isArray(payload?.nodes)) {
    return [];
  }

  return payload.nodes
    .map((node) => ({
      path: String(node?.path || node?.resolvedPath || ''),
      name: String(node?.name || node?.path || node?.resolvedPath || ''),
      componentTypes: Array.isArray(node?.componentTypes) ? node.componentTypes.map(String) : [],
      active: Boolean(node?.active),
      interactive: Boolean(node?.interactive),
    }))
    .filter((node) => node.path);
}

function resolveActivationPanel(currentPanel, panels) {
  if (currentPanel && panels.includes(currentPanel)) {
    return currentPanel;
  }
  return panels[0] || '';
}

function resolveRefreshPanel(previousPanel, currentPanel, panels) {
  if (previousPanel && panels.includes(previousPanel)) {
    return previousPanel;
  }
  return resolveActivationPanel(currentPanel, panels);
}

function nodeSupportsClick(node) {
  return Boolean(
    node &&
    (node.componentTypes.includes('Button') || node.componentTypes.includes('Toggle')),
  );
}

function nodeSupportsTextInput(node) {
  return Boolean(
    node &&
    (
      node.componentTypes.includes('TMP_InputField') ||
      node.componentTypes.includes('NumericInputField')
    ),
  );
}

function buildUiActionResult(action, panel, path, payload) {
  return {
    action,
    panel,
    path,
    payload,
  };
}

export function useControllerUiAutomation({
  isActive,
  transportReady,
  commandLoading,
  emitCommandLoadingChange,
}) {
  const uiAutomationRefreshing = ref(false);
  const currentMainPanel = ref('');
  const visiblePanels = ref([]);
  const selectedPanel = ref('');
  const interactiveNodes = ref([]);
  const selectedNodePath = ref('');
  const nodeInputDraft = ref('');
  const nodeSubmitAfterInput = ref(false);
  const uiAutomationError = ref('');
  const uiActionError = ref('');
  const lastUiActionResult = ref(null);
  const hasLoadedUiAutomationOnce = ref(false);
  const nodeListTruncated = ref(false);
  const localCommandLoading = ref('');

  const effectiveCommandLoading = computed(() => commandLoading.value || localCommandLoading.value);
  const selectedNode = computed(() => (
    interactiveNodes.value.find((node) => node.path === selectedNodePath.value) || null
  ));
  const selectedNodeSupportsClick = computed(() => nodeSupportsClick(selectedNode.value));
  const selectedNodeSupportsTextInput = computed(() => nodeSupportsTextInput(selectedNode.value));
  const canRefreshUi = computed(() => Boolean(transportReady.value && !effectiveCommandLoading.value));
  const canSwitchPanels = computed(() => Boolean(
    transportReady.value &&
    !effectiveCommandLoading.value &&
    visiblePanels.value.length > 0
  ));
  const canRunClickAction = computed(() => Boolean(
    transportReady.value &&
    !effectiveCommandLoading.value &&
    selectedPanel.value &&
    selectedNodeSupportsClick.value
  ));
  const canRunSetTextAction = computed(() => Boolean(
    transportReady.value &&
    !effectiveCommandLoading.value &&
    selectedPanel.value &&
    selectedNodeSupportsTextInput.value
  ));

  function resetSelectedNodeDraftState() {
    nodeInputDraft.value = '';
    nodeSubmitAfterInput.value = false;
    uiActionError.value = '';
  }

  function setSelectedNode(path) {
    selectedNodePath.value = String(path || '');
    resetSelectedNodeDraftState();
  }

  function clearStaleSelection(nextNodes) {
    if (!selectedNodePath.value) {
      return;
    }
    if (!nextNodes.some((node) => node.path === selectedNodePath.value)) {
      selectedNodePath.value = '';
      resetSelectedNodeDraftState();
    }
  }

  async function runCommand(command, args) {
    return unwrapResponsePayload(await getRunner()(command, args));
  }

  async function withSharedCommandLock(lockLabel, callback) {
    if (effectiveCommandLoading.value) {
      throw new Error('AutoOperation command already running');
    }

    localCommandLoading.value = lockLabel;
    emitCommandLoadingChange(lockLabel);

    try {
      return await callback();
    } finally {
      localCommandLoading.value = '';
      emitCommandLoadingChange('');
    }
  }

  function commitRefreshState({
    nextCurrentMainPanel,
    nextVisiblePanels,
    nextSelectedPanel,
    nextInteractiveNodes,
    nextNodeListTruncated,
  }) {
    currentMainPanel.value = nextCurrentMainPanel;
    visiblePanels.value = nextVisiblePanels;
    selectedPanel.value = nextSelectedPanel;
    interactiveNodes.value = nextInteractiveNodes;
    nodeListTruncated.value = nextNodeListTruncated;
    clearStaleSelection(nextInteractiveNodes);
    hasLoadedUiAutomationOnce.value = true;
  }

  async function refreshUi(options = {}) {
    if (!transportReady.value) {
      return false;
    }

    const preserveSelectedPanel = options.preserveSelectedPanel ?? true;
    uiAutomationRefreshing.value = true;
    uiAutomationError.value = '';

    try {
      await withSharedCommandLock('Controller:UI Refresh', async () => {
        const currentUiPayload = await runCommand('GetCurrentUI', {});
        const visiblePanelsPayload = await runCommand('GetVisiblePanels', {});
        const nextCurrentMainPanel = String(currentUiPayload?.panel || '');
        const nextVisiblePanels = Array.isArray(visiblePanelsPayload?.panels)
          ? visiblePanelsPayload.panels.map(String)
          : [];
        const nextSelectedPanel = preserveSelectedPanel
          ? resolveRefreshPanel(selectedPanel.value, nextCurrentMainPanel, nextVisiblePanels)
          : resolveActivationPanel(nextCurrentMainPanel, nextVisiblePanels);

        let nextInteractiveNodes = [];
        let nextNodeListTruncated = false;

        if (nextSelectedPanel) {
          const dumpPayload = await runCommand('DumpPanelTree', {
            panel: nextSelectedPanel,
            ...DUMP_PANEL_TREE_DEFAULTS,
          });
          nextInteractiveNodes = normalizeDumpNodes(dumpPayload);
          nextNodeListTruncated = Boolean(dumpPayload?.truncated);
        }

        commitRefreshState({
          nextCurrentMainPanel,
          nextVisiblePanels,
          nextSelectedPanel,
          nextInteractiveNodes,
          nextNodeListTruncated,
        });
      });
      return true;
    } catch (error) {
      uiAutomationError.value = error?.message || 'Failed to refresh UI automation state';
      return false;
    } finally {
      uiAutomationRefreshing.value = false;
    }
  }

  async function switchPanel(panel) {
    const nextPanel = String(panel || '');
    if (!nextPanel || nextPanel === selectedPanel.value) {
      return true;
    }
    if (!transportReady.value) {
      return false;
    }

    uiAutomationRefreshing.value = true;
    uiAutomationError.value = '';

    try {
      await withSharedCommandLock(`Controller:UI Switch:${nextPanel}`, async () => {
        const dumpPayload = await runCommand('DumpPanelTree', {
          panel: nextPanel,
          ...DUMP_PANEL_TREE_DEFAULTS,
        });
        const nextInteractiveNodes = normalizeDumpNodes(dumpPayload);
        selectedPanel.value = nextPanel;
        interactiveNodes.value = nextInteractiveNodes;
        nodeListTruncated.value = Boolean(dumpPayload?.truncated);
        clearStaleSelection(nextInteractiveNodes);
        hasLoadedUiAutomationOnce.value = true;
      });
      return true;
    } catch (error) {
      uiAutomationError.value = error?.message || 'Failed to switch UI panel';
      return false;
    } finally {
      uiAutomationRefreshing.value = false;
    }
  }

  async function clickSelectedNode() {
    if (!canRunClickAction.value || !selectedNode.value) {
      return false;
    }

    uiActionError.value = '';
    const panel = selectedPanel.value;
    const path = selectedNode.value.path;

    try {
      const payload = await withSharedCommandLock('Controller:UI ClickNode', async () => (
        runCommand('ClickNode', {
          panel,
          rootPath: '',
          path,
          pathMode: 'exact',
          component: 'auto',
        })
      ));
      lastUiActionResult.value = buildUiActionResult('ClickNode', panel, path, payload);
      return true;
    } catch (error) {
      const message = error?.message || 'Failed to click selected node';
      uiActionError.value = message;
      lastUiActionResult.value = buildUiActionResult('ClickNode', panel, path, {
        ok: false,
        error: message,
      });
      return false;
    }
  }

  async function setSelectedNodeText() {
    if (!canRunSetTextAction.value || !selectedNode.value) {
      return false;
    }

    uiActionError.value = '';
    const panel = selectedPanel.value;
    const path = selectedNode.value.path;

    try {
      const payload = await withSharedCommandLock('Controller:UI SetInputText', async () => (
        runCommand('SetInputText', {
          panel,
          rootPath: '',
          path,
          pathMode: 'exact',
          text: nodeInputDraft.value,
          submit: nodeSubmitAfterInput.value,
        })
      ));
      lastUiActionResult.value = buildUiActionResult('SetInputText', panel, path, payload);
      return true;
    } catch (error) {
      const message = error?.message || 'Failed to set selected node text';
      uiActionError.value = message;
      lastUiActionResult.value = buildUiActionResult('SetInputText', panel, path, {
        ok: false,
        error: message,
      });
      return false;
    }
  }

  let sawActive = false;
  watch(
    [() => Boolean(isActive.value), () => Boolean(transportReady.value)],
    ([nextActive, nextReady], [previousActive]) => {
      const shouldRefresh = nextActive && nextReady && (!sawActive || !previousActive);
      sawActive = nextActive;
      if (shouldRefresh) {
        refreshUi({ preserveSelectedPanel: false });
      }
    },
    { immediate: true },
  );

  return {
    uiAutomationRefreshing,
    currentMainPanel,
    visiblePanels,
    selectedPanel,
    interactiveNodes,
    selectedNodePath,
    selectedNode,
    selectedNodeSupportsClick,
    selectedNodeSupportsTextInput,
    nodeInputDraft,
    nodeSubmitAfterInput,
    uiAutomationError,
    uiActionError,
    lastUiActionResult,
    hasLoadedUiAutomationOnce,
    nodeListTruncated,
    effectiveCommandLoading,
    canRefreshUi,
    canSwitchPanels,
    canRunClickAction,
    canRunSetTextAction,
    setSelectedNode,
    refreshUi,
    switchPanel,
    clickSelectedNode,
    setSelectedNodeText,
  };
}
