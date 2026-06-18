# Controller UI Operations Panel Design

Date: 2026-06-18
Status: Approved for planning

## Goal

Add a `UI 操作` sub-area inside the existing Inject `Controller` panel so the user can:

- see the current main UI and other visible panels
- inspect the currently selected panel's interactive nodes
- select one interactive node
- perform direct node interaction from the UI
  - click `Button` / `Toggle`
  - set text on `TMP_InputField` / `NumericInputField`

The existing generic Controller command console must remain available.

## Current Context

Current state in the repo:

- `src/inject/panels/InjectControllerPanel.vue` is already a generic `runAutoOperationCommand(command, args)` console
- `Controller` already shares page-level AutoOperation command locking through `App.vue`
- backend UI automation commands already exist:
  - `GetCurrentUI`
  - `GetVisiblePanels`
  - `DumpPanelTree`
  - `ClickNode`
  - `SetInputText`
  - `GetNodeState`
  - `WaitForVisiblePanel`
  - `WaitForNode`
- `Controller` currently shows runtime readiness and a generic command console, but not a structured UI inspector/operator surface

This feature builds on that existing Controller panel rather than introducing a new top-level Inject panel.

## User Decisions Captured

- place the feature inside the existing `Controller` panel, not as a new page-level panel
- refresh strategy:
  - auto-refresh once when the Controller panel is first opened or re-opened
  - keep a manual refresh entry point
  - do not add continuous polling in phase 1
- interaction scope:
  - support click
  - support input text set/submit
  - do not expand phase 1 into a full wait/state workflow UI
- panel scope:
  - default to `GetCurrentUI`
  - allow switching to any panel from `GetVisiblePanels`
- node list shape:
  - show a flat list of interactive nodes only
- node action UX:
  - select a row first
  - perform actions in a dedicated detail area

## Rejected Approaches

### Approach A: Keep extending `InjectControllerPanel.vue` directly

Pros:

- smallest immediate edit surface
- fastest implementation

Cons:

- continues growing a file that is already handling runtime status, generic console, quick presets, log rendering, and validation
- weakens boundaries for the next rounds of UI automation work

### Approach B: Keep one Controller panel but split the new UI-operations area into focused subunits

Pros:

- preserves current information architecture
- isolates the higher-level UI automation surface from the low-level generic command console
- easier to test and extend

Cons:

- adds a small amount of file and state structure

This is the chosen approach.

### Approach C: Create a separate Inject top-level panel for UI operations

Pros:

- strongest visual separation

Cons:

- duplicates the role that `Controller` already owns
- fragments the controller/operator mental model too early
- adds navigation churn without clear phase-1 value

## Chosen Design

Keep `Controller` as one Inject panel, but split its internals into two functional surfaces:

- `UI 操作`
- `通用命令台`

The `UI 操作` surface becomes the primary operator-facing workflow for panel inspection and direct interaction. The generic command console remains available for low-level debugging, ad hoc protocol access, and future commands not yet promoted into structured UI.

## Proposed Structure

Recommended internal structure:

- `InjectControllerPanel.vue`
  - owns top-level Controller layout
  - owns readiness cards already present today
  - renders:
    - `UI 操作` sub-area
    - generic command console sub-area
- new focused child component, e.g. `InjectUiAutomationPanel.vue`
  - owns current UI / visible panel / interactive node workflow
- new focused composable, e.g. `useControllerUiAutomation.js`
  - owns refresh flow
  - owns selected panel / selected node state
  - owns UI action execution and result state

This is intentionally a bounded split:

- Controller shell stays responsible for page-facing composition
- UI automation logic stays responsible for UI automation workflow only
- generic command console remains independent and reusable within the same panel

## UI Layout

The Controller panel layout becomes:

1. runtime status cards
2. `UI 操作` section
3. generic command console section
4. existing future-domain cards can remain as secondary informational content, but must not compete with the operator workflow

The `UI 操作` section is divided into three subareas:

### Header area

Shows:

- current main UI from `GetCurrentUI`
- visible panels from `GetVisiblePanels`
- selected panel control
- `刷新 UI` button

### Interactive node list

Shows a flat list of interactive nodes only for the selected panel.

Each row displays:

- node `name`
- node `path`
- normalized `componentTypes`
- selected state

The list does not show the full raw tree in phase 1.

### Node detail area

Shows details and actions for the currently selected node.

Always displays:

- selected panel
- node path
- component types
- `active`
- `interactive`

Actions:

- if node contains `Button` or `Toggle`
  - show `点击` action
- if node contains `TMP_InputField` or `NumericInputField`
  - show text input
  - show `submit` toggle
  - show `设置文本` action

If a node exposes multiple supported capabilities, the detail area must render all applicable supported actions in phase 1.

## Data Flow

### Auto-refresh behavior

When the Controller panel becomes active and transport is ready:

1. run `GetCurrentUI`
2. run `GetVisiblePanels`
3. choose the selected panel
4. run `DumpPanelTree` for that selected panel

This happens automatically:

- on first open of the Controller panel
- when returning to the Controller panel after leaving it

There is also a manual `刷新 UI` action that reruns the full chain.

### Selected panel logic

Panel selection rules:

- prefer `GetCurrentUI.panel`
- if the current main panel is missing from visible panels, fall back to the first visible panel
- if there are no visible panels, selected panel becomes empty

