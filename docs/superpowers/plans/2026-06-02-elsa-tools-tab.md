# Elsa Tools Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Elsa hero-estimator panel inside `Tools` while keeping Ethan behavior unchanged and splitting Elsa `white / green / blue / purple / orange / red` end-to-end.

**Architecture:** Keep `lib/bidking-live-monitor.js` and `/api/bidking-monitor/events` generic, then derive Elsa-vs-Ethan monitor state locally in the renderer through profile-aware facts/store helpers. Extract the current Ethan page into a shared hero-estimator shell driven by profile objects, then mount that shell from both `/Ethan` and the new Elsa panel tab inside `/Tools`.

**Tech Stack:** Vue 3, Vite, CommonJS monitor helpers in `lib/`, existing `/run` and `/api/bidking-monitor/events` SSE flows, Vitest, real collectible data from `public/data/collectibles.json`.

---

## File Structure

- Create `lib/bidking-hero-profiles.js`
  - Shared CommonJS quality/group mapping for monitor facts/store.
  - Must stay CommonJS because `lib/bidking-monitor-facts.js` and `lib/bidking-monitor-store.js` already run under Node/CommonJS.
- Modify `lib/bidking-monitor-facts.js`
  - Accept a profile parameter, stop hard-coding `wg`, and emit Elsa complete-reveal facts for primary groups.
- Modify `lib/bidking-monitor-store.js`
  - Build `state.groups` from profile keys and derive Elsa complete-reveal totals from outlines.
- Modify `lib/bidking-monitor-facts.test.mjs`
  - Cover Ethan `wg` compatibility and Elsa white/green split behavior.
- Modify `lib/bidking-monitor-store.test.mjs`
  - Cover profile-shaped state and Elsa complete-reveal total-cell derivation.
- Create `src/hero-estimator/hero-profiles.js`
  - Shared ESM UI/estimation profiles.
  - Imports CommonJS monitor profiles from `../../lib/bidking-hero-profiles.js`.
- Create `src/hero-estimator/monitor-profile-adapter.js`
  - Local profile-aware monitor-state accumulator and autofill formatter for hero panels.
- Create `src/hero-estimator/result-row-builder.js`
  - Shared result-row/prediction-row helpers extracted from `src/ethan/App.vue`.
- Create `src/hero-estimator/useHeroEstimatorPanel.js`
  - Shared stateful logic migrated out of `src/ethan/App.vue`.
- Create `src/hero-estimator/HeroEstimatorPanel.vue`
  - Shared shell component for Ethan page mode and Elsa embedded-panel mode.
- Create `src/hero-estimator/HeroEstimatorPanel.test.js`
  - Shared shell regression tests independent of page wrappers.
- Create `src/hero-estimator/hero-estimator.css`
  - Shared component styles imported by both Ethan and Elsa apps.
- Modify `src/ethan/estimator.js`
  - Replace hard-coded group/stage assumptions with profile-driven inputs.
- Modify `src/ethan/estimator.test.js`
  - Add Elsa six-group coverage while preserving Ethan baseline.
- Modify `src/ethan/monitor-adapter.js`
  - Turn it into a thin Ethan wrapper over the shared monitor-profile adapter.
- Modify `src/ethan/monitor-adapter.test.js`
  - Preserve current Ethan behavior through the wrapper.
- Modify `src/ethan/App.vue`
  - Replace the giant route component with a wrapper around `HeroEstimatorPanel`.
- Modify `src/ethan/main.js`
  - Import `src/hero-estimator/hero-estimator.css`.
- Modify `src/ethan/App.test.js`
  - Keep Ethan route/page regression coverage after wrapper migration.
- Create `src/elsa/ElsaHeroPanel.vue`
  - Thin wrapper that mounts `HeroEstimatorPanel` with `elsaProfile` and `embedded` layout.
- Create `src/elsa/ElsaHeroPanel.test.js`
  - Elsa-specific integration coverage.
- Modify `src/elsa/App.vue`
  - Support mixed `solver` and `panel` tabs and mount the Elsa panel tab.
- Modify `src/elsa/App.test.js`
  - Preserve 9 solver tabs and add Elsa panel-tab coverage.
- Modify `src/elsa/main.js`
  - Import `src/hero-estimator/hero-estimator.css`.
- Modify `src/elsa/elsa.css`
  - Add panel-host layout rules only; keep existing solver-page look intact.
- Modify `src/shared/messages.js`
  - Add Elsa tab labels and the additional group labels/qualities used by the shared shell.
- Modify `docs/Documentation.md`
  - Update current-state Tools/Ethan facts after implementation.
- Modify `docs/ARCHITECTURE.md`
  - Document the new `src/hero-estimator/` layer and the new Tools tab composition.

Do not touch `public/inject/*` or run `npm run build:pages` during this implementation pass. The worktree already contains unrelated dirty `public/inject` output, and a page rebuild would overwrite unrelated user changes.

---

## Task 1: Add Shared Hero Profiles and Profile-Aware Monitor Facts/Store

**Files:**
- Create: `lib/bidking-hero-profiles.js`
- Modify: `lib/bidking-monitor-facts.js`
- Modify: `lib/bidking-monitor-store.js`
- Modify: `lib/bidking-monitor-facts.test.mjs`
- Modify: `lib/bidking-monitor-store.test.mjs`

- [ ] **Step 1: Write failing facts/store tests**

Add these imports near the top of both monitor test files:

```js
const {
  ETHAN_MONITOR_PROFILE,
  ELSA_MONITOR_PROFILE,
} = require('./bidking-hero-profiles.js');
```

Append this block to `lib/bidking-monitor-facts.test.mjs`:

```js
it('keeps Ethan wg merging but splits white and green for Elsa', () => {
  const rawEvent = {
    key: 'skill:split-qualities',
    gameUid: 'game-1',
    skill: {
      uid: 'split-qualities',
      heroCid: 103,
      skillCid: 1001034,
      hitBoxList: [
        { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        { boxId: 1, itemSlotType: 11, itemQuility: 2, itemQuilityName: '绿' },
      ],
    },
  };

  const ethanFacts = buildBidKingMonitorFacts(rawEvent, ETHAN_MONITOR_PROFILE);
  const elsaFacts = buildBidKingMonitorFacts(rawEvent, ELSA_MONITOR_PROFILE);

  expect(
    ethanFacts
      .filter((fact) => fact.type === 'item.qualityCellsRevealed')
      .map((fact) => fact.quality.group)
  ).toEqual(['wg', 'wg']);

  expect(
    elsaFacts
      .filter((fact) => fact.type === 'item.qualityCellsRevealed')
      .map((fact) => fact.quality.group)
  ).toEqual(['white', 'green']);
});

it('emits a complete-reveal fact for Elsa primary hero packets', () => {
  const facts = buildBidKingMonitorFacts({
    key: 'skill:elsa-white',
    gameUid: 'game-1',
    round: 1,
    group: 'hero',
    skill: {
      uid: 'elsa-white',
      heroCid: 103,
      skillCid: 1001034,
      hitBoxList: [
        { boxId: 24, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
      ],
    },
  }, ELSA_MONITOR_PROFILE);

  expect(facts).toContainEqual(expect.objectContaining({
    type: 'group.completeReveal',
    group: 'white',
    gameUid: 'game-1',
  }));
});
```

Append this block to `lib/bidking-monitor-store.test.mjs`:

