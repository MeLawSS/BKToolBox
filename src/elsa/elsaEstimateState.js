import { ref } from 'vue';

export const ELSA_AUTO_BID_DEFAULT_MULTIPLIER = 2;
export const ELSA_AUTO_BID_MIN_MULTIPLIER = 1;
export const ELSA_AUTO_BID_QUALITY_ORDER = Object.freeze([
  'white',
  'green',
  'blue',
  'purple',
  'orange',
  'red',
]);
export const ELSA_AUTO_BID_QUALITY_PENALTIES = Object.freeze({
  white: 0,
  green: 0.3,
  blue: 0.7,
  purple: 0.7,
  orange: 0.7,
  red: 0.7,
});

export const elsaExpectedPrice = ref(0);
export const elsaAutoBidKnownQualityKeys = ref([]);

export function normalizeElsaAutoBidKnownQualityKeys(value) {
  const seen = new Set();
  const normalized = [];
  for (const key of Array.isArray(value) ? value : []) {
    if (!ELSA_AUTO_BID_QUALITY_ORDER.includes(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return ELSA_AUTO_BID_QUALITY_ORDER.filter((key) => normalized.includes(key));
}

export function resolveElsaAutoBidMultiplier(knownQualityKeys) {
  const penalty = normalizeElsaAutoBidKnownQualityKeys(knownQualityKeys)
    .reduce((sum, key) => sum + (ELSA_AUTO_BID_QUALITY_PENALTIES[key] ?? 0), 0);
  return Math.max(ELSA_AUTO_BID_MIN_MULTIPLIER, ELSA_AUTO_BID_DEFAULT_MULTIPLIER - penalty);
}

export function computeElsaAutoBidPrice(expectedPrice, knownQualityKeys) {
  const price = Number(expectedPrice);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.floor(price * resolveElsaAutoBidMultiplier(knownQualityKeys));
}

export function deriveElsaAutoBidKnownQualityKeys(state) {
  const groups = state?.groups ?? {};
  const known = [];
  for (const key of ELSA_AUTO_BID_QUALITY_ORDER) {
    const group = groups[key];
    if (!group) continue;
    if (group.cells !== null && group.cells !== undefined) {
      known.push(key);
      continue;
    }
    if (key === 'orange' && (group.avg !== null || group.priceAverage !== null)) {
      known.push(key);
    }
  }
  return normalizeElsaAutoBidKnownQualityKeys(known);
}

export function syncElsaEstimateState(total, state) {
  elsaExpectedPrice.value = Number.isFinite(total) ? Math.round(total) : 0;
  elsaAutoBidKnownQualityKeys.value = Number.isFinite(total)
    ? deriveElsaAutoBidKnownQualityKeys(state)
    : [];
}

export function resetElsaEstimateState() {
  elsaExpectedPrice.value = 0;
  elsaAutoBidKnownQualityKeys.value = [];
}
