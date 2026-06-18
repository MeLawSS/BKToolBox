# bkcli Injection Analysis Tool Design

Date: 2026-06-18
Status: Approved for planning

## Goal

Implement a Node.js CLI tool at `tools/bkcli/` for Claude's own use during development and debugging sessions. The tool provides direct access to BidKing game process internals via DLL injection, named pipe commands, raw shellcode execution, and compiled C++ probe injection. This is not an end-user tool — it is a developer/analysis tool Claude invokes via Bash tool calls.

## Context

The BidKing Electron app already has:

- `tools/inject/BKPayload64/inject.ps1` — PowerShell injector using P/Invoke (CreateRemoteThread + LoadLibraryA)
- `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll` — persistent named pipe agent listening on `\\.\pipe\BKAutoOp`
- `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` — agent source with all supported commands
- `tools/inject/AutoOperation/protocol.h` — frame format: `[uint32 length][JSON bytes]`, BK_BUF_SIZE=262144
- `electron/services/inject-service.js` — Electron one-shot pipe client (sendAutoOperationCommand)

The bkcli tool replicates the pipe-framing layer independently so it can operate standalone without the Electron process.

## Non-Goals

- End-user UI or documentation
- Production use — tool is for Claude's analysis sessions only
- Cross-platform support (Windows only; BidKing is Windows-only)
- Continuous monitoring / polling mode

## File Structure

```
tools/bkcli/
├── bkcli.js              # CLI entry point — parse argv, dispatch commands
├── pipe.js               # Named pipe client: frame write/read (uint32 length + JSON)
├── inject.js             # Injection wrapper: calls inject.ps1, waits for pipe ready
├── shellcode.js          # exec-shellcode: VirtualAllocEx + WriteProcessMemory + RemoteThread
├── probe.js              # exec-probe: WSL MinGW compile + LoadProbe command
└── bkcli.test.mjs        # Unit tests (node:test + mock)

tools/inject/BKPayload64/
└── inject-shellcode.ps1  # New PowerShell script: RWX alloc + shellcode inject + scratch read

tools/inject/AutoOperation/
├── protocol.h            # Unchanged
├── BKProbeTemplate/
│   ├── probe_template.h  # Standard probe header (IL2CPP stubs + PROBE_RESULT macro)
│   └── build_probe.sh    # WSL MinGW compile: <source.cpp> → <output.dll>
└── BKAutoOpAgent/
    └── BKAutoOpAgent.cpp # Add LoadProbe command handler
```

## Command Interface

All commands output JSON to stdout:

```json
{"ok": true, "result": {...}}
{"ok": false, "error": "..."}
```

Full command set:

```bash
# Step 1: inject agent DLL into BidKing process
node bkcli.js inject

# Connectivity
node bkcli.js ping

# UI state queries
node bkcli.js get-current-ui
node bkcli.js get-visible-panels

# Panel tree analysis
node bkcli.js dump <panel> [--root <path>] [--all] [--depth <n>] [--limit <n>]
node bkcli.js get-node <panel> <path> [--root <path>] [--mode exact|glob]

# UI interactions
node bkcli.js click <panel> <path> [--root <path>] [--mode exact|glob] [--component auto|button|toggle]
node bkcli.js set-text <panel> <path> <text> [--root <path>] [--mode exact|glob] [--submit]

# Wait commands
node bkcli.js wait-panel <panel> [--hidden] [--timeout <ms>] [--poll <ms>]
node bkcli.js wait-node <panel> <path> <state> [--root <path>] [--mode exact|glob] [--timeout <ms>] [--poll <ms>]

# Raw x64 shellcode injection
node bkcli.js exec-shellcode <file.bin|file.hex> [--result-size <n>] [--no-wait]

# C++ probe compilation + injection
node bkcli.js exec-probe <file.cpp> [--args <jsonString>] [--keep]

# Escape hatch: raw command
node bkcli.js run <cmd> <argsJson>
```

## Injection Model (Two-Step)

Injection is explicit and separate from analysis commands.

```
node bkcli.js inject
  → inject.js reads BKAutoOpAgent.dll path relative to __dirname
  → calls: pwsh -File tools/inject/BKPayload64/inject.ps1 -Command AutoOperationAgent
  → polls pipe \\.\pipe\BKAutoOp every 500ms, up to 8s
  → on success: {"ok":true,"result":{"status":"ready"}}
  → on timeout: {"ok":false,"error":"agent pipe not ready after 8s"}
```

