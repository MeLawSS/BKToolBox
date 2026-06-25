# Purple Zero-Count Placeholder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ethan's purple total-cells input show placeholder `0` when a monitor aggregate packet proves the current round has zero purple items.

**Architecture:** Keep the change inside the existing monitor fact pipeline. Add a narrow inference in `lib/bidking-monitor-facts.js` that converts `purple + hitItemIndex === 0 + missing totalHitBoxIndex` into `group.totalCellsKnown = 0`, then rely on the existing monitor-store and hero-estimator placeholder plumbing to surface the visible `0`.

**Tech Stack:** Vitest, Vue Test Utils, Node.js CommonJS monitor modules, Vue 3 hero-estimator panel

---

## File Map

- Modify: `lib/bidking-monitor-facts.js`
  - Responsibility: infer a zero purple total-cells fact from zero-count aggregate packets without changing monitor state shape
- Modify: `lib/bidking-monitor-facts.test.mjs`
  - Responsibility: lock the fact-layer zero-count inference and its non-zero guardrail
- Modify: `src/hero-estimator/HeroEstimatorPanel.test.js`
  - Responsibility: prove the user-visible placeholder becomes `0` while the input value stays empty
- Modify: `docs/Documentation.md`
  - Responsibility: record the new current-state monitor-derived placeholder rule

### Task 1: Add Red Tests And Minimal Fact Inference

**Files:**
- Modify: `src/hero-estimator/HeroEstimatorPanel.test.js`
- Modify: `lib/bidking-monitor-facts.test.mjs`
- Modify: `lib/bidking-monitor-facts.js`

- [ ] **Step 1: Write the failing hero-estimator placeholder test**

Add this test near the existing monitor-placeholder coverage in `src/hero-estimator/HeroEstimatorPanel.test.js`:

```javascript
  it('shows a zero purple placeholder when an Ethan purple aggregate packet reports zero count without total cells', async () => {
    const wrapper = mount(HeroEstimatorPanel, {
      props: { profile: ethanProfile, activePage: 'ethan' },
      attachTo: document.body,
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    await nextTick();

    const monitorSource = FakeEventSource.instances.find((source) => source.url === '/api/bidking-monitor/events');

    monitorSource.emitEvent('event', {
      key: 'ethan-purple-zero-count',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'ethan-purple-zero-count-skill',
        skillCid: 203,
        hitItemIndex: 0,
      },
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('#cells-purple').element.value).toBe('');
    expect(wrapper.find('#cells-purple').attributes('placeholder')).toBe('0');
  });
```

- [ ] **Step 2: Run the hero-estimator test to verify it fails**

Run:

```bash
npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js -t "shows a zero purple placeholder when an Ethan purple aggregate packet reports zero count without total cells"
```

Expected: `FAIL` because the placeholder is still empty instead of `0`.

- [ ] **Step 3: Write the failing fact-layer tests**

Add these tests near the existing aggregate-fact coverage in `lib/bidking-monitor-facts.test.mjs`:

```javascript
  it('converts purple zero-count aggregate packets into zero total cells when totalHitBoxIndex is missing', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:purple-zero-count',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'purple-zero-count',
        skillCid: 203,
        hitItemIndex: 0,
      },
    })).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
      value: 0,
    }));
  });

  it('does not infer purple zero total cells when hitItemIndex is non-zero', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:purple-nonzero-count',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'purple-nonzero-count',
        skillCid: 203,
        hitItemIndex: 2,
      },
    })).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
      value: 0,
    }));
  });
```

- [ ] **Step 4: Run the fact-layer tests to verify they fail**

Run:

```bash
npx vitest run lib/bidking-monitor-facts.test.mjs -t "converts purple zero-count aggregate packets into zero total cells when totalHitBoxIndex is missing|does not infer purple zero total cells when hitItemIndex is non-zero"
```

Expected: the first test fails because `buildBidKingMonitorFacts(...)` does not currently emit `group.totalCellsKnown` for this packet shape.

- [ ] **Step 5: Write the minimal fact inference in `lib/bidking-monitor-facts.js`**

Update `buildAggregateFact(...)` and add a helper so the zero-count case only fills the missing total-cells gap:

```javascript
function buildAggregateFact(event, source, profile) {
  const skill = event.skill;
  const sourceIds = getSourceIds(skill);
  const sourceIdFact = buildSourceIdAggregateFact(event, source, sourceIds, profile);
  if (sourceIdFact) return sourceIdFact;

  const group = getAggregateGroup(skill, profile, []);
  if (!group) return null;

  const name = getSkillName(skill);
  if (isTotalCellsSkillName(name)) {
    const totalFact = buildGroupFact(event, source, 'group.totalCellsKnown', group, skill.totalHitBoxIndex);
    if (totalFact) return totalFact;
  }
  if (isAverageCellsSkillName(name)) {
    const averageFact = buildGroupFact(event, source, 'group.averageCellsKnown', group, skill.allHitItemAvgBoxIndex);
    if (averageFact) return averageFact;
  }
  if (skill.totalHitBoxIndex !== undefined) {
    const totalFact = buildGroupFact(event, source, 'group.totalCellsKnown', group, skill.totalHitBoxIndex);
    if (totalFact) return totalFact;
  }
  if (skill.allHitItemAvgBoxIndex !== undefined) {
    const averageFact = buildGroupFact(event, source, 'group.averageCellsKnown', group, skill.allHitItemAvgBoxIndex);
    if (averageFact) return averageFact;
  }

  const zeroCountFact = buildZeroCountTotalCellsFact(event, source, group);
  if (zeroCountFact) return zeroCountFact;

  return null;
}

function buildZeroCountTotalCellsFact(event, source, group) {
  const skill = event?.skill ?? {};
  if (group !== 'purple') return null;
  if (skill.totalHitBoxIndex !== undefined && skill.totalHitBoxIndex !== null && skill.totalHitBoxIndex !== '') {
    return null;
  }
  if (skill.hitItemIndex === undefined || skill.hitItemIndex === null || skill.hitItemIndex === '') {
    return null;
  }

  const count = Number(skill.hitItemIndex);
  if (!Number.isFinite(count) || count !== 0) return null;

  return buildGroupFact(event, source, 'group.totalCellsKnown', group, 0);
}
```

- [ ] **Step 6: Run the two targeted test files to verify they pass**

Run:

```bash
npx vitest run lib/bidking-monitor-facts.test.mjs src/hero-estimator/HeroEstimatorPanel.test.js
```

Expected: `PASS` for the new zero-count fact tests and the new purple placeholder panel test.

- [ ] **Step 7: Commit the green code and tests**

Run:

```bash
git add lib/bidking-monitor-facts.js lib/bidking-monitor-facts.test.mjs src/hero-estimator/HeroEstimatorPanel.test.js
git commit -m "feat: infer zero purple total-cells placeholder"
```

### Task 2: Record Current-State Docs And Re-Verify

**Files:**
- Modify: `docs/Documentation.md`

- [ ] **Step 1: Update current-state documentation**

Add one bullet under the `Hero Estimator 共享层事实` section in `docs/Documentation.md` after the monitor-route bullets:

```markdown
- 当 monitor 聚合事件能确定 `purple` 组且只给出 `hitItemIndex: 0`、未给 `totalHitBoxIndex` 时，`lib/bidking-monitor-facts.js` 会补发 `group.totalCellsKnown = 0`；`src/hero-estimator/useHeroEstimatorPanel.js` 因此会把 `#cells-purple` 的 placeholder 显示为 `0`，但不会替用户写入显式 input value。
```

- [ ] **Step 2: Run the targeted verification and diff sanity check**

Run:

```bash
npx vitest run lib/bidking-monitor-facts.test.mjs src/hero-estimator/HeroEstimatorPanel.test.js
git diff --check
```

Expected:

- Vitest reports both files `PASS`
- `git diff --check` prints no output

- [ ] **Step 3: Commit the documentation update**

Run:

```bash
git add docs/Documentation.md
git commit -m "docs: record purple zero-count placeholder behavior"
```

## Spec Coverage Check

- Goal covered by Task 1 integration test and fact inference.
- Non-goals preserved because the plan adds no new count state field, no solver changes, and no non-purple inference path.
- User-visible placeholder requirement covered by the new `HeroEstimatorPanel` test.
- Current-state documentation requirement covered by Task 2.

## Final Verification Reminder

Before claiming completion during execution, keep fresh evidence for:

- `npx vitest run lib/bidking-monitor-facts.test.mjs src/hero-estimator/HeroEstimatorPanel.test.js`
- `git diff --check`

If execution touches additional files or test helpers beyond this plan, expand verification to the smallest matching scope before closing the task.
