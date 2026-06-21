# BKToolBox Full-Repo Code Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute a repository-wide code review for BKToolBox, produce a findings-first report, and end with a phased remediation roadmap.

**Architecture:** The review is executed as a checkpointed documentation workflow rather than a one-shot terminal dump. One durable report file is created under `docs/superpowers/reviews/` and updated phase-by-phase, with each phase ending in a checkpoint update and an optional immediate escalation if a Critical issue is confirmed.

**Tech Stack:** CodeGraph MCP, shell inspection (`rg`, `sed`, `find`, `git`), Vitest, Electron/Express/Vue source, Windows packaging scripts, documentation in Markdown.

参考设计: `docs/superpowers/specs/2026-06-08-full-repo-codereview-design.md`

---

## File Structure

- **Create** `docs/superpowers/reviews/2026-06-08-full-repo-codereview.md` - the durable review artifact, updated after each phase and used for the final findings report, heatmap, and roadmap.
- **Modify** `docs/superpowers/reviews/2026-06-08-full-repo-codereview.md` - phase checkpoints, findings evidence, deduplicated risks, and remediation ordering.

---

### Task 1: Scaffold the durable review report before reading code deeply

**Files:**
- Create: `docs/superpowers/reviews/2026-06-08-full-repo-codereview.md`

- [ ] **Step 1: Create the report skeleton**

Create `docs/superpowers/reviews/2026-06-08-full-repo-codereview.md` with this exact starting structure:

```md
# BKToolBox Full-Repo Code Review

Date: 2026-06-08
Spec: `docs/superpowers/specs/2026-06-08-full-repo-codereview-design.md`
Plan: `docs/superpowers/plans/2026-06-08-full-repo-codereview.md`

## Scope

- `src/`
- `electron/`
- `lib/`
- `server.js`
- `runtime-paths.js`
- `scripts/`
- `tools/inject`
- `package.json`
- Windows build/package/release configuration and supporting scripts

## Method

- Phase 1: Runtime Backbone
- Phase 2: High-Change Product Surfaces
- Phase 3: Injection and Automation Chain
- Phase 4: Packaging and Release Path
- Phase 5: Architecture Debt and Test Debt Consolidation

## Phase Checkpoints

### Phase 1: Runtime Backbone

- Status: Pending
- Structural notes:
- Evidence:
- Findings:
- Checkpoint summary:

### Phase 2: High-Change Product Surfaces

- Status: Pending
- Structural notes:
- Evidence:
- Findings:
- Checkpoint summary:

### Phase 3: Injection and Automation Chain

- Status: Pending
- Structural notes:
- Evidence:
- Findings:
- Checkpoint summary:

### Phase 4: Packaging and Release Path

- Status: Pending
- Structural notes:
- Evidence:
- Findings:
- Checkpoint summary:

### Phase 5: Architecture Debt and Test Debt Consolidation

- Status: Pending
- Structural notes:
- Evidence:
- Findings:
- Checkpoint summary:

## Consolidated Findings

### Critical

### High

### Medium

### Low

## Module Risk Heatmap

| Area | Risk | Evidence |
| --- | --- | --- |

## Remediation Roadmap

### Immediate fixes

### Short-term cleanup

### Medium-term refactors
```

- [ ] **Step 2: Verify the new report file exists cleanly**

Run: `test -f docs/superpowers/reviews/2026-06-08-full-repo-codereview.md && sed -n '1,220p' docs/superpowers/reviews/2026-06-08-full-repo-codereview.md`

Expected: the scaffolded report prints with all five phase sections plus findings, heatmap, and roadmap sections.

- [ ] **Step 3: Commit the scaffold**

```bash
git add docs/superpowers/reviews/2026-06-08-full-repo-codereview.md
git commit -m "Create full-repo code review report scaffold"
```

---

### Task 2: Execute Phase 1 runtime backbone review and checkpoint it

**Files:**
- Modify: `docs/superpowers/reviews/2026-06-08-full-repo-codereview.md`

- [ ] **Step 1: Build the runtime backbone map with CodeGraph**

Use CodeGraph with this task description:

```text
Review BKToolBox runtime backbone: electron/main.js, preload, desktop bridge, server.js, runtime-paths.js, and lib runtime backbones used directly by Electron or Express startup paths.
```

Then inspect these files directly:

- `electron/main.js`
- `electron/preload.js`
- `electron/desktop-utils.js`
- `server.js`
- `runtime-paths.js`
- `lib/bidking-live-monitor.js`
- `lib/capture-driver.js`
- `lib/bidking-price-history-store.js`
- `lib/solver.js`

- [ ] **Step 2: Run the runtime-adjacent test slice**

Run: `npx vitest run electron/desktop-utils.test.mjs lib/bidking-live-monitor.test.mjs lib/capture-driver.test.mjs lib/bidking-price-history-store.test.mjs lib/solver.test.mjs`

