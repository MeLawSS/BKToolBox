# Dumpcap Pipe Streaming Design

Date: 2026-06-10

## Goal

Replace the current file-polling + subprocess-parser architecture with a pipe-based streaming model that delivers sub-100ms event latency while retaining pcapng file archival for debugging and replay.

## Background

The current dumpcap capture loop:

1. Spawns `dumpcap -w file.pcapng -b duration:2 -b files:120`
2. Polls the output directory every `batchSeconds` (2s minimum)
3. For each completed rotation file, spawns `node parse-bidking-tcp-pcap.mjs` as a subprocess
4. Reads the output `events.json` and processes events

This introduces at least 2–4 seconds of latency per event (one rotation period plus one polling interval), spawns a new Node.js process on every batch, and does a write-then-read file round-trip for each batch.

pktmon has already been removed. The system is dumpcap-only.

## Non-Goals

- Do not change the SSE / `recentEvents` / `stop()` / dedup / marketPriceStore layers.
- Do not change the existing `handleParsedEvent` / `emitParsedEvent` chain.
- Do not add a pktmon fallback.
- Do not implement out-of-order TCP segment reordering (game traffic on a local machine is in-order; gaps reset state and processing continues).

## Chosen Approach

Pipe dumpcap stdout into a streaming in-process parser. PcapngStreamReader parses complete pcapng blocks from the stdout byte stream and is the single source of truth for both the archival writer and the TCP reassembler. TeeWriter receives only complete pcapng blocks, so rotation always falls on a block boundary.

```
dumpcap -w - (stdout pipe)
  │
  └─▶ PcapngStreamReader.push(chunk)   ← sole consumer of raw stdout bytes
            │
            ├─▶ 'block'(rawBlock)  → TeeWriter.writeBlock(rawBlock)
            │                              → rotating .pcapng files (archive)
            │                              → rotate() only between blocks
            │                              → emit 'rotate'(newFilePath)
            │
            └─▶ 'packet'(data, idx) → TcpStreamReassembler.pushPacket()
                                              → complete BidKing frame
                                              → monitor.handleParsedEvent(event)
```

The key invariant: TeeWriter never receives a raw stdout chunk directly. It only ever receives slices that PcapngStreamReader has verified are complete, valid pcapng blocks.

## New Modules

All three modules live in `lib/`.

### `lib/bidking-pcap-stream-reader.js` — PcapngStreamReader

Accepts arbitrary-size byte chunks from dumpcap stdout. Internally maintains a Buffer and loops to extract complete pcapng blocks.

**Block extraction:**

1. Wait for ≥ 8 bytes.
2. Read `blockLength` at offset 4 (uint32 LE).
3. Validate: `blockLength >= 12` and `blockLength <= MAX_BLOCK_SIZE` (64 MB). On failure, emit `'error'` and clear the buffer.
4. Wait for `buffer.length >= blockLength`.
5. Slice out `block = buffer.slice(0, blockLength)`.
6. Validate tail: `block.readUInt32LE(blockLength - 4) === blockLength`. On mismatch, emit `'error'` and clear the buffer (avoids long desync on a dirty stream).
7. Emit `'block'(block)` for every valid block regardless of type.
8. For **SHB** (`0x0A0D0D0A`) and **IDB** (`0x00000001`): additionally save into `this.headerBlocks[]`.
9. For **EPB** (`0x00000006`): additionally read `capturedPacketLength` at offset 20, extract packet bytes at offset 28, emit `'packet'(packetData, packetIndex)`.
10. Advance buffer offset by `blockLength`, repeat.

`'error'` clears the internal buffer and is **not self-recovering** within the current dumpcap process: a running `dumpcap -w -` stream does not periodically re-emit SHB, so the reader cannot resync without a new process. The monitor treats a `'error'` from the reader as equivalent to a signal exit: it triggers a dumpcap restart (with `reassembler.resetStreamState()` and new `reader` + `tee`), which produces a fresh SHB at the start of the new stdout stream.

### `lib/bidking-tcp-reassembler.js` — TcpStreamReassembler

Maintains per-direction TCP stream state and processes one packet at a time. Uses `splitStreamDirection` from the parser to handle BidKing frame boundaries across packets.

```
async init()
  → await import('../scripts/parse-bidking-tcp-pcap.mjs')
  → cache extractTcpPayloadSegment, splitStreamDirection,
         createBidKingTcpStreamState, summarizeBidKingTcp,
         extractBidKingRealtimeEvents
  (called once before first packet)

pushPacket(packetData, packetIndex)
  1. extractTcpPayloadSegment(packetData, { packetIndex, port })
     → null (non-TCP, wrong port) → return
  2. Detect TCP sequence gap:
       expected = streamState[direction].nextSequence
       if expected !== null AND segment.sequence !== expected:
         log warning, reset streamState[direction] to fresh { remainderBase64: '', nextSequence: null }
  3. Build single-segment reassembled object:
       { payload, segmentCount: 1, firstSequence: seq, nextSequence: seq + len }
  4. splitStreamDirection(reassembled, { direction, directionState: streamState[direction] })
     → carries incomplete tail across packets via streamState[direction].remainderBase64
  5. For each complete frame → summarizeFrame() → emit 'event'

resetStreamState()
  → this.streamState = createBidKingTcpStreamState()
  (called by monitor on dumpcap restart; prevents cross-restart remainder splicing)
```

