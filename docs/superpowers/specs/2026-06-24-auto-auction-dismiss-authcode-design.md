# AutoAuction Dismiss-Authcode Design

**Goal:** When native `AutoAuction` detects the slide-verification screen, it should best-effort click the verification dialog's close button before returning the existing `authcode_required` result and stopping the automation.

## Current Facts

1. `DetectScreenState()` in `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` classifies the verification screen as `authcode` when `AuthCode_Main` is visible.
2. `CmdAutoAuction` already has many `authcode` early-return points, and they all converge on the local `sendAuthCodeRequired()` lambda.
3. `CloseCurrentOverlay` does **not** treat `authcode` as a generic closeable overlay. Its `ResolveCloseTarget(...)` helper intentionally only covers ended screens, lobby overlays, mailbox, exchange, battlepass, and warehouse.
4. Live `bkcli` inspection on 2026-06-24 confirmed the verification dialog structure:
   - panel: `AuthCode_Main`
   - close button: `Main/m_BtnClose`
   - drag button: `Main/Move`
5. Live `bkcli` verification also confirmed that clicking `AuthCode_Main/Main/m_BtnClose` hides `AuthCode_Main` and returns the game screen from `authcode` to `auction_lobby_room`.

## Decision

Implement the close action inside native `AutoAuction`, not in renderer code and not by broadening `CloseCurrentOverlay`.

Concretely:

- add a tiny AutoAuction-specific dismiss-target helper to `AggregateOperationSemantics.h`
- use that helper from a new best-effort native dismiss function in `MetaOperations.cpp`
- call the dismiss function from `sendAuthCodeRequired()` before emitting the unchanged `authcode_required` result

## Why This Shape

### 1. Keep the behavior at the source of truth

`AutoAuction` is a native aggregate command. If it owns the authcode interruption contract, it should also own the "dismiss before stop" behavior. This keeps `bkcli auto-auction`, desktop renderer calls, and any future callers consistent.

### 2. Avoid changing generic overlay semantics

`CloseCurrentOverlay` is a shared utility used by other flows. Treating the verification dialog as just another generic overlay would widen its behavior surface for no need and make the change harder to reason about.

### 3. Preserve current stop semantics

The request is not to auto-resume the auction. The request is to click close and still stop. So the response contract stays:

```json
{"result":"authcode_required","reason":"authcode_detected","rounds":N,"expectedPrice":P}
```

That means renderer behavior in `useElsaAutoOperation.js` stays unchanged: it still stops, logs, notifies, and focuses the toolbox window.

## Implementation Shape

### Native semantics helper

Add a pure helper to `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`:

- input: current screen string, plus output pointers for panel name and path
- output: `true` only for `authcode`
- resolved values:
  - panel: `AuthCode_Main`
  - path: `Main/m_BtnClose`

This gives us a testable contract for the new behavior without trying to unit-test IL2CPP interaction directly.

### Native best-effort dismiss

Add a file-local helper in `MetaOperations.cpp`:

1. Ask the semantics helper whether the current screen has an AutoAuction verification dismiss target.
2. If not, return immediately.
3. Find the target panel transform.
4. Click the resolved path with the existing `ClickNode(...)` helper.
5. Log success/failure, but never propagate errors.

This helper is intentionally best-effort. Even if the panel lookup fails or the click fails, `AutoAuction` must still return `authcode_required`.

### Authcode response path

Change the local `sendAuthCodeRequired()` lambda so it:

1. computes the reported expected price exactly as today
2. calls the best-effort dismiss helper
3. builds the existing JSON via `BuildAutoAuctionAuthCodeRequiredResult(...)`
4. sends the response unchanged

Because every authcode branch already funnels through this lambda, one change covers all current detection points.

## Error Handling

The dismiss step is best-effort only:

- no new response shape
- no new failure result
- no retries
- no waiting for the panel to disappear

Rationale: the close click is a courtesy cleanup action before the pre-existing stop path. The stop result remains authoritative.

## Testing

### Automated

Add pure-logic tests in `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp` for:

- `authcode` resolves to `AuthCode_Main` + `Main/m_BtnClose`
- non-authcode screens resolve to no dismiss target

### Manual verification already obtained

On 2026-06-24, `bkcli` verified:

- `get-current-screen` returned `authcode`
- `dump AuthCode_Main --all --depth 8 --limit 800` exposed `Main/m_BtnClose`
- `click AuthCode_Main Main/m_BtnClose` succeeded
- `AuthCode_Main` disappeared afterward

## Non-Goals

- No auto-resume after closing authcode
- No change to `CloseCurrentOverlay`
- No renderer API or IPC changes
- No new desktop UI controls
- No attempt to solve the slider automatically
