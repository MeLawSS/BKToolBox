# AutoOperation Manual

This is the current overview manual for BidKing's AutoOperation stack.

Use this file first when you need to answer:

- what `bkcli` currently does
- what `BKAutoOpAgent.dll` currently owns
- which commands are low-level pipe commands
- which commands are business-style `MetaOperation`
- which commands are native multi-step `AggregateOperation`
- which surfaces currently expose which commands

For detailed payload contracts, use [`docs/AUTO_OPERATION_COMMANDS.md`](./AUTO_OPERATION_COMMANDS.md). For Controller-side copy/paste examples, use [`docs/CONTROLLER_PAGE_COMMAND_EXAMPLES.md`](./CONTROLLER_PAGE_COMMAND_EXAMPLES.md). For CLI-first examples, use [`tools/bkcli/README.md`](../tools/bkcli/README.md).

## Overview

The current AutoOperation stack is layered like this:

```text
bkcli / Inject panels / Controller
    -> pipe command caller
    -> BKAutoOpAgent dispatch table
    -> base commands / MetaOperation / AggregateOperation
```

Current roles:

- `tools/bkcli/` is a standalone developer/operator CLI.
- Electron preload + `electron/services/inject-service.js` are the desktop app bridge.
- `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll` is the injected native named-pipe server.
- `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` owns the pipe server, dispatch table, most low-level commands, and infrastructure commands.
- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` owns the current business-oriented room / bidding / reward commands and also contains the current aggregate multi-step commands.

Two practical boundaries matter:

- Transport boundary: everything exposed through the Agent is still an ordinary named-pipe command in one shared dispatch table.
- Behavior boundary: some commands are single-step primitives, while some are native orchestration commands that chain multiple UI actions before returning.

## Shared Foundations

### Injection and DLL entry

Current injected DLL path:

```text
tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
```

Current CLI injection wrapper:

- `tools/bkcli/inject.js`
- calls `tools/inject/BKPayload64/inject.ps1`
- passes `-Command AutoOperationAgent`

Current desktop app injection path:

- `electron/services/inject-service.js`
- starts the same `BKAutoOpAgent.dll`
- verifies readiness with `Ping`

### Pipe, frame, and message shape

Current named pipe:

```text
\\.\pipe\BKAutoOp
```

Current request / response envelope:

```json
{ "id": "1", "cmd": "Ping", "args": {} }
{ "id": "1", "ok": true, "result": {} }
{ "id": "1", "ok": false, "error": "..." }
```

Current frame format:

```text
[4-byte little-endian uint32 payload length][UTF-8 JSON payload]
```

Current max frame size:

```text
262144 bytes
```

### One-shot caller model

The current Agent is a long-lived named-pipe server, but the common callers are one-shot command clients:

- `electron/services/inject-service.js` opens a fresh connection per `runAutoOperationCommand(...)`, waits for the matching `id`, then destroys the socket.
- `tools/bkcli/pipe.js` does the same per CLI command.
- `Controller` and Inject panels both go through `window.bidkingDesktop.runAutoOperationCommand(...)`, which lands in the Electron service path above.

That means the current desktop stack is request/response oriented, not a persistent session API for ordinary commands.

### Timeouts

Current timeout derivation is split by caller:

- `tools/bkcli/pipe.js`
  - default command timeout: `5000ms`
  - `inject` waits up to `8000ms` for the pipe to become reachable
  - `collect-cabinet-reward` uses `30000ms`
  - `auto-auction` uses `600000ms`
- `electron/services/inject-service.js`
  - default command timeout: `5000ms`
  - long commands currently use `45000ms`:
    - `GetCollectionItemCids`
    - `GetItemTradeInfo`
    - `GetWarehouseItemList`
    - `GetStockCollectibleCounts`
    - `GetStockContainers`
    - `MoveStockItem`
    - `CollectCabinetReward`
  - `AutoAuction` currently uses `600000ms`
  - `ExchangeItem` timeout is derived from `args.timeoutMs`
  - wait-style UI automation commands derive their socket timeout from `args.timeoutMs` plus a buffer

### Agent logging

Current native log file:

```text
%USERPROFILE%\Documents\BidKing\BKAutoOpAgent.log
```

Current fallback when `%USERPROFILE%` is unavailable:

```text
C:\BKAutoOpAgent.log
```

## `bkcli`

### What it is for

`tools/bkcli/bkcli.js` is the current standalone CLI entry point for:

- injecting the Agent
- probing pipe connectivity
- sending direct Agent commands
- running UI automation commands from a terminal
- triggering a small set of business / aggregate commands directly
- running non-Agent helper flows such as shellcode execution

### Current command groups

| Group | Subcommands | Downstream behavior |
| --- | --- | --- |
| Agent lifecycle | `inject`, `ping` | `inject` runs the PowerShell injector, then waits for `Ping`; `ping` is a direct pipe command |
| Base UI inspection | `get-current-ui`, `get-visible-panels` | direct pipe commands |
| UI automation | `dump`, `get-node`, `click`, `set-text`, `wait-panel`, `wait-node` | direct pipe commands to `DumpPanelTree`, `GetNodeState`, `ClickNode`, `SetInputText`, `WaitForVisiblePanel`, `WaitForNode` |
| Higher-level current shortcuts | `get-current-screen`, `dismiss-rewards-box`, `dismiss-collect-award`, `close-current-overlay`, `collect-cabinet-reward`, `auto-auction` | direct pipe commands to current native business / aggregate commands |
| Escape hatch | `run` | direct pipe command with arbitrary command name and JSON args |
| Out-of-band wrappers | `exec-shellcode`, `exec-probe` | not ordinary app-UI commands; see below |

### Direct pipe subcommands vs wrappers

Current direct pipe subcommands:

- `ping`
- `get-current-ui`
- `get-visible-panels`
- `get-current-screen`
- `dismiss-rewards-box`
- `dismiss-collect-award`
- `close-current-overlay`
- `collect-cabinet-reward`
- `auto-auction`
- `dump`
- `get-node`
- `click`
- `set-text`
- `wait-panel`
- `wait-node`
- `run`

Current wrappers that are not just "send one existing command name with args":

- `inject`
  - runs `inject.ps1`
  - injects `BKAutoOpAgent.dll`
  - waits for pipe readiness with `Ping`
- `exec-shellcode`
  - runs `tools/inject/BKPayload64/inject-shellcode.ps1`
  - does not call an Agent UI command
  - is a shellcode injection helper
- `exec-probe`
  - compiles a temporary DLL from a C++ source file through `tools/inject/AutoOperation/BKProbeTemplate/build_probe.sh`
  - then sends the Agent command `LoadProbe`
  - so it is a CLI wrapper around temporary probe compilation plus one infrastructure command

### Practical note

`bkcli` does not currently provide dedicated first-class subcommands for every MetaOperation command. For example:

- `CollectCabinetReward` and `AutoAuction` do have dedicated subcommands
- `GoToBattlePrev`, `EnterRoom`, `OpenSkillConfig`, `SelectRole`, `StartAction`, `PlaceBid`, `SetBidAmount`, and `ConfirmBid` currently require either:
  - `node bkcli.js run <CommandName> <argsJson>`
  - the Inject MetaOperation panel
  - the desktop Controller / generic command console

## `BKAutoOperationAgent`

### Ownership boundary

`BKAutoOpAgent.dll` is currently the authoritative native command host. It owns:

- the named-pipe server
- request parsing and response writing
- the dispatch table
- IL2CPP lookup / invoke helpers
- UI node inspection and interaction primitives
- warehouse / exchange / delayed-query native commands
- higher-level business and aggregate commands
- `LoadProbe`
- `UnloadAgent`

### File split

Current split inside the native Agent:

- `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
  - pipe server
  - dispatch table
  - base commands
  - UI automation primitives
  - warehouse / exchange / delayed query commands
  - `LoadProbe`
  - `UnloadAgent`
- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
  - room navigation commands
  - bidding helper commands
  - reward / overlay business commands
  - current aggregate commands

### Current dispatch table categories

The current dispatch table in `BKAutoOpAgent.cpp` registers all of these command groups:

| Category | Commands |
| --- | --- |
| Connectivity / lifecycle | `Ping`, `UnloadAgent` |
| Panel-level UI | `GetCurrentUI`, `GetVisiblePanels`, `OpenPanel`, `ClosePanel` |
| UI automation selector commands | `DumpPanelTree`, `ClickNode`, `SetInputText`, `GetNodeState`, `DescribeNodeComponents`, `DescribeNodeComponentMethods`, `DescribeNodeComponentMethodSignatures`, `DescribeNodeComponentFields`, `DescribeClassMethodSignatures`, `CallNodeComponentMethod`, `InvokeNodeComponentMethod`, `WaitForVisiblePanel`, `WaitForNode` |
| Collection / warehouse / exchange | `CollectionPrices`, `GetCollectionItemCids`, `GetWarehouseItemList`, `GetStockCollectibleCounts`, `GetStockContainers`, `MoveStockItem`, `GetItemTradeInfo`, `ExchangeItem`, `RefreshExchangeSellSlots` |
| Delayed query | `StartDelayedPriceQuery`, `GetDelayedPriceQueryStatus`, `CancelDelayedPriceQuery` |
| Probe infrastructure | `LoadProbe`, `InvokeMethod` |
| Business / MetaOperation | `GoToBattlePrev`, `EnterRoom`, `OpenSkillConfig`, `SelectRole`, `StartAction`, `GetBidState`, `PlaceBid`, `SetBidAmount`, `ConfirmBid`, `DismissRewardsBox`, `DismissCollectAward`, `GetCurrentScreen`, `CloseCurrentOverlay`, `SetExpectedPrice`, `CancelAutoAuction` |
| Cabinet reward scheduler | `GetAutoCollectCabinetRewardState`, `SetAutoCollectCabinetRewardEnabled` |
| AggregateOperation | `CollectCabinetReward`, `AutoAuction` |

