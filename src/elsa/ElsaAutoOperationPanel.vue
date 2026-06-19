<script setup>
import { ref, watch, nextTick } from 'vue';
import { useI18n } from '../shared/i18n.js';
import { useElsaAutoOperation } from './useElsaAutoOperation.js';

defineOptions({ name: 'ElsaAutoOperationPanel' });

const { t } = useI18n();
const { isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, log } =
  useElsaAutoOperation();

const logEl = ref(null);

watch(
  () => log.value.length,
  async () => {
    await nextTick();
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  },
);

function toggle() {
  if (isBusy.value) return;
  isEnabled.value ? disable() : enable();
}
</script>

<template>
  <section class="listing-advice-panel elsa-auto-operation-panel" data-testid="elsa-auto-operation-panel">
    <header class="section-head elsa-auto-operation-head">
      <h2>{{ t('tools.hero.elsaAutoOperationTitle') }}</h2>
      <button
        class="command-button"
        type="button"
        :disabled="isBusy"
        data-testid="elsa-auto-operation-toggle"
        @click="toggle"
      >
        {{
          isBusy
            ? t('tools.hero.elsaAutoOperationBusy')
            : isEnabled
              ? t('tools.hero.elsaAutoOperationDisable')
              : t('tools.hero.elsaAutoOperationEnable')
        }}
      </button>
    </header>

    <div class="elsa-auto-status-grid">
      <div class="elsa-auto-status-item" data-testid="elsa-auto-operation-monitor-status">
        <span>{{ t('tools.hero.elsaAutoOperationMonitorLabel') }}</span>
        <strong>{{ monitorStatus }}</strong>
      </div>
      <div class="elsa-auto-status-item" data-testid="elsa-auto-operation-agent-status">
        <span>{{ t('tools.hero.elsaAutoOperationAgentLabel') }}</span>
        <strong>{{
          agentConnected
            ? t('tools.hero.elsaAutoOperationAgentConnected')
            : t('tools.hero.elsaAutoOperationAgentDisconnected')
        }}</strong>
      </div>
    </div>

    <h3 class="elsa-auto-operation-log-header">{{ t('tools.hero.elsaAutoOperationLogTitle') }}</h3>
    <div ref="logEl" class="elsa-auto-operation-log" data-testid="elsa-auto-operation-log">
      <p v-if="!log.length" class="status-text is-muted">{{ t('tools.hero.elsaAutoOperationLogEmpty') }}</p>
      <div
        v-for="(entry, i) in log"
        :key="i"
        class="elsa-auto-operation-log-entry"
        :class="`is-${entry.level}`"
        :data-testid="`elsa-auto-operation-log-entry-${i}`"
      >
        <span class="log-time">{{ entry.time }}</span>
        <span class="log-message">{{ entry.message }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.elsa-auto-operation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.elsa-auto-status-grid {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}

.elsa-auto-status-item {
  display: flex;
  gap: 6px;
  font-size: 0.85em;
}

.elsa-auto-operation-log-header {
  margin-top: 12px;
  margin-bottom: 4px;
}

.elsa-auto-operation-log {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 4px;
  padding: 8px;
  font-size: 0.8em;
  font-family: monospace;
}

.elsa-auto-operation-log-entry {
  display: flex;
  gap: 8px;
  line-height: 1.6;
}

.elsa-auto-operation-log-entry.is-error { color: var(--color-error, #c00); }
.elsa-auto-operation-log-entry.is-warn  { color: var(--color-warn, #a60); }

.log-time    { opacity: 0.5; flex-shrink: 0; }
.log-message { word-break: break-all; }
</style>
