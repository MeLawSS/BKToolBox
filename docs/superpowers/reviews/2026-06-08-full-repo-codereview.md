# BKToolBox Full-Repo Code Review

Date: 2026-06-08
Spec: `docs/superpowers/specs/2026-06-08-full-repo-codereview-design.md`
Plan: `docs/superpowers/plans/2026-06-08-full-repo-codereview.md`

## Scope

- `src/`
- `electron/`
- `lib/`
- `server.js`
- `runtime-paths.js`
- `scripts/`
- `tools/inject`
- `package.json`
- Windows build/package/release configuration and supporting scripts

## Method

- Phase 1: Runtime Backbone
- Phase 2: High-Change Product Surfaces
- Phase 3: Injection and Automation Chain
- Phase 4: Packaging and Release Path
- Phase 5: Architecture Debt and Test Debt Consolidation

## Phase Checkpoints

### Phase 1: Runtime Backbone

- Status: Complete
- Structural notes:
  - `electron/main.js` sets packaged/dev runtime roots, starts the embedded Express server, then loads the BrowserWindow from the localhost URL.
  - Renderer HTTP/SSE traffic flows through `server.js`, while desktop-only capabilities are exposed through `electron/preload.js` IPC bindings and handled in `electron/main.js`.
  - `BidKingLiveMonitor` owns live capture, parser orchestration, recent-event state, and market-price persistence; `PriceHistoryStore` persists cross-session price history under Documents.
- Evidence:
  - Tests run: `npx vitest run electron/desktop-utils.test.mjs lib/bidking-live-monitor.test.mjs lib/capture-driver.test.mjs lib/bidking-price-history-store.test.mjs lib/solver.test.mjs` -> PASS (`5` files, `41` tests).
  - Reproduced `PriceHistoryStore` restart dedupe failure with a Node probe: after writing snapshots A and B, constructing a new store accepted snapshot A again and appended a duplicate CSV row.
  - Reproduced `solver.run()` hang with a fake worker that emitted only `exit(0)`: the injected `exit()` callback was never reached.
  - Reproduced `BidKingLiveMonitor.parseDumpcapCaptures()` retry loss with a probe where the first `parseCaptureFile()` call threw: the second pass did not retry because the file had already been added to `parsedDumpcapFiles`.
  - Reproduced `BidKingLiveMonitor.stop()` late-event leak with a probe where an in-flight batch emitted after `stop()` had already resolved: `recentEvents` was repopulated after the returned status claimed `stopped`.
- Findings:
  - High: `lib/bidking-live-monitor.js:389-394` adds each dumpcap file to `parsedDumpcapFiles` before parsing succeeds. A transient parser failure permanently suppresses retries for that file, so live monitor events can be silently lost.
  - High: `electron/main.js:112-118` downgrades main-process `uncaughtException` and `unhandledRejection` to log-only events. After an invariant-breaking main-process fault, the app keeps serving IPC, shortcuts, and cleanup paths in an undefined state instead of failing closed.
  - Medium: `lib/bidking-live-monitor.js:113-124`, `lib/bidking-live-monitor.js:234-237`, and `lib/bidking-live-monitor.js:303-309` make `stop()` non-blocking with respect to the active batch. Callers can receive `state: stopped` and an empty `recentEvents`, then get fresh events from the just-finished parse path afterward.
  - Medium: `server.js:439-443`, `server.js:329-355`, `server.js:360-414`, `electron/main.js:759-766`, and `electron/main.js:825-835` make quit cleanup depend on `server.close()` while the renderer itself keeps long-lived `EventSource` connections open. Quitting during active monitor or solver streams can hang shutdown behind app-owned HTTP clients.
  - Medium: `lib/bidking-price-history-store.js:17-18` and `lib/bidking-price-history-store.js:96-101` rebuild dedupe state only from `latest.json`, not from per-item CSV history. After restart, an older already-recorded snapshot is accepted again as soon as a newer snapshot has replaced it in `latest.json`.
  - Medium: `server.js:40-57`, `server.js:70`, and `server.js:177-179` handle missing or invalid `collectibles.json` inconsistently. Server-side logic silently degrades to an empty catalog, while `/data/collectibles.json` hard-fails against the runtime path, making packaging/data corruption harder to detect and diagnose.
  - Low: `lib/solver.js:114-120` treats worker `exit(0)` as success without marking the corresponding state entry `done`. A worker that exits cleanly without sending the expected `done` message can stall the solver forever.
