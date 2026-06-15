import { computed, onMounted, ref, watch } from 'vue';

const THEME_STORAGE_KEY = 'bidking-theme';

function afterThemePaint(callback) {
  if (typeof window.requestAnimationFrame !== 'function') {
    window.setTimeout(callback, 0);
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

function applyWithoutColorTransition(root, update) {
  root.dataset.themeSwitching = 'true';
  update();
  afterThemePaint(() => {
    delete root.dataset.themeSwitching;
  });
}

export function useTheme() {
  const themePreference = ref(getStoredTheme());
  const resolvedTheme = ref('dark');
  const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function getStoredTheme() {
    try {
      const theme = window.localStorage.getItem(THEME_STORAGE_KEY);
      return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';
    } catch (_error) {
      return 'system';
    }
  }

  function setStoredTheme(theme) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_error) {
      // Theme persistence is optional.
    }
  }

  function getResolvedTheme(theme) {
    if (theme === 'light' || theme === 'dark') return theme;
    return mediaQuery && mediaQuery.matches ? 'light' : 'dark';
  }

  function applyTheme(theme, { suppressColorTransition = false } = {}) {
    const nextTheme = getResolvedTheme(theme);
    const root = document.documentElement;
    const update = () => {
      resolvedTheme.value = nextTheme;
      root.dataset.theme = nextTheme;
      root.dataset.themePreference = theme;
    };

    if (suppressColorTransition) {
      applyWithoutColorTransition(root, update);
    } else {
      update();
    }
  }

  function toggleTheme() {
    themePreference.value = getResolvedTheme(themePreference.value) === 'light' ? 'dark' : 'light';
  }

  const themeButtonClass = computed(() => ({
    'theme-toggle': true,
    'is-light': resolvedTheme.value === 'light',
  }));

  let hasAppliedTheme = false;
  watch(themePreference, (value) => {
    setStoredTheme(value);
    applyTheme(value, { suppressColorTransition: hasAppliedTheme });
    hasAppliedTheme = true;
  }, { immediate: true });

  onMounted(() => {
    if (mediaQuery && mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', () => {
        if (themePreference.value === 'system') {
          applyTheme('system', { suppressColorTransition: true });
        }
      });
    }
  });

  return {
    resolvedTheme,
    themeButtonClass,
    toggleTheme,
  };
}
