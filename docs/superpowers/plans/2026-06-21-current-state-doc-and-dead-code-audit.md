# Current-State Doc And Dead-Code Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a committed audit report that identifies high-confidence and suspected outdated docs / dead code for the current-state docs and formal user-facing manuals only.

**Architecture:** Treat the audit as an evidence pipeline: first extract concrete claims from scoped docs, then verify each claim against current routes, page composition, command surfaces, and runtime entry points, then classify findings by confidence and write a repository-tracked report. Keep historical `docs/superpowers/*` content and archive/temporary directories out of scope throughout.

**Tech Stack:** Markdown, ripgrep, Git, PowerShell, CodeGraph, Electron/Vue/Node repository structure

---

### Task 1: Build The Scoped Document Inventory

**Files:**
- Read: `README.md`
- Read: `docs/Documentation.md`
- Read: `docs/ARCHITECTURE.md`
- Read: `docs/AUTO_OPERATION_COMMANDS.md`
- Read: `docs/AUTO_OPERATION_MANUAL.md`
- Read: `docs/BIDKING_GAME_LOG_REVERSE_ENGINEERING.md`
- Read: `docs/BIDKING_REALTIME_PROTOCOL_SCHEMA.md`
- Read: `docs/BIDKING_SKILL_PARSE_SUPPORT.md`
- Read: `docs/CONTROLLER_PAGE_COMMAND_EXAMPLES.md`
- Create: `docs/superpowers/reports/2026-06-21-current-state-audit.md`

- [ ] **Step 1: Create the report skeleton before collecting evidence**

Create `docs/superpowers/reports/2026-06-21-current-state-audit.md` with this initial structure:

```md
# Current-State Docs And Dead-Code Audit

## Scope And Method

## High-Confidence Outdated Documents

## High-Confidence Dead/Retired Code

## Suspected Outdated Documents / Suspected Dead Code

## Optional Next Actions
```

- [ ] **Step 2: Read the scoped docs and capture claim categories**

Run:

```powershell
Get-Content README.md
Get-Content docs\Documentation.md
Get-Content docs\ARCHITECTURE.md
Get-Content docs\AUTO_OPERATION_COMMANDS.md
Get-Content docs\AUTO_OPERATION_MANUAL.md
Get-Content docs\BIDKING_GAME_LOG_REVERSE_ENGINEERING.md
Get-Content docs\BIDKING_REALTIME_PROTOCOL_SCHEMA.md
Get-Content docs\BIDKING_SKILL_PARSE_SUPPORT.md
Get-Content docs\CONTROLLER_PAGE_COMMAND_EXAMPLES.md
```

Expected: enough source text to extract concrete claims about routes, panels, commands, build/pack flow, runtime ownership, and user-facing operation flow.

- [ ] **Step 3: Decide which `docs/BIDKING_*.md` files are actually formal manuals**

Use this rule while reading:

```text
If the file reads like a current user-facing reference/manual, keep it in-scope.
If it reads like reverse-engineering notes, protocol notes, or internal evidence, mention it in the report's scope note and do not treat it as a formal manual finding source.
```

- [ ] **Step 4: Fill the report's scope-and-method section**

Write the opening section so it explicitly records:

```md
- audited docs: `README.md`, `docs/Documentation.md`, `docs/ARCHITECTURE.md`, and the formal manuals that actually qualify as user-facing references
- verification surfaces: `server.js`, `electron/`, `src/`, `tools/`, `build/`
- excluded areas: `docs/superpowers/*`, `Archive/`, `tmp/`, `coverage/`, `.worktrees/`
- confidence split: high-confidence vs suspected
```

- [ ] **Step 5: Commit the initial report scaffold and scope note**

```bash
git add docs/superpowers/reports/2026-06-21-current-state-audit.md
git commit -m "docs(audit): scaffold current-state audit report"
```

### Task 2: Verify Current-State Document Claims Against Live Code Surfaces

**Files:**
- Read: `server.js`
- Read: `electron/main.js`
- Read: `electron/preload.js`
- Read: `electron/services/`
- Read: `src/home/`
- Read: `src/elsa/`
- Read: `src/ethan/`
- Read: `src/ahmed/`
- Read: `src/monitor/`
- Read: `src/price/`
- Read: `src/inject/`
- Read: `src/shared/`
- Modify: `docs/superpowers/reports/2026-06-21-current-state-audit.md`

- [ ] **Step 1: Verify route and page-entry claims**

Run:

```powershell
rg -n "app\.get\(|app\.use\(|/Tools|/Monitor|/Price|/Inject|/Elsa|/Ahmed|/Ethan" server.js
rg -n "Home|Tools|Monitor|Price|Inject|Ahmed|Ethan|Elsa" src\home src\shared src\elsa src\ahmed src\ethan
```

Expected: a current picture of canonical routes, compatibility routes, and visible navigation/page entry points.

- [ ] **Step 2: Verify current panel composition and current visible Inject surfaces**

Run:

```powershell
rg -n "cabinet|agent|controller|meta|warehouse|listing|delayed|collection|stock-move|uiAutomation" src\inject
Get-Content src\inject\App.vue
Get-Content src\inject\panels\InjectControllerPanel.vue
Get-Content src\inject\panels\InjectMetaOperationPanel.vue
```

Expected: direct evidence for the current panel list, workspace grouping, controller responsibilities, and meta-operation exposure.

- [ ] **Step 3: Verify AutoOperation / command-surface claims**

Run:

```powershell
rg -n "DumpPanelTree|WaitForVisiblePanel|WaitForNode|ClickNode|SetInputText|GetNodeState|GoToBattlePrev|EnterRoom|OpenSkillConfig|SelectRole|StartAction|GetBidState|PlaceBid|CollectCabinetReward|AutoAuction" electron src tools docs
Get-Content docs\AUTO_OPERATION_COMMANDS.md
Get-Content docs\AUTO_OPERATION_MANUAL.md
```

Expected: enough evidence to detect when a formal manual or command guide still claims an outdated command set or outdated exposure path.

- [ ] **Step 4: Add only evidence-backed document findings to the report**

For each accepted finding, write it in this format:

```md
### [Finding title]

- Files: `path/to/doc`, `path/to/code`
- Current doc claim: ...
- Current implementation evidence: ...
- Classification: high-confidence outdated document | suspected outdated document
- Reason: ...
```

- [ ] **Step 5: Commit the document-findings pass**

```bash
git add docs/superpowers/reports/2026-06-21-current-state-audit.md
git commit -m "docs(audit): record current-state document findings"
```

### Task 3: Identify Dead / Retired Code Candidates Within The Same Surface

**Files:**
- Read: `src/`
- Read: `electron/`
- Read: `tools/`
- Read: `build/`
- Modify: `docs/superpowers/reports/2026-06-21-current-state-audit.md`

- [ ] **Step 1: Enumerate replacement paths before calling anything dead**

Use CodeGraph first for likely candidates that appear shadowed by newer paths:

```powershell
codegraph explore "legacy wrapper compatibility shell standalone wrapper current canonical path inject panels auto operation bkcli"
```

Expected: a first-pass map of symbols/files that still exist near current workflows but may no longer be on the live path.

- [ ] **Step 2: Verify callers and current entry points for each candidate**

Run focused searches per candidate, for example:

```powershell
rg -n "<candidate-symbol-or-file-stem>" src electron tools build server.js README.md docs
git grep -n "<candidate-symbol-or-file-stem>"
```

Expected: proof of one of these outcomes:

- no meaningful current caller or entry point
- only compatibility/documentation mentions remain
- the only caller is itself dead, allowing transitive high-confidence classification

- [ ] **Step 3: Add dead-code findings with explicit replacement evidence**

For each accepted finding, write it in this format:

```md
### [Finding title]

- Files: `path/to/code`
- Former role: ...
- Current replacement path: ...
- Current live-path evidence: ...
- Classification: high-confidence dead/retired code | suspected dead/retired code
- Reason: ...
```

- [ ] **Step 4: Reject weak candidates instead of padding the report**

Apply this filter:

```text
If the code still has a plausible live caller, runtime fallback, or current user-facing integration,
do not upgrade it to high-confidence dead code.
If the evidence is interesting but incomplete, move it to the suspected section or drop it entirely.
```

- [ ] **Step 5: Commit the dead-code findings pass**

```bash
git add docs/superpowers/reports/2026-06-21-current-state-audit.md
git commit -m "docs(audit): record dead-code findings"
```

### Task 4: Validate The Final Audit Report And Close It Out

**Files:**
- Modify: `docs/superpowers/reports/2026-06-21-current-state-audit.md`

- [ ] **Step 1: Re-read the approved spec and cross-check every report section**

Run:

```powershell
Get-Content docs\superpowers\specs\2026-06-21-current-state-docs-and-dead-code-audit-design.md
Get-Content docs\superpowers\reports\2026-06-21-current-state-audit.md
```

Expected: every finding fits the approved scope and confidence model.

- [ ] **Step 2: Verify the report contains only evidence-backed findings**

Run:

```powershell
rg -n "high-confidence|suspected|Current doc claim|Current implementation evidence|Current replacement path|Reason:" docs\superpowers\reports\2026-06-21-current-state-audit.md
```

Expected: each finding includes evidence and explicit classification rather than impressionistic commentary.

- [ ] **Step 3: Run formatting and patch sanity checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace/patch errors, and only the audit report is pending unless the operator intentionally kept extra audit notes.

- [ ] **Step 4: Write the final optional-next-actions section**

Add only short follow-ups, for example:

```md
- rewrite the outdated current-state docs called out above
- decide whether each suspected dead-code candidate should be promoted to a cleanup task
- keep formal manuals and current-state docs synchronized when command surfaces change
```

- [ ] **Step 5: Commit the finished audit report**

```bash
git add docs/superpowers/reports/2026-06-21-current-state-audit.md
git commit -m "docs(audit): finalize current-state stale-doc and dead-code report"
```

## Self-Review

- Spec coverage: the plan covers scoped docs, verification surfaces, confidence split, report path, and tracked-report requirement from the approved spec.
- Placeholder scan: no `TODO`/`TBD` placeholders remain; every task has exact files, commands, and report structure.
- Type consistency: the plan consistently uses the approved report path `docs/superpowers/reports/2026-06-21-current-state-audit.md` and the approved confidence classes.