- Checkpoint summary: No Critical issues found in Phase 1.

### Phase 2: High-Change Product Surfaces

- Status: Complete
- Structural notes:
  - `src/elsa/App.vue` is now the `/Tools` shell for Elsa, Ethan, Ahmed, and the legacy solver tabs; Elsa/Ethan estimation behavior is centralized in `src/hero-estimator/useHeroEstimatorPanel.js`.
  - Shared runtime controls live in singleton composables under `src/shared`, so monitor and agent state cross all renderer entries rather than staying page-local.
  - `src/ahmed` is a Vue wrapper around the imperative controller in `public/ahmed/ahmed.js`; `src/price` and `src/inject` call desktop bridge operations directly from the renderer.
- Evidence:
  - Tests run: `npx vitest run src/home/App.test.js src/elsa/App.test.js src/elsa/ElsaHeroPanel.test.js src/ahmed/App.test.js src/hero-estimator/HeroEstimatorPanel.test.js src/monitor/App.test.js src/price/App.test.js src/inject/App.test.js src/shared/TopBar.test.js src/shared/useMonitorSwitch.test.js src/shared/useAutoOperationAgentSwitch.test.js` -> PASS (`11` files, `156` tests).
  - Reproduced an invalid stock-move placement with a `vite-node` probe: in a `3`-wide target grid with cells `0` and `1` occupied, `findFirstPlacement()` returned `{"newSlot":2,"boxIds":[2,3]}`, which wraps a horizontal `1x2` shape across two rows.
  - Confirmed by code inspection that hero-estimator saves `rows`, `summary`, and `meta` even when `hasCalculated` is forced `false` for monitor-placeholder inputs, and later restores those results without rerunning estimation.
  - Verified that current tests cover tab switching/state retention for Elsa, but do not cover the reload path where placeholder-derived results are restored from localStorage.
- Findings:
  - High: `src/inject/stock-move.js:17-54` computes shape fit from raw `boxId` deltas only. For multi-cell horizontal items, an anchor at the row edge can be accepted as long as the next numeric `boxId` exists, even when that slot is on the next row. This can generate illegal `MoveStockItem` targets; `src/inject/stock-move.test.js` currently misses the wrap-around case.
  - High: `src/hero-estimator/useHeroEstimatorPanel.js:180-204`, `src/hero-estimator/useHeroEstimatorPanel.js:232-250`, `src/hero-estimator/useHeroEstimatorPanel.js:640-645`, and `src/hero-estimator/useHeroEstimatorPanel.js:1592-1594` restore stale placeholder-driven Elsa/Ethan results after reload. The code explicitly marks those runs as non-restorable via `hasCalculated: false`, but still persists and restores the old rows/summary/meta, leaving the panel showing results that no longer correspond to restored inputs.
  - Medium: `src/shared/TopBar.vue:59-64` plus `src/shared/useMonitorSwitch.js:138-158` eagerly subscribe every page with a top bar to the full monitor SSE stream. Non-monitor surfaces therefore parse live monitor traffic on the main thread even when they do not render monitor data.
  - Medium: `src/shared/useMonitorSwitch.js:123-135` and `src/monitor/App.vue:385-389` make the shared top-bar monitor switch surface-dependent. Outside the monitor page, `toggleMonitor()` starts capture with an empty payload because no start-options resolver is registered, so the same global control behaves differently depending on which page is active.
  - Medium: `src/hero-estimator/useHeroEstimatorPanel.js:126`, `src/hero-estimator/useHeroEstimatorPanel.js:200-203`, `src/hero-estimator/useHeroEstimatorPanel.js:243`, and `src/hero-estimator/useHeroEstimatorPanel.js:1639-1648` persist the current monitor `gameUid` for Elsa but not the resolved hero profile latch. After reload, profile-less same-game packets fall back to Ethan-first compatibility rules until another Elsa-identifying packet arrives.
  - Medium: `public/ahmed/ahmed.js:277-285`, `public/ahmed/ahmed.js:455-464`, and `public/ahmed/ahmed.js:535-550` still do substantial synchronous work on every streamed Ahmed worker chunk: append the full result list, rerender the whole table, and rewrite saved page state. Large result streams therefore keep feeding UI-thread work even after moving the core combinatorics off-thread.
  - Medium: `src/monitor/App.vue:98-110`, `src/monitor/App.vue:152-157`, and `src/monitor/App.vue:229-243` let market-price events fan out into overlapping `/latest` refreshes and chained history loads without dedupe or outer-request ordering guards. Under bursty traffic, older latest responses can overwrite newer data and cause avoidable network/UI churn.
  - Low: `src/monitor/App.vue:555-559` serializes selected event `facts` and `state` with `JSON.stringify(..., null, 2)` directly on the render path, so large selected events increase rerender cost on the main thread.
