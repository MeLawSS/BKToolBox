<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../../shared/i18n.js';
import { useAutoOperationAgentRuntimeState } from '../../shared/useAutoOperationAgentSwitch.js';

defineOptions({ name: 'InjectControllerPanel' });

const { t } = useI18n();
const agent = useAutoOperationAgentRuntimeState();

const commandName = ref('');
const commandArgsText = ref('{\n  \n}');

const controllerTransportReady = computed(() => false);
const desktopReady = computed(() => Boolean(window.bidkingDesktop?.isDesktop));
const agentBridgeAvailable = computed(() => agent.isAvailable.value);
const agentStatusText = computed(() => agent.statusText.value);

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
      <div class="controller-command-fields">
        <label>
          <span>{{ t('inject.controllerCommandName') }}</span>
          <input v-model="commandName" type="text" data-testid="controller-command-input" />
        </label>
        <label>
          <span>{{ t('inject.controllerCommandArgs') }}</span>
          <textarea v-model="commandArgsText" data-testid="controller-args-input"></textarea>
        </label>
      </div>

      <div class="controller-command-actions">
        <button
          class="command-button"
          type="button"
          disabled
          data-testid="controller-send-button"
        >
          {{ t('inject.controllerCommandSend') }}
        </button>
        <p class="status-text controller-inline-hint" data-testid="controller-transport-not-ready">
          {{ t('inject.controllerTransportHint') }}
        </p>
      </div>

      <div class="command-result controller-response-placeholder" data-testid="controller-response-log">
        {{ t('inject.controllerResponsePlaceholder') }}
      </div>
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
