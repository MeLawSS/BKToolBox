# Controller UI Operations Compact Redesign

Date: 2026-06-18
Status: Drafted from approved design; pending spec review

## Goal

Redesign the existing Inject `Controller` -> `UI 操作` surface so it works as a fast game-UI operator console rather than a spacious debug inspector.

Primary outcome:

- make it fast to find a button
- make it fast to trigger a click
- keep detail and debugging information available without letting them dominate the screen

This redesign does not replace the generic Controller command console. It only changes the structured `UI 操作` sub-area.

## Relationship To Existing Spec

This document refines and partially supersedes the operator-facing layout and interaction portions of:

- `docs/superpowers/specs/2026-06-18-controller-ui-operations-panel-design.md`

The protocol assumptions from the existing UI-operations design remain valid:

- same AutoOperation commands
- same shared command lock
- same `panel + rootPath + path` addressing model
- same refresh flow based on `GetCurrentUI`, `GetVisiblePanels`, and `DumpPanelTree`

What changes here is the user-facing workflow and layout.

## Current Problems

Observed from the current running Controller UI screenshots:

- the node list uses tall card rows, so the user sees too few actionable nodes per screen
- the right-side detail area consumes a large amount of width but is mostly empty most of the time
- the main click action is visually far away from the node list, forcing an unnecessary left-to-right interaction jump
- list rows give too much space to low-frequency debug metadata and too little to quick scanning
- the surface reads like a debug inspector instead of a high-frequency operator tool

## User Decisions Captured

The redesign must follow these choices already confirmed by the user:

- priority workflow: `快速点击按钮`
- primary click trigger: double-click the row
- single click only selects; it does not click the game UI
- list content priority:
  - if a display-name mapping exists, show the mapped name
  - if no mapping exists, show the path directly
- layout priority:
  - node list gets the full main width
  - detail area is not a permanent second column

## Approaches Considered

### Approach A: Full-width dense list + weak detail panel

Pros:

- aligns with rapid button clicking
- minimizes scroll cost
- removes the large idle detail column
- keeps details available without sacrificing throughput

Cons:

- less suited for deep inspection-first workflows

This is the chosen approach.

### Approach B: Full-width list + explicit row action button

Pros:

- safer and more explicit
- easier to discover than double-click

Cons:

- slower for repeated clicking
- adds visual clutter to every row

Rejected because the user chose double-click as the primary action.

### Approach C: Keep two columns, just compress them

Pros:

- smallest structural change

Cons:

- preserves the bad interaction path of “find on the left, act on the right”
- still wastes width on idle detail content

Rejected because it does not solve the core workflow problem.

## Chosen Design

Redesign `UI 操作` into a compact, operator-first surface with:

1. a thin top toolbar
2. a dense full-width node list
3. a collapsed-by-default detail area below the list
4. lightweight action feedback instead of a permanently large result block

The generic Controller command console remains below this area unchanged in role.

## Layout

### Top toolbar

The top area remains visible but is compressed into a thin control bar.

It contains:

- current main UI
- visible panel selector
- refresh button
- search input
- interactive node count

This bar must fit on one row on desktop unless the viewport is too narrow to do so.

### Main content area

The main content area becomes a single-column list-first layout.

Desktop default:

- full-width interactive node list
- no always-visible right detail column
- node-list region uses an internal scroll container with a fixed maximum height of `60vh`

Narrow/mobile default:

- same stacked structure
- node-list region uses an internal scroll container with a fixed maximum height of `50vh`

### Detail area

The detail area moves below the node list and becomes collapsed by default.

Behavior:

- no selected node: collapsed and hidden from the normal reading flow
- selected node: expands beneath the list
- only shows focused metadata and secondary actions

This preserves advanced controls without letting them dominate the screen.

## Node List Design

### Density

Rows must be significantly shorter than the current card layout.

Required direction:

- compact row height
- reduced vertical padding
- no three-line card treatment as the default rhythm

### Primary row text

Each row shows one primary label.

Rules:

- if the node path has a configured display-name mapping, show that mapped label as the primary label
- if no mapping exists, show the node path as the primary label

This means the list is optimized for operator naming first, protocol naming second.

### Secondary row text

Secondary information must be visually subordinate.

Allowed default secondary content:

- a short path line when a display-name mapping is present
- a small type badge such as `Button`, `Toggle`, or `Input`

Do not default to rendering the full current multi-line card payload for every row.

### Row state

Rows must visually distinguish:

- default
- selected
- actionable
- unavailable/busy
- recent success
- recent failure

The selected state must be obvious without increasing row height.

Transient action-state rules:

- `recent success` and `recent failure` apply only to the last row that received a double-click action attempt
- the row-level transient state lasts `1.5s`
- starting a new double-click action clears any previous transient row state before applying the next one
- refresh success, manual panel switching, or panel re-open clears any transient row state
- the compact status line and the row-level transient state may coexist
  - the status line records the latest action outcome in text
  - the row-level state provides immediate spatial feedback on the acted-on row

## Interaction Model

### Single click

Single click selects the node only.

It must:

- update selected state
- open or populate the detail area
- clear stale per-node input draft if the selected node changes

It must not:

- call `ClickNode`
- trigger any game UI interaction

### Double click

