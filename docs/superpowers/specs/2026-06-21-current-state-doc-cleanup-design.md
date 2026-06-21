# Current-State Document Cleanup Design

## Goal

Apply the 2026-06-21 audit report to the repository in a narrowly scoped cleanup pass that:

- fixes only the high-confidence outdated current-state documents
- does not delete code based on suspected-only evidence
- records the current `BKAutoOpClient` status clearly enough that future audits do not re-open the same ambiguity from scratch

This is a cleanup spec, not a broad documentation rewrite.

## Inputs

This cleanup is driven by:

- `docs/superpowers/reports/2026-06-21-current-state-audit.md`

The audit report is the source of truth for what qualifies as:

- high-confidence outdated document
- suspected dead/retired code

## Scope

In scope:

- `docs/Documentation.md`
- `docs/ARCHITECTURE.md`
- `docs/AUTO_OPERATION_MANUAL.md`
- `docs/AUTO_OPERATION_COMMANDS.md`
- one current-state note about `BKAutoOpClient` status if needed to preserve audit clarity

Out of scope:

- deleting `tools/inject/AutoOperation/BKAutoOpClient/`
- changing `package.json` pack filters
- changing Electron, CLI, Agent, or Inject runtime behavior
- rewriting unrelated sections of the current-state docs
- editing historical specs, plans, or review records to match the cleanup

## Cleanup Philosophy

This pass is evidence-aligned, not aspirational.

That means:

- if the current shipped surface changed, the current-state docs must match it
- if a command is currently registered in the Agent dispatch table, the manual inventory must include it
- if a code path is only suspected dead, this pass must not silently delete it

This pass should prefer precise local corrections over editorial expansion.

## Decision Summary

### Decision 1: fix only the four high-confidence document findings

The cleanup will update exactly the document surfaces named by the audit:

1. stale Inject MetaOperation panel exposure in `docs/Documentation.md`
2. missing warehouse auto-sort surface in `docs/Documentation.md`
3. missing warehouse auto-sort surface in `docs/ARCHITECTURE.md`
4. incomplete AutoOperation dispatch-table inventories in `docs/AUTO_OPERATION_MANUAL.md` and `docs/AUTO_OPERATION_COMMANDS.md`

No other audit items are promoted into this pass.

### Decision 2: `BKAutoOpClient` is not deletable in this pass

`BKAutoOpClient` is still classified as suspected dead/retired code, not high-confidence dead code.

The decisive current-state fact is:

- the repository does not show any current in-repo caller chain for `BKAutoOpClient`
- but `package.json` still packages `tools/inject/**/*.dll` into runtime resources
- current `dist/*/resources/runtime/tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.dll` confirms the DLL is still distributed in built app output

Therefore this pass must treat `BKAutoOpClient` as:

- no current in-repo caller
- still a distributed runtime artifact
- not safe to delete as a no-risk dead-code cleanup

### Decision 3: clarify `BKAutoOpClient` status, do not change behavior

This pass may add or adjust one current-state note so the repository clearly states:

- `BKAutoOpClient` has no known in-repo integration path
- it still remains in packaged runtime resources under the current pack configuration

The note is documentation only. It must not be paired with code deletion, directory moves, or build filtering changes.

## File-Level Design

### `docs/Documentation.md`

Update only the current-state facts that the audit proved stale:

- replace the outdated Inject MetaOperation command exposure description
- reflect the current `InjectMetaOperationPanel.vue` surface:
  - 12 zero-arg commands:
    - `GoToBattlePrev`
    - `OpenSkillConfig`
    - `SelectRole`
    - `StartAction`
    - `GetBidState`
    - `PlaceBid`
    - `ConfirmBid`
    - `DismissRewardsBox`
    - `DismissCollectAward`
    - `GetCurrentScreen`
    - `CloseCurrentOverlay`
    - `CollectCabinetReward`
  - plus parameterized `EnterRoom`
  - plus parameterized `SetBidAmount`
- update the Controller panel composition so it no longer describes only `UI 操作` + generic command console
- explicitly mention the current warehouse auto-sort surface under Controller

Do not rewrite unrelated Inject sections just for style consistency.

### `docs/ARCHITECTURE.md`

Update the current Inject Controller composition description so it reflects the real shell:

- readiness cards
- `InjectUiAutomationPanel.vue`
- generic command console
- `InjectWarehouseBatchOpPanel.vue`

The architecture note should describe the warehouse auto-sort panel as a current child surface of Controller, not a future idea and not a separate top-level panel.

### `docs/AUTO_OPERATION_MANUAL.md`

Refresh the current dispatch-table inventory so it matches the commands currently registered in `BKAutoOpAgent.cpp`.

The cleanup must add the omitted currently registered commands:

- `DescribeNodeComponents`
- `DescribeNodeComponentMethods`
- `DescribeNodeComponentMethodSignatures`
- `DescribeNodeComponentFields`
- `DescribeClassMethodSignatures`
- `CallNodeComponentMethod`
- `InvokeNodeComponentMethod`
- `SetExpectedPrice`
- `CancelAutoAuction`

The manual must keep its current role split:

- low-level / infrastructure commands
- MetaOperation
- AggregateOperation
- operator surfaces

But it should not invent new category semantics beyond what the current text already uses.

### `docs/AUTO_OPERATION_COMMANDS.md`

Refresh the flat “current dispatch table contains” inventory so it includes the same omitted currently registered commands listed above.

This file stays transport/protocol focused. The cleanup should not broaden it into another overview manual.

### `BKAutoOpClient` current-state note

If the cleanup adds a note, it should live in an appropriate current-state document rather than in a historical spec.

The note should state three facts only:

1. no current in-repo caller/integration path was found
2. the DLL is still packaged by the current `extraResources` filter
3. deletion would require a separate change that intentionally alters packaged runtime contents

The note must not speculate about unknown external consumers beyond that boundary.

## Non-Goals

This cleanup does not:

- decide the long-term fate of `BKAutoOpClient`
- remove `BKAutoOpClient.dll` from packaged output
- change `electron/services/inject-service.js`, `tools/bkcli/`, or `BKAutoOpAgent.cpp`
- normalize every historical verification bullet in `docs/Documentation.md`
- rewrite the AutoOperation manuals end-to-end

## Verification

This cleanup is complete when all of the following are true:

1. the four high-confidence document findings from the audit are resolved in the tracked docs
2. no code or pack-behavior changes are introduced as part of the `BKAutoOpClient` clarification
3. `git diff --check` stays clean
4. a targeted text re-read shows:
   - `docs/Documentation.md` no longer claims the old seven-command MetaOperation surface
   - `docs/Documentation.md` and `docs/ARCHITECTURE.md` both acknowledge the warehouse auto-sort Controller surface
   - `docs/AUTO_OPERATION_MANUAL.md` and `docs/AUTO_OPERATION_COMMANDS.md` include the omitted currently registered commands

## Completion Criteria

The cleanup design is satisfied when implementation can make a single focused documentation-only patch that:

- resolves the high-confidence stale-doc findings
- preserves the suspected-only status of `BKAutoOpClient`
- leaves runtime behavior and packaged contents unchanged
