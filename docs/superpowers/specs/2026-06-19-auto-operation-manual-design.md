# AutoOperation Manual Design

Date: 2026-06-19
Status: Approved for planning

## Goal

Add one official manual at `docs/AUTO_OPERATION_MANUAL.md` that explains the current, implemented AutoOperation stack across:

- `tools/bkcli/`
- `tools/inject/AutoOperation/BKAutoOpAgent/`
- native `MetaOperation` commands
- native `AggregateOperation` commands

The manual must document current facts only. It must not present reverse-engineering guesses, future design intent, or planned APIs as if they already exist.

## Context

The repository already contains several related but fragmented documents:

- `tools/bkcli/README.md` — CLI-oriented usage notes
- `docs/AUTO_OPERATION_COMMANDS.md` — protocol and command reference
- `docs/CONTROLLER_PAGE_COMMAND_EXAMPLES.md` — Controller page examples
- `docs/Documentation.md` / `docs/ARCHITECTURE.md` — current-state notes

These documents do not currently provide one entry point that answers all of the following together:

1. What `bkcli` currently does
2. What `BKAutoOpAgent` currently owns
3. Which commands are business-level `MetaOperation`
4. Which commands are multi-step `AggregateOperation`
5. How these layers relate to one another

## Non-Goals

- Redesigning the AutoOperation protocol
- Renaming commands or normalizing inconsistent terminology in code
- Expanding command coverage beyond what is currently registered in `BKAutoOpAgent.cpp`
- Replacing the detailed protocol reference in `docs/AUTO_OPERATION_COMMANDS.md`
- Writing speculative guidance about unreleased operations or future workflow panels

## Current-Fact Rules

The manual must follow these rules:

- Every statement should trace to code or an already-shipped doc that itself reflects shipped code.
- When multiple layers differ, the manual should describe the difference instead of smoothing it over.
- The manual should use “currently”, “now”, or “the current dispatch table” when the scope is implementation state rather than protocol law.
- If a command exists in the native dispatch table but is not exposed in the Inject MetaOperation panel, the manual should say so explicitly.
- If a helper exists only in `bkcli`, the manual should say that it is a CLI wrapper rather than a native Agent command.

## Proposed Output

Create:

```text
docs/AUTO_OPERATION_MANUAL.md
```

Keep existing detailed docs in place and position the new manual as the top-level entry point.

## Document Audience

The manual serves two audiences in one file:

- developers extending the AutoOperation stack
- operators or maintainers using `bkcli`, Controller, or Inject MetaOperation entry points

Because the user requested one total document, the structure should move from architecture to usage, rather than splitting into separate files.

## Proposed Structure

### 1. Overview

Explain the current stack in one page:

- `bkcli` as a standalone developer CLI
- Electron preload / service bridge as the desktop app entry point
- `BKAutoOpAgent.dll` as the injected named-pipe server
- `MetaOperations.cpp` as the home of higher-level business commands
- aggregate commands as the subset of native commands that orchestrate multiple lower-level UI steps internally

This section should also define the practical layering:

```text
bkcli / Inject panels / Controller
    -> pipe command caller
    -> BKAutoOpAgent dispatch table
    -> base commands / MetaOperation / AggregateOperation
```

### 2. Shared Foundations

Document the facts shared by all four areas:

- DLL path and injection entry
- named pipe name
- request/response envelope shape
- one-shot command model
- where timeout behavior is currently derived
- where Agent logs are currently written

This section should point readers to `docs/AUTO_OPERATION_COMMANDS.md` for full field-level protocol details rather than duplicating every command payload example.

### 3. `bkcli`

Document:

- what the CLI is for
- current prerequisites
- current command groups
- which subcommands call native commands directly
- which subcommands are wrappers around injection, shellcode injection, or probe loading

The manual should map the implemented CLI subcommands in `tools/bkcli/bkcli.js` to their actual downstream behavior, including currently exposed business commands such as:

- `get-current-screen`
- `dismiss-rewards-box`
- `dismiss-collect-award`
- `close-current-overlay`
- `collect-cabinet-reward`
- `auto-auction`

### 4. `BKAutoOperationAgent`

Document the current native ownership boundary:

- dispatch table location
- base UI / warehouse / exchange commands
- `LoadProbe`
- `UnloadAgent`
- the split between `BKAutoOpAgent.cpp` and `MetaOperations.cpp`

This section should describe the Agent as the authoritative native command host and should include the current dispatch table categories, not just one flat list.

### 5. `MetaOperation`

Document `MetaOperation` as the current business-command layer implemented in native code.

This section should distinguish three different sets because they are not identical:

1. commands implemented in `MetaOperations.cpp`
2. commands registered in the native dispatch table
3. commands currently exposed in `src/inject/panels/InjectMetaOperationPanel.vue`

The manual should not assume these differences from older docs. It must derive the current sets from code.

The manual should explicitly reflect the current reality:

- the Inject MetaOperation panel already exposes most human-facing meta commands implemented in native code, including `ConfirmBid`, `DismissRewardsBox`, `DismissCollectAward`, `GetCurrentScreen`, `CloseCurrentOverlay`, and `CollectCabinetReward`
- `AutoAuction` is currently registered in the native dispatch table and available through `bkcli`, but not exposed in the Inject MetaOperation panel
- `LoadProbe` is also in the native dispatch table, but it belongs to probe loading infrastructure rather than MetaOperation and must not be mixed into the MetaOperation difference set

Because `MetaOperations.cpp` now contains both meta-style commands and aggregate-style commands, the manual should classify commands by current behavior and exposure, not by source file membership alone.

### 6. `AggregateOperation`

Document only what currently qualifies by implementation fact.

At the moment, the manual should describe `AggregateOperation` as the native multi-step orchestration layer represented by commands that internally chain multiple UI actions and waits, rather than as a separate transport or module. Based on the current code, that section should at minimum cover:

- `CollectCabinetReward`
- `AutoAuction`

The manual should explain that these are still ordinary pipe commands in the same dispatch table, but their internal behavior is aggregate because they orchestrate multiple lower-level steps before returning.

### 7. Entry Points and Cross-References

End the manual with a navigation section that tells readers where to go next:

- `docs/AUTO_OPERATION_COMMANDS.md` for full command contracts
- `docs/CONTROLLER_PAGE_COMMAND_EXAMPLES.md` for Controller-side examples
- `tools/bkcli/README.md` for CLI-first examples

## Content Style

The manual should be:

- factual
- implementation-oriented
- explicit about boundaries and differences
- concise enough to scan

Avoid:

- speculative roadmap content
- reverse-engineering narrative unless required to explain an already-shipped command
- duplicated full JSON examples for every command already covered in `docs/AUTO_OPERATION_COMMANDS.md`

## Required Repository Changes

This documentation round should include:

- a new `docs/AUTO_OPERATION_MANUAL.md`
- a short link addition near the top of:
  - `docs/AUTO_OPERATION_COMMANDS.md`
  - `docs/CONTROLLER_PAGE_COMMAND_EXAMPLES.md`
  - `tools/bkcli/README.md`

Those additions should present the new manual as the primary overview without removing the detailed role of the existing files.

## Verification

This is a documentation-only change. Verification should focus on factual consistency:

1. Re-read:
   - `tools/bkcli/bkcli.js`
   - `tools/bkcli/inject.js`
   - `tools/bkcli/shellcode.js`
   - `tools/bkcli/probe.js`
   - `tools/bkcli/README.md`
   - `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
   - `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
   - `src/inject/panels/InjectMetaOperationPanel.vue`
   - `docs/AUTO_OPERATION_COMMANDS.md`
   - `docs/CONTROLLER_PAGE_COMMAND_EXAMPLES.md`
2. Confirm the manual's command lists match the current code rather than older specs.
3. Confirm the manual's `bkcli` section describes injection / shellcode / probe wrappers from their implementation files, not only from README text.
4. Confirm the manual never claims Inject MetaOperation exposes commands that are only present in native code.
5. Run `git diff --check`.

## Acceptance Criteria

The work is complete when:

1. `docs/AUTO_OPERATION_MANUAL.md` exists as one official overview manual.
2. The manual explains `bkcli`, `BKAutoOperationAgent`, `MetaOperation`, and `AggregateOperation` in one coherent structure.
3. The document describes current implementation facts only.
4. Existing detailed docs link back to the new manual as the overview entry point.
5. `git diff --check` reports no patch-format issues.
