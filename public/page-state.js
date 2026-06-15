(function () {
  const prefix = 'bidking-page-state:v1:';

  function getStorageKey(pageKey) {
    return `${prefix}${pageKey || window.location.pathname.toLowerCase() || '/'}`;
  }

  function safeParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function create(pageKey) {
    const storageKey = getStorageKey(pageKey);

    function load() {
      try {
        return safeParse(window.localStorage.getItem(storageKey));
      } catch (_error) {
        return null;
      }
    }

    function save(state) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({
          ...state,
          savedAt: new Date().toISOString(),
        }));
      } catch (_error) {
        // Page state is a convenience feature; storage failures should not block the UI.
      }
    }

    function clear() {
      try {
        window.localStorage.removeItem(storageKey);
      } catch (_error) {
        // Ignore blocked storage.
      }
    }

    function collectControls(root = document) {
      const controls = {};
      root.querySelectorAll('input, select, textarea').forEach((control) => {
        const key = control.id || control.name;
        if (!key || control.disabled) return;

        if (control instanceof HTMLInputElement && control.type === 'checkbox') {
          controls[key] = { type: 'checkbox', checked: control.checked };
          return;
        }

        if (control instanceof HTMLInputElement && control.type === 'radio') {
          if (control.checked) controls[key] = { type: 'radio', value: control.value };
          return;
        }

        controls[key] = { type: 'value', value: control.value };
      });
      return controls;
    }

    function restoreControls(controls, root = document) {
      if (!controls || typeof controls !== 'object') return;

      Object.entries(controls).forEach(([key, state]) => {
        const selector = `#${window.CSS && CSS.escape ? CSS.escape(key) : key}, [name="${String(key).replace(/"/g, '\\"')}"]`;
        const control = root.querySelector(selector);
        if (!control) return;

        if (state?.type === 'checkbox' && control instanceof HTMLInputElement) {
          control.checked = Boolean(state.checked);
          return;
        }

        if (state?.type === 'radio') {
          const radio = root.querySelector(`[name="${String(key).replace(/"/g, '\\"')}"][value="${String(state.value).replace(/"/g, '\\"')}"]`);
          if (radio instanceof HTMLInputElement) radio.checked = true;
          return;
        }

        if ('value' in control && state && Object.prototype.hasOwnProperty.call(state, 'value')) {
          control.value = state.value ?? '';
        }
      });
    }

    return {
      load,
      save,
      clear,
      collectControls,
      restoreControls,
    };
  }

  window.BidKingPageState = { create };
}());