Expected: PASS

- [ ] **Step 3: Record Phase 1 checkpoint in the report**

Update the `Phase 1: Runtime Backbone` section with:

- `Status: Complete`
- a short runtime data-flow summary
- the exact tests run
- any findings discovered with file references
- a checkpoint summary line that says either:
  - `No Critical issues found in Phase 1.`
  - or `Critical issue escalated during Phase 1 review.`

- [ ] **Step 4: Escalate immediately if a Critical issue is confirmed**

If a Critical issue is found, send a progress update before starting Phase 2 with exactly these five bullets:

- `Area:`
- `Problem:`
- `Impact:`
- `Evidence:`
- `Suggested next move:`

If no Critical issue is found, continue directly.

- [ ] **Step 5: Commit the Phase 1 checkpoint**

```bash
git add docs/superpowers/reviews/2026-06-08-full-repo-codereview.md
git commit -m "Checkpoint runtime backbone review findings"
```

---

### Task 3: Execute Phase 2 product-surface review and checkpoint it

**Files:**
- Modify: `docs/superpowers/reviews/2026-06-08-full-repo-codereview.md`

- [ ] **Step 1: Inspect the high-change product surfaces**

Use CodeGraph and direct file reads for:

- `src/home`
- `src/elsa`
- `src/ethan`
- `src/ahmed`
- `src/hero-estimator`
- `src/monitor`
- `src/price`
- `src/inject`
- `src/shared`

Focus on:

- state isolation
- shared state leakage
- UI-thread blocking paths
- duplicated business logic
- panel-to-panel consistency

- [ ] **Step 2: Run the front-end regression slice**

Run: `npx vitest run src/home/App.test.js src/elsa/App.test.js src/elsa/ElsaHeroPanel.test.js src/ahmed/App.test.js src/hero-estimator/HeroEstimatorPanel.test.js src/monitor/App.test.js src/price/App.test.js src/inject/App.test.js src/shared/TopBar.test.js src/shared/useMonitorSwitch.test.js src/shared/useAutoOperationAgentSwitch.test.js`

Expected: PASS

- [ ] **Step 3: Record Phase 2 checkpoint in the report**

Update the `Phase 2: High-Change Product Surfaces` section with:

- `Status: Complete`
- the major state/interaction boundaries observed
- the exact tests run
- confirmed findings with file references
- the top UI responsiveness or state-coupling risks

- [ ] **Step 4: Escalate immediately if a Critical issue is confirmed**

If a Critical issue is found, send the same Critical-update template used in Task 2 before starting Phase 3.

- [ ] **Step 5: Commit the Phase 2 checkpoint**

```bash
git add docs/superpowers/reviews/2026-06-08-full-repo-codereview.md
git commit -m "Checkpoint product surface review findings"
```

---

### Task 4: Execute Phase 3 injection and automation review and checkpoint it

**Files:**
- Modify: `docs/superpowers/reviews/2026-06-08-full-repo-codereview.md`

- [ ] **Step 1: Inspect the injection and automation chain**

Review these areas together:

- `tools/inject`
- `electron/services/inject-service.js`
- `electron/services/inject-scheduler.js`
- `electron/services/collection-price-scan-controller.js`
- injection- and automation-specific IPC handlers in `electron/main.js`
- `src/inject`
- `src/shared/useAutoOperationAgentSwitch.js`
- `src/shared/useMonitorSwitch.js`

Focus on:

- agent load/unload lifecycle
- stale state after crash or exit
- command contract consistency
- warehouse/listing/monitor integration boundaries
- environment assumptions versus real code defects

- [ ] **Step 2: Run the automation and inject regression slice**

Run: `npx vitest run electron/services/inject-service.test.mjs electron/services/inject-scheduler.test.mjs electron/services/collection-price-scan-controller.test.mjs src/inject/StockMovePanel.test.js src/inject/StockMoveListEditorModal.test.js src/inject/stock-move.test.js src/inject/stock-move-saved-list-draft.test.js src/shared/useAutoOperationAgentSwitch.test.js src/shared/useMonitorSwitch.test.js`

Expected: PASS

- [ ] **Step 3: Record Phase 3 checkpoint in the report**

Update the `Phase 3: Injection and Automation Chain` section with:

- `Status: Complete`
- the lifecycle model observed
- the exact tests run
- findings with file references
- any contract mismatches or zombie-state risks

- [ ] **Step 4: Escalate immediately if a Critical issue is confirmed**

If a Critical issue is found, send the same Critical-update template used in Task 2 before starting Phase 4.

- [ ] **Step 5: Commit the Phase 3 checkpoint**