- Checkpoint summary:
  - No Critical issues found in Phase 2.
  - Top UI responsiveness risks: global monitor SSE subscription on non-monitor pages, Ahmed per-chunk rerender/storage writes, and repeated monitor price refresh fan-out.
  - Top state-coupling risks: shared monitor start semantics depend on page-local resolver registration, and hero-estimator reload persistence can restore results without restoring the monitor context that produced them.

### Phase 3: Injection and Automation Chain

- Status: Complete
- Structural notes:
  - Electron exposes inject operations as thin IPC wrappers around `electron/services/inject-service.js`; collection price scan is a long-lived controller instance with push updates, and the hourly scheduler is a separate singleton service.
  - The native automation chain is a named-pipe request/response protocol over `\\.\pipe\BKAutoOp`; JS always probes that global pipe first and injects only when no responder is reachable.
  - Renderer inject surfaces mix shared agent-switch state with direct bridge calls, so liveness ownership is split between the top bar hook and per-panel command handlers.
- Evidence:
  - Tests run: `npx vitest run electron/services/inject-service.test.mjs electron/services/inject-scheduler.test.mjs electron/services/collection-price-scan-controller.test.mjs src/inject/StockMovePanel.test.js src/inject/StockMoveListEditorModal.test.js src/inject/stock-move.test.js src/inject/stock-move-saved-list-draft.test.js src/shared/useAutoOperationAgentSwitch.test.js src/shared/useMonitorSwitch.test.js` -> PASS (`9` files, `103` tests).
  - Reproduced unload-success misclassification with a Node probe: after a successful `UnloadAgent` response, forcing `Ping` to throw `ping timed out` still produced `{ ok: true, value: { unloaded: true } }` from `runAutoOperationCommand('UnloadAgent', ...)`.
  - Confirmed in native code that `UnloadThread()` sets `g_shuttingDown = 1`, tears down the pipe server, and if active handlers remain after the deadline it returns without restoring `g_shuttingDown` or restarting `AgentMain`.
  - Confirmed in renderer code that collection-scan status/start/stop resolved values are passed straight into `applyCollectionScanState()` without checking for `{ ok: false, error }`.
