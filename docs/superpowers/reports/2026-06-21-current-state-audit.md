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

### [Inject MetaOperation panel command list is stale]

- Files: `docs/Documentation.md`, `src/inject/panels/InjectMetaOperationPanel.vue`
- Current doc claim: `InjectMetaOperationPanel.vue` directly exposes seven MetaOperation commands: `GoToBattlePrev`, `EnterRoom`, `OpenSkillConfig`, `SelectRole`, `StartAction`, `GetBidState`, and `PlaceBid`.
- Current implementation evidence: `InjectMetaOperationPanel.vue` now exposes 12 zero-arg commands in `ZERO_ARG_ACTIONS` (`GoToBattlePrev`, `OpenSkillConfig`, `SelectRole`, `StartAction`, `GetBidState`, `PlaceBid`, `ConfirmBid`, `DismissRewardsBox`, `DismissCollectAward`, `GetCurrentScreen`, `CloseCurrentOverlay`, `CollectCabinetReward`) and also renders separate submit actions for `EnterRoom` and `SetBidAmount`.
- Classification: high-confidence outdated document
- Reason: The document makes a concrete current-surface claim about which commands the panel exposes, and the current panel implementation exposes materially more commands than documented.

### [Inject Controller composition omits the warehouse auto-sort surface]

- Files: `docs/Documentation.md`, `docs/ARCHITECTURE.md`, `src/inject/panels/InjectControllerPanel.vue`, `src/inject/panels/InjectWarehouseBatchOpPanel.vue`, `src/inject/useWarehouseBatchOp.js`
- Current doc claim: `docs/Documentation.md` describes the current Controller surface as `UI 操作` plus the generic command console under `InjectControllerPanel.vue`; `docs/ARCHITECTURE.md` similarly describes the current Controller shell as readiness cards plus the UI-automation shell / generic command-console path.
- Current implementation evidence: `InjectControllerPanel.vue` renders `<InjectWarehouseBatchOpPanel />` in addition to `InjectUiAutomationPanel` and the generic command console. `InjectWarehouseBatchOpPanel.vue` is a visible `仓库自动排序` surface with start/stop/clear controls, and `useWarehouseBatchOp.js` runs a multi-step warehouse-sorting automation flow over `GetCurrentScreen`, `CloseCurrentOverlay`, `GetStockContainers`, and `ClickNode`.
- Classification: high-confidence outdated document
- Reason: `docs/Documentation.md` makes a strong current-state composition claim for the Controller surface that is now incomplete, and `docs/ARCHITECTURE.md` collapses the live Controller surface down to the UI-automation shell plus generic console path, omitting the current warehouse auto-sort child surface.

### [AutoOperation dispatch-table inventories are incomplete]

- Files: `docs/AUTO_OPERATION_MANUAL.md`, `docs/AUTO_OPERATION_COMMANDS.md`, `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Current doc claim: `docs/AUTO_OPERATION_MANUAL.md` says “The current dispatch table in BKAutoOpAgent.cpp registers all of these command groups” and then lists grouped command inventories; `docs/AUTO_OPERATION_COMMANDS.md` says “The current dispatch table contains” and then lists a flat dispatch-table command list.
- Current implementation evidence: `BKAutoOpAgent.cpp` currently registers additional commands that both inventories omit: `DescribeNodeComponents`, `DescribeNodeComponentMethods`, `DescribeNodeComponentMethodSignatures`, `DescribeNodeComponentFields`, `DescribeClassMethodSignatures`, `CallNodeComponentMethod`, `InvokeNodeComponentMethod`, `SetExpectedPrice`, and `CancelAutoAuction`.
- Classification: high-confidence outdated document
- Reason: The manual presents a grouped current inventory but omits commands that are already present in the asserted dispatch table, and the commands reference presents a flat current dispatch-table list but likewise omits currently registered commands.

## High-Confidence Dead/Retired Code

## Suspected Outdated Documents / Suspected Dead Code

## Optional Next Actions
