# Elsa Nearest Feasible Total Cells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Elsa's auto-derived all-item `totalCells` fall back to the nearest feasible total implied by the current average-cells input instead of leaving estimation at `0`.

**Architecture:** Keep the numeric rule in the shared estimator layer and expose it through a semantically named helper for auto-derived totals. Then compute one shared `normalizedAutoTotalCells` value inside `useHeroEstimatorPanel.js` and consume it from both the placeholder UI and `getEffectiveGlobalInputs()` so display and estimation cannot diverge.

**Tech Stack:** Vue 3 Composition API, Vitest, happy-dom, shared estimator utilities in `src/ethan/estimator.js`

---

### Task 1: Baseline Verification

**Files:**
- Read: `package.json`
- Test: `src/ethan/estimator.test.js`
- Test: `src/hero-estimator/HeroEstimatorPanel.test.js`

- [ ] **Step 1: Run the current targeted baseline**

```bash
npx vitest run src/ethan/estimator.test.js src/hero-estimator/HeroEstimatorPanel.test.js
```

Expected: both suites pass before feature edits start.

- [ ] **Step 2: Record the baseline status**

```text
If the command passes, continue to Task 2.
If it fails, stop and investigate before adding new tests so new failures are not mixed with pre-existing ones.
```

### Task 2: Add Shared Estimator Tests First

**Files:**
- Modify: `src/ethan/estimator.test.js`
- Modify later: `src/ethan/estimator.js`

- [ ] **Step 1: Add failing tests for the shared auto-total helper**