- Findings:
  - High: `electron/services/inject-service.js:374-390`, `electron/services/inject-service.js:416-423`, and `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp:2194-2219` make `UnloadAgent` vulnerable to a half-dead success path. JS treats any failed post-unload `Ping` as proof that the agent is gone and returns `unloaded: true`, while the native unload thread can abort after closing the pipe server but before `FreeLibraryAndExitThread()`. The result is a loaded-but-unreachable DLL state that the renderer believes is fully unloaded.
  - Medium: `electron/main.js:781-790`, `electron/services/collection-price-scan-controller.js:274-286`, and `electron/services/inject-service.js:433-437` make app shutdown race an in-flight collection scan. `stopCollectionPriceScan()` only flips controller state to `stopping`; it does not wait for the active native command to finish before `unloadAutoOperationAgent()` runs with a short timeout and its failure is downgraded to a logged `{ ok: false }`.
  - Medium: `electron/main.js:657-683` and `src/inject/App.vue:244-266`, `src/inject/App.vue:504-529` expose incompatible collection-scan IPC result shapes. Success returns raw controller state, failure returns `{ ok: false, error }`, but the renderer blindly feeds both into `applyCollectionScanState()`, so a failing start/stop/status call can silently corrupt scan state instead of surfacing a proper error.
  - Medium: `src/inject/App.vue:379-400`, `src/inject/App.vue:403-419`, `src/inject/App.vue:447-500`, `src/inject/StockMovePanel.vue:419-456`, `src/inject/StockMovePanel.vue:547-584`, and `src/shared/useAutoOperationAgentSwitch.js:102-205` leave zombie UI state after agent or game exit. Most inject actions bypass the shared agent-switch liveness sync, so the top-bar switch can remain "connected" and the page can keep showing stale warehouse/task data after later bridge failures.
  - Medium: `electron/services/inject-service.js:40-55`, `electron/services/inject-service.js:19`, and `electron/services/inject-service.js:589-600` allow cabinet-reward query/claim to consume stale JSON from the previous run. `waitForJsonFile()` accepts any reward file whose `mtimeMs >= startedAt - 1000`, so back-to-back reward operations can read the old payload before the new injector run finishes writing.
  - Low: `electron/services/inject-scheduler.js:21-37` and `electron/services/inject-scheduler.js:77` swallow runner failures and still advertise a healthy `{ enabled, nextRunAt }` state. The scheduler can fail every hour without any surfaced error or degraded state signal.
- Checkpoint summary:
  - No Critical issues found in Phase 3.
  - Lifecycle model observed: renderer IPC -> inject service -> global named pipe probe/inject -> short-lived native command connection -> optional background controller/scheduler loops.
  - Key zombie-state risks: unload can be reported successful before the DLL is actually gone, and renderer inject panels can retain stale "connected" or stale stock/task snapshots after later bridge failures.
  - Key environment assumption: the native chain is single-instance oriented today; the pipe name is global and the injector selects the first `BidKing` process it finds, so multi-instance correctness is not enforced by the current design.

### Phase 4: Packaging and Release Path

- Status: Complete
- Structural notes:
  - `npm run pack` is a custom wrapper around `electron-builder --win --dir`: it builds pages, prepares dumpcap runtime assets, writes to a hidden builder output directory, renames the unpacked app, then runs the icon patch step.
  - `npm run dist:win` builds a Windows portable target and then runs the same icon patch script against `dist`.
  - Runtime payload assembly is driven by `package.json#build.extraResources`, which populates `resources/runtime` with solver scripts, monitor tables, dumpcap assets, and inject tools.
- Evidence:
  - Tests run: `npx vitest run scripts/pack-win-dir.test.mjs scripts/deploy-unpacked-app.test.mjs scripts/prepare-dumpcap-runtime.test.mjs scripts/windows-build-metadata.test.mjs electron/desktop-utils.test.mjs` -> PASS (`5` files, `18` tests).
  - Verified with a Node probe that `resolveExecutableTargets('dist')` returns only `dist/win-unpacked/BKToolBox.exe`, so the icon patcher does not target the portable release artifact when invoked via `npm run dist:win`.
  - Reproduced `prepareDumpcapRuntime()` partial-state skipping with only `dumpcap.exe` plus one `npcap-*.exe` present: the script returned `{ skipped: true }` without checking for the rest of the runtime DLL set.
  - Confirmed that `tools/dumpcap/README.md` allows placing `WiresharkPortable-v3.6.5.zip` under `tools/dumpcap/`, while `package.json#build.extraResources` copies that directory wholesale into the app.
