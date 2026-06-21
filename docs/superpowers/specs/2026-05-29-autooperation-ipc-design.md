# AutoOperation IPC Design

## Goal

Implement two DLLs under `tools/inject/AutoOperation/` that communicate over a Named Pipe:

- **BKAutoOpAgent.dll** — injected into the BidKing process, executes automation operations, serves as the pipe server, and can push unsolicited events to connected clients.
- **BKAutoOpClient.dll** — a generic client library loadable by any process (Electron, Python, C#, CLI tools, etc.), exposing a C ABI for sending commands and receiving events.

## Directory Structure

```
tools/inject/AutoOperation/
├── protocol.h                    # Shared: frame read/write helpers, message constants
├── BKAutoOpAgent/
│   ├── BKAutoOpAgent.cpp
│   └── build.sh
└── BKAutoOpClient/
    ├── BKAutoOpClient.cpp
    ├── BKAutoOpClient.h          # C interface header for consumers
    └── build.sh
```

## Architecture

```
┌─────────────────────────────────────┐      Named Pipe
│  BidKing process                     │   \\.\pipe\BKAutoOp
│                                     │◄──────────────────►  Any external process
│  BKAutoOpAgent.dll (injected)       │                      (Electron, Python,
│  ├─ Pipe Server Thread              │                       C#, CLI, ...)
│  ├─ Command Executor                │
│  └─ Event Pusher                    │                      BKAutoOpClient.dll
│                                     │                      ├─ BKConnect()
│  [IL2CPP Runtime]                   │                      ├─ BKSendCommand()
│  [Unity main thread]                │                      └─ BKSetEventCallback()
└─────────────────────────────────────┘
```

## Message Protocol

All messages share a single pipe connection per client (full-duplex). The frame format is:

```
[4 bytes uint32_t: payload length][UTF-8 JSON bytes]
```

Three message types, distinguished by the `id` field:

```jsonc
// Command (Client → Agent)
{ "id": "a1b2c3", "cmd": "GetCurrentUI", "args": {} }

// Response (Agent → Client, id matches the Command)
{ "id": "a1b2c3", "ok": true,  "result": { "panel": "TradingPanel" } }
{ "id": "a1b2c3", "ok": false, "error": "PlayerManager not found" }

// Event (Agent → Client, unsolicited, id is empty string)
{ "id": "", "event": "UIChanged",    "data": { "panel": "BattlePrev" } }
{ "id": "", "event": "OperationDone","data": { "cmd": "OpenPanel", "result": {} } }
{ "id": "", "event": "Heartbeat",    "data": { "uptime": 1234 } }
```

### Initial Command Set

| cmd | args | description |
|---|---|---|
| `Ping` | — | Connectivity check; returns `{ "pong": true }` |
| `GetCurrentUI` | — | Returns current panel class name |
| `GetVisiblePanels` | — | Returns list of all visible panel class names |
| `OpenPanel` | `{ "name": "TradingPanel" }` | Calls `UIManager.ShowUIByName` |
| `ClosePanel` | — | Calls `UIManager.AsyncClosePanel` |
| `InvokeMethod` | `{ "class": "PlayerManager", "method": "GetAllCollectionItems", "args": [] }` | Generic IL2CPP method call; result JSON-serialized |
| `CollectionPrices` | — | Existing price-history logic (backward compatibility) |

The command set is a dispatch table in Agent; adding new commands requires only a new entry in the table.

### Execution Strategy for InvokeMethod

- **Read-only operations** (no IL2CPP writes, no UI state change): executed synchronously on the pipe thread; response sent immediately.
- **UI operations** (`ShowUIByName`, `On*Click`, etc.): queued onto `UnityMainThreadDispatcher` (already present in the game); Agent returns `{ "ok": true, "queued": true }` immediately, then pushes an `OperationDone` event when the main thread finishes.

## BKAutoOpAgent Internal Structure

```
DllMain (DLL_PROCESS_ATTACH)
└── CreateThread → AgentMain()
    ├── il2cpp_thread_attach()
    ├── Initialise IL2CPP function pointers (same pattern as BKPayload64)
    ├── CreateNamedPipe("\\\\.\\pipe\\BKAutoOp", PIPE_ACCESS_DUPLEX, ...)
    └── Loop: ConnectNamedPipe()
        └── Per connection → CreateThread → ConnectionHandler
            ├── ReadThread: ReadFrame → parse JSON → dispatch table → execute
            │   ├── read op  → execute inline → WriteResponse()
            │   └── UI op    → enqueue g_mainThreadQueue → WriteResponse(queued=true)
            └── WriteThread: dequeue g_writeQueue → WriteFrame

g_mainThreadQueue
└── drained by UnityMainThreadDispatcher on Unity main thread Update()
    └── on completion → PushEvent("OperationDone", result) to all connections
```

The pipe name `\\.\pipe\BKAutoOp` is defined as a constant in `protocol.h` so both DLLs share it.

Agent does not export functions beyond `DllMain`; it is activated purely by injection.

## BKAutoOpClient Exported C Interface

```c
// BKAutoOpClient.h

#define BKAPI __declspec(dllexport)

#ifdef __cplusplus
extern "C" {
#endif

// Connect to the agent pipe. Pass NULL to use the default pipe name.
// Returns a connection handle, or NULL on failure.
BKAPI HANDLE BKConnect(const char* pipeName);

// Disconnect and free resources.
BKAPI void BKDisconnect(HANDLE conn);

// Send a command JSON string and wait for the Response (blocking).
// outJson: caller-allocated buffer for the response JSON.
// Returns number of bytes written, or -1 on failure/timeout.
BKAPI int BKSendCommand(HANDLE conn,
                         const char* cmdJson,
                         char* outJson, int outSize,
                         int timeoutMs);

// Register a callback for unsolicited events from the Agent.
// The callback is invoked on the Client's internal read thread.
BKAPI void BKSetEventCallback(HANDLE conn,
                               void (*cb)(const char* eventJson, void* userdata),
                               void* userdata);

// Optional helper: build a standard command JSON string from cmd name + args JSON.
// Returns bytes written, or -1 if buffer too small.
BKAPI int BKBuildCommand(const char* cmd,
                          const char* argsJson,
                          char* outJson, int outSize);

#ifdef __cplusplus
}
#endif
```

Client internals: one background ReadThread continuously reads frames. Frames whose `id` is non-empty are Responses — they wake the `BKSendCommand` call waiting on a per-request `HANDLE` event. Frames whose `id` is empty are Events — they invoke the registered callback.

## Build System

Both DLLs use the MinGW cross-compiler, consistent with the existing `BKPayload64` build:

```bash
# BKAutoOpAgent/build.sh
x86_64-w64-mingw32-g++ -shared -o BKAutoOpAgent.dll BKAutoOpAgent.cpp \
    -lkernel32 -O2 -std=c++11 -static-libgcc -static-libstdc++

# BKAutoOpClient/build.sh
x86_64-w64-mingw32-g++ -shared -o BKAutoOpClient.dll BKAutoOpClient.cpp \
    -lkernel32 -O2 -std=c++11 -static-libgcc -static-libstdc++ \
    -Wl,--export-all-symbols
```

## Error Handling

- If BidKing crashes, the pipe handle becomes invalid; `ReadFrame` returns an error, `ConnectionHandler` exits cleanly.
- `BKConnect` returns NULL if the Agent is not running (pipe does not exist yet); callers should retry.
- `BKSendCommand` with `timeoutMs > 0` returns -1 on timeout without blocking forever.
- Agent handles malformed JSON by returning `{ "ok": false, "error": "parse error" }` without crashing.

## Out of Scope

- Authentication or access control on the pipe (single-machine, same user context).
- Persistence of Agent state across BidKing restarts (Agent exits with BidKing; caller re-injects).
- High-frequency streaming (this design is command/response, not a frame-rate data feed).
