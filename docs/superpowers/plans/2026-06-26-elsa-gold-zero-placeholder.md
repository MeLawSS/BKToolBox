# Elsa Gold Zero Placeholder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Elsa receives an orange `group.averageCellsKnown` monitor fact with value `0`, automatically infer `group.totalCellsKnown = 0` so both gold placeholders display `0` without overwriting explicit user input.

**Architecture:** Add a 5-line inference block in `buildBidKingMonitorFacts()` in `lib/bidking-monitor-facts.js`, immediately after the existing `aggregateFact` push. Keep `buildAggregateFact()` unchanged as a single-fact helper. All downstream layers (store, UI) require zero changes.

**Tech Stack:** Node.js, Vitest, Vue 3 (Vue Test Utils for UI test)

## Global Constraints

- Only apply to the `orange` group; do not expand to purple or red
- Only fire when the parsed numeric average value is exactly `0`
- Profile-agnostic: applies for both Ethan and Elsa monitor profiles
- Source-agnostic: fires regardless of which aggregate parsing path produced the orange average fact
- Do not fire when the value is missing, empty, malformed, `null`, or `undefined`
- Do not auto-write into `#elsa-avg-orange` or `#elsa-cells-orange` input values
- Run `git diff --check`, `npm test`, and `npm run build:pages` after all changes

---

### Task 1: Add zero-average → zero-total inference in the fact builder

**Files:**
- Modify: `lib/bidking-monitor-facts.js:61-62`

**Interfaces:**
- Consumes: `buildAggregateFact(event, source, resolvedProfile)` — existing, returns a single fact object or `null`
- Produces: an additional `group.totalCellsKnown` fact (inline push, no new function signature)

- [ ] **Step 1: Replace the single-line aggregate push with a guarded block**

In `lib/bidking-monitor-facts.js`, replace lines 61-62:

```javascript
	const aggregateFact = buildAggregateFact(event, source, resolvedProfile);
	if (aggregateFact) facts.push(aggregateFact);
```

With:

```javascript
	const aggregateFact = buildAggregateFact(event, source, resolvedProfile);
	if (aggregateFact) {
	  facts.push(aggregateFact);

	  if (
	    aggregateFact.type === 'group.averageCellsKnown' &&
	    aggregateFact.group === 'orange' &&
	    aggregateFact.value === 0
	  ) {
	    facts.push({
	      type: 'group.totalCellsKnown',
	      key: `${source.key}:group.totalCellsKnown:orange`,
	      gameUid: event.gameUid ? String(event.gameUid) : null,
	      group: 'orange',
	      value: 0,
	      source,
	    });
	  }
	}
```

- [ ] **Step 2: Run existing fact-layer tests to confirm no regressions**

```powershell
npx vitest run lib/bidking-monitor-facts.test.mjs
```

Expected: all existing tests pass (the new code only fires when `aggregateFact.value === 0` for orange, which no existing test triggers).

- [ ] **Step 3: Commit**

```bash
git add lib/bidking-monitor-facts.js
git commit -m "feat: infer orange totalCells=0 from orange averageCells=0 aggregate fact"
```

---

### Task 2: Add fact-layer regression tests

**Files:**
- Modify: `lib/bidking-monitor-facts.test.mjs` (insert before the closing `});` at line 631)

**Interfaces:**
- Consumes: `buildBidKingMonitorFacts` (already imported), `ELSA_MONITOR_PROFILE` (already imported)
- Produces: four new test cases — positive, profile-scope, non-zero negative, purple/red negative

- [ ] **Step 1: Add the four test cases**

Insert the following tests before the closing `});` at line 631 of `lib/bidking-monitor-facts.test.mjs`:

```javascript
  it('emits orange totalCells=0 when orange averageCells aggregate value is zero', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:orange-zero-average',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'orange-zero-average',
        skillCid: 200015,
        allHitItemAvgBoxIndex: 0,
      },
    });

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'orange',
      value: 0,
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'orange',
      value: 0,
    }));
  });

  it('emits orange totalCells=0 from orange zero average under the Elsa profile too', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:orange-zero-average-elsa',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'orange-zero-average-elsa',
        skillCid: 200015,
        allHitItemAvgBoxIndex: 0,
      },
    }, ELSA_MONITOR_PROFILE);

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'orange',
      value: 0,
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'orange',
      value: 0,
    }));
  });

  it('does not infer orange totalCells=0 when orange averageCells value is non-zero', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:orange-nonzero-average',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'orange-nonzero-average',
        skillCid: 200015,
        allHitItemAvgBoxIndex: 3.2,
      },
    });

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'orange',
      value: 3.2,
    }));
    expect(facts).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'orange',
      value: 0,
    }));
  });

  it('does not infer totalCells=0 for purple or red when their average is zero', () => {
    const purpleFacts = buildBidKingMonitorFacts({
      key: 'skill:purple-zero-average',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'purple-zero-average',
        skillCid: 200013,
        allHitItemAvgBoxIndex: 0,
      },
    });

    expect(purpleFacts).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
      value: 0,
    }));

    const redFacts = buildBidKingMonitorFacts({
      key: 'skill:red-zero-average',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'red-zero-average',
        skillCid: 200016,
        allHitItemAvgBoxIndex: 0,
      },
    });

    expect(redFacts).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'red',
      value: 0,
    }));
  });
```

