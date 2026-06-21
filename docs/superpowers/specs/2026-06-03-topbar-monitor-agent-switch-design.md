# TopBar Monitor And Agent Switch Design

## Goal

Move the existing monitor start/stop switch out of the Ethan page and make it a persistent topbar control across the app.

Add a second persistent topbar switch for the AutoOperation Agent so users can load or unload `BKAutoOpAgent.dll` from any desktop page.

The feature must:

- render `Monitor switch` in the shared topbar on every page
- render `Agent switch` in the shared topbar only when the renderer has desktop bridge access
- keep Ethan, Elsa, `/Monitor`, and `/Inject` synchronized with the same underlying runtime state
- avoid duplicate monitor SSE connections and avoid duplicate agent injection attempts

## Non-Goals

- Do not redesign the existing `/Monitor` page.
- Do not remove the existing live monitor board from Ethan or Elsa.
- Do not add browser-only shims for the AutoOperation Agent.
- Do not implement cross-tab synchronization between different browser tabs or windows.
- Do not change existing monitor parsing, Elsa/Ethan outline behavior, or AutoOperation command semantics.

## Current Context

### Topbar today

[`src/shared/TopBar.vue`](../../../src/shared/TopBar.vue) is a shared navigation component used by all page entries.

It currently owns:

- brand link
- page navigation
- language toggle
- theme toggle

It accepts a default slot, and the Ethan hero estimator currently injects the monitor switch through that slot.

### Hero estimator monitor control today

[`src/hero-estimator/HeroEstimatorPanelBody.vue`](../../../src/hero-estimator/HeroEstimatorPanelBody.vue) renders the monitor switch inside the local page topbar area when `embedded` is false.

[`src/hero-estimator/useHeroEstimatorPanel.js`](../../../src/hero-estimator/useHeroEstimatorPanel.js) currently owns monitor control and monitor stream behavior directly:

- `fetch('/api/bidking-monitor/status')`
- `fetch('/api/bidking-monitor/start')`
- `fetch('/api/bidking-monitor/stop')`
- `new EventSource('/api/bidking-monitor/events')`

That means:

- the monitor switch only exists on the standalone Ethan page
- hero pages can create their own monitor SSE connection
- global header state cannot be shared cleanly

### Monitor page today

[`src/monitor/App.vue`](../../../src/monitor/App.vue) has its own monitor control UI and its own status/event handling.

This is a second renderer-side state owner for the same monitor runtime.

### AutoOperation Agent control today

[`src/inject/App.vue`](../../../src/inject/App.vue) exposes a desktop-only button to start the AutoOperation Agent and a manual `UnloadAgent` command path.

Renderer desktop access comes from [`electron/preload.js`](../../../electron/preload.js), which exposes:

- `startAutoOperationAgent()`
- `runAutoOperationCommand(command, args)`

[`electron/services/inject-service.js`](../../../electron/services/inject-service.js) already contains the important runtime guarantees:

- `startAutoOperationAgent()` reuses a reachable existing agent instead of injecting again
- `runAutoOperationCommand('UnloadAgent')` waits for the agent to disappear before reporting success

These guarantees must remain the source of truth for the new topbar agent switch.

## Chosen Approach

Introduce shared renderer-side composables with module-level singleton state, and keep `TopBar.vue` as a view-only consumer.

The topbar should become the common interaction entry point, but not a new business-logic owner.

Reason:

- monitor and agent state are process-wide runtime concerns, not page-local concerns
- multiple pages already need to observe the same runtime state
- moving fetch/desktop bridge logic into `TopBar.vue` would mix navigation UI with runtime orchestration
- a shared singleton composable allows one authoritative request/stream owner per renderer entry

## Rejected Alternatives

### 1. Put all runtime logic directly inside `TopBar.vue`

Why rejected:

- turns a shared layout component into a business-logic hub
- makes testing harder because the view and the runtime coordination are tightly coupled
- makes page-level reuse awkward for Ethan, Elsa, `/Monitor`, and `/Inject`

