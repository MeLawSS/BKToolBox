<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useAutoOperationAgentRuntimeState } from '../../shared/useAutoOperationAgentSwitch.js';

defineOptions({ name: 'InjectControllerPanel' });

const DEFAULT_COMMAND_ARGS_TEXT = '{}';
const MAX_RESPONSE_LOG_ENTRIES = 10;

const props = defineProps({
  commandLoading: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['command-loading-change']);

const { t } = useI18n();
const agent = useAutoOperationAgentRuntimeState();

const commandName = ref('');
const commandArgsText = ref(DEFAULT_COMMAND_ARGS_TEXT);
const controllerError = ref('');
const responseLogEntries = ref([]);
const localCommandLoading = ref('');

const quickCommandPresets = [
  {
    id: 'DumpPanelTree',
    command: 'DumpPanelTree',
    args: {
      panel: 'UIMain',
    },
  },
  {
    id: 'WaitForVisiblePanel',
    command: 'WaitForVisiblePanel',
    args: {
      panel: 'BidPop_Main',
      visible: true,
      timeoutMs: 3000,
    },
  },
  {
    id: 'WaitForNode',
    command: 'WaitForNode',
    args: {
      panel: 'UIMain',
      rootPath: 'WareHousePanel/StorePanel_InfoPane',
      path: 'InputRoot/PriceInput',
      pathMode: 'exact',
      state: 'interactive',
      timeoutMs: 3000,
    },
  },
  {
    id: 'ClickNode',
    command: 'ClickNode',
    args: {
      panel: 'UIMain',
      rootPath: 'WareHousePanel/StorePanel_InfoPane',
      path: 'BtnSell',
      pathMode: 'exact',
      component: 'auto',
    },
  },
  {
    id: 'SetInputText',
    command: 'SetInputText',
    args: {
      panel: 'UIMain',
      rootPath: 'WareHousePanel/StorePanel_InfoPane',
      path: 'InputRoot/PriceInput',
      pathMode: 'exact',
      text: '7799',
      submit: true,
    },
  },
  {
    id: 'GetNodeState',
    command: 'GetNodeState',
    args: {
      panel: 'UIMain',
      rootPath: 'WareHousePanel/StorePanel_InfoPane',
      path: 'InputRoot/PriceInput',
      pathMode: 'exact',
    },
  },
];

const desktopReady = computed(() => Boolean(window.bidkingDesktop?.isDesktop));
const agentBridgeAvailable = computed(() => agent.isAvailable.value);
const agentConnected = computed(() => agent.isConnected.value);
const agentStatusText = computed(() => agent.statusText.value);
const effectiveCommandLoading = computed(() => props.commandLoading || localCommandLoading.value);

const controllerTransportReady = computed(() =>
  Boolean(
    desktopReady.value &&
    agentBridgeAvailable.value &&
    agentConnected.value &&
    typeof window.bidkingDesktop?.runAutoOperationCommand === 'function',
  ),
);

const normalizedCommandName = computed(() => commandName.value.trim());

const parsedCommandArgs = computed(() => {
  const source = commandArgsText.value.trim();
  if (!source) {
    return {
      ok: true,
      value: {},
      error: '',
    };
  }

  try {
    const value = JSON.parse(source);
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return {
        ok: false,
        value: null,
        error: t('inject.controllerCommandArgsObjectRequired'),
      };
    }
    return {
      ok: true,
      value,
      error: '',
    };
  } catch (_error) {
    return {
      ok: false,
      value: null,
      error: t('inject.controllerCommandArgsInvalid'),
    };
  }
});

const inlineValidationText = computed(() => {
  if (!normalizedCommandName.value) return '';
  return parsedCommandArgs.value.ok ? '' : parsedCommandArgs.value.error;
});

const canSendControllerCommand = computed(() =>
  Boolean(
    controllerTransportReady.value &&
    !effectiveCommandLoading.value &&
    normalizedCommandName.value &&
    parsedCommandArgs.value.ok,
  ),
);

const desktopStatusText = computed(() =>
  desktopReady.value ? t('inject.controllerAvailable') : t('inject.controllerUnavailable'),
);

const bridgeStatusText = computed(() =>
  agentBridgeAvailable.value ? t('inject.controllerAvailable') : t('inject.controllerUnavailable'),
);

const transportStatusText = computed(() =>
  controllerTransportReady.value
    ? t('inject.controllerAvailable')
    : t('inject.controllerTransportUnavailable'),
);

const controllerInlineHint = computed(() => {
  if (!desktopReady.value) return t('inject.unavailable');
  if (!agentBridgeAvailable.value) return t('inject.controllerBridgeHint');
  if (!agentConnected.value) return t('inject.controllerAgentDisconnectedHint');
  if (effectiveCommandLoading.value) return t('inject.controllerBusyHint');
  return t('inject.controllerReadyHint');
});

const responseLogText = computed(() => {
  if (!responseLogEntries.value.length) {
    return controllerTransportReady.value
      ? t('inject.controllerResponseEmpty')
      : t('inject.controllerResponsePlaceholder');
  }

  return responseLogEntries.value
    .map((entry) => `${entry.command}\n${JSON.stringify(entry.payload, null, 2)}`)
    .join('\n\n');
});

const hasResponseLog = computed(() => responseLogEntries.value.length > 0);