```js
it('derives Elsa primary-group total cells from complete reveal outlines', () => {
  const facts = buildBidKingMonitorFacts({
    key: 'skill:elsa-green',
    gameUid: 'game-1',
    round: 2,
    group: 'hero',
    skill: {
      uid: 'elsa-green',
      heroCid: 103,
      skillCid: 1001033,
      hitBoxList: [
        { boxId: 0, itemSlotType: 21, itemQuility: 2, itemQuilityName: '绿' },
        { boxId: 10, itemSlotType: 11, itemQuility: 2, itemQuilityName: '绿' },
      ],
    },
  }, ELSA_MONITOR_PROFILE);

  const state = applyBidKingMonitorFacts(
    createEmptyBidKingMonitorState(ELSA_MONITOR_PROFILE),
    facts,
    ELSA_MONITOR_PROFILE,
  );

  expect(state.profileId).toBe('elsa');
  expect(state.groups.green.totalCells).toBe(3);
  expect(state.groups.white.totalCells).toBeNull();
  expect(Object.keys(state.groups)).toEqual(['white', 'green', 'blue', 'purple', 'orange', 'red']);
});
```

- [ ] **Step 2: Run monitor tests to verify they fail**

Run:

```bash
npx vitest run lib/bidking-monitor-facts.test.mjs lib/bidking-monitor-store.test.mjs
```

Expected: FAIL because `lib/bidking-hero-profiles.js` does not exist yet and the facts/store functions do not accept Elsa profile input.

- [ ] **Step 3: Implement shared monitor profiles and update facts/store**

Create `lib/bidking-hero-profiles.js`:

```js
const ETHAN_MONITOR_PROFILE = {
  id: 'ethan',
  groupKeys: ['wg', 'blue', 'purple', 'orange', 'red'],
  qualityIdGroups: { 1: 'wg', 2: 'wg', 3: 'blue', 4: 'purple', 5: 'orange', 6: 'red' },
  aggregateIdGroups: { 201: 'wg', 202: 'blue', 203: 'purple', 204: 'orange', 205: 'red', 301: 'wg', 302: 'blue', 303: 'purple', 304: 'orange', 305: 'red', 100104: 'wg', 100105: 'blue', 100106: 'purple', 100107: 'orange', 100108: 'red', 100110: 'wg', 100111: 'blue', 100112: 'purple', 100113: 'orange', 100114: 'red' },
  aggregateNameMatchers: [
    [/普品/, 'wg'],
    [/良品/, 'blue'],
    [/优品/, 'purple'],
    [/极品/, 'orange'],
    [/珍品/, 'red'],
  ],
  qualityNameMatchers: [
    [/[白绿普]/, 'wg'],
    [/[蓝良]/, 'blue'],
    [/[紫优]/, 'purple'],
    [/[金橙极]/, 'orange'],
    [/[红珍]/, 'red'],
  ],
  completeRevealHeroSkillCids: [],
  completeRevealGroups: new Set(),
};

const ELSA_MONITOR_PROFILE = {
  id: 'elsa',
  groupKeys: ['white', 'green', 'blue', 'purple', 'orange', 'red'],
  qualityIdGroups: { 1: 'white', 2: 'green', 3: 'blue', 4: 'purple', 5: 'orange', 6: 'red' },
  aggregateIdGroups: { 201: 'white', 202: 'green', 203: 'blue', 204: 'orange', 205: 'red', 301: 'white', 302: 'green', 303: 'blue', 304: 'orange', 305: 'red', 100104: 'white', 100105: 'green', 100106: 'blue', 100107: 'orange', 100108: 'red', 100110: 'white', 100111: 'green', 100112: 'blue', 100113: 'orange', 100114: 'red' },
  aggregateNameMatchers: [
    [/普品/, 'white'],
    [/良品/, 'green'],
    [/优品/, 'blue'],
    [/极品/, 'orange'],
    [/珍品/, 'red'],
  ],
  qualityNameMatchers: [
    [/[白普]/, 'white'],
    [/[绿]/, 'green'],
    [/[蓝良]/, 'blue'],
    [/[紫优]/, 'purple'],
    [/[金橙极]/, 'orange'],
    [/[红珍]/, 'red'],
  ],
  completeRevealHeroSkillCids: [1001031, 1001032, 1001033, 1001034],
  completeRevealGroups: new Set(['white', 'green', 'blue', 'purple']),
};

function getBidKingHeroProfile(profileOrId = 'ethan') {
  if (profileOrId?.id) return profileOrId;
  return String(profileOrId) === 'elsa' ? ELSA_MONITOR_PROFILE : ETHAN_MONITOR_PROFILE;
}

function resolveQualityGroupFromId(profile, id) {
  return getBidKingHeroProfile(profile).qualityIdGroups[Number(id)] || '';
}

function resolveQualityGroupFromName(profile, name) {
  const normalized = String(name ?? '').trim();
  if (!normalized) return '';
  for (const [pattern, group] of getBidKingHeroProfile(profile).qualityNameMatchers) {
    if (pattern.test(normalized)) return group;
  }
  return '';
}

module.exports = {
  ETHAN_MONITOR_PROFILE,
  ELSA_MONITOR_PROFILE,
  getBidKingHeroProfile,
  resolveQualityGroupFromId,
  resolveQualityGroupFromName,
};
```

Update `lib/bidking-monitor-facts.js`:

```js
const {
  ETHAN_MONITOR_PROFILE,
  getBidKingHeroProfile,
  resolveQualityGroupFromId,
  resolveQualityGroupFromName,
} = require('./bidking-hero-profiles.js');

function buildBidKingMonitorFacts(rawEvent, profile = ETHAN_MONITOR_PROFILE) {
  const resolvedProfile = getBidKingHeroProfile(profile);
  const event = rawEvent?.rawEvent ?? rawEvent;
  facts.push(...buildItemFacts(event, source, resolvedProfile));
  const aggregateFact = buildAggregateFact(event, source, resolvedProfile);
  if (aggregateFact) facts.push(aggregateFact);
  return facts;
}

function buildItemFacts(event, source, profile) {
  const quality = getBoxQuality(box, profile);
  if (isCompleteRevealFact(event, quality?.group, profile)) {
    facts.push({
      type: 'group.completeReveal',
      key: `${source.key}:complete:${quality.group}`,
      gameUid: event.gameUid ? String(event.gameUid) : null,
      group: quality.group,
      source,
    });
  }
}

function getBoxQuality(box, profile) {
  return {
    id,
    name: name ?? (id === null ? null : String(id)),
    group: resolveQualityGroupFromId(profile, id) || resolveQualityGroupFromName(profile, name),
  };
}
```

Update `lib/bidking-monitor-store.js`:

```js
const { inferMinimumOccupiedCells } = require('./bidking-monitor-grid.js');
const {
  ETHAN_MONITOR_PROFILE,
  getBidKingHeroProfile,
} = require('./bidking-hero-profiles.js');

function createEmptyBidKingMonitorState(profile = ETHAN_MONITOR_PROFILE, gameUid = null) {
  const resolvedProfile = getBidKingHeroProfile(profile);
  return {
    profileId: resolvedProfile.id,
    gameUid,
    round: null,
    groups: Object.fromEntries(resolvedProfile.groupKeys.map((group) => [group, {
      totalCells: null,
      averageCells: null,
      averagePrice: null,
    }])),
    completeRevealGroups: [],
    outlines: [],
    exactItems: [],
    qualityCells: [],
    revealedTypes: [],
    minimumOccupied: null,
    warnings: [],
    seenFactKeys: [],
  };
}

function applyBidKingMonitorFacts(currentState = createEmptyBidKingMonitorState(), facts = [], profile = getBidKingHeroProfile(currentState?.profileId || 'ethan')) {
  const resolvedProfile = getBidKingHeroProfile(profile);
  let state = currentState?.profileId === resolvedProfile.id
    ? currentState
    : createEmptyBidKingMonitorState(resolvedProfile, currentState?.gameUid ?? null);
  if (fact.type === 'group.completeReveal') {
    state = setGroupCompleteReveal(state, fact.group);
  }
  state = finalizeDerivedState(state, resolvedProfile);
}

function finalizeDerivedState(state, profile) {
  const outlines = applyExactItemsToOutlines(state.outlines, state.exactItems)
    .map((outline) => applyOutlineQuality(outline, state.qualityCells));
  const groups = applyCompleteRevealTotals(state.groups, outlines, state.completeRevealGroups, profile);
  const minimumOccupiedOutlines = outlines.filter(hasValidOutlineCells);
  return {
    ...state,
    groups,
    outlines,
    minimumOccupied: inferMinimumOccupiedCells({ outlines: minimumOccupiedOutlines }),
  };
}
```

- [ ] **Step 4: Re-run monitor tests**

Run:

```bash
npx vitest run lib/bidking-monitor-facts.test.mjs lib/bidking-monitor-store.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bidking-hero-profiles.js lib/bidking-monitor-facts.js lib/bidking-monitor-store.js lib/bidking-monitor-facts.test.mjs lib/bidking-monitor-store.test.mjs
git commit -m "feat: add profile-aware hero monitor state"
```

---

## Task 2: Parameterize Estimator Logic and Add a Shared Monitor Adapter

**Files:**
- Create: `src/hero-estimator/hero-profiles.js`
- Create: `src/hero-estimator/monitor-profile-adapter.js`
- Modify: `src/ethan/estimator.js`
- Modify: `src/ethan/estimator.test.js`
- Modify: `src/ethan/monitor-adapter.js`
- Modify: `src/ethan/monitor-adapter.test.js`

- [ ] **Step 1: Write failing estimator/adapter tests**

Add these imports to `src/ethan/estimator.test.js`:

```js
import { elsaProfile } from '../hero-estimator/hero-profiles.js';
```

Add this helper near `emptyGroupInputs()`:

```js
function emptyGroupInputsFor(groups, overrides = {}) {
  return Object.fromEntries(groups.map((group) => [
    group.key,
    {
      avg: '',
      cells: '',
      priceAverage: '',
      ...overrides[group.key],
    },
  ]));
}
```

Append these tests to `src/ethan/estimator.test.js`:

```js
it('collects Elsa white and green inputs independently', () => {
  const state = collectEstimationInputs(
    { totalCells: '30', totalAverage: '' },
    emptyGroupInputsFor(elsaProfile.groups, {
      white: { cells: '4' },
      green: { cells: '6', priceAverage: '900' },
      orange: { cells: '3' },
    }),
    elsaProfile.groups,
  );

  expect(state.knownCells).toBe(13);
  expect(state.groups.white.cells).toBe(4);
  expect(state.groups.green).toMatchObject({ cells: 6, priceAverage: 900 });
  expect(state.groups.orange.cells).toBe(3);
});

it('does not apply Ethan overflow relaxation to Elsa groups', () => {
  const state = collectEstimationInputs(
    { totalCells: '30', totalAverage: '' },
    emptyGroupInputsFor(elsaProfile.groups, {
      white: { cells: '4' },
      green: { cells: '6' },
    }),
    elsaProfile.groups,
  );

  expect(getEffectiveMaxCells(state, elsaProfile)).toBe(30);
});
```

Create `src/hero-estimator/monitor-profile-adapter.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createMonitorProfileAdapter } from './monitor-profile-adapter.js';
import { elsaProfile } from './hero-profiles.js';

describe('monitor profile adapter', () => {
  it('accumulates Elsa payloads without collapsing white and green', () => {
    const adapter = createMonitorProfileAdapter(elsaProfile);
    let state = adapter.createState();

    state = adapter.applyPayload(state, {
      key: 'skill:white',
      gameUid: 'game-1',
      round: 1,
      group: 'hero',
      skill: {
        uid: 'skill:white',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [{ boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' }],
      },
    });

    state = adapter.applyPayload(state, {
      key: 'skill:green',
      gameUid: 'game-1',
      round: 2,
      group: 'hero',
      skill: {
        uid: 'skill:green',
        heroCid: 103,
        skillCid: 1001033,
        hitBoxList: [{ boxId: 10, itemSlotType: 11, itemQuility: 2, itemQuilityName: '绿' }],
      },
    });

    expect(adapter.getAutoFills(state)).toContainEqual({ groupKey: 'white', fieldKey: 'cells', value: '1' });
    expect(adapter.getAutoFills(state)).toContainEqual({ groupKey: 'green', fieldKey: 'cells', value: '1' });
  });
});
```

- [ ] **Step 2: Run estimator/adapter tests to verify they fail**

Run:

```bash
npx vitest run src/ethan/estimator.test.js src/ethan/monitor-adapter.test.js src/hero-estimator/monitor-profile-adapter.test.js
```

Expected: FAIL because `src/hero-estimator/hero-profiles.js` and `src/hero-estimator/monitor-profile-adapter.js` do not exist, and `getEffectiveMaxCells()` is still Ethan-specific.

- [ ] **Step 3: Implement UI profiles, estimator parameterization, and the shared adapter**

Create `src/hero-estimator/hero-profiles.js`:

```js
import monitorProfilesModule from '../../lib/bidking-hero-profiles.js';

const {
  ETHAN_MONITOR_PROFILE,
  ELSA_MONITOR_PROFILE,
} = monitorProfilesModule;

export const ethanProfile = {
  id: 'ethan',
  storageKey: 'bidking-page-state:v1:ethan',
  monitorProfile: ETHAN_MONITOR_PROFILE,
  groups: [
    { key: 'wg', label: '白+绿', qualities: ['白', '绿'], labelKey: 'ethan.groups.wg', qualitiesKey: 'ethan.groups.wgQualities' },
    { key: 'blue', label: '蓝色', qualities: ['蓝'], labelKey: 'ethan.groups.blue', qualitiesKey: 'ethan.groups.blueQualities' },
    { key: 'purple', label: '紫色', qualities: ['紫'], labelKey: 'ethan.groups.purple', qualitiesKey: 'ethan.groups.purpleQualities' },
    { key: 'orange', label: '橙/金色', qualities: ['金'], labelKey: 'ethan.groups.orange', qualitiesKey: 'ethan.groups.orangeQualities' },
    { key: 'red', label: '红色', qualities: ['红'], labelKey: 'ethan.groups.red', qualitiesKey: 'ethan.groups.redQualities' },
  ],
  perCellExpected: { wg: 232, blue: 889, purple: 2482, orange: 9228, red: 40000 },
  overflowRelaxationGroupKeys: ['wg', 'blue'],
  overflowRelaxationBuffer: 20,
  streamSearchConfigs: [
    { groupKey: 'purple', labelKey: 'ethan.groups.purple', script: 'solve-purple-combo.js' },
    { groupKey: 'orange', labelKey: 'ethan.groups.orange', script: 'solve-gold-combo.js' },
  ],
};

export const elsaProfile = {
  id: 'elsa',
  storageKey: 'bidking-page-state:v1:elsa-hero',
  monitorProfile: ELSA_MONITOR_PROFILE,
  groups: [
    { key: 'white', label: '白色', qualities: ['白'], labelKey: 'ethan.groups.white', qualitiesKey: 'ethan.groups.whiteQualities' },
    { key: 'green', label: '绿色', qualities: ['绿'], labelKey: 'ethan.groups.green', qualitiesKey: 'ethan.groups.greenQualities' },
    { key: 'blue', label: '蓝色', qualities: ['蓝'], labelKey: 'ethan.groups.blue', qualitiesKey: 'ethan.groups.blueQualities' },
    { key: 'purple', label: '紫色', qualities: ['紫'], labelKey: 'ethan.groups.purple', qualitiesKey: 'ethan.groups.purpleQualities' },
    { key: 'orange', label: '橙/金色', qualities: ['金'], labelKey: 'ethan.groups.orange', qualitiesKey: 'ethan.groups.orangeQualities' },
    { key: 'red', label: '红色', qualities: ['红'], labelKey: 'ethan.groups.red', qualitiesKey: 'ethan.groups.redQualities' },
  ],
  perCellExpected: { white: 124, green: 328, blue: 889, purple: 2482, orange: 9228, red: 40000 },
  overflowRelaxationGroupKeys: [],
  overflowRelaxationBuffer: 0,
  streamSearchConfigs: [
    { groupKey: 'orange', labelKey: 'ethan.groups.orange', script: 'solve-gold-combo.js' },
  ],
};
```

Create `src/hero-estimator/monitor-profile-adapter.js`:

```js
import factsModule from '../../lib/bidking-monitor-facts.js';
import storeModule from '../../lib/bidking-monitor-store.js';

const { buildBidKingMonitorFacts } = factsModule;
const { createEmptyBidKingMonitorState, applyBidKingMonitorFacts } = storeModule;

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
    return facts.length ? applyBidKingMonitorFacts(state, facts, profile.monitorProfile) : state;
  }

  function getAutoFills(state) {
    const fills = [];
    for (const [groupKey, groupState] of Object.entries(state?.groups || {})) {
      for (const [stateKey, fieldKey] of GROUP_FIELD_MAP) {
        const value = groupState?.[stateKey];
        if (value === null || value === undefined || value === '') continue;
        fills.push({ groupKey, fieldKey, value: fieldKey === 'cells' ? String(Number(value)) : String(Number(value.toFixed?.(2) ?? value)) });
      }
    }
    return fills;
  }

  return { createState, applyPayload, getAutoFills };
}
```

Update `src/ethan/estimator.js`:

```js
import { ethanProfile } from '../hero-estimator/hero-profiles.js';

export const PER_CELL_EXPECTED = ethanProfile.perCellExpected;
export const ESTIMATION_GROUPS = ethanProfile.groups;

export function getStage(state, groups = ESTIMATION_GROUPS) {
  const filled = getFilledGroups(state, groups).map((group) => group.key);
  for (const group of [...groups].reverse()) {
    if (filled.includes(group.key)) return group.key;
  }
  return 'total';
}

export function getEffectiveMaxCells(state, profile = ethanProfile) {
  if (state.totalCells === null) return null;
  if (state.totalCount !== null) return state.totalCells;
  const relaxedKeys = profile.overflowRelaxationGroupKeys ?? [];
  if (!relaxedKeys.length) return state.totalCells;
  return relaxedKeys.every((key) => state.groups[key]?.cells !== null)
    ? state.totalCells + (profile.overflowRelaxationBuffer ?? 0)
    : state.totalCells;
}
```

Turn `src/ethan/monitor-adapter.js` into a thin wrapper:

```js
import { createMonitorProfileAdapter } from '../hero-estimator/monitor-profile-adapter.js';
import { ethanProfile } from '../hero-estimator/hero-profiles.js';

const adapter = createMonitorProfileAdapter(ethanProfile);

export function getEthanMonitorAutoFills(payload, state = adapter.createState()) {
  const nextState = payload?.state?.profileId === 'ethan' ? payload.state : adapter.applyPayload(state, payload);
  return adapter.getAutoFills(nextState);
}

export function getEthanMonitorGridState(payload) {
  return payload?.state?.profileId === 'ethan' ? payload.state : null;
}
```

- [ ] **Step 4: Re-run estimator/adapter tests**

Run:

```bash
npx vitest run src/ethan/estimator.test.js src/ethan/monitor-adapter.test.js src/hero-estimator/monitor-profile-adapter.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hero-estimator/hero-profiles.js src/hero-estimator/monitor-profile-adapter.js src/hero-estimator/monitor-profile-adapter.test.js src/ethan/estimator.js src/ethan/estimator.test.js src/ethan/monitor-adapter.js src/ethan/monitor-adapter.test.js
git commit -m "feat: add shared hero estimator profiles"
```

---

## Task 3: Extract a Shared Hero Estimator Shell and Reconnect Ethan

**Files:**
- Create: `src/hero-estimator/HeroEstimatorPanel.vue`
- Create: `src/hero-estimator/useHeroEstimatorPanel.js`
- Create: `src/hero-estimator/result-row-builder.js`
- Create: `src/hero-estimator/HeroEstimatorPanel.test.js`
- Create: `src/hero-estimator/hero-estimator.css`
- Modify: `src/ethan/App.vue`
- Modify: `src/ethan/main.js`
- Modify: `src/ethan/App.test.js`

- [ ] **Step 1: Write failing shared-shell and Ethan wrapper tests**

Create `src/hero-estimator/HeroEstimatorPanel.test.js`:

```js
/* @vitest-environment happy-dom */
import fs from 'node:fs';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import HeroEstimatorPanel from './HeroEstimatorPanel.vue';
import { ethanProfile } from './hero-profiles.js';

const realAveragePrices = JSON.parse(fs.readFileSync('public/data/quality-size-average-prices.json', 'utf8'));
const realCollectibles = JSON.parse(fs.readFileSync('public/data/collectibles.json', 'utf8'));

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url) === '/api/bidking-monitor/status') {
      return { ok: true, json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }) };
    }
    return {
      ok: true,
      json: async () => String(url).includes('/data/collectibles.json') ? realCollectibles : realAveragePrices,
    };
  }));
}

describe('HeroEstimatorPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Ethan groups in page mode', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('h1').text()).toBe('期望价值估算');
    expect(wrapper.find('#cells-wg').exists()).toBe(true);
    expect(wrapper.find('#cells-blue').exists()).toBe(true);
    expect(wrapper.find('#ethan-monitor-board').exists()).toBe(true);
  });
});
```

Add this regression test to `src/ethan/App.test.js`:

```js
it('keeps the Ethan page chrome after the shared shell extraction', async () => {
  const wrapper = await mountApp();

  expect(wrapper.find('h1').text()).toBe('期望价值估算');
  expect(wrapper.find('#cells-wg').exists()).toBe(true);
  expect(wrapper.find('#ethan-monitor-board').exists()).toBe(true);
  expect(wrapper.findAll('.nav a').map((link) => link.attributes('href'))).toContain('/Ethan');
});
```