- Findings:
  - Medium: `package.json:21`, `scripts/patch-win-icons.js:34-42`, and `scripts/patch-win-icons.js:75-89` make `npm run dist:win` patch the wrong executable. The script is invoked on `dist`, but for that input it only targets `dist/win-unpacked/BKToolBox.exe`; the shipped portable artifact in the output root is never post-processed by this step.
  - Medium: `scripts/prepare-dumpcap-runtime.mjs:19-25`, `scripts/prepare-dumpcap-runtime.mjs:32-45`, and `package.json:91-106` make dumpcap preparation stateful and non-reproducible. The script skips on partial existing state, never cleans `tools/dumpcap` / `tools/npcap`, and writes a wall-clock timestamp into bundled metadata, so stale DLLs/installers can persist across builds and identical sources do not guarantee identical packaged runtime payloads.
  - Medium: `tools/dumpcap/README.md:7-8` and `package.json:91-106` can leak the full WiresharkPortable source zip into the shipped app. Following the documented archive placement under `tools/dumpcap/` causes `extraResources` to package that build input alongside runtime binaries.
  - Medium: `package.json:117-118`, `scripts/pack-win-dir.mjs:131-143`, `scripts/patch-win-icons.js:45-62`, `docs/Documentation.md:204-218`, and `docs/ARCHITECTURE.md:5-18` leave the release boundary under-documented. Windows builds always request elevation, and the final EXE is mutated after `electron-builder` by `rcedit`, so any signing or release process that treats builder completion as the final artifact boundary is operating on the wrong file.
  - Low: `scripts/patch-win-icons.js:53-62` and `scripts/patch-win-icons.js:86-89` are fail-open and log false success. A non-zero `rcedit` result only emits a warning, but the caller still prints `patched ...`, making release logs unreliable when icon patching actually failed.
  - Low: `scripts/deploy-unpacked-app.mjs:21-36`, `scripts/deploy-unpacked-app.mjs:54-56`, and `scripts/deploy-unpacked-app.mjs:82-85` allow build/deploy path drift when `--local-dir` is overridden. The script always builds `dist/win-unpacked` but will happily deploy a different caller-supplied directory, including stale output.
- Checkpoint summary:
  - No Critical issues found in Phase 4.
  - Major release-chain assumptions observed: unpacked app builds are post-processed after `electron-builder`; runtime tools are assembled from mutable local directories; and Windows packaging always requests administrator elevation.
  - Configuration defects vs environment constraints: stale DLL locks from a running `BidKing.exe` and unsigned UAC publisher warnings are environment/external constraints, while wrong icon patch targets and stateful dumpcap bundling are code/configuration defects.

### Phase 5: Architecture Debt and Test Debt Consolidation

- Status: Complete
- Structural notes:
  - Cross-phase findings cluster around five recurring root causes: fail-open lifecycle transitions, stale or weakly revalidated persisted state, over-coupled shared runtime ownership, mutable packaging boundaries, and UI-thread work that still scales with live event volume.
  - The highest-risk problems are boundary problems rather than isolated line bugs: renderer/main/native lifecycle handoffs, monitor capture parse acknowledgements, persisted estimator snapshots, and post-build artifact mutation.
  - Existing Vitest coverage is strong on happy-path component behavior and command plumbing, but thinner on race conditions, reload-time state revalidation, failure-envelope normalization, and packaging artifact selection.
- Evidence:
  - Consolidated findings from Phase 1 through Phase 4 checkpoints in this report.
  - Test slices already executed during the review all passed: runtime (`5` files, `41` tests), product surfaces (`11` files, `156` tests), injection/automation (`9` files, `103` tests), and packaging (`5` files, `18` tests).
  - Runtime probes already reproduced the key cross-phase defects: dumpcap retry loss, solver exit hang, late monitor events after stop, row-wrap stock placement, and unload-success misclassification.
- Findings:
  - High-value structural debt clusters are shared lifecycle ownership, persistence freshness/revalidation, and packaging determinism. These clusters generate multiple user-visible defects across otherwise separate modules.
  - Highest-value missing regression tests are: dumpcap parse retry after transient failure, hero-estimator reload after placeholder-only monitor data, stock-move wrap-around placement rejection, unload-agent confirmation when the pipe disappears before the DLL actually exits, and `dist:win` post-processing of the shipped executable.
  - The repository does not currently show a confirmed Critical issue, but several High findings can produce misleading success states, stale computed UI, or silent data loss, so they should be prioritized ahead of broader refactors.
