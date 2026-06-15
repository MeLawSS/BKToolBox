import { computed, ref } from 'vue';
import { messages } from './messages.js';

export const LOCALES = ['zh-CN', 'en-US'];
export const DEFAULT_LOCALE = 'zh-CN';
export const LOCALE_STORAGE_KEY = 'bidking-locale';

const locale = ref(DEFAULT_LOCALE);

function isSupportedLocale(value) {
  return LOCALES.includes(value);
}

function readStoredLocale() {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch (_error) {
    return DEFAULT_LOCALE;
  }
}

function writeStoredLocale(value) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, value);
  } catch (_error) {
    // Language persistence is optional.
  }
}

function applyDocumentLocale(value) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value;
  }
}

function notifyLocaleChange(value) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('bidking-locale-change', { detail: { locale: value } }));
  }
}

function resolveMessage(key) {
  return key.split('.').reduce((node, part) => node?.[part], messages[locale.value]);
}

export function initLocale() {
  locale.value = readStoredLocale();
  applyDocumentLocale(locale.value);
}

export function setLocale(value) {
  const nextLocale = isSupportedLocale(value) ? value : DEFAULT_LOCALE;
  locale.value = nextLocale;
  writeStoredLocale(nextLocale);
  applyDocumentLocale(nextLocale);
  notifyLocaleChange(nextLocale);
}

export function toggleLocale() {
  setLocale(locale.value === 'zh-CN' ? 'en-US' : 'zh-CN');
}

export function t(key, params = {}) {
  const template = resolveMessage(key);
  const text = typeof template === 'string' ? template : key;
  return Object.entries(params).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    text
  );
}

export function useI18n() {
  initLocale();
  return {
    locale,
    isEnglish: computed(() => locale.value === 'en-US'),
    t,
    setLocale,
    toggleLocale,
  };
}