- [ ] **Step 2: Run the fact-layer tests**

```powershell
npx vitest run lib/bidking-monitor-facts.test.mjs
```

Expected: all existing tests + 4 new tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/bidking-monitor-facts.test.mjs
git commit -m "test: add orange zero-average -> zero-total fact inference cases"
```

---

### Task 3: Add Elsa UI regression test

**Files:**
- Modify: `src/hero-estimator/HeroEstimatorPanel.test.js` (find the existing orange placeholder test around line 800 and add a new test after it)

**Interfaces:**
- Consumes: `mount(HeroEstimatorPanel, ...)`, `FakeEventSource`, `elsaProfile`, `flushPromises`, `nextTick`
- Produces: a new `it(...)` block verifying orange zero-average → both placeholders show `'0'`, inputs stay empty

- [ ] **Step 1: Add the Elsa zero-average placeholder test**

Insert the following test after the closing `});` of the "still accepts same-game generic map events" test (after line 801):

```javascript
  it('shows gold zero placeholders when Elsa receives an orange zero-average aggregate event', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: elsaProfile, embedded: true },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'elsa-orange-zero-average',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-orange-zero-average-hero',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    });
    await nextTick();

    monitorSource.emitEvent('event', {
      key: 'elsa-orange-zero-average-map',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'elsa-orange-zero-average-map-skill',
        skillCid: 200015,
        allHitItemAvgBoxIndex: 0,
      },
    });
    await nextTick();

    expect(wrapper.find('#elsa-avg-orange').attributes('placeholder')).toBe('0');
    expect(wrapper.find('#elsa-cells-orange').attributes('placeholder')).toBe('0');
    expect(wrapper.find('#elsa-avg-orange').element.value).toBe('');
    expect(wrapper.find('#elsa-cells-orange').element.value).toBe('');
  });
```

- [ ] **Step 2: Run the UI test**

```powershell
npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js
```

Expected: all existing tests + the new test pass.

- [ ] **Step 3: Commit**

```bash
git add src/hero-estimator/HeroEstimatorPanel.test.js
git commit -m "test: add Elsa gold zero placeholder regression for orange zero-average event"
```

---

### Task 4: Update Documentation.md

**Files:**
- Modify: `docs/Documentation.md` (line 154, append after the existing purple zero-count entry)

**Interfaces:**
- Produces: one new documentation line recording the new orange zero-average → zero-total behavior

- [ ] **Step 1: Add the new fact to documentation**

After line 154 (`- 当 monitor 聚合事件能确定 \`purple\` 组且只给出 \`hitItemIndex: 0\`、未给 \`totalHitBoxIndex\` 时...`), add:

```markdown
- 当 monitor 聚合事件解析出 `orange` 组 `group.averageCellsKnown = 0` 时，`lib/bidking-monitor-facts.js` 会补发 `group.totalCellsKnown = 0`；Elsa 因此会把 `#elsa-avg-orange` 和 `#elsa-cells-orange` 的 placeholder 都显示为 `0`，但不会替用户写入显式 input value。
```

- [ ] **Step 2: Commit**

```bash
git add docs/Documentation.md
git commit -m "docs: record orange zero-average -> zero-total placeholder behavior"
```

---

### Task 5: Full verification

**Files:**
- (none — verification only)

- [ ] **Step 1: Run git diff --check**

```powershell
git diff --check
```

Expected: no output (no whitespace errors).

- [ ] **Step 2: Run full test suite**

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run page build**

```powershell
npm run build:pages
```

Expected: all page entry bundles build successfully.

- [ ] **Step 4: Final review of the diff**

```powershell
git diff master --stat
```

Confirm only the expected files are changed:
- `lib/bidking-monitor-facts.js` (the inference)
- `lib/bidking-monitor-facts.test.mjs` (fact-layer tests)
- `src/hero-estimator/HeroEstimatorPanel.test.js` (UI regression test)
- `docs/Documentation.md` (documentation update)
