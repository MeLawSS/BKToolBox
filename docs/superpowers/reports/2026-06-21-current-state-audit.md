# Current-State Docs And Dead-Code Audit

## Scope And Method

This report currently contains the report skeleton and the opening scope/method statement only. The later section headings are intentional placeholders for evidence-backed findings that are added in subsequent audit tasks.

This audit covers only current-state documents and formal user-facing/operator manuals that describe the repository's present behavior, supported surfaces, or current operating workflow.

Audited current-state documents:

- `README.md`
- `docs/Documentation.md`
- `docs/ARCHITECTURE.md`

Audited formal user-facing/operator manuals:

- `docs/AUTO_OPERATION_MANUAL.md`
- `docs/AUTO_OPERATION_COMMANDS.md`
- `docs/CONTROLLER_PAGE_COMMAND_EXAMPLES.md`

Candidate `docs/BIDKING_*.md` files were reviewed during the document inventory, but they are not treated in this report as formal user-facing/operator manuals:

- `docs/BIDKING_GAME_LOG_REVERSE_ENGINEERING.md`
- `docs/BIDKING_REALTIME_PROTOCOL_SCHEMA.md`
- `docs/BIDKING_SKILL_PARSE_SUPPORT.md`

Those three files function as reverse-engineering notes, protocol reference material, and parser/support evidence. They do not present themselves as the canonical current manual for repository users or operators.

Verification surface for later findings is limited to the current implementation areas that can confirm or contradict document claims:

- runtime/server entry:
  - `server.js`
- Electron desktop boundary:
  - `electron/main.js`
  - `electron/preload.js`
  - relevant files under `electron/services/`
- current page and workspace implementations:
  - relevant files under `src/home/`
  - relevant files under `src/elsa/`
  - relevant files under `src/ethan/`
  - relevant files under `src/ahmed/`
  - relevant files under `src/monitor/`
  - relevant files under `src/price/`
  - relevant files under `src/inject/`
  - relevant files under `src/shared/`
- current automation/tooling surfaces:
  - relevant files under `tools/`
  - relevant files under `build/`

Excluded from scope:

- `docs/superpowers/*`
- `Archive/`
- `tmp/`
- `coverage/`
- `.worktrees/`

Method:

1. Read the scoped documents and extract concrete claims about current routes, visible pages/panels, command surfaces, runtime ownership, build/pack flow, and operator workflow.
2. Check each claim against the current implementation surface named above.
3. Record a document finding only when the repository contains direct implementation evidence that contradicts the document claim, or direct implementation evidence that a different current surface now owns the documented responsibility.
4. Record a dead/retired-code finding only when the repository contains direct evidence of both:
   - a current replacement or surviving canonical path
   - no remaining current entry point, caller chain, or user-facing integration for the older path within the audited surface
5. Keep confidence split explicit:
   - `High-Confidence` means the contradiction, replacement, or loss of live integration is directly demonstrated by the current repository state.
   - `Suspected` means the repository shows stale or bypassed signals, but the audit still finds an unresolved caller, compatibility path, fallback behavior, or other concrete evidence that prevents a stronger classification.

This report is evidence-first. A finding must cite observable repository facts from the audited documents and verification surface. Age, naming, code style, apparent legacy status, or proximity to a newer implementation are not sufficient evidence on their own.

## High-Confidence Outdated Documents

## High-Confidence Dead/Retired Code

## Suspected Outdated Documents / Suspected Dead Code

## Optional Next Actions
