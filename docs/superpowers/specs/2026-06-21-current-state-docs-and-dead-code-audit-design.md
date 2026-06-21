# Current-State Docs And Dead Code Audit Design

## Goal

Produce a single audit report for the current repository state that identifies:

- high-confidence outdated current-state documents
- high-confidence dead/retired code
- suspected outdated documents
- suspected dead/retired code

The output is an audit report only. It is not a cleanup implementation plan.

## Scope

This audit only covers:

- current-state top-level docs
  - `README.md`
  - `docs/Documentation.md`
  - `docs/ARCHITECTURE.md`
- user-facing formal manuals
  - `docs/AUTO_OPERATION_COMMANDS.md`
  - `docs/AUTO_OPERATION_MANUAL.md`
  - `docs/BIDKING_*.md`
  - `docs/CONTROLLER_PAGE_COMMAND_EXAMPLES.md`
- the current code surface needed to verify those docs and identify retired code
  - `src/`
  - `electron/`
  - `tools/`
  - `build/`
  - `server.js`

Out of scope:

- `docs/superpowers/plans/`
- `docs/superpowers/specs/`
- `docs/superpowers/reviews/`
- `Archive/`
- `tmp/`
- `coverage/`
- `.worktrees/`

## Audit Philosophy

The audit is evidence-first.

Each finding must be backed by a direct contradiction or a strong replacement signal:

- document statement vs. current code reality
- old code path vs. current replacement path
- exposed user-facing entry vs. no current route/caller/integration path

The audit must not label something as dead merely because:

- the code looks old
- the name looks legacy
- there is a newer implementation nearby
- the code is awkward or under-documented

## Finding Classes

### High-confidence outdated document

A document item qualifies only when:

- it presents itself as current-state or user-facing truth
- the statement is concrete
- current code, routes, UI entry points, or command surfaces contradict it

Examples:

- the doc says a panel or command is current, but the current UI no longer exposes it that way
- the doc says a route or build path is canonical, but the current runtime uses another path

### Suspected outdated document

A document item qualifies when:

- it appears stale or misaligned
- but the repository still contains compatibility behavior, conditional support, or incomplete evidence

These findings must explicitly state why the evidence is not fully closed.

### High-confidence dead/retired code

A code item qualifies only when all of the following are true:

- its former responsibility can be identified
- the current repository has a replacement path or a newer canonical surface
- the old code no longer has a meaningful current entry/caller/integration role

This class is for code that is effectively retired, not just secondary.

### Suspected dead/retired code

A code item qualifies when:

- it appears bypassed, shadowed, or compatibility-only
- but there is still some ambiguity around current use, fallback behavior, or external invocation

These findings must stay separate from the high-confidence group.

## Evidence Sources

The audit should prioritize:

1. current-state docs and formal manuals
2. current runtime entry points
   - `README.md`
   - `server.js`
   - `electron/main.js`
   - `electron/preload.js`
3. current user-visible app surfaces
   - `src/home/`
   - `src/elsa/`
   - `src/ethan/`
   - `src/ahmed/`
   - `src/monitor/`
   - `src/price/`
   - `src/inject/`
   - `src/shared/`
4. current automation/runtime surfaces
   - `tools/bkcli/`
   - `tools/inject/AutoOperation/`
   - `electron/services/`
   - `build/`

## Audit Method

### Step 1: extract current-state claims

Read the scoped docs and collect concrete claims about:

- canonical pages and routes
- visible panels and user workflows
- supported commands and command groupings
- build and pack flows
- runtime ownership and integration boundaries
- tool entry points and operational instructions

### Step 2: verify against current implementation

Check each claim against the current code surface:

- routes and page mounts
- panel composition and visible tabs
- command dispatch and current bridge surfaces
- preload APIs and Electron services
- current `bkcli` and agent command entry points

### Step 3: detect retired code candidates

Within the same scoped code surface, identify code that appears retired by checking:

- lack of callers
- lack of current UI or runtime entry
- presence of a newer canonical path
- incompatibility with current docs and current page composition

### Step 4: classify with confidence

Each candidate must end in exactly one of:

- high-confidence outdated document
- suspected outdated document
- high-confidence dead/retired code
- suspected dead/retired code

## Report Structure

The final audit report should have these sections:

1. scope and method
2. high-confidence outdated documents
3. high-confidence dead/retired code
4. suspected outdated documents / suspected dead code
5. short optional next actions

Each finding should include:

- item title
- affected file(s)
- evidence
- why it is classified at that confidence level

## Prioritization

Prioritize findings in this order:

1. current-state or formal docs that actively mislead maintainers or users
2. dead/retired code that still occupies a named surface near current workflows
3. lower-confidence leftovers that deserve follow-up but not immediate cleanup

## Non-Goals

This audit does not:

- produce deletion patches
- refactor the codebase
- rewrite all docs
- audit historical design records
- judge code quality outside the stale/dead-code question

## Completion Criteria

The work is complete when:

- the scoped docs have been compared against current code surfaces
- the report contains only evidence-backed findings
- high-confidence and suspected findings are clearly separated
- no claim relies only on intuition or naming conventions
