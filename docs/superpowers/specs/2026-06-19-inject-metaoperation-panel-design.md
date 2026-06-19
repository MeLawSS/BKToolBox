# Inject MetaOperation Panel Design

## Overview

Add a new `MetaOperation` panel under the Inject page so operators can trigger the existing business-level `BKAutoOpAgent` meta-operation commands without using the generic Controller command console.

This panel is a dedicated UI entry surface for the seven meta-operations that already exist in the current workspace:

- `GoToBattlePrev`
- `EnterRoom`
- `OpenSkillConfig`
- `SelectRole`
- `StartAction`
- `GetBidState`
- `PlaceBid`

The panel is intentionally narrow in scope. It is not another generic RPC console, does not expose arbitrary command/JSON editing, and does not attempt to infer current game state beyond transport-level availability.

## Current Context

The current Inject page structure is defined in `src/inject/App.vue`:

- `基础` group currently contains `柜子奖励`, `Agent 状态`, and `控制器`
- `交易` group currently contains `仓库统计`, `批量移仓`, `上架建议`, `延迟查价`, and `长期扫描`
- Panels are mounted with the established `first open => v-if`, `later => v-show` keep-alive pattern
- Cross-panel AutoOperation concurrency is already coordinated through the shared `commandLoading` prop plus `command-loading-change` emit contract

The current `BKAutoOpAgent` meta-operation command set is registered in `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` and implemented in `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`.

Important current fact:

- `StartAction` does trigger a scene-transition click in the native layer
- The native code comments currently claim the pipe drops after this click
- However, the front-end design must not present “DLL unload” or “Agent will disconnect” as a guaranteed UI fact unless the runtime contract is explicitly verified and formalized later

## Goals

- Add a dedicated Inject panel for the existing seven meta-operations
- Keep the panel operator-friendly and business-oriented
- Reuse the existing `window.bidkingDesktop.runAutoOperationCommand()` bridge
- Reuse the shared Inject command lock so this panel does not race other AutoOperation panels
- Show the latest execution result as formatted JSON

## Non-Goals

- No new preload or Electron API surface
- No new native meta-operation commands in this design round
- No generic command builder in this panel
- No UI-state-based enable/disable logic for individual meta-operations
- No attempt to “correct” or reinterpret successful native responses such as `{"clicked":false,"reason":"..."}` in the renderer
- No change to the existing Controller generic command console in this round
- No change to the existing Agent panel command list in this round

## Information Architecture

### Navigation

Add a new nav item under the Inject `基础` group:

- id: `metaOperation`
- Chinese label: `元操作`
- English label: `MetaOperation`

Recommended `基础` group order after this change:

1. `柜子奖励`
2. `Agent 状态`
3. `控制器`
4. `元操作`

### Panel Placement

Register a new standalone panel in `src/inject/App.vue`:

- component: `InjectMetaOperationPanel.vue`
- host section test id: `inject-panel-metaOperation`
- nav button test id: `inject-tab-metaOperation`

This panel follows the same Inject page lifecycle pattern as the existing panels:

- first activation mounts it with `v-if`
- later tab switches keep it alive with `v-show`

Unlike the Controller UI-operations surface, this panel does not require an `isActive` prop because it has no activation-triggered refresh workflow.

## Command Inventory

The panel exposes these seven operations as fixed UI entries:

| Command | UI label | Args |
| --- | --- | --- |
| `GoToBattlePrev` | `前往房间页` | `{}` |
| `EnterRoom` | `进入房间` | `{ roomId }` |
| `OpenSkillConfig` | `打开技能配置` | `{}` |
| `SelectRole` | `选择艾莎` | `{}` |
| `StartAction` | `开始行动` | `{}` |
| `GetBidState` | `获取竞拍状态` | `{}` |
| `PlaceBid` | `出价` | `{}` |

### EnterRoom Options

`EnterRoom` is the only command with a user-selectable argument.

The panel must render a dropdown using Chinese room names only. Internally it still sends the numeric `roomId`.

Supported options:

- `快递盲盒堆` -> `101`
- `废弃仓库` -> `102`
- `航运集装箱` -> `103`
- `空置别墅` -> `104`
- `沉船密封仓` -> `105`
- `隐秘拍卖会` -> `106`
- `幽静别墅` -> `304`
- `深海沉船` -> `305`

For the first implementation, the dropdown should default to `快递盲盒堆`.

## UI Design

### Top Status Area

Show a compact status strip at the top of the panel. This area is transport-focused only.

Minimum fields:

- desktop environment ready
- agent bridge available
- agent connected

These values should be consumed from the shared agent runtime state rather than recalculated locally from raw bridge fields wherever possible.

### Action Area

Render a flat set of command cards, not grouped by scenario.

Recommended behavior:

- each operation gets its own small card
- zero-arg operations render as a single primary action button
- `EnterRoom` renders a room dropdown plus its execute button within the same card

This is intentionally a direct action surface, not a wizard and not a multi-step flow engine.

### Result Area

Render one bottom result section that shows only the latest execution result.

The result area should include:

- the latest command label
- the underlying command name
- the latest response payload formatted as pretty JSON in a `pre` block

If there has not been any execution yet, show a placeholder message instead of empty chrome.

No separate rolling log and no clear-log button are required in the first implementation.

## Command Execution Model

### Transport Readiness

Meta-operation actions are allowed only when transport-level prerequisites are met:

- desktop environment is ready
- shared agent bridge is available
- shared agent runtime reports connected
- `window.bidkingDesktop.runAutoOperationCommand` exists
- no other Inject AutoOperation command is currently holding the shared command lock

When these transport prerequisites are not met:

- disable all action buttons
- disable the `EnterRoom` dropdown
- show the existing transport / agent hint text style used by current Inject controller surfaces