- [ ] **Step 2: Run shell/Ethan tests to verify they fail**

Run:

```bash
npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js src/ethan/App.test.js
```

Expected: FAIL because `HeroEstimatorPanel.vue`, `useHeroEstimatorPanel.js`, and the Ethan wrapper do not exist yet.

- [ ] **Step 3: Implement the shared shell and migrate Ethan to a wrapper**

Create `src/hero-estimator/useHeroEstimatorPanel.js` by moving the stateful logic out of `src/ethan/App.vue`. Keep the existing function bodies unless a profile hook is required. The new composable must:

```js
import { computed, reactive, ref, watch } from 'vue';
import {
  buildPriceProfilesByGroup,
  collectEstimationInputs,
  estimateGroupValue,
  estimateTotalByStage,
  findFirstAveragePriceCellMatch,
  getAverageOnlyPredictions,
  getCombinedAverageOnlyPredictions,
  getFeasibleCellsFromAverage,
  getPossibleCellsFromAverage,
  parseComboOutputLine,
  prepareCollectibleItemsForGroup,
} from '../ethan/estimator.js';
import {
  applyMonitorEventToGridState,
  createEmptyMonitorGridState,
  createMonitorCells,
  parseSlotType,
} from '../ethan/monitor-grid.js';
import { createMonitorProfileAdapter } from './monitor-profile-adapter.js';

export function useHeroEstimatorPanel(profile, { t }) {
  const groups = profile.groups;
  const streamSearchConfigs = profile.streamSearchConfigs ?? [];
  const monitorAdapter = createMonitorProfileAdapter(profile);
  const monitorFactState = ref(monitorAdapter.createState());
  const monitorGridState = ref(createEmptyMonitorGridState());
  const monitorCells = createMonitorCells();
  const selectedMonitorOutline = ref(null);
  const averagePricesByQuality = ref(null);
  const priceProfilesByGroup = ref(null);
  const collectibleItemsByGroup = ref({});
  const collectibleItems = ref([]);
  const isLoading = ref(true);
  const hasCalculated = ref(false);
  const totalCellOptions = ref([]);
  const tableRows = ref([]);
  const lastState = ref(null);
  const metaText = ref('');
  const metaStatus = ref('');
  const summary = reactive({ total: null, low: null, high: null });
  const monitorStatus = ref({ state: 'idle', running: false, totalEvents: 0, lastError: null });
  let monitorEventSource = null;

  function applyAveragePriceCellMatchOverrides(state) {
    const stateGroups = Object.fromEntries(groups.map((group) => [group.key, { ...state.groups[group.key] }]));
    for (const group of groups) {
      const input = state.groups[group.key];
      if (!input || input.cells === null || input.priceAverage === null) continue;
      const match = findFirstAveragePriceCellMatch(
        collectibleItemsByGroup.value[group.key] ?? [],
        input.cells,
        input.priceAverage,
      );
      if (!match) continue;
      stateGroups[group.key] = {
        ...stateGroups[group.key],
        count: match.count,
        valueOverride: match.totalPrice,
      };
    }
    return {
      ...state,
      knownCells: Object.values(stateGroups).reduce((sum, groupState) => sum + (groupState.cells ?? 0), 0),
      groups: stateGroups,
    };
  }

  function connectMonitorStream() {
    if (typeof EventSource !== 'function') return;
    monitorEventSource = new EventSource('/api/bidking-monitor/events');
    monitorEventSource.addEventListener('status', (message) => {
      const payload = parseMonitorStreamPayload(message);
      if (payload) updateMonitorStatus(payload);
    });
    monitorEventSource.addEventListener('error', (message) => {
      const payload = parseMonitorStreamPayload(message);
      if (payload) updateMonitorStatus(payload);
    });
    monitorEventSource.addEventListener('event', (message) => {
      const payload = parseMonitorStreamPayload(message);
      if (!payload) return;

      monitorFactState.value = monitorAdapter.applyPayload(monitorFactState.value, payload);
      for (const fill of monitorAdapter.getAutoFills(monitorFactState.value)) {
        applyAutoGroupInput(fill);
      }

      const rawPayload = payload.rawEvent ?? payload;
      const nextGridState = applyMonitorEventToGridState(monitorGridState.value, rawPayload);
      if (nextGridState !== monitorGridState.value) {
        monitorGridState.value = nextGridState;
      }
      refreshEstimateAfterMonitorUpdate();
    });
  }

  return {
    groups,
    globalFields,
    qualityFields,
    resultColumns,
    globalInputs,
    groupInputs,
    groupPlaceholders,
    totalCellOptions,
    tableRows,
    summaryCards,
    metaText,
    metaStatus,
    isLoading,
    usesTotalCellSelect,
    totalCellsPlaceholder,
    totalAveragePlaceholder,
    monitorCells,
    monitorGridState,
    monitorStatus,
    monitorStatusText,
    monitorErrorText,
    monitorControlVisible: profile.supportsMonitor,
    monitorOutlineDetail,
    monitorCellClassMap,
    formatMoney,
    formatAverage,
    formatMonitorOutlineValue,
    getMonitorOutlineQualityClass,
    openMonitorOutlineDetail,
    closeMonitorOutlineDetail,
    handleSubmit,
    handleClear,
    loadData,
    toggleMonitor,
  };
}
```

Create `src/hero-estimator/result-row-builder.js` and move the current row helpers out of `src/ethan/App.vue`:

```js
export function buildPredictionRow({ index, item, config, t }) {
  const group = item.state.groups[config.groupKey];
  const prediction = item.prediction;
  const totalCountText = item.state.totalCount === null ? '-' : item.state.totalCount;
  const isOverflow = item.state.totalCells !== null && item.state.knownCells > item.state.totalCells;
  return {
    label: t('ethan.status.plan', { index }),
    count: group.count,
    cells: group.cells,
    avg: group.avg,
    low: prediction.total,
    mean: prediction.total,
    high: prediction.total,
    status: t('ethan.status.planDetail', {
      label: t('ethan.status.groupPredictionLabel', { label: t(config.labelKey) }),
      remaining: prediction.remaining,
      totalCount: totalCountText,
    }),
    statusClass: isOverflow ? 'status-over' : 'status-ok',
    tags: isOverflow ? [t('ethan.status.overflowCells', { total: item.state.knownCells })] : [],
    predictionGroupKey: config.groupKey,
    predictionCandidates: {
      [config.groupKey]: {
        count: group.count,
        cells: group.cells,
      },
    },
  };
}

export function buildCombinedPredictionRow({ index, item, configs, t }) {
  const prediction = item.prediction;
  const candidates = item.candidatesByGroup;
  const totalCountText = item.state.totalCount === null ? '-' : item.state.totalCount;
  const totalCount = Object.values(candidates).reduce((sum, candidate) => sum + candidate.count, 0);
  const totalCells = Object.values(candidates).reduce((sum, candidate) => sum + candidate.cells, 0);
  const detailText = configs
    .filter((config) => candidates[config.groupKey])
    .map((config) => {
      const candidate = candidates[config.groupKey];
      return t('ethan.status.combinedItem', { label: t(config.labelKey), count: candidate.count, cells: candidate.cells });
    })
    .join('；');
  const isOverflow = item.state.totalCells !== null && item.state.knownCells > item.state.totalCells;
  return {
    label: t('ethan.status.plan', { index }),
    count: totalCount,
    cells: totalCells,
    avg: totalCount > 0 ? totalCells / totalCount : null,
    low: prediction.total,
    mean: prediction.total,
    high: prediction.total,
    status: t('ethan.status.combinedDetail', {
      detail: detailText,
      remaining: prediction.remaining,
      totalCount: totalCountText,
    }),
    statusClass: isOverflow ? 'status-over' : 'status-ok',
    tags: isOverflow ? [t('ethan.status.overflowCells', { total: item.state.knownCells })] : [],
    predictionGroupKeys: Object.keys(candidates),
    predictionCandidates: candidates,
  };
}

export function withAverageMatchTags(row, matchedGroupKeys, configs, t) {
  if (!matchedGroupKeys?.length) return row;
  const configByGroup = new Map(configs.map((config) => [config.groupKey, config]));
  const isCombined = configs.length > 1;
  const tags = matchedGroupKeys.map((groupKey) => {
    const config = configByGroup.get(groupKey);
    if (!isCombined || !config) return t('ethan.status.priceMatchTag');
    return t('ethan.status.groupPriceMatchTag', { label: t(config.labelKey) });
  });
  return {
    ...row,
    tags: [...new Set([...(row.tags ?? []), ...tags])],
  };
}
```

