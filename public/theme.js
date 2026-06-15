(function () {
  const storageKey = 'bidking-theme';
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function getStoredTheme() {
    try {
      const theme = window.localStorage.getItem(storageKey);
      return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';
    } catch (_error) {
      return 'system';
    }
  }

  function getResolvedTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      return theme;
    }

    return media && media.matches ? 'light' : 'dark';
  }

  function setStoredTheme(theme) {
    try {
      window.localStorage.setItem(storageKey, theme);
    } catch (_error) {
      // Theme choice is optional; ignore blocked storage.
    }
  }

  function afterThemePaint(callback) {
    if (typeof window.requestAnimationFrame !== 'function') {
      window.setTimeout(callback, 0);
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(callback);
    });
  }

  function applyWithoutColorTransition(update) {
    root.dataset.themeSwitching = 'true';
    update();
    afterThemePaint(() => {
      delete root.dataset.themeSwitching;
    });
  }

  function updateButtons(theme) {
    const resolvedTheme = getResolvedTheme(theme);
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const nextTheme = resolvedTheme === 'light' ? 'dark' : 'light';
      button.classList.toggle('is-light', resolvedTheme === 'light');
      button.setAttribute('aria-pressed', resolvedTheme === 'light' ? 'true' : 'false');
      button.setAttribute('aria-label', resolvedTheme === 'light' ? '当前为白天模式，点击切换到夜间模式' : '当前为夜间模式，点击切换到白天模式');
      button.setAttribute('title', resolvedTheme === 'light' ? '点击切换到夜间模式' : '点击切换到白天模式');
      button.dataset.nextTheme = nextTheme;
      const icon = button.querySelector('.theme-toggle-icon');
      if (icon) {
        icon.textContent = resolvedTheme === 'light' ? '☀' : '☾';
      }
    });
  }

  function applyTheme(theme, suppressColorTransition = false) {
    const resolvedTheme = getResolvedTheme(theme);
    const update = () => {
      root.dataset.theme = resolvedTheme;
      root.dataset.themePreference = theme;
      updateButtons(theme);
    };

    if (suppressColorTransition) {
      applyWithoutColorTransition(update);
    } else {
      update();
    }
  }

  function toggleTheme() {
    const current = getResolvedTheme(getStoredTheme());
    const next = current === 'light' ? 'dark' : 'light';
    setStoredTheme(next);
    applyTheme(next, true);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    toggleTheme();
  });

  if (media && media.addEventListener) {
    media.addEventListener('change', () => {
      if (getStoredTheme() === 'system') {
        applyTheme('system', true);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyTheme(getStoredTheme()));
  } else {
    applyTheme(getStoredTheme());
  }
}());