const domainCards = [
  {
    id: 'character-scene',
    titleKey: 'inject.controllerDomainCharacterScene',
    subtitleKey: 'inject.controllerDomainCharacterSceneSub',
  },
  {
    id: 'movement-interaction',
    titleKey: 'inject.controllerDomainMovementInteraction',
    subtitleKey: 'inject.controllerDomainMovementInteractionSub',
  },
  {
    id: 'inventory-warehouse',
    titleKey: 'inject.controllerDomainInventoryWarehouse',
    subtitleKey: 'inject.controllerDomainInventoryWarehouseSub',
  },
  {
    id: 'trading-market',
    titleKey: 'inject.controllerDomainTradingMarket',
    subtitleKey: 'inject.controllerDomainTradingMarketSub',
  },
];

function appendResponseLog(command, payload) {
  responseLogEntries.value = [
    {
      command,
      payload,
    },
    ...responseLogEntries.value,
  ].slice(0, MAX_RESPONSE_LOG_ENTRIES);
}

function clearResponseLog() {
  responseLogEntries.value = [];
  controllerError.value = '';
}

function applyQuickCommandPreset(preset) {
  if (!preset) return;
  commandName.value = preset.command;
  commandArgsText.value = JSON.stringify(preset.args, null, 2);
  controllerError.value = '';
}

async function submitControllerCommand() {
  if (!canSendControllerCommand.value) {
    if (!normalizedCommandName.value) {
      controllerError.value = t('inject.controllerCommandRequired');
    } else if (!parsedCommandArgs.value.ok) {
      controllerError.value = parsedCommandArgs.value.error;
    }
    return;
  }

  const command = normalizedCommandName.value;
  const args = parsedCommandArgs.value.value || {};
  controllerError.value = '';
  localCommandLoading.value = command;
  emit('command-loading-change', command);

  try {
    const response = await window.bidkingDesktop.runAutoOperationCommand(command, args);
    if (response?.ok === false) {
      controllerError.value = response.error || t('inject.failed');
      appendResponseLog(command, response);
      return;
    }
    appendResponseLog(command, response);
  } catch (error) {
    const message = error?.message || t('inject.failed');
    controllerError.value = message;
    appendResponseLog(command, {
      ok: false,
      error: message,
    });
  } finally {
    localCommandLoading.value = '';
    emit('command-loading-change', '');
  }
}
</script>

<template>
  <section class="controller-panel">
    <header class="section-head">
      <div>
        <h2>{{ t('inject.controllerTitle') }}</h2>
        <p>{{ t('inject.controllerSubtitle') }}</p>
      </div>
    </header>

    <div class="metric-grid">
      <div class="metric" data-testid="controller-status-desktop">
        <span>{{ t('inject.controllerDesktop') }}</span>
        <strong>{{ desktopStatusText }}</strong>
      </div>
      <div class="metric" data-testid="controller-status-agentBridge">
        <span>{{ t('inject.controllerAgentBridge') }}</span>
        <strong>{{ bridgeStatusText }}</strong>
      </div>
      <div class="metric" data-testid="controller-status-agentConnection">
        <span>{{ t('inject.controllerAgentConnection') }}</span>
        <strong>{{ agentStatusText }}</strong>
      </div>
      <div class="metric" data-testid="controller-status-transport">
        <span>{{ t('inject.controllerTransport') }}</span>
        <strong>{{ transportStatusText }}</strong>
      </div>
    </div>

    <section class="listing-advice-panel controller-command-panel">
      <div class="controller-quick-command-panel">
        <span class="status-text is-muted">{{ t('inject.controllerQuickCommands') }}</span>
        <div class="command-grid" data-testid="controller-quick-commands">
          <button
            v-for="preset in quickCommandPresets"
            :key="preset.id"
            class="command-button"
            type="button"
            :data-testid="`controller-preset-${preset.id}`"
            @click="applyQuickCommandPreset(preset)"
          >
            {{ preset.command }}
          </button>
        </div>
      </div>

      <div class="controller-command-fields">
        <label>
          <span>{{ t('inject.controllerCommandName') }}</span>
          <input
            v-model="commandName"
            type="text"
            placeholder="DumpPanelTree"
            data-testid="controller-command-input"
          />
        </label>
        <label>
          <span>{{ t('inject.controllerCommandArgs') }}</span>
          <textarea
            v-model="commandArgsText"
            spellcheck="false"
            data-testid="controller-args-input"
          ></textarea>
        </label>
      </div>

      <p
        v-if="controllerError || inlineValidationText"
        class="status-text is-error"
        data-testid="controller-command-error"
      >
        {{ controllerError || inlineValidationText }}
      </p>

      <div class="controller-command-actions">
        <button
          class="command-button"
          type="button"
          :disabled="!canSendControllerCommand"
          data-testid="controller-send-button"
          @click="submitControllerCommand"
        >
          {{
            effectiveCommandLoading
              ? t('inject.autoOperationRunning')
              : t('inject.controllerCommandSend')
          }}
        </button>
        <button
          class="command-button"
          type="button"
          :disabled="!hasResponseLog"
          data-testid="controller-clear-log-button"
          @click="clearResponseLog"
        >
          {{ t('inject.controllerClearLog') }}
        </button>
        <p class="status-text controller-inline-hint" data-testid="controller-inline-hint">
          {{ controllerInlineHint }}
        </p>
      </div>

      <p class="status-text is-muted controller-command-examples" data-testid="controller-command-examples">
        {{ t('inject.controllerCommandExamples') }}
      </p>

      <pre class="command-result" data-testid="controller-response-log">{{ responseLogText }}</pre>
    </section>

    <section class="controller-domain-grid">
      <article
        v-for="card in domainCards"
        :key="card.id"
        class="controller-domain-card"
        :data-testid="`controller-domain-${card.id}`"
      >
        <h3>{{ t(card.titleKey) }}</h3>
        <p>{{ t(card.subtitleKey) }}</p>
      </article>
    </section>
  </section>
</template>