- Checkpoint summary:
  - No Critical issues found in Phase 5.
  - Final consolidated findings, heatmap, and remediation roadmap follow.

## Consolidated Findings

### Critical

- None confirmed in this review pass.

### High

- Agent unload can report success before the DLL is actually gone. Impact: the UI and operator can believe automation is fully unloaded while a loaded-but-unreachable agent remains inside the game process. Evidence: `electron/services/inject-service.js:374-390`, `electron/services/inject-service.js:416-423`, and `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp:2194-2219`. Risk now: this leaves the hardest failure mode to recover from because reload, exit, and later status checks all reason from a false success signal. Suggested fix direction: make unload confirmation authoritative on the native side, keep the pipe alive until `FreeLibraryAndExitThread()` is guaranteed, and have JS treat lost ping as "unknown/incomplete" rather than "success".
- Hero-estimator reload can restore stale placeholder-derived results that no longer match the restored inputs or active monitor context. Impact: Elsa/Ethan panels can display confident-looking price results that were never recomputed for the current state after reload. Evidence: `src/hero-estimator/useHeroEstimatorPanel.js:180-204`, `src/hero-estimator/useHeroEstimatorPanel.js:232-250`, `src/hero-estimator/useHeroEstimatorPanel.js:640-645`, `src/hero-estimator/useHeroEstimatorPanel.js:1592-1594`, and `src/hero-estimator/useHeroEstimatorPanel.js:1639-1648`. Risk now: this is silent correctness drift in a core decision-support workflow. Suggested fix direction: persist raw user inputs and validated monitor context separately, then revalidate or recompute results on restore before rendering them as current output.
- Stock-move placement still accepts illegal row-wrap targets. Impact: batch warehouse moves can generate impossible placements that cross a row boundary and rely on server rejection or undefined downstream behavior. Evidence: `src/inject/stock-move.js:17-54`. Risk now: the bug sits on an automated bulk-action path, so one bad fit check can corrupt a large move run. Suggested fix direction: compute fit from row/column coordinates instead of numeric slot adjacency and add regression coverage for horizontal edge anchors.
- Dumpcap capture files are marked consumed before parse success. Impact: one transient parser failure can permanently drop live-monitor events with no retry for that file. Evidence: `lib/bidking-live-monitor.js:389-394`. Risk now: this is silent data loss on the runtime backbone used by monitor-driven flows and price/event features. Suggested fix direction: acknowledge files only after successful parse completion and keep failed files retryable with bounded backoff or error-state tracking.
- Main-process fatal errors are handled as log-only events. Impact: after `uncaughtException` or `unhandledRejection`, the Electron main process can continue serving IPC and cleanup flows in an undefined state. Evidence: `electron/main.js:112-118`. Risk now: this converts invariant-breaking failures into low-observability corruption or secondary bugs instead of an explicit crash boundary. Suggested fix direction: fail closed on unrecoverable main-process faults, surface operator-visible diagnostics, and let restart semantics recover from a known state.

### Medium

