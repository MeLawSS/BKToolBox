export const LEAVE_TOOLS_EVENT = 'bidking:leave-tools';

export const TOOLS_PAGE_STATE_KEY = 'bidking-page-state:v2:elsa';
export const LEGACY_TOOLS_PAGE_STATE_KEY = 'bidking-page-state:v1:elsa';
export const ELSA_HERO_STATE_KEY = 'bidking-page-state:v1:elsa-hero';
export const ETHAN_HERO_STATE_KEY = 'bidking-page-state:v1:ethan';
export const AHMED_PAGE_STATE_KEY = 'bidking-page-state:v1:ahmed';

export const TOOLS_PAGE_CACHE_KEYS = [
  TOOLS_PAGE_STATE_KEY,
  LEGACY_TOOLS_PAGE_STATE_KEY,
  ELSA_HERO_STATE_KEY,
  ETHAN_HERO_STATE_KEY,
  AHMED_PAGE_STATE_KEY,
];

export function dispatchLeaveToolsEvent(target = window) {
  if (!target || typeof target.dispatchEvent !== 'function') return;
  target.dispatchEvent(new CustomEvent(LEAVE_TOOLS_EVENT));
}

export function clearToolsPageStateStorage(storage = window.localStorage) {
  if (!storage || typeof storage.removeItem !== 'function') return;
  TOOLS_PAGE_CACHE_KEYS.forEach((key) => {
    try {
      storage.removeItem(key);
    } catch (_error) {
      // Ignore blocked storage so cache clearing never breaks navigation.
    }
  });
}
