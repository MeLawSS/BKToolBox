import factsModule from '../../lib/bidking-monitor-facts.js';
import storeModule from '../../lib/bidking-monitor-store.js';

const { buildBidKingMonitorFacts } = factsModule;
const {
  applyBidKingMonitorFacts,
  createEmptyBidKingMonitorState,
} = storeModule;

const GROUP_FIELD_MAP = [
  ['averageCells', 'avg'],
  ['totalCells', 'cells'],
  ['averagePrice', 'priceAverage'],
];

export function createMonitorProfileAdapter(profile) {
  function createState() {
    return createEmptyBidKingMonitorState(profile.monitorProfile);
  }

  function applyPayload(state, payload) {
    const rawPayload = payload?.rawEvent ?? payload;
    const facts = buildBidKingMonitorFacts(rawPayload, profile.monitorProfile);
    if (!facts.length) return state;
    return applyBidKingMonitorFacts(state, facts, profile.monitorProfile);
  }

  function getAutoFills(state) {
    const groups = state?.groups;
    if (!groups) return [];

    const fills = [];
    for (const [groupKey, groupState] of Object.entries(groups)) {
      for (const [stateKey, fieldKey] of GROUP_FIELD_MAP) {
        const value = groupState?.[stateKey];
        if (value === null || value === undefined || value === '') continue;
        const formattedValue = formatMonitorInputValue(value, fieldKey);
        if (formattedValue === '') continue;
        fills.push({ groupKey, fieldKey, value: formattedValue });
      }
    }
    return fills;
  }

  return {
    createState,
    applyPayload,
    getAutoFills,
  };
}

function formatMonitorInputValue(value, fieldKey) {
  if (fieldKey === 'cells') return formatMonitorInputNumber(value, 0);
  return formatMonitorInputNumber(value, 2);
}

function formatMonitorInputNumber(value, precision) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const factor = 10 ** precision;
  const truncated = Math.trunc(number * factor) / factor;
  if (Number.isInteger(truncated)) return String(truncated);
  return String(Number(truncated.toFixed(precision)));
}
