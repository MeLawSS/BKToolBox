<script setup>
import { computed, onMounted } from 'vue';
import './topbar-base.css';
import './topbar-controls.css';
import ThemeToggleIcon from './ThemeToggleIcon.vue';
import { dispatchLeaveInjectEvent } from './inject-page-lifecycle.js';
import { useAutoOperationAgentSwitch } from './useAutoOperationAgentSwitch.js';
import { useI18n } from './i18n.js';
import { dispatchLeaveToolsEvent } from './tools-page-lifecycle.js';
import { useMonitorSwitch } from './useMonitorSwitch.js';
import { useTheme } from './theme.js';

const props = defineProps({
  activePage: { type: String, default: '' },
});

const { t, isEnglish, toggleLocale } = useI18n();
const { resolvedTheme, themeButtonClass, toggleTheme } = useTheme();
const monitor = useMonitorSwitch();
const agent = useAutoOperationAgentSwitch();

const themeAriaLabel = computed(() =>
  resolvedTheme.value === 'light' ? t('common.switchThemeToDark') : t('common.switchThemeToLight'),
);

const navItems = [
  { href: '/',        page: 'home',    labelKey: 'common.home' },
  { href: '/Tools',   page: 'tools',   labelKey: 'common.tools' },
  { href: '/Monitor', page: 'monitor', labelKey: 'common.monitor' },

  { href: '/Inject',  page: 'inject',  labelKey: 'common.inject' },
];

function ignoreRejectedPromise(promise) {
  if (promise && typeof promise.catch === 'function') {
    void promise.catch(() => {});
  }
}

function isPlainPrimaryNavigation(event) {
  return event.button === 0
    && !event.defaultPrevented
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey;
}

function handleNavClick(item, event) {
  if (item.page === props.activePage) {
    event.preventDefault();
    return;
  }

  if (props.activePage === 'tools' && item.page !== 'tools' && isPlainPrimaryNavigation(event)) {
    dispatchLeaveToolsEvent();
  }

  if (props.activePage === 'inject' && item.page !== 'inject' && isPlainPrimaryNavigation(event)) {
    dispatchLeaveInjectEvent();
  }
}

function handleBrandClick(event) {
  if (!isPlainPrimaryNavigation(event)) return;

  if (props.activePage === 'tools') {
    dispatchLeaveToolsEvent();
    return;
  }

  if (props.activePage === 'inject') {
    dispatchLeaveInjectEvent();
  }
}

onMounted(() => {
  ignoreRejectedPromise(monitor.refreshStatus());
  monitor.ensureStreamConnected();
  if (agent.isAvailable.value) {
    ignoreRejectedPromise(agent.refreshAgentState());
  }
});
</script>

<template>
  <header class="topbar">
    <a class="brand" href="/" @click="handleBrandClick">BKToolBox</a>
    <nav class="nav" aria-label="Main navigation">
      <a
        v-for="item in navItems"
        :key="item.href"
        :href="item.href"
        :class="{ active: item.page === props.activePage }"
        :aria-current="item.page === props.activePage ? 'page' : undefined"
        @click="handleNavClick(item, $event)"
      >
        {{ t(item.labelKey) }}
      </a>
    </nav>

    <div class="topbar-actions">
      <button
        data-testid="topbar-monitor-switch"
        class="topbar-runtime-switch"
        :class="{ 'is-active': monitor.status.value.running }"
        type="button"
        :aria-pressed="monitor.status.value.running ? 'true' : 'false'"
        :disabled="monitor.isBusy.value"
        :title="monitor.errorText.value || monitor.statusText.value"
        @click="monitor.toggleMonitor"
      >
        <span class="topbar-runtime-switch-copy">{{ t('common.monitorSwitch') }}</span>
        <span class="topbar-runtime-switch-track" aria-hidden="true">
          <span class="topbar-runtime-switch-thumb"></span>
        </span>
      </button>

      <button
        v-if="agent.isAvailable.value"
        data-testid="topbar-agent-switch"
        class="topbar-runtime-switch"
        :class="{ 'is-active': agent.isConnected.value }"
        type="button"
        :aria-pressed="agent.isConnected.value ? 'true' : 'false'"
        :disabled="agent.isBusy.value"
        :title="agent.errorText.value || agent.statusText.value"
        @click="agent.toggleAgent"
      >
        <span class="topbar-runtime-switch-copy">{{ t('common.agentSwitch') }}</span>
        <span class="topbar-runtime-switch-track" aria-hidden="true">
          <span class="topbar-runtime-switch-thumb"></span>
        </span>
      </button>

      <slot />

      <button
        class="lang-capsule"
        type="button"
        :aria-label="t('common.languageAria')"
        @click="toggleLocale"
      >
        <span class="lang-capsule-opt" :class="{ active: !isEnglish }" :aria-current="!isEnglish ? 'true' : undefined">中文</span>
        <span class="lang-capsule-opt" :class="{ active: isEnglish }" :aria-current="isEnglish ? 'true' : undefined">EN</span>
      </button>

      <button
        :class="themeButtonClass"
        type="button"
        :aria-pressed="resolvedTheme === 'light'"
        :aria-label="themeAriaLabel"
        :title="themeAriaLabel"
        @click="toggleTheme"
      >
        <span class="theme-toggle-track" aria-hidden="true">
          <span class="theme-toggle-thumb">
            <ThemeToggleIcon :theme="resolvedTheme" />
          </span>
        </span>
      </button>
    </div>
  </header>
</template>