Create `src/hero-estimator/HeroEstimatorPanel.vue`:

```vue
<script setup>
import TopBar from '../shared/TopBar.vue';
import { useI18n } from '../shared/i18n.js';
import { useTheme } from '../shared/theme.js';
import { useHeroEstimatorPanel } from './useHeroEstimatorPanel.js';

const props = defineProps({
  profile: { type: Object, required: true },
  activePage: { type: String, default: '' },
  embedded: { type: Boolean, default: false },
});

const { t, locale, isEnglish, toggleLocale } = useI18n();
const { resolvedTheme, themeButtonClass, toggleTheme } = useTheme();
const panel = useHeroEstimatorPanel(props.profile, { t, locale, isEnglish });
</script>

<template>
  <TopBar v-if="!embedded" :active-page="activePage">
    <button
      v-if="panel.monitorControlVisible"
      id="ethan-monitor-switch"
      class="monitor-switch"
      type="button"
      :class="{ active: panel.monitorStatus.running }"
      :aria-pressed="panel.monitorStatus.running ? 'true' : 'false'"
      :title="panel.monitorStatusText"
      @click="panel.toggleMonitor"
    >
      <span class="monitor-switch-label">{{ t('ethan.monitor.switchLabel') }}</span>
      <span class="monitor-switch-track" aria-hidden="true">
        <span class="monitor-switch-thumb"></span>
      </span>
    </button>
  </TopBar>
  <main class="hero-estimator" :class="{ 'hero-estimator--embedded': embedded }">
    <section class="heading">
      <div class="mark" aria-hidden="true">{{ props.profile.mark }}</div>
      <div>
        <h1>{{ t(props.profile.titleKey) }}</h1>
        <p>{{ t(props.profile.subtitleKey) }}</p>
      </div>
    </section>

    <section class="tool" :aria-label="t(props.profile.toolLabelKey)">
      <form class="inputs" id="estimate-form" autocomplete="off" @submit.prevent="panel.handleSubmit">
        <div class="group-title">
          <strong>{{ t('ahmed.sections.global') }}</strong>
          <span>{{ t(props.profile.inputSubtitleKey) }}</span>
        </div>

        <div class="field-pair">
          <label class="field">
            <span>{{ t(panel.globalFields[0].labelKey) }}</span>
            <select
              v-if="panel.usesTotalCellSelect"
              :id="panel.globalFields[0].id"
              v-model="panel.globalInputs.totalCells"
            >
              <option value="">{{ t('ethan.optional') }}</option>
              <option
                v-for="option in panel.totalCellOptions"
                :key="option.cells"
                :value="String(option.cells)"
              >
                {{ option.cells }} 格 / {{ option.count }} 件
              </option>
            </select>
            <input
              v-else
              :id="panel.globalFields[0].id"
              v-model="panel.globalInputs.totalCells"
              type="text"
              :inputmode="panel.globalFields[0].mode"
              :placeholder="panel.totalCellsPlaceholder"
            >
          </label>
          <label class="field">
            <span>{{ t(panel.globalFields[1].labelKey) }}</span>
            <input
              :id="panel.globalFields[1].id"
              v-model="panel.globalInputs.totalAverage"
              type="text"
              :inputmode="panel.globalFields[1].mode"
              :placeholder="panel.totalAveragePlaceholder"
            >
          </label>
        </div>

        <div class="quality-grid" id="quality-grid">
          <section v-for="group in panel.groups" :key="group.key" class="quality-block">
            <div class="quality-head">
              <strong>{{ t(group.labelKey) }}</strong>
              <span>{{ t(group.qualitiesKey) }}</span>
            </div>
            <div class="quality-inputs">
              <label v-for="field in panel.qualityFields" :key="field.key" class="quality-field">
                <span>{{ t(group.labelKey) }}{{ t(field.suffixKey) }}</span>
                <input
                  :id="`${field.prefix}-${group.key}`"
                  v-model="panel.groupInputs[group.key][field.key]"
                  type="text"
                  :inputmode="field.mode"
                  :placeholder="panel.groupPlaceholders[group.key][field.key] || t('ethan.optional')"
                >
              </label>
            </div>
          </section>
        </div>

        <div class="actions">
          <button type="submit" id="calculate-button" :disabled="panel.isLoading">{{ t('ethan.estimate') }}</button>
          <button type="button" id="reload-button" :disabled="panel.isLoading" @click="panel.loadData(t('ethan.meta.dataReloading'))">
            {{ t('ethan.reload') }}
          </button>
          <button type="button" id="clear-button" @click="panel.handleClear">{{ t('ethan.clear') }}</button>
        </div>
      </form>

      <section class="results" aria-live="polite">
        <header class="results-head">
          <div>
            <h2>{{ t('ethan.resultsTitle') }}</h2>
            <p id="result-meta" :class="panel.metaStatus">{{ panel.metaText }}</p>
          </div>
        </header>

        <div class="summary-grid">
          <div v-for="card in panel.summaryCards" :key="card.id" class="summary-card">
            <span>{{ card.label }}</span>
            <strong :id="card.id">{{ card.value }}</strong>
          </div>
        </div>
      </section>
    </section>
  </main>
</template>
```

Create `src/hero-estimator/hero-estimator.css` with the extracted form/result/monitor selectors from the current Ethan page, then import it from both entry files:

```js
// src/ethan/main.js
import '../hero-estimator/hero-estimator.css';
import '../../public/ethan/ethan.css';

// src/elsa/main.js
import '../hero-estimator/hero-estimator.css';
import './elsa.css';
```

Replace `src/ethan/App.vue` with a wrapper:

```vue
<script setup>
import HeroEstimatorPanel from '../hero-estimator/HeroEstimatorPanel.vue';
import { ethanProfile } from '../hero-estimator/hero-profiles.js';
</script>

<template>
  <HeroEstimatorPanel :profile="ethanProfile" active-page="ethan" />
</template>
```

- [ ] **Step 4: Re-run shell/Ethan tests**

Run:

```bash
npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js src/ethan/App.test.js src/ethan/monitor-grid.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hero-estimator/HeroEstimatorPanel.vue src/hero-estimator/useHeroEstimatorPanel.js src/hero-estimator/result-row-builder.js src/hero-estimator/HeroEstimatorPanel.test.js src/hero-estimator/hero-estimator.css src/ethan/App.vue src/ethan/main.js src/ethan/App.test.js
git commit -m "refactor: extract shared hero estimator shell"
```

---

## Task 4: Add the Elsa Tools Panel Tab and Elsa-Specific Coverage

**Files:**
- Create: `src/elsa/ElsaHeroPanel.vue`
- Create: `src/elsa/ElsaHeroPanel.test.js`
- Modify: `src/elsa/App.vue`
- Modify: `src/elsa/App.test.js`
- Modify: `src/elsa/main.js`
- Modify: `src/elsa/elsa.css`
- Modify: `src/shared/messages.js`

- [ ] **Step 1: Write failing Elsa panel tests**

Append this test to `src/elsa/App.test.js`:

```js
it('renders an Elsa panel tab without using the solver /run flow', async () => {
  const wrapper = await mountApp();

  expect(wrapper.findAll('.tab-button')).toHaveLength(10);
  expect(wrapper.findAll('.tab-button').map((button) => button.text())).toContain('Elsa · 期望价值');

  await selectTab(wrapper, 9);

  expect(wrapper.find('#cells-white').exists()).toBe(true);
  expect(wrapper.find('#cells-green').exists()).toBe(true);
  expect(wrapper.find('#price-orange').exists()).toBe(true);
  expect(wrapper.find('#price-red').exists()).toBe(true);
  expect(FakeEventSource.instances.filter((source) => String(source.url).startsWith('/run?'))).toHaveLength(0);
});
```

Create `src/elsa/ElsaHeroPanel.test.js`:

```js
/* @vitest-environment happy-dom */
import fs from 'node:fs';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ElsaHeroPanel from './ElsaHeroPanel.vue';

const realAveragePrices = JSON.parse(fs.readFileSync('public/data/quality-size-average-prices.json', 'utf8'));
const realCollectibles = JSON.parse(fs.readFileSync('public/data/collectibles.json', 'utf8'));

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }
  emitEvent(type, payload) {
    this.listeners.get(type)?.({ data: JSON.stringify(payload) });
  }
  close() {}
  static reset() {
    FakeEventSource.instances = [];
  }
}

describe('ElsaHeroPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === '/api/bidking-monitor/status') {
        return { ok: true, json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }) };
      }
      return {
        ok: true,
        json: async () => String(url).includes('/data/collectibles.json') ? realCollectibles : realAveragePrices,
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('autofills white and green separately from Elsa hero events', async () => {
    const wrapper = mount(ElsaHeroPanel, { attachTo: document.body });
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => String(source.url) === '/api/bidking-monitor/events');
    monitorSource.emitEvent('event', {
      key: 'skill:white',
      gameUid: 'game-1',
      rawEvent: {
        key: 'skill:white',
        gameUid: 'game-1',
        round: 1,
        group: 'hero',
        skill: {
          uid: 'skill:white',
          heroCid: 103,
          skillCid: 1001034,
          hitBoxList: [{ boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' }],
        },
      },
    });
    monitorSource.emitEvent('event', {
      key: 'skill:green',
      gameUid: 'game-1',
      rawEvent: {
        key: 'skill:green',
        gameUid: 'game-1',
        round: 2,
        group: 'hero',
        skill: {
          uid: 'skill:green',
          heroCid: 103,
          skillCid: 1001033,
          hitBoxList: [{ boxId: 10, itemSlotType: 11, itemQuility: 2, itemQuilityName: '绿' }],
        },
      },
    });
    await nextTick();

    expect(wrapper.find('#cells-white').attributes('placeholder')).toBe('1');
    expect(wrapper.find('#cells-green').attributes('placeholder')).toBe('1');
    expect(wrapper.find('#price-orange').exists()).toBe(true);
    expect(wrapper.find('#price-red').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run Elsa tests to verify they fail**

Run:

```bash
npx vitest run src/elsa/App.test.js src/elsa/ElsaHeroPanel.test.js
```

Expected: FAIL because the Tools app does not support panel tabs and `src/elsa/ElsaHeroPanel.vue` does not exist.

- [ ] **Step 3: Implement the Elsa wrapper, mixed tab model, and messages**

Create `src/elsa/ElsaHeroPanel.vue`:

```vue
<script setup>
import HeroEstimatorPanel from '../hero-estimator/HeroEstimatorPanel.vue';
import { elsaProfile } from '../hero-estimator/hero-profiles.js';
</script>

<template>
  <HeroEstimatorPanel :profile="elsaProfile" embedded />
