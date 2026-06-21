# Tools Non-UI-Thread Computation Design

## Goal

Keep the canonical `Tools` page responsive even when a panel is doing expensive work.

The resulting behavior must be:

- all meaningful computation inside `Tools` panels runs off the renderer/UI thread
- the UI thread only owns form state, worker orchestration, `/run` `EventSource` lifecycle, and rendering
- multi-result computations stream incremental updates back to the UI instead of waiting for one final batch
- stale computations can be cancelled cleanly when the user clears, reruns, switches tabs, or leaves `Tools`

## Non-Goals

- Do not redesign the visual layout of `Tools`, `Elsa`, `Ethan`, or `Ahmed`.
- Do not change solver algorithms in the Node `/run` scripts.
- Do not move `Monitor`, `Price`, or `Inject` into this workerization pass.
- Do not rewrite Ahmed into a full Vue-local state architecture.
- Do not move trivial DOM writes or cheap input parsing into workers just for style points.

## Current State

### Hero Estimator is only partially off-thread

[`src/hero-estimator/useHeroEstimatorPanel.js`](../../../src/hero-estimator/useHeroEstimatorPanel.js) already boots [`src/ethan/estimation-worker.js`](../../../src/ethan/estimation-worker.js) for direct and average-only estimation.

But meaningful work still remains on the UI thread:

- `solve-gold-total.js` / price-only SSE output is parsed in the renderer
- total-price candidate filtering and row construction still happens in the renderer
- `applyPriceMatchTags()` still walks rows and runs average-price matching on the renderer

This means large candidate streams can still freeze input, tab switches, and repaint.

### Ahmed is still fully main-thread for heavy work

[`public/ahmed/ahmed.js`](../../../public/ahmed/ahmed.js) currently handles `submit` synchronously in the mounted controller.

That path directly performs:

- group count possibility expansion
- total-cell resolution
- known-item constraint validation
- full combination enumeration via `calculateCombinations()`
- per-row price-constraint checks
- per-row expected-total calculation
- detail expansion when a result row is opened

Those steps depend on pure helpers in [`public/ahmed/ahmed-core.js`](../../../public/ahmed/ahmed-core.js), but they are still invoked from the UI thread.

### Solver tabs still derive output on the renderer

The canonical `Tools` container is [`src/elsa/App.vue`](../../../src/elsa/App.vue).

Its `9` solver tabs already stream raw solver output over `/run`, but the renderer still performs repeated derivation work:

- ANSI cleanup and segment formatting in `formatLine()`
- per-line table parsing in `parseResultRow()`
- repeated `map/filter/sort` in `getTableRows()`
- repeated filtering in `getFilteredLines()`
- purple total-cell block reordering in `sortTotalCellsBlocks()`
- run-status inference by re-scanning stored lines

When a solver emits many lines, the bottleneck moves from the server process to Vue render and renderer-side parsing.

## Chosen Approach

Use **three worker pipelines**, each owned by the panel family that already owns the UI:

1. extend the existing `Hero Estimator` worker flow
2. add a dedicated `Ahmed` computation worker
3. add a dedicated `Tools` solver-output worker for `/run` stream parsing and derivation

This is intentionally not a “single global tools worker”.

Reason:

- each panel family has different data shapes and cancellation semantics
- existing test coverage already follows those boundaries
- `Hero Estimator` already has a working worker pattern we can extend
- one mega-worker would increase coupling and make regressions harder to isolate

## Architecture

### UI thread responsibilities

The renderer remains responsible for:

- collecting form input
- starting and stopping `EventSource`
- spawning / terminating workers
- assigning `runId`
- dropping stale worker messages
- rendering incremental rows, status text, and progress

The renderer must **not** continue to perform heavy parsing, candidate expansion, combination enumeration, or expensive filtering/sorting.

### Worker responsibilities

Each worker owns:

- heavy pure computation
- incremental result assembly
- filtering and sorting for the result model it serves
- run-local caches and intermediate state

Each worker must support:

- `runId`
- `start`
- `cancel`
- incremental `row` / `chunk` / `progress`
- terminal `done`
- terminal `error`

### Message contract

All three pipelines should converge on the same message semantics even if payload shapes differ:

- `start`
  - UI -> worker
  - begins a new run
- `append-source`
  - UI -> worker
  - forwards raw `/run` text chunks for solver-stream cases
- `progress`
  - worker -> UI
  - lightweight status for long-running jobs
- `row`
  - worker -> UI
  - one normalized result row
- `row-batch`
  - worker -> UI
  - several normalized rows when batching is more efficient
- `status`
  - worker -> UI
  - metadata text/state that should update before the run is finished
- `result`
  - worker -> UI
  - full direct-result payload for single-result cases
- `done`
  - worker -> UI
  - worker-side run finished
- `error`
  - worker -> UI
  - deterministic computation failure

The renderer should treat every message as stale unless `message.runId === activeRunId`.

## Hero Estimator Design

### What moves off-thread

Keep direct estimation on the existing worker path, and extend the same pattern to cover the remaining expensive branches:

- price-only solver stream parsing
- total-price solver stream parsing
- candidate filtering for `avg`, `cells`, `priceAverage`, and monitor-known-cell constraints
- average-price match tagging
- total-price match tagging
- row construction for streamed prediction candidates

### What stays on the UI thread

- form input collection
- current shared monitor runtime subscription
- `/run` `EventSource` creation/teardown
- “clear” / “leave tools” page-state behavior

### Stream handling

For solver-backed branches, the UI thread should only:

- receive `{ type, text, code }` from `/run`
- pass raw `text` chunks into the worker

The worker then:

- tokenizes the stream
- parses candidate lines
- validates each candidate
- emits `row` messages incrementally as soon as a candidate survives filtering

This keeps the “results appear live” behavior without tying parsing to the renderer.

### File boundary

Keep ownership inside `src/hero-estimator/` and `src/ethan/`:

- extend [`src/ethan/estimation-worker-core.js`](../../../src/ethan/estimation-worker-core.js)
- extend [`src/ethan/estimation-worker.js`](../../../src/ethan/estimation-worker.js)
- slim down renderer logic in [`src/hero-estimator/useHeroEstimatorPanel.js`](../../../src/hero-estimator/useHeroEstimatorPanel.js)

No new global worker registry is needed.

## Ahmed Design

### Workerization scope

Ahmed should move all meaningful result computation off-thread:

- total-cells resolution
- possible-count generation per group
- known-constraint summary and reachability checks
- full `calculateCombinations()` enumeration
- price-constraint validation
- expected-total calculation
- row detail expansion

### UI behavior

The Ahmed controller should become a thin orchestrator:

- collect validated form values
- send a normalized input payload to the worker
- render progress updates
- append `row-batch` results as they arrive
- request detail computation lazily when the user opens one row

The UI must not synchronously call `calculateCombinationsForController()` anymore.

### Shared pure-compute source

Ahmed currently mixes two concerns:

- panel/controller DOM orchestration in `public/ahmed/ahmed.js`
- pure combination logic in `public/ahmed/ahmed-core.js`

For workerization, the pure compute layer should be extracted into a shareable source-of-truth module under `src/ahmed/`, then imported by both:

- the Ahmed worker
- the Ahmed controller glue

That avoids duplicating combination logic and avoids making the worker depend on controller-specific DOM code.

### Incremental updates

Ahmed worker should emit:

- `progress`
  - current `red` branch or equivalent outer-loop progress
  - current match count
  - whether the limit has already been hit
- `row-batch`
  - normalized rows in small batches
- `status`
  - concrete computation states such as “no feasible group”, “known constraints invalid”, and “stopped early”
- `done`

The worker should not wait until enumeration fully completes before sending the first rows.

### Detail generation

Row detail generation is also potentially heavy because it resolves concrete selections per group.

That path should become a second Ahmed worker action:

- UI sends `open-detail` with the normalized row
- worker resolves the detail payload off-thread
- UI renders the returned structure