**State invariant on restart:** when dumpcap exits and is restarted, there is an unknown capture gap. Any `remainderBase64` carried from before the gap would be spliced with bytes from after the gap, producing fabricated BidKing frames. `resetStreamState()` prevents this. The cost is that any partial frame at the restart boundary is dropped, which is acceptable.

**State invariant on gap:** a TCP sequence gap within a running capture has the same risk: the carried remainder no longer aligns with the incoming sequence. Resetting the affected direction's state on gap detection is safe here too; the malformed-frame guard in `splitBidKingFrames` would catch the corrupted concatenation anyway, but resetting eagerly avoids emitting any partial event data.

`streamState` is kept in memory only. The `tcp-live-stream-state.json` file is no longer written during normal operation; `resetSessionState()` can still delete it for clean restarts.

### `lib/bidking-capture-tee-writer.js` — TeeWriter

Receives **complete pcapng blocks** from PcapngStreamReader and writes them to a rotating file archive. Rotation always occurs between blocks, never mid-block.

TeeWriter tracks one boolean state flag in addition to `currentStream` and `currentBytes`:

- `pendingRotate` (boolean, starts `false`): set to `true` when a write error forces the current stream to be abandoned. Distinguishes "first ever open" from "error-recovery open" so that `writeBlock` can dispatch to the correct open path.

```
writeBlock(block: Buffer)
  → if !currentStream:
       if pendingRotate:
         rotate()           ← error recovery: open new file WITH SHB+IDB prepend
         pendingRotate = false
       else:
         openInitialFile()  ← first call only: open WITHOUT prepend
  else if currentBytes >= rotationBytes:
       rotate()             ← size-triggered rotation: prepends SHB+IDB
  → currentStream.write(block)
  → currentBytes += block.length

openInitialFile()
  → open new WriteStream: tcp-live-dumpcap-<timestamp>.pcapng
  → currentBytes = 0
  → push filePath to files[]; if files.length > maxFiles, unlink oldest
  → emit 'rotate'(filePath)

rotate()
  → close current WriteStream (async drain), or skip drain if already null
  → open new file: tcp-live-dumpcap-<timestamp>.pcapng
  → write all saved headerBlocks (SHB + IDB) at the start of the new file
  → currentBytes = total bytes of written header blocks
  → push newFilePath to files[]; if files.length > maxFiles, unlink oldest
  → emit 'rotate'(newFilePath)

On file write error:
  → close / abandon currentStream (best-effort, no drain)
  → currentStream = null
  → pendingRotate = true
  → call onError(err)
  (next writeBlock call goes to rotate() path, producing a valid new file with headers)

end(): Promise<void>
  → flush and close current stream
```

**Initial file vs rotated files:** The first file receives the real SHB and IDB blocks as they arrive in the stream — written once, as regular blocks, with no prepend step. Rotated files (and error-recovery files) get a prepended copy of the saved `headerBlocks` so each is independently parseable. SHB and IDB appear exactly once at the head of every file; no duplicate-header risk.

**`headerBlocks` population:** TeeWriter identifies SHB (`0x0A0D0D0A`) and IDB (`0x00000001`) blocks by reading the block type at offset 0 of each incoming block, and accumulates them. By the time any rotation or error-recovery open is needed, at least one SHB and one IDB will have been received (they are always the first blocks dumpcap emits).

**`openInitialFile` and `'rotate'` event:** `openInitialFile` emits `'rotate'(filePath)` so the monitor's `updateStatus({ currentCapture })` fires immediately when capture begins, not only on the first size-triggered rotation.

Default rotation: 32 MB per file, 120 files max.

A TeeWriter write failure does not interrupt live capture or TCP reassembly.

TeeWriter emits `'rotate'(newFilePath: string)` after each rotation so the monitor can update `currentCapture` in status.

## Changes to `bidking-live-monitor.js`

### Removed

- `runBatch` (dead code after pktmon removal)
- `parseCaptureFile` / `runParserWithRetry` (subprocess parser path)
- `parseDumpcapCaptures` + inner sleep-poll loop
- `listDumpcapCaptureFiles` / `readEventsFile`
- `-b duration` and `-b files:120` flags from `buildDumpcapArgs` (replaced by `-w -`)
- `parsedDumpcapFiles` Set and related state

### `batchSeconds` — accepted but ignored

`DEFAULT_BATCH_SECONDS`, `parseBatchSeconds`, and the `batchSeconds` field in `normalizeOptions` / `publicOptions` are retained for API backward compatibility. The Monitor UI (`src/monitor/App.vue`) and the server (`server.js`) currently pass this field; no changes to UI or API are required by this spec. The new implementation reads but does not use the value. A future cleanup pass can remove it end-to-end.

### Added: `startDumpcapPipeCapture(options)`