This is one dispatch table, not separate transport layers.

## `MetaOperation`

### What the manual means by MetaOperation

In the current repository, "MetaOperation" is the native business-command layer that sits above low-level UI primitives.

It is currently defined by behavior, not by a separate transport or a separate DLL:

- commands are still normal pipe commands
- the implementation currently lives in `MetaOperations.cpp`
- some of those commands are exposed in Inject as dedicated business buttons
- some are not

### Current set differences

The three current sets are close, but not identical:

1. commands implemented in `MetaOperations.cpp`
2. commands registered in the native dispatch table
3. commands exposed in `src/inject/panels/InjectMetaOperationPanel.vue`

Current command matrix:

| Command | In `MetaOperations.cpp` | In dispatch table | In Inject MetaOperation panel | Notes |
| --- | --- | --- | --- | --- |
| `GoToBattlePrev` | yes | yes | yes | zero-arg button |
| `EnterRoom` | yes | yes | yes | form with `roomId` |
| `OpenSkillConfig` | yes | yes | yes | zero-arg button |
| `SelectRole` | yes | yes | yes | currently wired to Elsa |
| `StartAction` | yes | yes | yes | zero-arg button |
| `GetBidState` | yes | yes | yes | zero-arg button |
| `PlaceBid` | yes | yes | yes | zero-arg button |
| `SetBidAmount` | yes | yes | yes | form with `amount` |
| `ConfirmBid` | yes | yes | yes | zero-arg button |
| `DismissRewardsBox` | yes | yes | yes | zero-arg button |
| `DismissCollectAward` | yes | yes | yes | zero-arg button |
| `GetCurrentScreen` | yes | yes | yes | zero-arg button |
| `CloseCurrentOverlay` | yes | yes | yes | zero-arg button |
| `SetExpectedPrice` | yes | yes | no | helper command for renderer-driven expected-price sync; not exposed in Inject MetaOperation panel |
| `CancelAutoAuction` | yes | yes | no | stop/cancel companion to `AutoAuction`; not exposed in Inject MetaOperation panel |
| `CollectCabinetReward` | yes | yes | yes | aggregate by behavior, but exposed in the panel |
| `GetAutoCollectCabinetRewardState` | yes | yes | yes | reads scheduler state (`enabled`, `running`, `lastResultCode`); called automatically by the panel on transport-ready |
| `SetAutoCollectCabinetRewardEnabled` | yes | yes | yes | toggles the cabinet reward scheduler; takes `{ enabled: boolean }` |
| `RefreshExchangeSellSlots` | yes | yes | no | navigates to exchange sell tab and confirms ready; used by price page auto-seller |
| `AutoAuction` | yes | yes | no | available in native dispatch and `bkcli`, not in Inject MetaOperation panel |