### 2. Keep per-page monitor and agent state, but mirror button state into the topbar

Why rejected:

- duplicates status ownership
- invites drift between topbar state and page state
- does not solve duplicate monitor SSE connections

### 3. Build a larger global app shell/provider across every page entry

Why rejected:

- this repo uses multiple page entrypoints, not one SPA shell
- it would expand the change surface well beyond the feature boundary
- shared module-level composables solve the problem with less structural churn

## Architecture

### 1. Shared monitor runtime composable

Create `src/shared/useMonitorSwitch.js`.

It owns:

- initial status fetch from `/api/bidking-monitor/status`
- start/stop requests to `/api/bidking-monitor/start` and `/api/bidking-monitor/stop`
- one shared `EventSource('/api/bidking-monitor/events')` per renderer runtime
- a shared reactive status object
- a shared error/busy state
- a subscription hook for pages that need raw monitor events

This composable is the renderer-side source of truth for:

- topbar monitor switch state
- Ethan monitor status text and status lamp
- Elsa monitor status text and status lamp
- `/Monitor` page monitor state

### 2. Shared AutoOperation Agent runtime composable

Create `src/shared/useAutoOperationAgentSwitch.js`.

It owns:

- capability detection for desktop-only availability
- initial agent reachability probe via `runAutoOperationCommand('Ping', {})`
- `load` via `startAutoOperationAgent()`
- `unload` via `runAutoOperationCommand('UnloadAgent', {})`
- a shared reactive connected/busy/error state

This composable must treat initial `Ping` failure as a normal "currently off" state, not a user-facing error.

### 3. Topbar renders persistent controls

[`src/shared/TopBar.vue`](../../../src/shared/TopBar.vue) should render:

- `Monitor switch` after the nav block
- `Agent switch` after the monitor switch when desktop APIs are available
- existing language and theme controls unchanged

The topbar keeps no independent copy of monitor or agent runtime state.

### 4. Hero estimator consumes shared monitor runtime

[`src/hero-estimator/useHeroEstimatorPanel.js`](../../../src/hero-estimator/useHeroEstimatorPanel.js) should stop owning:

- monitor status polling
- monitor start/stop requests
- monitor `EventSource` creation

Instead it should consume the shared monitor runtime and subscribe to shared raw events.

It still owns hero-specific behavior:

- Ethan/Elsa event compatibility filtering
- monitor board state adaptation
- outline detail modal state
- autofill application
- estimate refresh scheduling

### 5. Monitor page consumes the same shared runtime

[`src/monitor/App.vue`](../../../src/monitor/App.vue) should use the shared monitor composable for status, events, and switching.

Its existing richer control surface can remain, but it must no longer create a second independent runtime owner.

### 6. Inject page consumes the same shared agent runtime

[`src/inject/App.vue`](../../../src/inject/App.vue) should use the shared agent composable for its primary agent status and top-level load/unload behavior.

The page may continue to expose manual command buttons, but those command flows should refresh shared agent state after success when relevant.

## State Design

### Monitor runtime state

The shared monitor composable should expose a stable interface shaped around:

- `status`
- `statusText`
- `errorText`
- `isBusy`
- `startMonitor(options = {})`
- `stopMonitor()`
- `toggleMonitor()`
- `refreshStatus()`
- `subscribe(listener)`

Implementation expectations:

- module-level singleton state, so multiple component consumers share one runtime owner
- module-level pending promises for `refreshStatus()` and `toggleMonitor()`, so repeated calls coalesce
- one module-level `EventSource` instance, lazily created on first consumer mount
- a cleanup model that allows consumers to unsubscribe without tearing down the shared runtime prematurely

The composable should not attempt to store monitor state in `localStorage`.

The backend monitor API remains the source of truth.

`TopBar` uses `toggleMonitor()` for the default start/stop path.

`/Monitor` uses `startMonitor(options)` when it needs to preserve its custom start payload.