Replaces `startDumpcapCapture`. Spawns dumpcap with stdout piped:

```
dumpcap -i <iface> -f "tcp port <port>" -s 0 -w -
  stdio: ['ignore', 'pipe', 'pipe']
```

Wiring:

```javascript
const tee = new TeeWriter({
  outputDir,
  maxFiles: 120,
  rotationBytes: 32 * 1024 * 1024,
  now: this.now,
  onError: (err) => this.updateStatus({ lastCaptureMessage: err.message })
});
const reader = new PcapngStreamReader();
const reassembler = new TcpStreamReassembler({ port, tablesDir });
await reassembler.init();

child.stdout.on('data', chunk => reader.push(chunk));
reader.on('block', block => tee.writeBlock(block));
reader.on('packet', (data, idx) => reassembler.pushPacket(data, idx));
reader.on('error', err => readerErrorReject(err));   // see restart flow below
reassembler.on('event', event => this.handleParsedEvent(event));
tee.on('rotate', filePath => this.updateStatus({ currentCapture: { capturePath: filePath } }));
```

`readerErrorReject` is the reject side of a Promise created alongside the child-exit promise (see `runDumpcapLoop` below). This causes the inner wait to throw with the reader error, entering the same cleanup and restart path as a signal exit.

On any restart (signal exit **or** reader error):

1. `await oldTee.end()` — flush and close the current archive file before discarding the reference.
2. `reassembler.resetStreamState()` — clear stream state to prevent cross-restart frame splicing.
3. Create new `reader` and new `tee`.
4. Restart dumpcap, wire up new instances.

The reassembler instance itself is reused across restarts; only its stream state is cleared.

### Updated: `runDumpcapLoop`

The inner sleep-poll loop is replaced by a `Promise.race` on two conditions:

```
await Promise.race([
  new Promise(resolve  => child.once('exit', resolve)),
  new Promise((_, rej) => { readerErrorReject = rej; })
])
```

If the child exits: the existing `dumpcapError` / `canRestartDumpcapError` logic decides whether to restart or throw.

If the reader emits `'error'`: the race rejects; the monitor logs the error, kills dumpcap (`child.kill()`), awaits drain, then follows the same restart sequence (cleanup step 1–4 above). Reader-triggered restarts increment `restartCount` (used for capture-path naming and status reporting only, same as signal-exit restarts). There is no maximum restart count; the current monitor has no such guard, and reader-error restarts follow the same unbounded policy.

`tee.end()` is called before every restart, on clean stop, and after the final failed restart attempt — covering all exit paths.

### Updated: `stop()`

Calls `tee.end()` before returning to flush and close the current archive file.

## Parser Changes (`parse-bidking-tcp-pcap.mjs`)

Export the following functions that are currently internal:

- `extractTcpPayloadSegment`
- `splitStreamDirection`
- `summarizeBidKingTcp`
- `extractBidKingRealtimeEvents`

No behavioral changes to any of these functions.

## Error Handling Summary

| Situation | Response |
|---|---|
| dumpcap exits with signal | Call `reassembler.resetStreamState()`, restart dumpcap, new `reader` + `tee` |
| dumpcap exits with non-zero code | Throw; monitor enters error state |
| Corrupt pcapng block (bad length or tail mismatch) | reader emits `'error'` → race rejects → `oldTee.end()`, kill dumpcap, `resetStreamState()`, new `reader` + `tee`, restart |
| TCP sequence gap | Reset affected direction's stream state, log warning, continue |
| BidKing frame malformed | Existing guard in `splitBidKingFrames` drops it silently |
| TeeWriter file write error | Log via `onError`, attempt fresh rotation, live parse unaffected |

## Testing

- **PcapngStreamReader**: feed existing `.pcapng` fixture files in chunks of 1 byte, 128 bytes, and whole file; assert `'block'` count and `'packet'` count match `parsePcapngEnhancedPackets` output; assert tail-mismatch corruption emits `'error'` without crashing.
- **TcpStreamReassembler**: replay existing batch-mode test cases packet-by-packet; assert final event set matches batch parser output; assert `resetStreamState()` prevents cross-boundary frame assembly.
- **TeeWriter**: assert rotation triggers only between `writeBlock` calls (never mid-block); assert each rotated file starts with valid SHB + IDB; assert `'rotate'` event fires with the new file path; assert ring deletion fires when `files.length > maxFiles`.
- **Integration**: existing `BidKingLiveMonitor` tests updated to replace file-based dumpcap mock with a piped stdout mock; event assertion results unchanged.

## Done When

- `PcapngStreamReader`, `TcpStreamReassembler`, and `TeeWriter` are implemented and unit-tested.
- `BidKingLiveMonitor.runDumpcapLoop` uses `startDumpcapPipeCapture`; no poll loop remains.
- Dead code (`runBatch`, `parseCaptureFile`, `parseDumpcapCaptures`, etc.) is removed.
- Parser exports the four newly-needed functions.
- All existing tests pass.
- Monitor page receives events within ~100ms of game network activity (verified by observation).