Current non-member that is easy to confuse with MetaOperation:

- `LoadProbe`
  - registered in the native dispatch table
  - used by `bkcli exec-probe`
  - infrastructure command, not a MetaOperation command

### Current Inject MetaOperation panel surface

`src/inject/panels/InjectMetaOperationPanel.vue` currently exposes 16 native business commands:

- zero-arg actions
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
  - `GetAutoCollectCabinetRewardState`
- argument-taking actions
  - `EnterRoom`
  - `SetBidAmount`
  - `SetAutoCollectCabinetRewardEnabled`

It currently does not expose `AutoAuction`, `SetExpectedPrice`, `CancelAutoAuction`, or `RefreshExchangeSellSlots`.

## `AggregateOperation`

### What the manual means by AggregateOperation

The current codebase does not have a separate module or protocol layer literally named `AggregateOperation`.

In current implementation terms, AggregateOperation means:

- still a normal Agent pipe command
- still registered in the same dispatch table
- implemented natively as a multi-step orchestration flow
- internally chains several lower-level UI actions, waits, and screen checks before returning

### Current aggregate commands

Current aggregate commands implemented in native code are:

- `CollectCabinetReward`
- `AutoAuction`

### `CollectCabinetReward`

`CollectCabinetReward` is currently a native multi-step reward collection flow. It does not just click one button. It currently:

1. closes overlays until the Agent reaches a stable reward-entry screen
2. opens the warehouse when needed
3. enters the reward list
4. verifies the reward list screen
5. clicks the collect action
6. dismisses the reward popup when present
7. closes the reward list overlay

Current exposure:

- native dispatch table: yes
- `bkcli collect-cabinet-reward`: yes
- Inject MetaOperation panel: yes

### `AutoAuction`

`AutoAuction` is currently the largest native orchestration command. It chains:

1. screen recovery back to `main_lobby`
2. auction hall navigation
3. room entry
4. skill config / role selection / start action
5. wait for the in-battle auction screen
6. repeated bid rounds
7. optional quick recycle
8. exit back toward the lobby

Current exposure:

- native dispatch table: yes
- `bkcli auto-auction`: yes
- Inject MetaOperation panel: no

This command is aggregate by implementation behavior, but it is not a special transport. It is still invoked like any other pipe command.

## Entry Points

### Which surface to use

Use the current surfaces like this:

| Surface | Best for | Current limitation |
| --- | --- | --- |
| `bkcli` | scripting, terminal use, direct operator control, probe loading | not every MetaOperation has its own dedicated subcommand |
| Inject `Agent 状态` panel | low-level native command probing | mostly a base-command console, not a business workflow UI |
| Inject `MetaOperation` panel | current human-facing business commands | does not expose `AutoAuction` |
| Inject `Controller` panel | generic desktop-side command sending and UI automation experimentation | still a generic command console, not a curated workflow surface |

### Current cross-reference map

- Overview and boundaries: this document
- Full protocol and payload contracts: [`docs/AUTO_OPERATION_COMMANDS.md`](./AUTO_OPERATION_COMMANDS.md)
- Controller-side examples: [`docs/CONTROLLER_PAGE_COMMAND_EXAMPLES.md`](./CONTROLLER_PAGE_COMMAND_EXAMPLES.md)
- CLI-first usage examples: [`tools/bkcli/README.md`](../tools/bkcli/README.md)

## Current Summary

The current repository already has one complete native command host, one shared dispatch table, and three practical operator surfaces:

- `bkcli`
- desktop `Controller`
- Inject `MetaOperation` panel

The main distinction is no longer "which DLL owns the command", but:

- whether the command is low-level or business-level
- whether it is single-step or aggregate
- whether it is exposed in CLI, Controller, Inject, or only some of them

That is the current implementation reality the rest of the docs should be read against.