</template>
```

Update `src/elsa/App.vue` to split the tab model:

First, rename the existing top-level `const tabs = [` declaration to `const solverTabs = [` and leave the current nine solver tab objects unchanged. Then add:

```js
import ElsaHeroPanel from './ElsaHeroPanel.vue';

const tabs = [
  ...solverTabs.map((tab) => ({ kind: 'solver', ...tab })),
  {
    kind: 'panel',
    titleKey: 'tools.tabs.elsaHero',
    panelKey: 'elsa-hero',
    component: ElsaHeroPanel,
  },
];

const activeTab = computed(() => tabs[activeTabIndex.value] || tabs[0]);
const activeSolverTab = computed(() => activeTab.value?.kind === 'solver' ? activeTab.value : null);
const activePanelComponent = computed(() => activeTab.value?.kind === 'panel' ? activeTab.value.component : null);
```

Replace the solver-only panel body with a `panel` / `solver` conditional:

```vue
<section class="tool-panel" :class="{ 'tool-panel--panel': activeTab.kind === 'panel' }">
  <component :is="activePanelComponent" v-if="activeTab.kind === 'panel'" />
  <template v-else>
    <header class="panel-head">
      <h2>{{ t(activeSolverTab.titleKey) }}</h2>
      <div class="panel-actions">
        <button class="action-button" type="button" @click="run(activeTabIndex)">{{ t('tools.calculate') }}</button>
        <button class="ghost-button" type="button" :disabled="!running[activeTabIndex]" @click="stop(activeTabIndex)">{{ t('tools.stop') }}</button>
      </div>
    </header>

    <div class="form-grid">
      <div v-for="field in activeSolverTab.fields" :key="field.key" class="field">
        <span>{{ t(field.labelKey) }}</span>
        <select v-if="field.type === 'select'" v-model="values[activeTabIndex][field.key]">
          <option v-for="option in field.options" :key="option.value" :value="option.value">{{ t(option.labelKey) }}</option>
        </select>
        <label v-else-if="field.type === 'switch'" class="switch-control">
          <input v-model="values[activeTabIndex][field.key]" type="checkbox">
          <span class="switch-track" aria-hidden="true">
            <span class="switch-thumb"></span>
          </span>
          <span class="switch-text">{{ values[activeTabIndex][field.key] ? t('tools.switchOn') : t('tools.switchOff') }}</span>
        </label>
        <input
          v-else
          v-model="values[activeTabIndex][field.key]"
          :inputmode="field.type"
          autocomplete="off"
          :placeholder="t(field.placeholderKey)"
        >
      </div>
    </div>

    <div class="result-toolbar">
      <label class="filter-control">
        <span>{{ t('tools.filter') }}</span>
        <input v-model="filters[activeTabIndex]" autocomplete="off" :placeholder="t('tools.filterPlaceholder')">
      </label>
      <div
        v-if="usesTableOutput(activeTabIndex)"
        :class="getRunStatusClass(activeTabIndex)"
        role="status"
      >
        {{ getRunStatus(activeTabIndex) }}
      </div>
    </div>

    <div
      v-if="usesTableOutput(activeTabIndex)"
      :ref="el => { outputRefs[activeTabIndex] = el }"
      class="table-output"
      aria-live="polite"
    >
      <table v-if="getTableRows(activeTabIndex).length > 0" class="result-table">
        <thead>
          <tr>
            <th
              v-for="column in tableColumns"
              :key="column.key"
              :class="{ 'sortable-header': column.sortable }"
            >
              <button
                v-if="column.sortable"
                class="table-sort-button"
                type="button"
                @click="toggleTableSort(activeTabIndex, column.key)"
              >
                {{ t(column.labelKey) }}{{ getSortIndicator(activeTabIndex, column.key) }}
              </button>
              <span v-else>{{ t(column.labelKey) }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in getTableRows(activeTabIndex)" :key="row.id">
            <td>{{ row.count }}</td>
            <td>{{ row.totalCells }}</td>
            <td>{{ row.totalPrice }}</td>
            <td class="combo-cell">{{ row.combo }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-output">
        {{ t('tools.empty') }}
      </div>
    </div>

    <div v-else :ref="el => { outputRefs[activeTabIndex] = el }" class="output" aria-live="polite">
      <div
        v-for="line in getFilteredLines(activeTabIndex)"
        :key="line.id"
        class="line"
      >
        <span
          v-for="(segment, segmentIndex) in line.segments"
          :key="`${line.id}-${segmentIndex}`"
          :class="segment.className"
        >{{ segment.text }}</span>
      </div>
      <div v-if="getFilteredLines(activeTabIndex).length === 0" class="empty-output">
        {{ t('tools.empty') }}
      </div>
    </div>
  </template>
</section>
```

Update `src/shared/messages.js`:

```js
tools: {
  title: 'Tools 组合计算器',
  tabs: {
    goldAverage: '金色 · 平均价格',
    goldTotal: '金色 · 总价格',
    goldGrid: '金色 · 平均格数',
    purpleGrid: '紫色 · 平均格数',
    redGrid: '红色 · 平均格数',
    categoryAverage: '类目 · 平均价格',
    countAverage: 'X件 · 平均价格',
    purpleAverage: '紫色 · 平均价格',
    purpleTotal: '紫色 · 总价格',
    elsaHero: 'Elsa · 期望价值',
  },
},
ethan: {
  groups: {
    wg: '白+绿',
    blue: '蓝色',
    purple: '紫色',
    orange: '橙/金色',
    red: '红色',
    white: '白色',
    green: '绿色',
    wgQualities: '白 + 绿',
    blueQualities: '蓝',
    purpleQualities: '紫',
    orangeQualities: '金',
    redQualities: '红',
    whiteQualities: '白',
    greenQualities: '绿',
  },
},
```

Keep `src/elsa/elsa.css` changes minimal:

```css
.tool-panel--panel {
  padding: 0;
}

.tool-panel--panel .hero-estimator--embedded {
  border: 0;
  box-shadow: none;
}
```

- [ ] **Step 4: Re-run Elsa tests**

Run:

```bash
npx vitest run src/elsa/App.test.js src/elsa/ElsaHeroPanel.test.js src/hero-estimator/HeroEstimatorPanel.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/elsa/ElsaHeroPanel.vue src/elsa/ElsaHeroPanel.test.js src/elsa/App.vue src/elsa/App.test.js src/elsa/main.js src/elsa/elsa.css src/shared/messages.js
git commit -m "feat: add Elsa hero panel tab"
```

---

## Task 5: Refresh Current-State Docs and Run Final Feature Verification

**Files:**
- Modify: `docs/Documentation.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update current-state docs**

Update the `Tools` and `Ethan` sections in `docs/Documentation.md` to reflect the new behavior:

```md
- `Tools`
  - 保留 9 个 solver 模式走 `/run` + SSE
  - 额外新增 1 个 `Elsa` panel tab，走共享 hero-estimator 壳层和 `/api/bidking-monitor/events`
- `Ethan`
  - 页面入口仍是独立 `/Ethan`
  - 实际由 `src/hero-estimator/` 共享壳层 + `ethanProfile` 驱动
```

Update `docs/ARCHITECTURE.md` in the `src/` tree and page sections:

```md
├── src/
│   ├── hero-estimator/
│   ├── elsa/
│   ├── ethan/
│   ├── monitor/
│   ├── price/
│   └── shared/

### Tools

源码：`src/elsa/`

职责：

- 保留 9 个 solver tabs
- 新增 1 个 Elsa hero panel tab
- solver tabs 继续走 `/run`
- Elsa panel 走 `src/hero-estimator/` 共享壳层

### Ethan

源码：`src/ethan/`

职责：

- `/Ethan` 仍是独立页面入口
- 页面本体由 `src/hero-estimator/HeroEstimatorPanel.vue` + `ethanProfile` 渲染
- `src/ethan/App.vue` 退化为薄 wrapper
```

- [ ] **Step 2: Run the feature verification suites**

Run:

```bash
npx vitest run lib/bidking-monitor-facts.test.mjs lib/bidking-monitor-store.test.mjs
npx vitest run src/ethan/estimator.test.js src/ethan/monitor-adapter.test.js src/ethan/monitor-grid.test.js src/ethan/App.test.js
npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js src/elsa/ElsaHeroPanel.test.js src/elsa/App.test.js
git diff --check
```

Expected:

- all targeted Vitest suites PASS
- `git diff --check` prints nothing

- [ ] **Step 3: Record the build skip explicitly**

Do not run `npm run build:pages` in this round. Instead, add a short note to `docs/Documentation.md` latest verification section:

```md
- 2026-06-02：本轮未执行 `npm run build:pages`，因为工作区存在无关的 `public/inject/*` 脏改动；重建页面会覆盖无关变更。
```

- [ ] **Step 4: Review the final diff boundary**

Run:

```bash
git status --short
```

Expected: only the Elsa hero-estimator source/test/doc files from this plan are modified; unrelated `public/inject/*` changes remain untouched.

- [ ] **Step 5: Commit**

```bash
git add docs/Documentation.md docs/ARCHITECTURE.md
git commit -m "docs: record Elsa hero tools tab architecture"
```

---

## Self-Review

- Spec coverage:
  - profile-aware facts/store: Task 1
  - split white/green Elsa groups: Tasks 1, 2, 4
  - keep Ethan behavior frozen: Tasks 2, 3, 5
  - retain orange/red support: Tasks 2 and 4
  - Tools mixed solver/panel tabs: Task 4
  - current-state docs refresh: Task 5
- Placeholder scan:
  - no `TODO` / `TBD`
  - each task includes concrete files, tests, commands, and commit messages
- Type consistency:
  - CommonJS monitor profile source lives in `lib/bidking-hero-profiles.js`
  - ESM UI profiles live in `src/hero-estimator/hero-profiles.js`
  - Ethan wrapper keeps `src/ethan/App.vue` public entry stable while reusing `HeroEstimatorPanel`

## Execution Notes

- Do not widen this refactor into a `Monitor` page rewrite.
- Do not rebuild tracked page outputs while `public/inject/*` is dirty.
- Stop and fix any Ethan regression before starting the next task.
