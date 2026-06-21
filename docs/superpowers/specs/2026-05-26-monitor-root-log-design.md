# Monitor Root Log Design

## Goal

BKToolBox should persist BidKing monitor capture artifacts in a predictable `log/` folder so debugging recent games does not require searching `%TEMP%`.

## Behavior

- If the Monitor start request provides `outputDir`, keep using that explicit directory.
- If `outputDir` is empty, use the application root `log/` directory.
- In packaged Electron on Windows, the application root is the directory containing `BKToolBox.exe`.
- In development and tests, the application root is the project root.
- Existing batch artifacts remain unchanged: `.etl`, `.pcapng`, and `.events.json` files named `tcp-live-batch-YYYYMMDD-HHMMSS.*`.

## Implementation

Add a runtime-path helper for the default log directory and use it as `BidKingLiveMonitor`'s default `outputDir`. The live monitor already creates the output directory before capture, so no extra startup migration is required.

The Monitor UI placeholder should describe the new default: leaving the field empty uses the application root `log/` folder.

## Verification

Add tests for:

- Default log directory resolution in development.
- Packaged Electron resolution using `process.execPath`.
- Explicit `outputDir` still taking precedence.
- Monitor start route still passes the user's explicit field unchanged.