When the user manually switches panel:

- do not rerun `GetCurrentUI`
- do not rerun `GetVisiblePanels`
- only rerun `DumpPanelTree` for the newly selected panel

### Interactive node list derivation

The node list always comes from:

```json
{
  "interactiveOnly": true
}
```

for the selected panel's `DumpPanelTree` call.

Phase 1 list items only need these fields:

- `path`
- `name`
- `componentTypes`
- `active`
- `interactive`

No separate raw-tree explorer is required in phase 1.

## State Model

The new UI-operations surface should keep its own state rather than reusing the generic command-console state.

Recommended local state:

- `uiAutomationRefreshing`
- `currentMainPanel`
- `visiblePanels`
- `selectedPanel`
- `interactiveNodes`
- `selectedNodePath`
- `nodeInputDraft`
- `nodeSubmitAfterInput`
- `uiAutomationError`
- `uiActionError`
- `lastUiActionResult`

Selection model:

- store selected node identity as `selectedNodePath`
- after each new dump, re-resolve the selected node by `path`
- if the path no longer exists, clear selection

This prevents stale object references after refresh.

## Command Execution Model

All UI-operations commands must continue using the same page-level AutoOperation command lock already shared by:

- Agent panel
- Listing panel
- Delayed Price panel
- Controller generic command console

That means:

- `UI 操作` actions cannot run concurrently with other active AutoOperation panel actions
- when shared `commandLoading` is occupied, `UI 操作` controls render as unavailable/disabled

Phase 1 commands used by the structured UI:

- refresh:
  - `GetCurrentUI`
  - `GetVisiblePanels`
  - `DumpPanelTree`
- node actions:
  - `ClickNode`
  - `SetInputText`

`GetNodeState` is not part of the structured `UI 操作` flow in phase 1. It remains available only in the generic command console.

## Interaction Details

### Empty states

Phase 1 must distinguish these states explicitly:

- transport not ready
- no visible panels
- selected panel has no interactive nodes
- interactive nodes have not been refreshed yet

Do not collapse them into one generic empty message.

### Node selection behavior

When the user selects a node:

- detail area updates immediately
- any input draft is reset for the newly selected node
- prior node-specific action error is cleared

### Click action behavior

For `Button` / `Toggle` nodes:

- trigger `ClickNode`
- pass the currently selected panel
- use the node path from the selected row
- always use `component: "auto"` in phase 1

### Input action behavior

For `TMP_InputField` / `NumericInputField` nodes:

- user edits a local text draft
- user can toggle `submit`
- `设置文本` triggers `SetInputText`

The draft is tied to the selected node only.

## Error Handling

Three error classes are required.

### 1. Refresh-level errors

Examples:

- `GetCurrentUI` failure
- `GetVisiblePanels` failure
- `DumpPanelTree` failure

Behavior:

- show the error at the top of the `UI 操作` section
- preserve the last successful visible data instead of clearing the whole surface

### 2. Action-level errors

Examples:

- `ClickNode` failure
- `SetInputText` failure

Behavior:

- show the error inside the detail area
- keep the selected node intact
- update `lastUiActionResult` so the user can still inspect the last command outcome

### 3. Environment-level unavailability

Examples:

- not desktop
- bridge unavailable
- agent disconnected
- shared command lock busy

Behavior:

- keep the status surface visible
- disable refresh and node actions
- show a specific reason rather than a generic failure message

## Result Feedback

`UI 操作` needs its own last-action feedback area separate from the generic Controller log.

Rationale:

- users need a clear answer to "did this click / input succeed?"
- generic protocol logs are still useful, but they represent a different workflow

Minimum feedback content:

- action name
- selected panel
- selected node path
- compact success or failure payload

## Testing Requirements

At minimum, tests must cover:

- Controller panel auto-refreshes `GetCurrentUI -> GetVisiblePanels -> DumpPanelTree` when transport is ready
- switching visible panel only reruns `DumpPanelTree`
- interactive node list shows only interactive nodes from dump output
- selecting a row updates detail area with the correct path and component types
- button/toggle node action calls `ClickNode`
- input node action calls `SetInputText`
- switching selected node resets the input draft
- refresh clears stale selection when `selectedNodePath` no longer exists
- refresh failure preserves previous successful UI data
- shared `commandLoading` disables refresh and action controls

## Out of Scope

Not included in this design:

- continuous polling
- full raw tree explorer UI
- phase-1 visual support for `WaitForNode` / `WaitForVisiblePanel`
- generalized workflow scripting/orchestration
- adding a new top-level Inject panel
- replacing the generic Controller console

## Acceptance Criteria

The feature is accepted when:

1. `Controller` contains a dedicated `UI 操作` sub-area plus the existing generic command console.
2. Opening the Controller panel in a ready environment automatically loads current main UI, visible panels, and interactive nodes for one selected panel.
3. The user can switch among visible panels and see the selected panel's interactive nodes.
4. The user can select an interactive node and perform:
   - click on button/toggle-like nodes
   - set text on input-like nodes
5. Errors are surfaced without wiping previously successful UI inspection data.
6. The feature respects the shared Inject AutoOperation command lock.
7. Tests cover refresh flow, selection flow, click/input actions, stale-selection clearing, and busy-state disabling.