- Runtime shutdown is not fully drained. Impact: `BidKingLiveMonitor.stop()` can resolve before active parsing finishes, and app quit can race monitor/solver streams or an active collection scan. Evidence: `lib/bidking-live-monitor.js:113-124`, `lib/bidking-live-monitor.js:234-237`, `lib/bidking-live-monitor.js:303-309`, `server.js:439-443`, `electron/main.js:759-766`, `electron/main.js:781-790`, and `electron/services/collection-price-scan-controller.js:274-286`. Risk now: users can see stale "stopped" or "quitting" states while work is still mutating runtime state underneath them. Suggested fix direction: introduce explicit drain/await semantics for monitor batches, SSE shutdown, and collection-scan stop before teardown proceeds.
- Shared monitor runtime is over-coupled across pages. Impact: every top-bar page subscribes to the full monitor SSE stream, while the global switch only gets proper start parameters when the monitor page has registered its resolver. Evidence: `src/shared/TopBar.vue:59-64`, `src/shared/useMonitorSwitch.js:123-158`, and `src/monitor/App.vue:385-389`. Risk now: background pages still pay live event parsing cost, and the same control behaves differently depending on which page is open. Suggested fix direction: separate lightweight global monitor status from heavy event streaming, and make start configuration explicit rather than page-implicit.
- Inject renderer contracts are inconsistent and allow zombie state after failures. Impact: collection-scan failures can be fed into success-only state updaters, while stale warehouse/task/connection data survives agent or game exit. Evidence: `electron/main.js:657-683`, `src/inject/App.vue:244-266`, `src/inject/App.vue:379-419`, `src/inject/App.vue:447-529`, `src/inject/StockMovePanel.vue:419-456`, `src/inject/StockMovePanel.vue:547-584`, and `src/shared/useAutoOperationAgentSwitch.js:102-205`. Risk now: operators can keep acting on invalid state after the underlying bridge is already broken. Suggested fix direction: normalize IPC envelopes, centralize bridge-offline reconciliation, and aggressively clear stale UI state on disconnect/failure.
- Persistence freshness rules are inconsistent across subsystems. Impact: price-history restart dedupe can regress, cabinet reward queries can read stale JSON, and missing/invalid collectibles catalogs degrade differently depending on entrypoint. Evidence: `lib/bidking-price-history-store.js:17-18`, `lib/bidking-price-history-store.js:96-101`, `electron/services/inject-service.js:40-55`, `electron/services/inject-service.js:589-600`, and `server.js:40-57`. Risk now: restart or back-to-back operations produce nondeterministic reads that are hard to diagnose because each subsystem defines freshness differently. Suggested fix direction: standardize persisted artifact validation around monotonic identifiers or request-scoped tokens rather than wall-clock heuristics and partial latest snapshots.
- Packaging and runtime asset preparation are mutable and partially mis-targeted. Impact: `dist:win` post-processing can miss the shipped executable, dumpcap prep can silently reuse stale partial runtime assets, and build-input archives can leak into packaged resources. Evidence: `package.json:21`, `package.json:91-106`, `scripts/patch-win-icons.js:34-42`, `scripts/prepare-dumpcap-runtime.mjs:19-45`, and `tools/dumpcap/README.md:7-8`. Risk now: release artifacts depend on local filesystem state and may diverge from operator expectations even when the build command "succeeds". Suggested fix direction: make runtime prep idempotent and cleaning, target the actual shipped artifact explicitly, and keep source archives outside packaged resource roots.
- UI responsiveness still has hotspots even after off-thread compute work. Impact: Ahmed still rerenders and persists large result sets on every worker chunk, while Monitor can trigger overlapping latest/history refresh chains under bursty traffic. Evidence: `public/ahmed/ahmed.js:277-285`, `public/ahmed/ahmed.js:455-464`, `public/ahmed/ahmed.js:535-550`, `src/monitor/App.vue:98-110`, `src/monitor/App.vue:152-157`, and `src/monitor/App.vue:229-243`. Risk now: monitor-heavy or search-heavy sessions can still freeze the UI even though the expensive core computation moved off the main thread. Suggested fix direction: batch renderer updates, debounce persistence, and serialize or discard stale monitor refresh requests.
- Release and operator boundaries remain under-documented. Impact: Windows builds always request elevation and the final EXE is mutated after `electron-builder`, but release/signing steps can still assume builder completion is the final artifact boundary. Evidence: `package.json:117-118`, `scripts/pack-win-dir.mjs:131-143`, `scripts/patch-win-icons.js:45-62`, `docs/Documentation.md:204-218`, and `docs/ARCHITECTURE.md:5-18`. Risk now: release automation or manual signing can target the wrong artifact or wrong stage. Suggested fix direction: publish one authoritative Windows release flow document and script boundary that defines when the artifact is final.

### Low