## Solver Tabs Design

### What moves off-thread

All renderer-side derivation for the `9` solver tabs should move into a dedicated worker:

- ANSI stripping
- text-line segmentation
- table-row parsing
- filter matching
- current sort application
- purple `dedupe-total-cells` block sorting
- run-status derivation from emitted lines

### What stays on the UI thread

- tab state
- field editing
- `/run` `EventSource`
- stop button
- worker lifecycle

### Data model

The solver-output worker should own a per-run state bucket:

- raw source fragments
- parsed text lines
- parsed table rows
- current filter text
- current sort config
- current run status

The renderer should no longer recompute `getTableRows()` and `getFilteredLines()` from scratch on each render.

### Incremental updates

The worker should emit:

- `line-batch` for plain text tabs
- `row-batch` for table tabs
- `status` whenever the human-readable run status changes
- `replace-visible` only for filter/sort changes that genuinely require a recomputed snapshot

### Sorting and filtering

User-triggered filter/sort changes should also be handled off-thread.

Reason:

- a large accumulated solver output can be expensive to repeatedly re-scan
- the goal is not just to offload server-produced rows, but also heavy client-side display derivation

## Cancellation And Lifecycle Design

### Rerun

When the user reruns a panel:

- close the old `EventSource`
- increment `runId`
- send `cancel` to the old worker or terminate it
- clear only view state owned by that run

### Tab switch

Switching between tabs must not let a background run keep mutating the newly active tab by mistake.

Each tab keeps its own worker/source handles and `runId`.

### Leave Tools

When `LEAVE_TOOLS_EVENT` fires:

- close all active `EventSource` handles for solver/hero tabs
- terminate all panel workers
- clear worker-owned caches and staged rows
- preserve or clear persisted page-state according to existing `Tools` semantics

The workerization pass must not weaken the current “leave Tools clears panel caches” rule.

## Testing Design

### Hero Estimator

Add tests to prove:

- streamed price-only and total-price candidates are parsed off-thread
- rows arrive incrementally instead of one final payload
- stale worker messages are ignored after rerun/clear
- price-match and total-price-match tags still appear correctly

### Ahmed

Add tests to prove:

- submit no longer performs synchronous combination enumeration in the controller
- the worker emits progress and row batches
- detail expansion is worker-backed
- clear/rerun/cancel paths drop stale batches

### Solver tabs

Add tests to prove:

- `/run` output parsing is delegated to the worker
- table rows stream in incrementally
- filter and sort requests are handled off-thread
- purple `dedupe-total-cells` ordering remains correct
- run status still updates correctly for `running`, `done`, `stopped`, and `closed`

### Integration

Add at least one end-to-end `Tools` regression test to prove:

- the page remains interactive while a panel is still receiving worker updates
- tab switching during an active run does not cross-write results

## Risks And Mitigations

### Risk: worker message volume becomes too chatty

Mitigation:

- batch rows when necessary
- keep progress payloads small
- use per-run append buffers instead of one message per character/line when the stream is noisy

### Risk: Ahmed detail generation duplicates expensive work

Mitigation:

- reuse normalized row payloads and run-local caches inside the Ahmed worker
- separate “result enumeration” and “detail expansion” actions, but keep them in the same worker module family

### Risk: stale messages corrupt visible results

Mitigation:

- every pipeline uses `runId`
- every UI consumer drops messages from inactive runs
- rerun/clear/leave paths explicitly terminate or cancel workers

### Risk: workerization changes behavior subtly

Mitigation:

- reuse existing pure helper functions where possible
- add regression tests around exact result ordering, conflict states, and incremental update semantics
- keep the server `/run` protocol unchanged in this pass

## Success Criteria

This design is successful when:

- no `Tools` panel performs expensive combination/search/parsing work on the UI thread
- large streamed solver output no longer freezes tab switching or typing
- Ahmed no longer blocks the page during full combination enumeration
- Hero Estimator streamed branches behave like the existing worker-backed direct branch: responsive, cancellable, and incremental