```javascript
import {
  // existing imports...
  resolveAutoTotalCellsFromAverage,
} from './estimator.js';

describe('Ethan estimator auto total-cells normalization', () => {
  it('keeps an already feasible auto-derived total unchanged', () => {
    expect(resolveAutoTotalCellsFromAverage(2.5, 50)).toBe(50);
  });

  it('normalizes an auto-derived total to the nearest feasible value', () => {
    expect(resolveAutoTotalCellsFromAverage(2.5, 48)).toBe(50);
  });

  it('breaks equal-distance ties downward', () => {
    expect(resolveAutoTotalCellsFromAverage(2, 19)).toBe(18);
  });

  it('passes through the preferred total when no average is available', () => {
    expect(resolveAutoTotalCellsFromAverage(null, 48)).toBe(48);
  });

  it('returns null when there is no preferred auto-derived total', () => {
    expect(resolveAutoTotalCellsFromAverage(2.5, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the estimator suite and verify RED**

```bash
npx vitest run src/ethan/estimator.test.js
```

Expected: fail because `resolveAutoTotalCellsFromAverage` is not exported yet.

- [ ] **Step 3: Implement the minimal shared helper**

```javascript
export function resolveAutoTotalCellsFromAverage(avg, preferredCells) {
  return deriveNearestCellsFromAverage(avg, preferredCells);
}
```

Place it near `deriveNearestCellsFromAverage()` in `src/ethan/estimator.js` and export it from that module.

- [ ] **Step 4: Run the estimator suite and verify GREEN**

```bash
npx vitest run src/ethan/estimator.test.js
```

Expected: all estimator tests pass, including the new helper coverage.

### Task 3: Add Hero Estimator Page Tests First

**Files:**
- Modify: `src/hero-estimator/HeroEstimatorPanel.test.js`
- Modify later: `src/hero-estimator/useHeroEstimatorPanel.js`

- [ ] **Step 1: Add a failing test for normalized placeholder display and submission**

```javascript
it('normalizes Elsa auto-derived total-cells placeholder and uses that same value for estimation', async () => {
  vi.stubGlobal('Worker', FakeEstimationWorker);

  const wrapper = mount(HeroEstimatorPanel, {
    props: { profile: elsaProfile, embedded: true },
    attachTo: document.body,
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();

  const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

  monitorSource.emitEvent('event', {
    key: 'elsa-nearest-total-cells-hero',
    gameUid: 'game-1',
    group: 'hero',
    skill: {
      uid: 'elsa-nearest-total-cells-hero-skill',
      heroCid: 103,
      skillCid: 1001034,
      hitBoxList: [
        { boxId: 1, itemSlotType: 33, itemQuility: 1, itemQuilityName: '白' },
        { boxId: 2, itemSlotType: 33, itemQuility: 1, itemQuilityName: '白' },
        { boxId: 3, itemSlotType: 33, itemQuility: 1, itemQuilityName: '白' },
        { boxId: 4, itemSlotType: 33, itemQuility: 1, itemQuilityName: '白' },
      ],
    },
  });
  monitorSource.emitEvent('event', {
    key: 'elsa-nearest-total-cells-map',
    gameUid: 'game-1',
    group: 'map',
    skill: {
      uid: 'elsa-nearest-total-cells-map-skill',
      skillCid: 200014,
      allHitItemAvgBoxIndex: 2.5,
    },
  });
  await settleWorkerStream();

  expect(wrapper.find('#elsa-total-cells-all').element.value).toBe('');
  expect(wrapper.find('#elsa-total-cells-all').attributes('placeholder')).toBe('50');

  await wrapper.find('#elsa-cells-white').setValue('4');
  await wrapper.find('#elsa-estimate-form').trigger('submit');
  await settleWorkerStream();

  const estimateMessage = FakeEstimationWorker.messages.findLast((message) => message?.type === 'estimate');
  expect(estimateMessage?.state?.totalCells).toBe(50);
  expect(wrapper.find('#elsa-result-meta').classes()).not.toContain('status-error');
});
```

- [ ] **Step 2: Add a failing test for the non-normalizing fallback cases**

```javascript
it('keeps the optional placeholder when no monitor total exists and does not materialize zero', async () => {
  const wrapper = mount(HeroEstimatorPanel, {
    props: { profile: elsaProfile, embedded: true },
    attachTo: document.body,
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();

  expect(wrapper.find('#elsa-total-cells-all').attributes('placeholder')).toBe('可选');
});

it('keeps an already feasible monitor-derived total unchanged', async () => {
  const wrapper = mount(HeroEstimatorPanel, {
    props: { profile: elsaProfile, embedded: true },
    attachTo: document.body,
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  await nextTick();

  const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

  monitorSource.emitEvent('event', {
    key: 'elsa-feasible-total-cells-hero',
    gameUid: 'game-1',
    group: 'hero',
    skill: {
      uid: 'elsa-feasible-total-cells-hero-skill',
      heroCid: 103,
      skillCid: 1001034,
      hitBoxList: [
        { boxId: 1, itemSlotType: 33, itemQuility: 1, itemQuilityName: '白' },
        { boxId: 2, itemSlotType: 33, itemQuility: 1, itemQuilityName: '白' },
        { boxId: 3, itemSlotType: 33, itemQuility: 1, itemQuilityName: '白' },
        { boxId: 4, itemSlotType: 33, itemQuility: 1, itemQuilityName: '白' },
      ],
    },
  });
  monitorSource.emitEvent('event', {
    key: 'elsa-feasible-total-cells-map',
    gameUid: 'game-1',
    group: 'map',
    skill: {
      uid: 'elsa-feasible-total-cells-map-skill',
      skillCid: 200014,
      allHitItemAvgBoxIndex: 3,
    },
  });
  await settleWorkerStream();

  expect(wrapper.find('#elsa-total-cells-all').attributes('placeholder')).toBe('48');
});
```

- [ ] **Step 3: Run the page suite and verify RED**

```bash
npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js
```

Expected: fail because the placeholder and effective input still use the raw monitor value.

### Task 4: Implement Shared `normalizedAutoTotalCells` Wiring

**Files:**
- Modify: `src/hero-estimator/useHeroEstimatorPanel.js`
- Modify: `src/ethan/estimator.js`

- [ ] **Step 1: Import the new helper into `useHeroEstimatorPanel.js`**

```javascript
import {
  // existing imports...
  parseOptionalNumber,
  resolveAutoTotalCellsFromAverage,
} from '../ethan/estimator.js';
```

- [ ] **Step 2: Add the shared computed for non-manual auto totals**

```javascript
const normalizedAutoTotalCells = computed(() => {
  const rawCells = monitorEstimatedTotalCells.value;
  if (!rawCells) return '';

  const averageSource = String(globalInputs.totalAverage).trim() || globalPlaceholders.totalAverage;
  if (!averageSource) return '';

  let average = null;
  try {
    average = parseOptionalNumber(averageSource, t(heroKey('fields.totalAverage')));
  } catch (_error) {
    return '';
  }
  if (average === null) return '';

  const preferredCells = Number(rawCells);
  if (!Number.isFinite(preferredCells)) return '';

  const normalizedCells = resolveAutoTotalCellsFromAverage(average, preferredCells);
  return normalizedCells === null ? '' : String(normalizedCells);
});
```

- [ ] **Step 3: Rewire the placeholder and effective global inputs**

```javascript
const totalCellsPlaceholder = computed(() =>
  normalizedAutoTotalCells.value || monitorEstimatedTotalCells.value || t(globalFields[0].placeholderKey)
);

function getEffectiveGlobalInputs() {
  return {
    ...globalInputs,
    totalCells: String(globalInputs.totalCells).trim()
      || normalizedAutoTotalCells.value
      || monitorEstimatedTotalCells.value,
    totalAverage: String(globalInputs.totalAverage).trim() || globalPlaceholders.totalAverage,
  };
}
```

- [ ] **Step 4: Keep `refreshTotalCellOptions()` manual-only**

```javascript
function refreshTotalCellOptions(force = false) {
  const source = String(globalInputs.totalAverage).trim() || globalPlaceholders.totalAverage;
  if (!force && source === totalAverageOptionSource.value) return;

  totalAverageOptionSource.value = source;
  totalCellOptions.value = [];
  if (!source) return;

  try {
    const average = parseOptionalNumber(source, t(heroKey('fields.totalAverage')));
    const options = getFeasibleCellsFromAverage(average);
    totalCellOptions.value = options;

    const currentTotalCells = String(globalInputs.totalCells).trim();
    if (currentTotalCells && !options.some((option) => String(option.cells) === currentTotalCells)) {
      globalInputs.totalCells = '';
    }
  } catch (_error) {
    totalCellOptions.value = [];
  }
}
```

No new mutation of `globalInputs.totalCells` should be introduced for the monitor-derived normalized value.

- [ ] **Step 5: Run the page suite and verify GREEN**

```bash
npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js
```

Expected: the new placeholder / estimation regression coverage passes and existing remount behavior stays green.

### Task 5: Final Verification

**Files:**
- Verify: `src/ethan/estimator.js`
- Verify: `src/hero-estimator/useHeroEstimatorPanel.js`
- Test: `src/ethan/estimator.test.js`
- Test: `src/hero-estimator/HeroEstimatorPanel.test.js`

- [ ] **Step 1: Run the touched suites together**

```bash
npx vitest run src/ethan/estimator.test.js src/hero-estimator/HeroEstimatorPanel.test.js
```

Expected: both suites pass together with no new failures.

- [ ] **Step 2: Optionally run the page build for the touched surface**

```bash
npm run build:elsa
```

Expected: Elsa page build succeeds.

- [ ] **Step 3: Commit the feature work**

```bash
git add src/ethan/estimator.js src/ethan/estimator.test.js src/hero-estimator/useHeroEstimatorPanel.js src/hero-estimator/HeroEstimatorPanel.test.js docs/superpowers/plans/2026-06-20-elsa-nearest-feasible-total-cells.md
git commit -m "feat(elsa): normalize auto total-cells to nearest feasible value"
```