```bash
git add docs/superpowers/reviews/2026-06-08-full-repo-codereview.md
git commit -m "Checkpoint injection chain review findings"
```

---

### Task 5: Execute Phase 4 packaging/release review and checkpoint it

**Files:**
- Modify: `docs/superpowers/reviews/2026-06-08-full-repo-codereview.md`

- [ ] **Step 1: Inspect the packaging and release path**

Read and analyze:

- `package.json`
- `scripts/pack-win-dir.mjs`
- `scripts/patch-win-icons.js`
- `scripts/deploy-unpacked-app.mjs`
- `scripts/prepare-dumpcap-runtime.mjs`
- `scripts/windows-build-metadata.test.mjs`
- related release sections in `docs/Documentation.md` and `docs/ARCHITECTURE.md`

Focus on:

- reproducibility
- path assumptions
- runtime resource bundling
- icon/resource patching
- Windows metadata versus code-signing boundaries
- configuration bugs versus environment-only failures

- [ ] **Step 2: Run the packaging regression slice**

Run: `npx vitest run scripts/pack-win-dir.test.mjs scripts/deploy-unpacked-app.test.mjs scripts/prepare-dumpcap-runtime.test.mjs scripts/windows-build-metadata.test.mjs electron/desktop-utils.test.mjs`

Expected: PASS

- [ ] **Step 3: Record Phase 4 checkpoint in the report**

Update the `Phase 4: Packaging and Release Path` section with:

- `Status: Complete`
- the major release-chain assumptions observed
- the exact tests run
- findings with file references
- a note distinguishing configuration defects from external requirements like code signing or Windows file locks

- [ ] **Step 4: Escalate immediately if a Critical issue is confirmed**

If a Critical issue is found, send the same Critical-update template used in Task 2 before starting Phase 5.

- [ ] **Step 5: Commit the Phase 4 checkpoint**

```bash
git add docs/superpowers/reviews/2026-06-08-full-repo-codereview.md
git commit -m "Checkpoint packaging review findings"
```

---

### Task 6: Consolidate findings, heatmap, and roadmap in Phase 5

**Files:**
- Modify: `docs/superpowers/reviews/2026-06-08-full-repo-codereview.md`

- [ ] **Step 1: Deduplicate root causes across phase checkpoints**

Review the five checkpoint sections and merge repeated symptoms into shared findings where appropriate. A repeated issue should only stay separate if the implementation cause is genuinely different.

- [ ] **Step 2: Fill the consolidated findings section**

Populate these sections in findings-first order:

- `### Critical`
- `### High`
- `### Medium`
- `### Low`

Each finding entry must include:

- problem
- impact
- file references
- why it is risky now
- suggested fix direction

- [ ] **Step 3: Fill the module risk heatmap**

Populate the heatmap table with at least these rows:

- `electron/main + preload + server`
- `src/shared + topbar/switch state`
- `src/elsa + src/ethan + src/hero-estimator`
- `src/price`
- `src/inject + electron/services`
- `tools/inject`
- `scripts + Windows packaging`
- `lib/ runtime and monitor modules`

Each row must end with a risk level and one evidence summary.

- [ ] **Step 4: Fill the remediation roadmap**

Group findings into:

- `Immediate fixes`
- `Short-term cleanup`
- `Medium-term refactors`

The roadmap must map directly back to the consolidated findings rather than introducing new unreviewed ideas.

- [ ] **Step 5: Mark Phase 5 complete and add the final checkpoint summary**

Update the `Phase 5: Architecture Debt and Test Debt Consolidation` section with:

- `Status: Complete`
- deduplication notes
- heatmap completion note
- roadmap completion note

- [ ] **Step 6: Run the final verification commands**

Run: `git diff --check`

Expected: no output

Run: `git status --short`

Expected: only the intended review report file is modified before the final commit.

- [ ] **Step 7: Commit the final review report**

```bash
git add docs/superpowers/reviews/2026-06-08-full-repo-codereview.md
git commit -m "Complete full-repo code review report"
```

---

## Self-Review

- Spec coverage:
  - repository-wide scope: Tasks 2-6
  - five-phase execution order: Tasks 2-6
  - findings-first output: Task 6
  - module heatmap: Task 6
  - phased remediation roadmap: Task 6
  - immediate escalation behavior: Tasks 2-5
  - explicit inclusion of `tools/inject`: Task 4
  - explicit inclusion of `src/home`, `src/monitor`, `src/shared`: Task 3
  - explicit treatment of `lib/` runtime backbones: Task 2 and Task 6
- Placeholder scan:
  - none
- Type consistency:
  - report path is consistently `docs/superpowers/reviews/2026-06-08-full-repo-codereview.md`
  - roadmap buckets are consistently `Immediate fixes`, `Short-term cleanup`, `Medium-term refactors`
  - Critical escalation uses one consistent template across phases
