# Tools Hero Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate `Ethan` and `Ahmed` into the canonical `Tools` page while preserving deep-link compatibility and existing solver behavior.

**Architecture:** Reuse the current mixed `solver`/`panel` `Tools` shell, add embedded hero panels for `Ethan` and `Ahmed`, and drive initial tab selection from `?tab=` before falling back to saved local page state. Keep Ahmed’s controller-based behavior intact by converting its legacy page boot into a mountable embedded panel contract rather than rewriting Ahmed state in this pass.

**Tech Stack:** Vue 3, Vite, existing `HeroEstimatorPanel`, legacy Ahmed DOM controller in `public/ahmed/ahmed.js`, Express routes in `server.js`, Vitest, Supertest.

---

## File Structure

- Create `src/ethan/EthanHeroPanel.vue`
  - Thin embedded wrapper for `HeroEstimatorPanel` + `ethanProfile`.
- Create `src/ahmed/AhmedPanel.vue`
  - Embedded Ahmed panel markup without standalone page shell.
- Modify `src/elsa/App.vue`
  - Add hero-first tabs, query parsing, query synchronization, and embedded panel hosting.
- Modify `src/elsa/App.test.js`
  - Cover hero tab order, query-driven initial tab selection, query synchronization, and embedded panel mounting.
- Modify `src/ahmed/App.vue`
  - Delegate standalone route body to shared Ahmed panel component.
- Modify `src/ahmed/main.js`
  - Mount the standalone page without relying on unconditional one-shot controller boot.
- Modify `public/ahmed/ahmed.js`
  - Export a mount/unmount style controller API that works for both standalone and embedded use.
- Modify `src/ahmed/App.test.js`
  - Keep standalone Ahmed smoke coverage aligned with the shared panel.
- Modify `docs/Prompt.md`
  - Update canonical tool-entry goal and page-count facts after consolidation.
- Modify `docs/Plan.md`
  - Update routing/build milestones to reflect canonical `Tools` ownership of Elsa/Ethan/Ahmed.
- Modify `docs/Implement.md`
  - Update current repository conventions for page ownership and route compatibility.
- Modify `docs/Documentation.md`
  - Record current-state route, tab, and Ahmed embedding facts.
- Modify `docs/ARCHITECTURE.md`
  - Document the consolidated Tools container and embedded Ahmed/Ethan panels.

---

### Task 1: Add Failing Tests For Consolidated Tools Tabs

**Files:**
- Modify: `src/elsa/App.test.js`

- [ ] **Step 1: Write the failing test**

Add tests that prove:

```js
it('renders hero tabs first in Elsa Ethan Ahmed order', async () => {
  const wrapper = await mountApp();

  expect(wrapper.findAll('.tab-button').slice(0, 3).map((button) => button.text())).toEqual([
    'Elsa · 期望价值',
    'Ethan · 期望价值',
    'Ahmed · 组合计算器',
  ]);
});

it('selects the Ethan tab from the location query before saved state', async () => {
  window.history.replaceState({}, '', '/Tools?tab=ethan');
  window.localStorage.setItem('bidking-page-state:v1:elsa', JSON.stringify({
    activeTabIndex: 0,
  }));

  const wrapper = await mountApp();

  expect(wrapper.find('#ethan-total-cells').exists()).toBe(true);
});

it('updates the current URL query when switching hero tabs', async () => {
  window.history.replaceState({}, '', '/Tools');
  const wrapper = await mountApp();

  await wrapper.findAll('.tab-button')[2].trigger('click');
  await nextTick();

  expect(window.location.search).toBe('?tab=ahmed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/elsa/App.test.js
```

Expected: FAIL because `Tools` does not yet expose hero-first tabs or query-driven selection.

- [ ] **Step 3: Write minimal implementation**

Implement in `src/elsa/App.vue`:

- add stable tab ids such as `elsa`, `ethan`, `ahmed`
- prepend hero tabs in the required order
- map query `tab` values to tab indexes
- read query before saved `activeTabIndex`
- update the current URL with `history.replaceState` when tab changes

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/elsa/App.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/elsa/App.vue src/elsa/App.test.js src/ethan/EthanHeroPanel.vue
git commit -m "feat: add hero-first tools tabs"
```

### Task 2: Embed Ethan Into Tools

**Files:**
- Create: `src/ethan/EthanHeroPanel.vue`
- Modify: `src/elsa/App.vue`

- [ ] **Step 1: Write the failing test**

Add a test in `src/elsa/App.test.js`:

```js
it('renders an Ethan panel tab without using the solver run flow', async () => {
  window.history.replaceState({}, '', '/Tools?tab=ethan');

  const wrapper = await mountApp();

  expect(wrapper.find('#ethan-total-cells').exists()).toBe(true);
  expect(FakeEventSource.instances.filter((source) => String(source.url).startsWith('/run?'))).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/elsa/App.test.js
```

Expected: FAIL because no embedded Ethan panel exists yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/ethan/EthanHeroPanel.vue`:

```vue
<script setup>
import HeroEstimatorPanel from '../hero-estimator/HeroEstimatorPanel.vue';
import { ethanProfile } from '../hero-estimator/hero-profiles.js';
</script>

<template>
  <HeroEstimatorPanel :profile="ethanProfile" embedded />
</template>
```

Register the component as a `panel` tab in `src/elsa/App.vue`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/elsa/App.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ethan/EthanHeroPanel.vue src/elsa/App.vue src/elsa/App.test.js
git commit -m "feat: embed ethan in tools"
```

### Task 3: Make Ahmed Mountable As An Embedded Panel

**Files:**
- Create: `src/ahmed/AhmedPanel.vue`
- Modify: `src/ahmed/App.vue`
- Modify: `src/ahmed/main.js`
- Modify: `public/ahmed/ahmed.js`
- Modify: `src/ahmed/App.test.js`
- Modify: `src/elsa/App.vue`
- Modify: `src/elsa/App.test.js`

- [ ] **Step 1: Write the failing test**

Add a smoke test proving Ahmed can mount inside `Tools`:

```js
it('renders an Ahmed panel tab from the location query', async () => {
  window.history.replaceState({}, '', '/Tools?tab=ahmed');

  const wrapper = await mountApp();

  expect(wrapper.find('#combo-form').exists()).toBe(true);
  expect(wrapper.find('#calculate-button').exists()).toBe(true);
  expect(wrapper.find('#result-body').exists()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/elsa/App.test.js src/ahmed/App.test.js
```

Expected: FAIL because Ahmed is not yet embeddable inside `Tools`.

- [ ] **Step 3: Write minimal implementation**

Implement:

- `src/ahmed/AhmedPanel.vue` with the existing Ahmed body markup
- `src/ahmed/App.vue` as `<TopBar active-page="tools|ahmed"> + <AhmedPanel />` split if needed
- `public/ahmed/ahmed.js` mount API that accepts a root element and returns cleanup
- `src/elsa/App.vue` hero tab registration for `Ahmed`

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/elsa/App.test.js src/ahmed/App.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ahmed/AhmedPanel.vue src/ahmed/App.vue src/ahmed/main.js public/ahmed/ahmed.js src/ahmed/App.test.js src/elsa/App.vue src/elsa/App.test.js
git commit -m "feat: embed ahmed in tools"
```

### Task 4: Update Current-State Docs And Verify Consolidation End-To-End

**Files:**
- Modify: `docs/Prompt.md`
- Modify: `docs/Plan.md`
- Modify: `docs/Implement.md`
- Modify: `docs/Documentation.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update current-state docs**

Record:

- `Tools` now owns Elsa/Ethan/Ahmed tabs
- standalone `Ethan` / `Ahmed` nav is removed
- `/Ethan` and `/Ahmed` now redirect into `Tools?tab=...`
- Ahmed is now embedded through a shared panel + legacy controller mount path

- [ ] **Step 2: Run targeted verification**

Run:

```bash
npx vitest run src/elsa/App.test.js src/ahmed/App.test.js src/home/App.test.js src/shared/TopBar.test.js server.test.mjs
git diff --check
```

Expected: PASS with no diff-format issues.

- [ ] **Step 3: Commit**

```bash
git add docs/Prompt.md docs/Plan.md docs/Implement.md docs/Documentation.md docs/ARCHITECTURE.md
git commit -m "docs: record tools hero consolidation"
```