For this redesign, a `clickable node` means a node whose normalized `componentTypes` includes `Button` or `Toggle`.

Double click on a clickable node is the primary fast-path action.

It must:

- execute `ClickNode`
- use the toolbar's current selected panel as `panel`
- always pass `rootPath: ""`
- use the selected row's real path exactly as returned by the Agent as `path`
- always pass `pathMode: "exact"`
- always pass `component: "auto"`
- reflect shared `commandLoading`
- show immediate lightweight success/failure feedback

Double-clicking a non-clickable node must not silently do nothing. It must surface a lightweight “not clickable” style of feedback.

### Detail-area fallback actions

The detail area still provides a secondary manual action surface:

- clickable node:
  - show a fallback `点击` button
- input node:
  - show `设置文本`
  - show `submit` toggle

This preserves precision workflows without making them the primary interaction path.

## Search Behavior

Add a search field to the toolbar.

Search rules:

- when a mapped display name exists, that display name is searchable
- the underlying path remains searchable
- when no mapping exists, the path is both the visible label and the searchable text

Filtering only affects the local rendered list. It does not change Agent queries.

The search term must be preserved across refreshes.

## Detail Area Contents

The detail area must show only focused information:

- selected panel
- full path
- normalized component type(s)
- `active`
- `interactive`

This area is not intended to be a large inspector.

It must not reintroduce the current wide, sparse, always-open layout.

## Refresh And Selection Behavior

The refresh transaction rules from the existing UI-operations design remain in force.

Additional redesign-specific behavior:

- preserve the current search term after refresh
- if the selected node still exists after refresh, preserve selection
- if the selected node no longer exists:
  - clear selection
  - reset per-node input draft
  - collapse or clear the detail area

Manual panel switching remains a `DumpPanelTree`-only change. This redesign does not alter that protocol flow.

## Command Lock Behavior

The redesign must continue to respect the shared page-level AutoOperation command lock.

When `commandLoading` is active:

- row double-click is disabled
- detail-area actions are disabled
- refresh is disabled
- visible-panel switching is disabled
- search input may remain editable, but it must not trigger commands by itself

The user must have a visible busy indicator, and it must stay compact.

## Result Feedback

The current large result area is too heavy for the fast-click workflow.

Replace it with lightweight feedback:

- a compact status line near the toolbar or above the list
- optional per-row transient success/failure styling
- detail-area error text for node-specific failures

If a detailed result view remains, it must be collapsed by default and treated as secondary diagnostic content.

## Mapping Behavior

The redesign continues using:

- `/data/controller-ui-node-labels.json`

Matching rules remain exact by path.

List display rules:

- mapped node: show mapped label as the primary visible text
- unmapped node: show path as the primary visible text

No fallback to raw `node.name` is needed in the default compact list if path is already available and more useful for disambiguation.

## Implementation Structure

Recommended structure:

- keep `InjectControllerPanel.vue` as the Controller shell
- keep `InjectUiAutomationPanel.vue` as the UI-operations component
- keep `useControllerUiAutomation.js` as the composable for refresh and action state

The redesign should primarily change:

- `InjectUiAutomationPanel.vue`
- any small supporting state derived from `useControllerUiAutomation.js`
- associated tests

Avoid introducing a new top-level Inject panel or a parallel UI-operations architecture.

## CSS / Visual Direction

Required direction:

- dense rows
- low vertical padding
- strong selected-row highlight
- a thin utility toolbar
- visually subdued metadata
- no large empty right column

Avoid:

- oversized cards for every node
- large whitespace blocks between operator actions
- burying the primary click action far from the list

## Testing Requirements

At minimum, tests must cover:

- the compact list prefers mapped display names
- unmapped nodes show path as the primary visible label
- single click selects only and does not call `ClickNode`
- double click on a clickable node triggers exactly one `ClickNode`
- double click uses the full required `ClickNode` parameter set:
  - current selected panel
  - `rootPath: ""`
  - node real current path
  - `pathMode: "exact"`
  - `component: "auto"`
- double click on a non-clickable node does not send a click command and surfaces failure feedback
- the detail area is collapsed before selection
- selecting a node reveals detail content
- search filters by mapped display name
- search also filters by path
- refresh preserves search text
- refresh preserves selection when the node still exists
- refresh clears selection when the node disappears
- shared `commandLoading` disables double click, refresh, panel switch, and detail actions

## Out Of Scope

Not included in this redesign:

- changes to generic Controller command console behavior
- protocol changes to Agent command names or payload shapes
- continuous polling
- image-based UI previewing
- full tree visualization
- macro/workflow scripting
- remapping storage format changes

## Acceptance Criteria

The redesign is accepted when:

1. `UI 操作` opens into a list-first layout rather than a permanent list/detail split.
2. The interactive node list replaces the current tall-card treatment with compact rows that show one primary label and at most one secondary line by default.
3. Single click selects a node without clicking the game UI.
4. Double click on a clickable row triggers the click command directly.
5. When a node has a configured mapping, the list shows the mapped label first.
6. When a node has no mapping, the list shows the path directly.
7. Search works against both mapped labels and paths.
8. The detail area no longer dominates the layout and only expands when needed.
9. Shared AutoOperation locking still prevents conflicting commands.
10. Tests cover the new compact interaction model and layout-driven behavior.