- `lib/solver.js:114-120` can hang forever if a worker exits cleanly without sending the expected `done` message. Impact: solver jobs can stall even though the child process is already gone. Suggested fix direction: treat `exit(0)` without `done` as a terminal failure or synthesize completion with invariant checks.
- `src/monitor/App.vue:555-559` stringifies large event objects directly on the render path. Impact: selecting a large event increases rerender cost and makes an already-busy monitor page less responsive. Suggested fix direction: cache formatted payload text outside the render path or format lazily on selection changes.
- `electron/services/inject-scheduler.js:21-37`, `electron/services/inject-scheduler.js:77`, and `scripts/patch-win-icons.js:53-62` fail open and under-report operational failures. Impact: hourly inject jobs or icon patch steps can repeatedly fail while logs still resemble normal operation. Suggested fix direction: surface degraded state explicitly and reserve success logs for verified success paths.
- `scripts/deploy-unpacked-app.mjs:21-36`, `scripts/deploy-unpacked-app.mjs:54-56`, and `scripts/deploy-unpacked-app.mjs:82-85` can build one directory and deploy another when `--local-dir` overrides the source. Impact: deployment commands can silently ship stale local output. Suggested fix direction: require source-path consistency checks or rebuild the exact directory being deployed.

## Module Risk Heatmap

| Area | Risk | Evidence |
| --- | --- | --- |
| `tools/inject` unload lifecycle | High | JS unload treats lost ping as success, while native unload can stop after closing the pipe but before DLL exit. |
| `src/hero-estimator` restore/persistence | High | Placeholder-derived results and incomplete Elsa context can be restored without recomputation. |
| `src/inject/stock-move.js` | High | Fit logic checks numeric slot adjacency and misses row-wrap invalidation. |
| `lib/bidking-live-monitor.js` dumpcap ingestion | High | Files are marked parsed before parse success, causing retry loss and silent event drops. |
| `electron/main.js` fatal ownership | High | Uncaught main-process faults are logged only instead of terminating to a known-safe state. |
| Shared monitor/runtime controls | Medium | Heavy SSE subscription is global, but start semantics still depend on page-local resolver registration. |
| Inject renderer and collection-scan contracts | Medium | Mixed IPC result shapes and weak disconnect reconciliation allow zombie UI state. |
| Packaging/runtime asset prep | Medium | Post-build patch targeting and dumpcap resource assembly depend on mutable local state. |
| Persistence stores and reward outputs | Medium | Freshness/dedupe checks differ across history, reward JSON, and catalog loading paths. |
| Ahmed and Monitor renderer churn | Medium | Main-thread rerender and refresh fan-out remain proportional to live event volume. |

## Remediation Roadmap

### Immediate fixes

- Fix `UnloadAgent` confirmation so success means the DLL is actually gone, then add a regression test that simulates pipe loss before native unload completion.
- Fix `findFirstPlacement()` to validate row/column bounds for horizontal shapes and add wrap-around rejection coverage.
- Stop restoring placeholder-derived hero-estimator output unless the restored monitor/user context is revalidated and recomputed first.
- Move dumpcap file acknowledgement to post-parse success and add a retry-path regression test for transient parser failure.
- Make `dist:win` target the real shipped executable explicitly or remove the misleading post-patch step from that release path.

### Short-term cleanup

- Add drain semantics for monitor stop, quit cleanup, and collection-scan shutdown so teardown waits for in-flight work to settle.
- Normalize inject IPC envelopes and centralize renderer-side connection/offline reconciliation to clear stale warehouse, task, and switch state consistently.
- Split lightweight monitor status from full event streaming so non-monitor pages do not subscribe to heavy SSE traffic by default.
- Make persisted artifacts freshness-safe: unify price-history dedupe, cabinet reward response validation, and collectibles catalog failure handling around explicit identifiers or versioned state.
- Make dumpcap runtime assembly deterministic: clean staging dirs, reject partial existing state, and keep source archives outside `extraResources`.

### Medium-term refactors

- Split `useHeroEstimatorPanel.js` into smaller persistence, monitor-routing, and calculation modules so reload behavior is easier to reason about and test.
- Reduce Ahmed and Monitor renderer churn with batched view-model updates, debounced persistence, and stale-request suppression.
- Decide whether the native automation stack remains intentionally single-instance; if yes, document that operational boundary clearly, and if no, add process-identity handshakes.
- Create one authoritative Windows release/signing pipeline that defines the final artifact boundary after all post-build mutations and elevation requirements are applied.