### No Game-State Gating

The renderer does not try to infer whether a specific command is appropriate for the current game screen.

Explicit rule:

- if transport is ready, the command entry remains clickable
- if the game is not in the right scene or UI state, the native command response decides the outcome
- a response such as `{"clicked":false,"reason":"..."}` is treated as a valid latest result, not as a renderer validation failure

This matches the user decision to avoid front-end per-screen button gating.

### Execution Flow

Each operation uses the same execution path:

1. determine `command` and `args`
2. acquire the shared command lock through the existing Inject `commandLoading` relay contract
3. call `window.bidkingDesktop.runAutoOperationCommand(command, args)`
4. write the response into the “latest result” section
5. release the shared command lock

### Error Semantics

Transport or bridge failure:

- show error state text
- also write a synthetic latest result payload like `{ ok: false, error: "<message>" }`

Native success with business no-op:

- do not convert it into renderer error state automatically
- preserve the returned payload in the result section exactly as the latest result

### StartAction Boundary

The panel must not present any dedicated warning line such as:

- “this disconnects the agent”
- “this unloads the DLL”
- “this will drop the pipe”

The front-end simply sends `StartAction`, records the returned payload, and leaves any subsequent transport consequences to the normal shared runtime behavior.

## Component Structure

### App Integration

Update `src/inject/App.vue` to:

- import `InjectMetaOperationPanel`
- add nav item `metaOperation` under the `基础` group
- add a panel host section for `metaOperation`
- pass `command-loading` and `command-loading-change` exactly the same way the existing command-bearing panels do

### Panel Component

Add a dedicated `src/inject/panels/InjectMetaOperationPanel.vue`.

It owns:

- room dropdown state
- latest result state
- local execution state label
- panel-local transport/error presentation

It does not own:

- the global shared agent lifecycle
- shared command lock source of truth
- generic command parsing or arbitrary JSON input

### Optional Composable

A dedicated composable is optional in this round.

Default guidance:

- keep the first implementation in a single panel component unless the file becomes hard to read
- only extract `useInjectMetaOperationPanel.js` if the command execution and state mapping logic grows beyond a straightforward panel component

## Data Model

Suggested local state shape:

- `selectedRoomId`
- `latestResultCommand`
- `latestResultLabel`
- `latestResultPayload`
- `panelError`
- `localCommandLoading`

`latestResultPayload` should always be the exact latest response payload shown in the result `pre`, including synthetic error payloads generated by the renderer.

## i18n

Add explicit i18n keys for both `zh-CN` and `en-US`.

Minimum key set:

- `inject.nav.metaOperation`
- `inject.metaOperationTitle`
- `inject.metaOperationSubtitle`
- `inject.metaOperationDesktop`
- `inject.metaOperationAgentBridge`
- `inject.metaOperationAgentConnection`
- `inject.metaOperationTransportHint`
- `inject.metaOperationLatestResult`
- `inject.metaOperationNoResult`
- `inject.metaOperationLatestCommand`
- `inject.metaOperationRoom`
- `inject.metaOperationGoToBattlePrev`
- `inject.metaOperationEnterRoom`
- `inject.metaOperationOpenSkillConfig`
- `inject.metaOperationSelectElsa`
- `inject.metaOperationStartAction`
- `inject.metaOperationGetBidState`
- `inject.metaOperationPlaceBid`
- `inject.metaOperationExecute`
- `inject.metaOperationRunning`

The room dropdown should keep the room names in Chinese in both locales for the first implementation, because the approved interaction requirement is “Chinese room names only”.

Per-room i18n keys are therefore not required in this round.

## Styling

The panel should reuse current Inject panel styling conventions rather than invent a new visual language.

Minimum layout guidance:

- compact top status area
- responsive grid of flat action cards
- one full-width result block at the bottom

Do not introduce a second console-style surface inside this panel. The result block is a single latest-result viewer, not a scrolling command terminal.

## Testing Requirements

### App-Level Tests

Update `src/inject/App.test.js` to cover:

- new nav item exists under the `基础` group
- new panel host renders with `data-testid="inject-panel-metaOperation"`
- localization coverage includes at least one `en-US` assertion for the new panel/tab label

### Panel Tests

Add `src/inject/panels/InjectMetaOperationPanel.test.js` coverage for:

- all seven operations render
- `EnterRoom` dropdown renders Chinese room labels
- default room selection is `快递盲盒堆`
- each button dispatches the correct command name
- `EnterRoom` dispatches the correct `roomId`
- all actions participate in the shared command lock
- transport-not-ready state disables actions
- latest-result block shows formatted JSON for success
- latest-result block preserves `clicked:false/reason` payloads
- transport failure writes synthetic `{ ok:false, error }` payload

### Shared Behavior Tests

If implementation extracts a composable, add focused unit tests for:

- command-to-args mapping
- latest-result state updates
- lock acquire/release behavior

## Documentation Sync Required At Implementation Time

When the feature is implemented, the same change round must update:

- `docs/Documentation.md`
- `docs/ARCHITECTURE.md`

Reason:

- this changes the Inject page panel inventory and information architecture
- prior review history in this repository already established that Inject page structure changes must update the current-state docs in the same round

## Acceptance Criteria

- Inject `基础` nav gains a new `MetaOperation` tab
- Opening that tab shows direct UI entries for the seven existing native meta-operations
- `EnterRoom` uses a Chinese-name dropdown and sends the matching numeric `roomId`
- Commands execute through the existing `runAutoOperationCommand` bridge
- The panel honors the shared Inject command lock
- The panel does not expose generic command/JSON editing
- The panel shows the latest execution result as formatted JSON
- The panel does not perform front-end scene-specific button gating beyond transport readiness
- The implementation updates `Documentation.md` and `ARCHITECTURE.md`