### Agent runtime state

The shared agent composable should expose:

- `isAvailable`
- `isConnected`
- `errorText`
- `isBusy`
- `loadAgent()`
- `unloadAgent()`
- `toggleAgent()`
- `refreshAgentState()`

Implementation expectations:

- detect availability strictly from `window.bidkingDesktop`
- hide the switch entirely when unavailable
- coalesce simultaneous state refreshes and toggles
- interpret initial ping failure as disconnected without surfacing an error banner
- surface user-facing errors only for explicit load/unload actions

## UI And Interaction

### Monitor switch behavior

- Always visible in the topbar.
- Uses the current switch visual language rather than introducing a new control style.
- Shows active state when the shared monitor runtime reports `running`.
- Disables repeated clicks while a start/stop request is in flight.
- On failure, the switch returns to the last known stable state and exposes the shared error text to the local page consumers.

### Agent switch behavior

- Visible only when `window.bidkingDesktop?.isDesktop` and the required bridge methods exist.
- Initial render probes live agent state.
- Shows active state when the shared agent runtime can reach the agent.
- Opening the switch loads or reuses the existing agent.
- Closing the switch unloads the agent and waits for actual disconnect confirmation through existing Electron service behavior.

### Hero page layout changes

- Remove the monitor switch from the Ethan standalone page header slot.
- Elsa embedded mode remains embedded and does not get its own local header switch.
- Ethan and Elsa monitor panels keep their live status text, board, and detail views.

## Error Handling

### Monitor

- A failed initial status fetch should populate shared error state but not crash the topbar.
- A failed start/stop request should:
  - clear the busy flag
  - restore the previous stable `running` state
  - preserve a readable error message
- malformed or missing monitor event payloads should continue to be ignored by hero-specific consumers as they are today

### Agent

- Initial ping failure means "off", not "error"
- explicit load failure surfaces an error and leaves the switch off
- explicit unload failure surfaces an error and leaves the switch on
- command execution paths that imply agent presence may call `refreshAgentState()` afterward to keep the topbar synchronized

## Testing Strategy

### Topbar tests

Update [`src/shared/TopBar.test.js`](../../../src/shared/TopBar.test.js) to cover:

- monitor switch renders in the shared header
- agent switch is hidden without desktop bridge access
- agent switch renders in desktop mode
- clicking the switches delegates to the shared composable actions

### Shared monitor composable tests

Add tests for `src/shared/useMonitorSwitch.js` covering:

- initial status fetch
- start path
- stop path
- failed toggle rollback
- one shared pending request reused by multiple consumers
- one shared `EventSource` instance reused by multiple consumers
- event subscription and unsubscribe behavior

### Shared agent composable tests

Add tests for `src/shared/useAutoOperationAgentSwitch.js` covering:

- non-desktop availability = hidden/disabled state
- initial reachable agent probe marks the switch as on
- initial unreachable probe marks the switch as off without error
- load path calls `startAutoOperationAgent()`
- unload path calls `runAutoOperationCommand('UnloadAgent', {})`
- busy-state protection and pending promise reuse

### Page regression tests

Update the relevant page tests so they verify:

- Ethan no longer renders the old local topbar monitor switch
- Elsa monitor status still updates from shared runtime events
- `/Monitor` and hero pages remain synchronized through one shared monitor runtime
- `/Inject` page actions keep topbar agent state synchronized

## Acceptance Criteria

- `Monitor switch` is visible in the shared topbar on every page.
- `Agent switch` is visible in the shared topbar only in desktop renderer environments.
- Toggling monitor in the topbar updates Ethan, Elsa, and `/Monitor` status consistently.
- Toggling agent in the topbar updates `/Inject` page status consistently.
- Hero pages no longer create independent monitor `EventSource` connections.
- Renderer-side changes do not bypass the existing Electron service protections against duplicate agent injection and incomplete unload.
- Existing Ethan/Elsa monitor board parsing, autofill, and outline display behavior remain unchanged.