After injection, all analysis commands connect directly to the pipe without re-injecting.

## Pipe Client (pipe.js)

Implements the same frame protocol as protocol.h:

- write: uint32 LE length prefix + UTF-8 JSON bytes
- read: read 4 bytes → parse length → read that many bytes → parse JSON
- default timeout: 5000ms (matching inject-service.js DEFAULT_AUTO_OPERATION_TIMEOUT_MS)
- persistent connection: connect → send command → receive response → disconnect (one-shot per CLI invocation, matching the Electron model)

## exec-shellcode Data Flow

```
node bkcli.js exec-shellcode payload.bin [--result-size 4096] [--no-wait]

shellcode.js:
  1. Read file: detect .hex extension → parse hex pairs; otherwise treat as raw binary
  2. Invoke: pwsh -File inject-shellcode.ps1 -ShellcodeHex <hex> -ResultSize <n>

inject-shellcode.ps1 (new):
  1. OpenProcess(BidKing, PROCESS_ALL_ACCESS)
  2. VirtualAllocEx(PAGE_EXECUTE_READWRITE, shellcodeSize)  → shellcodeAddr
  3. VirtualAllocEx(PAGE_READWRITE, resultSize)             → scratchAddr
  4. WriteProcessMemory(shellcodeAddr, shellcodeBytes)
  5. CreateRemoteThread(start=shellcodeAddr, param=scratchAddr)
     // Windows x64 calling convention: scratchAddr arrives in shellcode's RCX register
     // Shellcode writes null-terminated JSON to [RCX] as its result
  6. Unless --no-wait: WaitForSingleObject(thread, 5000ms)
  7. ReadProcessMemory(scratchAddr, resultSize) → trim at first null byte
  8. VirtualFreeEx(shellcodeAddr); VirtualFreeEx(scratchAddr)
  9. Print JSON: result bytes as string (or raw hex if not valid UTF-8)

bkcli.js output: {"ok":true,"result":{"output":"<scratch content>"}}
```

`--no-wait` skips steps 6-7, used when the shellcode only needs to trigger an action with no return value.

## exec-probe Data Flow

```
node bkcli.js exec-probe payload.cpp [--args '{"key":"val"}'] [--keep]

probe.js:
  1. Generate temp DLL path: %TEMP%\bkprobe_<hash>.dll
  2. Compile:
     wsl -e bash tools/inject/AutoOperation/BKProbeTemplate/build_probe.sh \
       /mnt/<windows-path-to-cpp> /mnt/<windows-path-to-dll>
     On compile failure: print gcc stderr, exit 1
  3. Send LoadProbe command via pipe:
     {"cmd":"LoadProbe","args":{"dllPath":"<dll path>","argsJson":"<--args value>"}}
  4. Read response: {"ok":true,"result":{"output":"..."}}
  5. Unless --keep: delete temp DLL
  6. Print result to stdout
```

### BKAutoOpAgent LoadProbe Command (new)

Add handler in BKAutoOpAgent.cpp:

```
cmd = "LoadProbe"
args.dllPath   → absolute Windows path to probe DLL
args.argsJson  → arbitrary JSON string passed to probe entry point (default: "{}")

Handler:
  HMODULE h = LoadLibraryA(dllPath)
  if (!h) → error "LoadLibrary failed: 0x<GetLastError hex>"
  auto fn = (void(*)(const char*,char*,int))GetProcAddress(h, "BKProbeEntry")
  if (!fn) → FreeLibrary(h); error "BKProbeEntry not exported"
  char resultBuf[65536] = {};
  fn(argsJson, resultBuf, sizeof(resultBuf))
  FreeLibrary(h)
  respond: {"ok":true,"result":{"output":"<resultBuf>"}}
```

The probe runs on the agent thread. For operations that must run on the game main thread (e.g., direct UI manipulation without the existing click path), a future `--main-thread` flag could enqueue via the existing UiMainThreadClickPlan mechanism.

### Probe Template (probe_template.h)

Every probe.cpp includes this header. It provides:

- IL2CPP function typedefs (matching BKPayload64.cpp)
- `bool BKProbeResolveIl2cpp()` — resolves all IL2CPP function pointers from GameAssembly.dll at call time
- `PROBE_RESULT(fmt, ...)` macro — snprintf into resultBuf (passed as a thread-local pointer)
- Standard entry point signature:

```cpp
extern "C" __declspec(dllexport)
void BKProbeEntry(const char* argsJson, char* resultBuf, int resultSize);
```

### build_probe.sh

```bash
#!/bin/bash
# Usage: build_probe.sh <source.cpp> <output.dll>
SOURCE="$1"
OUTPUT="$2"
INCLUDE_DIR="$(dirname "$0")"  # probe_template.h lives next to this script

x86_64-w64-mingw32-g++ \
  -shared -o "$OUTPUT" \
  -I "$INCLUDE_DIR" \
  -O0 -g \
  "$SOURCE" \
  -lkernel32 \
  2>&1
```

Requires `mingw-w64` installed in WSL: `sudo apt install gcc-mingw-w64-x86-64`.

## Error Handling

| Scenario | Output |
|---|---|
| BidKing process not found | `{"ok":false,"error":"process not found: BidKing.exe"}` |
| inject.ps1 fails | `{"ok":false,"error":"injection failed","detail":"<stderr>"}` |
| Pipe not ready after 8s | `{"ok":false,"error":"agent pipe not ready after 8s"}` |
| Pipe connection refused | `{"ok":false,"error":"pipe not available — run: node bkcli.js inject"}` |
| Command timeout (5s) | `{"ok":false,"error":"command timeout: <cmd>"}` |
| Agent returns ok:false | `{"ok":false,"error":"<agent error message>"}` |
| Shellcode file not found | `{"ok":false,"error":"file not found: <path>"}` |
| Shellcode thread timeout | `{"ok":false,"error":"shellcode thread timeout after 5000ms"}` |
| Scratch buffer empty | `{"ok":false,"error":"no output (scratch buffer empty)"}` |
| WSL compile failure | `{"ok":false,"error":"compile failed","detail":"<gcc stderr>"}` |
| LoadProbe: DLL load fails | `{"ok":false,"error":"LoadLibrary failed: 0x<GetLastError>"}` |
| LoadProbe: entry not found | `{"ok":false,"error":"BKProbeEntry not exported"}` |

## Output Format

All outputs are JSON on stdout. Claude parses these programmatically.

The `dump` command output mirrors the DumpPanelTree response shape from protocol.h. The `get-node` command mirrors GetNodeState response shape.

No pretty-printing is the default. `--pretty` flag optionally adds indentation for human-readable inspection.

## Testing (bkcli.test.mjs)

Tests use `node:test` + mock (no external test framework).

Coverage required:

- `pipe.js`: frame encode/decode round-trip with known bytes
- `inject.js`: verify inject.ps1 is called with correct arguments; verify poll-and-retry logic (mock pipe responses)
- `shellcode.js`: .hex vs .bin file parsing; verify inject-shellcode.ps1 argument construction
- `probe.js`: verify WSL compile command arguments; verify LoadProbe payload construction; verify temp DLL cleanup on success and failure
- `bkcli.js`: every command → verify correct JSON payload sent to pipe (mock pipe)
- Error paths: pipe unavailable, command timeout, agent error response

## Implementation Notes

- bkcli.js uses no package.json dependencies — only Node.js built-ins (`net`, `fs`, `child_process`, `path`, `crypto`)
- PowerShell scripts are invoked via `child_process.spawnSync('pwsh', ['-File', ...])` with `stdio: 'pipe'`
- WSL is invoked via `child_process.spawnSync('wsl', ['-e', 'bash', ...])`
- Windows path ↔ WSL path conversion for build_probe.sh: replace drive letter with `/mnt/<drive>/` and backslashes with forward slashes
- The tool targets Node.js 20+ (matching the project's Electron version)

## Acceptance Criteria

The tool is accepted when:

1. `node bkcli.js inject` successfully injects BKAutoOpAgent into BidKing and confirms pipe readiness.
2. `node bkcli.js dump <panel>` returns a JSON node list for the given panel.
3. `node bkcli.js click <panel> <path>` triggers a UI click and returns success/failure JSON.
4. `node bkcli.js exec-shellcode payload.bin` allocates RWX memory, runs shellcode, and returns scratch buffer content.
5. `node bkcli.js exec-probe payload.cpp` compiles the C++ file via WSL MinGW, injects the DLL, and returns `BKProbeEntry` output.
6. All error scenarios produce `{"ok":false,"error":"..."}` with specific messages.
7. Tests pass: `node --test tools/bkcli/bkcli.test.mjs`.
