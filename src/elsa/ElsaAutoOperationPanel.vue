<script setup>
import { ref, watch, nextTick } from 'vue';
import { useI18n } from '../shared/i18n.js';
import { useElsaAutoOperation } from './useElsaAutoOperation.js';
import { ROOM_OPTIONS } from '../inject/room-options.js';

defineOptions({ name: 'ElsaAutoOperationPanel' });

const { t } = useI18n();
const selectedRoomId = ref('101');
const { isEnabled, isBusy, enable, disable, monitorStatus, agentConnected, log } =
  useElsaAutoOperation({ roomId: selectedRoomId });

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
    <div class="elsa-auto-operation-shell">
      <div class="elsa-auto-operation-toolbar">
        <header class="section-head elsa-auto-operation-head">
          <div class="elsa-auto-operation-copy">
            <h2>{{ t('tools.hero.elsaAutoOperationTitle') }}</h2>
            <p class="elsa-auto-operation-summary">
              {{ t('tools.hero.elsaAutoOperationMonitorLabel') }} · {{ monitorStatus }}
              <span aria-hidden="true"> / </span>
              {{ t('tools.hero.elsaAutoOperationAgentLabel') }} ·
              {{
                agentConnected
                  ? t('tools.hero.elsaAutoOperationAgentConnected')
                  : t('tools.hero.elsaAutoOperationAgentDisconnected')
              }}
            </p>
          </div>
        </header>

        <div class="elsa-auto-operation-controls">
          <label>
            <span>{{ t('inject.metaOperationRoom') }}</span>
            <select
              v-model="selectedRoomId"
              data-testid="elsa-auto-operation-room-select"
              :disabled="isEnabled || isBusy"
            >
              <option v-for="room in ROOM_OPTIONS" :key="room.value" :value="room.value">
                {{ room.label }}
              </option>
            </select>
          </label>

          <button
            class="command-button elsa-auto-operation-toggle"
            :class="{ 'is-enabled': isEnabled, 'is-disabled': !isEnabled }"
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
        </div>
      </div>

      <div class="elsa-auto-status-grid">
        <article class="elsa-auto-status-card" data-testid="elsa-auto-operation-monitor-status">
          <span class="elsa-auto-status-label">{{ t('tools.hero.elsaAutoOperationMonitorLabel') }}</span>
          <strong class="elsa-auto-status-value">{{ monitorStatus }}</strong>
          <span class="elsa-auto-status-pill" :class="{ 'is-live': isEnabled }">{{ monitorStatus }}</span>
        </article>
        <article class="elsa-auto-status-card" data-testid="elsa-auto-operation-agent-status">
          <span class="elsa-auto-status-label">{{ t('tools.hero.elsaAutoOperationAgentLabel') }}</span>
          <strong class="elsa-auto-status-value">{{
            agentConnected
              ? t('tools.hero.elsaAutoOperationAgentConnected')
              : t('tools.hero.elsaAutoOperationAgentDisconnected')
          }}</strong>
          <span class="elsa-auto-status-pill" :class="{ 'is-connected': agentConnected }">
            {{
              agentConnected
                ? t('tools.hero.elsaAutoOperationAgentConnected')
                : t('tools.hero.elsaAutoOperationAgentDisconnected')
            }}
          </span>
        </article>
      </div>

      <section class="elsa-auto-operation-log-card">
        <header class="elsa-auto-operation-log-head">
          <h3 class="elsa-auto-operation-log-header">{{ t('tools.hero.elsaAutoOperationLogTitle') }}</h3>
          <span class="elsa-auto-log-count">{{ log.length }}</span>
        </header>

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
    </div>
  </section>
</template>

<style scoped>
.elsa-auto-operation-panel {
  border: 1px solid rgba(57, 168, 149, 0.24);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgba(57, 168, 149, 0.18), transparent 32%),
    linear-gradient(160deg, rgba(16, 30, 30, 0.03), rgba(57, 168, 149, 0.06));
  box-shadow: 0 18px 40px rgba(17, 33, 33, 0.1);
  margin-bottom: 18px;
  overflow: hidden;
}

.elsa-auto-operation-shell {
  display: grid;
  gap: 16px;
  padding: 18px;
}

.elsa-auto-operation-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;
}

.elsa-auto-operation-head {
  min-width: 0;
}

.elsa-auto-operation-copy {
  min-width: 0;
}

.elsa-auto-operation-copy h2 {
  margin: 0;
}

.elsa-auto-operation-controls {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}

.elsa-auto-operation-controls label {
  display: grid;
  gap: 6px;
}

.elsa-auto-operation-controls label span {
  color: var(--muted);
  font-size: 12px;
}

.elsa-auto-operation-controls select {
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  padding: 0 10px;
}

.elsa-auto-operation-summary {
  margin: 6px 0 0;
  color: var(--muted);
  line-height: 1.5;
}

.elsa-auto-operation-toggle {
  min-width: 132px;
  min-height: 42px;
  border: none;
  border-radius: 999px;
  box-shadow: 0 10px 24px rgba(57, 168, 149, 0.18);
}

.elsa-auto-operation-toggle.is-disabled {
  background: linear-gradient(135deg, #2f8f83, #4fbaa4);
}

.elsa-auto-operation-toggle.is-enabled {
  background: linear-gradient(135deg, #cb5f5f, #e07c6e);
}

.elsa-auto-status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.elsa-auto-status-card {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(57, 168, 149, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.78);
  padding: 14px 16px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

.elsa-auto-status-label {
  color: var(--faint);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.elsa-auto-status-value {
  color: var(--text);
  font-size: 18px;
  line-height: 1.2;
}

.elsa-auto-status-pill {
  width: fit-content;
  border-radius: 999px;
  background: rgba(67, 85, 85, 0.08);
  color: var(--muted);
  font-size: 12px;
  line-height: 1;
  padding: 6px 10px;
}

.elsa-auto-status-pill.is-live,
.elsa-auto-status-pill.is-connected {
  background: rgba(57, 168, 149, 0.16);
  color: var(--primary-strong);
}

.elsa-auto-operation-log-card {
  border: 1px solid rgba(57, 168, 149, 0.16);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 14px;
}

.elsa-auto-operation-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.elsa-auto-operation-log-header {
  margin: 0;
  color: var(--text);
}

.elsa-auto-log-count {
  min-width: 28px;
  border-radius: 999px;
  background: rgba(57, 168, 149, 0.12);
  color: var(--primary-strong);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  padding: 6px 8px;
}

.elsa-auto-operation-log {
  max-height: 256px;
  overflow-y: auto;
  border: 1px solid rgba(57, 168, 149, 0.14);
  border-radius: 12px;
  background: rgba(17, 33, 33, 0.04);
  padding: 10px;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
}

.elsa-auto-operation-log-entry {
  display: flex;
  gap: 8px;
  line-height: 1.6;
  border-bottom: 1px solid rgba(57, 168, 149, 0.08);
  padding: 4px 0;
}

.elsa-auto-operation-log-entry.is-error { color: var(--color-error, #c00); }
.elsa-auto-operation-log-entry.is-warn  { color: var(--color-warn, #a60); }

.log-time    { opacity: 0.5; flex-shrink: 0; }
.log-message { word-break: break-all; }

.elsa-auto-operation-log-entry:last-child {
  border-bottom: 0;
}

@media (max-width: 720px) {
  .elsa-auto-operation-toolbar,
  .elsa-auto-status-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .elsa-auto-operation-toggle {
    width: 100%;
  }
}
</style>
