# AutoOperation IPC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `BKAutoOpAgent.dll` (Named Pipe server injected into BidKing) and `BKAutoOpClient.dll` (generic C-ABI client library) enabling any external process to send automation commands to the game and receive events back.

**Architecture:** Agent creates `\\.\pipe\BKAutoOp` in BidKing's process, one background thread per client connection doing sequential read→execute→respond. Client wraps pipe I/O with a C API and a background ReadThread that routes responses by correlation ID and calls a registered event callback for unsolicited pushes.

**Tech Stack:** C++11, Windows Named Pipes (`kernel32`), IL2CPP reflection (same function-pointer pattern as `BKPayload64`), MinGW cross-compiler (`x86_64-w64-mingw32-g++`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `tools/inject/AutoOperation/protocol.h` | Create | Frame I/O, minimal JSON helpers, pipe name constant |
| `tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.h` | Create | Exported C API declarations |
| `tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.cpp` | Create | Connect, send/receive, event routing |
| `tools/inject/AutoOperation/BKAutoOpClient/build.sh` | Create | MinGW build script |
| `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` | Create | Pipe server, IL2CPP executor, command dispatch |
| `tools/inject/AutoOperation/BKAutoOpAgent/build.sh` | Create | MinGW build script |

---

### Task 1: protocol.h — shared frame I/O and JSON helpers

**Files:**
- Create: `tools/inject/AutoOperation/protocol.h`

- [ ] **Step 1: Create directories**

```bash
mkdir -p /mnt/c/tools/bidking/tools/inject/AutoOperation/BKAutoOpAgent
mkdir -p /mnt/c/tools/bidking/tools/inject/AutoOperation/BKAutoOpClient
```

- [ ] **Step 2: Write protocol.h**

Create `tools/inject/AutoOperation/protocol.h`:

```cpp
#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <limits.h>

#define BKPIPE_NAME "\\\\.\\pipe\\BKAutoOp"
#define BK_BUF_SIZE 65536

// --- Frame I/O: [4-byte uint32 length][JSON bytes] ---

static bool WriteFrame(HANDLE h, const char* json) {
    uint32_t len = (uint32_t)strlen(json);
    DWORD n;
    if (!WriteFile(h, &len, 4, &n, NULL) || n != 4) return false;
    if (!WriteFile(h, json, len, &n, NULL) || n != len) return false;
    return true;
}

static bool ReadFrame(HANDLE h, char* buf, int bufSize) {
    uint32_t len; DWORD n;
    if (!ReadFile(h, &len, 4, &n, NULL) || n != 4) return false;
    if (len == 0 || (int)len >= bufSize) return false;
    if (!ReadFile(h, buf, len, &n, NULL) || n != len) return false;
    buf[len] = '\0';
    return true;
}

// --- Minimal JSON field extractors ---

// Extract string value: {"field":"value"} -> copies value into out
static bool JsonGetString(const char* json, const char* field, char* out, int outSize) {
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\":\"", field);
    const char* p = strstr(json, needle);
    if (!p) return false;
    p += strlen(needle);
    const char* e = strchr(p, '"');
    if (!e) return false;
    int len = (int)(e - p);
    if (len >= outSize) len = outSize - 1;
    memcpy(out, p, len);
    out[len] = '\0';
    return true;
}

// Extract int value: {"field":42} -> 42, not found -> INT_MIN
static int JsonGetInt(const char* json, const char* field) {
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\":", field);
    const char* p = strstr(json, needle);
    if (!p) return INT_MIN;
    p += strlen(needle);
    while (*p == ' ') p++;
    if (*p == '-' || (*p >= '0' && *p <= '9')) return atoi(p);
    return INT_MIN;
}

// --- JSON builders ---

// {"id":"<id>","ok":true,"result":<result>}
// or {"id":"<id>","ok":false,"error":"<result>"}
static int BuildResponse(char* buf, int size, const char* id, bool ok, const char* result) {
    if (ok)
        return snprintf(buf, size,
            "{\"id\":\"%s\",\"ok\":true,\"result\":%s}", id, result ? result : "{}");
    else
        return snprintf(buf, size,
            "{\"id\":\"%s\",\"ok\":false,\"error\":\"%s\"}", id, result ? result : "error");
}

// {"id":"","event":"<event>","data":<data>}
static int BuildEvent(char* buf, int size, const char* event, const char* data) {
    return snprintf(buf, size,
        "{\"id\":\"\",\"event\":\"%s\",\"data\":%s}", event, data ? data : "{}");
}
```

- [ ] **Step 3: Compile-test the header in isolation**

```bash
cd /mnt/c/tools/bidking
printf '#include "tools/inject/AutoOperation/protocol.h"\nint main(){return 0;}\n' \
  > /tmp/test_proto.cpp
x86_64-w64-mingw32-g++ -o /tmp/test_proto.exe /tmp/test_proto.cpp -lkernel32 2>&1
echo "exit: $?"
```

Expected: warnings about unused statics are fine; exit code `0`.

- [ ] **Step 4: Commit**

```bash
git add tools/inject/AutoOperation/protocol.h
git commit -m "feat: add AutoOperation protocol.h (frame I/O + JSON helpers)"
```

---

### Task 2: BKAutoOpClient.h — exported C interface

**Files:**
- Create: `tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.h`

- [ ] **Step 1: Write BKAutoOpClient.h**

```cpp
#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#define BKAPI __declspec(dllexport)

#ifdef __cplusplus
extern "C" {
#endif

// Connect to the agent pipe. Pass NULL to use the default pipe name.
// Returns an opaque connection handle, or NULL on failure.
BKAPI HANDLE BKConnect(const char* pipeName);

// Disconnect and free all resources for this connection.
BKAPI void BKDisconnect(HANDLE conn);

// Send cmdJson (built by BKBuildCommand or manually) and wait for a Response.
// cmdJson must be {"cmd":"...","args":{...}} — BKSendCommand injects the id.
// outJson: caller-allocated buffer. timeoutMs=0 waits forever.
// Returns bytes written to outJson, or -1 on failure/timeout.
BKAPI int BKSendCommand(HANDLE conn,
                         const char* cmdJson,
                         char* outJson, int outSize,
                         int timeoutMs);

// Register a callback for unsolicited events from the Agent.
// Callback is invoked on the Client's internal read thread.
BKAPI void BKSetEventCallback(HANDLE conn,
                               void (*cb)(const char* eventJson, void* userdata),
                               void* userdata);

// Build a command JSON string: {"cmd":"<cmd>","args":<argsJson>}
// Pass NULL for argsJson to use {}. Returns bytes written, or -1 if buffer too small.
BKAPI int BKBuildCommand(const char* cmd, const char* argsJson,
                          char* outJson, int outSize);

#ifdef __cplusplus
}
#endif
```

- [ ] **Step 2: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.h
git commit -m "feat: add BKAutoOpClient.h C interface header"
```

---

### Task 3: BKAutoOpClient.cpp + build.sh

**Files:**
- Create: `tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.cpp`
- Create: `tools/inject/AutoOperation/BKAutoOpClient/build.sh`

- [ ] **Step 1: Write BKAutoOpClient.cpp**

```cpp
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include "../protocol.h"
#include "BKAutoOpClient.h"

// Per-request correlation slot
struct Pending {
    char   id[32];
    HANDLE evt;
    char*  buf;
    int    size;
    int    written;   // -1 = error/timeout
};

// Connection state
struct BKConn {
    HANDLE           pipe;
    HANDLE           readThread;
    CRITICAL_SECTION cs;
    Pending          pending[64];
    int              pendingCount;
    void           (*eventCb)(const char*, void*);
    void*            eventUserdata;
    volatile bool    closing;
};

static LONG g_idCounter = 0;
static void GenId(char* buf, int size) {
    snprintf(buf, size, "%ld", InterlockedIncrement(&g_idCounter));
}

static DWORD WINAPI ReadThread(LPVOID param) {
    BKConn* c = (BKConn*)param;
    char buf[BK_BUF_SIZE];
    while (!c->closing) {
        if (!ReadFrame(c->pipe, buf, BK_BUF_SIZE)) break;
        char id[32] = {};
        JsonGetString(buf, "id", id, sizeof(id));
        if (id[0] != '\0') {
            // Response: wake the matching BKSendCommand call
            EnterCriticalSection(&c->cs);
            for (int i = 0; i < c->pendingCount; i++) {
                if (strcmp(c->pending[i].id, id) == 0) {
                    int len = (int)strlen(buf);
                    if (len < c->pending[i].size) {
                        memcpy(c->pending[i].buf, buf, len + 1);
                        c->pending[i].written = len;
                    } else {
                        c->pending[i].written = -1;
                    }
                    SetEvent(c->pending[i].evt);
                    break;
                }
            }
            LeaveCriticalSection(&c->cs);
        } else {
            // Event: invoke registered callback
            if (c->eventCb) c->eventCb(buf, c->eventUserdata);
        }
    }
    return 0;
}

BKAPI HANDLE BKConnect(const char* pipeName) {
    const char* name = pipeName ? pipeName : BKPIPE_NAME;
    HANDLE pipe = CreateFileA(name, GENERIC_READ | GENERIC_WRITE,
                              0, NULL, OPEN_EXISTING, 0, NULL);
    if (pipe == INVALID_HANDLE_VALUE) return NULL;
    DWORD mode = PIPE_READMODE_BYTE;
    SetNamedPipeHandleState(pipe, &mode, NULL, NULL);
    BKConn* c = (BKConn*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(BKConn));
    c->pipe = pipe;
    InitializeCriticalSection(&c->cs);
    c->readThread = CreateThread(NULL, 0, ReadThread, c, 0, NULL);
    return (HANDLE)c;
}

BKAPI void BKDisconnect(HANDLE h) {
    if (!h) return;
    BKConn* c = (BKConn*)h;
    c->closing = true;
    CloseHandle(c->pipe);
    WaitForSingleObject(c->readThread, 3000);
    CloseHandle(c->readThread);
    DeleteCriticalSection(&c->cs);
    HeapFree(GetProcessHeap(), 0, c);
}

BKAPI int BKSendCommand(HANDLE h, const char* cmdJson,
                         char* outJson, int outSize, int timeoutMs) {
    if (!h || !cmdJson || !outJson) return -1;
    BKConn* c = (BKConn*)h;
    if (c->closing) return -1;

    // cmdJson format: {"cmd":"...","args":{...}}
    // We prepend "id":"<n>", into the object by skipping the leading {
    char id[32];
    GenId(id, sizeof(id));
    char frame[BK_BUF_SIZE];
    snprintf(frame, sizeof(frame), "{\"id\":\"%s\",%s", id, cmdJson + 1);

    // Register pending slot
    HANDLE evt = CreateEvent(NULL, FALSE, FALSE, NULL);
    EnterCriticalSection(&c->cs);
    if (c->pendingCount >= 64) {
        LeaveCriticalSection(&c->cs);
        CloseHandle(evt);
        return -1;
    }
    Pending* slot = &c->pending[c->pendingCount++];
    strncpy(slot->id, id, sizeof(slot->id) - 1);
    slot->evt = evt; slot->buf = outJson; slot->size = outSize; slot->written = -1;
    LeaveCriticalSection(&c->cs);

    int result = -1;
    if (WriteFrame(c->pipe, frame)) {
        DWORD wait = WaitForSingleObject(evt, timeoutMs > 0 ? (DWORD)timeoutMs : INFINITE);
        if (wait == WAIT_OBJECT_0) result = slot->written;
    }

    // Remove slot (use evt pointer as unique key in case id wraps around)
    EnterCriticalSection(&c->cs);
    for (int i = 0; i < c->pendingCount; i++) {
        if (c->pending[i].evt == evt) {
            c->pending[i] = c->pending[--c->pendingCount];
            break;
        }
    }
    LeaveCriticalSection(&c->cs);
    CloseHandle(evt);
    return result;
}

BKAPI void BKSetEventCallback(HANDLE h, void (*cb)(const char*, void*), void* userdata) {
    if (!h) return;
    BKConn* c = (BKConn*)h;
    c->eventCb = cb;
    c->eventUserdata = userdata;
}

BKAPI int BKBuildCommand(const char* cmd, const char* argsJson,
                          char* out, int outSize) {
    return snprintf(out, outSize, "{\"cmd\":\"%s\",\"args\":%s}",
                    cmd, argsJson ? argsJson : "{}");
}

BOOL WINAPI DllMain(HINSTANCE, DWORD, LPVOID) { return TRUE; }
```

- [ ] **Step 2: Write build.sh**

```bash
#!/bin/bash
# Run from repo root: bash tools/inject/AutoOperation/BKAutoOpClient/build.sh
set -e
cd "$(dirname "$0")"

x86_64-w64-mingw32-g++ \
    -shared -o BKAutoOpClient.dll BKAutoOpClient.cpp \
    -lkernel32 -O2 -std=c++11 \
    -static-libgcc -static-libstdc++ \
    -Wl,--export-all-symbols

echo "Done: tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.dll"
```

- [ ] **Step 3: Build**

```bash
cd /mnt/c/tools/bidking
bash tools/inject/AutoOperation/BKAutoOpClient/build.sh
```

Expected: `Done: tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.dll`

- [ ] **Step 4: Verify exports**

```bash
x86_64-w64-mingw32-nm \
  tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.dll \
  | grep " T " | grep -i bk
```

Expected lines containing: `BKConnect`, `BKDisconnect`, `BKSendCommand`, `BKSetEventCallback`, `BKBuildCommand`.

- [ ] **Step 5: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpClient/
git commit -m "feat: implement BKAutoOpClient.dll (Named Pipe client, C ABI)"
```

---

### Task 4: BKAutoOpAgent.cpp — pipe server skeleton

Build the server loop and per-connection handler threads with a stub command dispatcher. Verifies the threading model compiles before adding IL2CPP.

**Files:**
- Create: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Create: `tools/inject/AutoOperation/BKAutoOpAgent/build.sh`

- [ ] **Step 1: Write BKAutoOpAgent.cpp (skeleton)**

```cpp
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <limits.h>
#include "../protocol.h"

// ==========================================================================
// IL2CPP types and globals (filled in Task 5)
// ==========================================================================
typedef void Il2CppDomain;
typedef void Il2CppAssembly;
typedef void Il2CppImage;
typedef void Il2CppClass;
typedef void Il2CppMethod;
typedef void Il2CppFieldInfo;
typedef void Il2CppObject;

#define FIELDINFO_OBJECT_OFFSET(f) (*(int32_t*)((char*)(f) + 24))
#define UNBOX_INT32(obj)  (*(int32_t*)((char*)(obj) + 16))

typedef Il2CppDomain*         (*fn_domain_get)();
typedef const Il2CppAssembly**(*fn_domain_get_assemblies)(const Il2CppDomain*, size_t*);
typedef Il2CppImage*          (*fn_assembly_get_image)(const Il2CppAssembly*);
typedef Il2CppClass*          (*fn_class_from_name)(Il2CppImage*, const char*, const char*);
typedef const char*           (*fn_class_get_name)(const Il2CppClass*);
typedef const Il2CppMethod*   (*fn_class_get_method_from_name)(Il2CppClass*, const char*, int);
typedef Il2CppObject*         (*fn_runtime_invoke)(const Il2CppMethod*, void*, void**, Il2CppObject**);
typedef Il2CppFieldInfo*      (*fn_class_get_field_from_name)(Il2CppClass*, const char*);
typedef void                  (*fn_field_static_get_value)(Il2CppFieldInfo*, void*);
typedef Il2CppClass*          (*fn_object_get_class)(Il2CppObject*);
typedef void*                 (*fn_thread_attach)(Il2CppDomain*);
typedef Il2CppObject*         (*fn_string_new)(const char*);

static fn_domain_get                 g_domain_get;
static fn_domain_get_assemblies      g_domain_get_assemblies;
static fn_assembly_get_image         g_assembly_get_image;
static fn_class_from_name            g_class_from_name;
static fn_class_get_name             g_class_get_name;
static fn_class_get_method_from_name g_class_get_method_from_name;
static fn_runtime_invoke             g_runtime_invoke;
static fn_class_get_field_from_name  g_class_get_field_from_name;
static fn_field_static_get_value     g_field_static_get_value;
static fn_object_get_class           g_object_get_class;
static fn_thread_attach              g_thread_attach;
static fn_string_new                 g_string_new;

static Il2CppDomain* g_domain    = nullptr;
static bool          g_il2cpyReady = false;

// ==========================================================================
// Connection state
// ==========================================================================
struct AgentConn {
    HANDLE           pipe;
    CRITICAL_SECTION writeMutex;
    volatile bool    closing;
};

#define MAX_CONNS 16
static AgentConn*    g_conns[MAX_CONNS];
static int           g_connCount;
static CRITICAL_SECTION g_connsCs;

// ==========================================================================
// Write helpers — thread-safe, any thread may call
// ==========================================================================
static void SendResponse(AgentConn* c, const char* id, bool ok, const char* result) {
    char buf[BK_BUF_SIZE];
    BuildResponse(buf, BK_BUF_SIZE, id, ok, result);
    EnterCriticalSection(&c->writeMutex);
    WriteFrame(c->pipe, buf);
    LeaveCriticalSection(&c->writeMutex);
}

static void PushEvent(AgentConn* c, const char* event, const char* data) {
    char buf[BK_BUF_SIZE];
    BuildEvent(buf, BK_BUF_SIZE, event, data);
    EnterCriticalSection(&c->writeMutex);
    WriteFrame(c->pipe, buf);
    LeaveCriticalSection(&c->writeMutex);
}

static void PushEventToAll(const char* event, const char* data) {
    EnterCriticalSection(&g_connsCs);
    for (int i = 0; i < g_connCount; i++) {
        if (g_conns[i] && !g_conns[i]->closing)
            PushEvent(g_conns[i], event, data);
    }
    LeaveCriticalSection(&g_connsCs);
}

static void RemoveConn(AgentConn* c) {
    EnterCriticalSection(&g_connsCs);
    for (int i = 0; i < g_connCount; i++) {
        if (g_conns[i] == c) {
            g_conns[i] = g_conns[--g_connCount];
            break;
        }
    }
    LeaveCriticalSection(&g_connsCs);
}

// ==========================================================================
// Command dispatch (stub — replaced in Task 6)
// ==========================================================================
static void DispatchCommand(AgentConn* c, const char* id, const char* cmd,
                             const char* /*json*/) {
    char err[128];
    snprintf(err, sizeof(err), "not implemented: %s", cmd);
    SendResponse(c, id, false, err);
}

// ==========================================================================
// Connection handler thread — one per client
// ==========================================================================
static DWORD WINAPI ConnectionHandler(LPVOID param) {
    AgentConn* c = (AgentConn*)param;
    char buf[BK_BUF_SIZE];
    while (!c->closing) {
        if (!ReadFrame(c->pipe, buf, BK_BUF_SIZE)) break;
        char id[32] = {}, cmd[64] = {};
        JsonGetString(buf, "id",  id,  sizeof(id));
        JsonGetString(buf, "cmd", cmd, sizeof(cmd));
        DispatchCommand(c, id, cmd, buf);
    }
    c->closing = true;
    RemoveConn(c);
    DisconnectNamedPipe(c->pipe);
    CloseHandle(c->pipe);
    DeleteCriticalSection(&c->writeMutex);
    HeapFree(GetProcessHeap(), 0, c);
    return 0;
}

// ==========================================================================
// Heartbeat thread — pushes uptime every 30s to all connected clients
// ==========================================================================
static DWORD WINAPI HeartbeatThread(LPVOID) {
    DWORD uptime = 0;
    for (;;) {
        Sleep(30000);
        uptime += 30;
        char data[64];
        snprintf(data, sizeof(data), "{\"uptime\":%lu}", uptime);
        PushEventToAll("Heartbeat", data);
    }
    return 0;
}

// ==========================================================================
// AgentMain — pipe server loop
// ==========================================================================
static DWORD WINAPI AgentMain(LPVOID) {
    InitializeCriticalSection(&g_connsCs);

    // IL2CPP init placeholder — replaced in Task 5
    // InitIl2cpp();

    CreateThread(NULL, 0, HeartbeatThread, NULL, 0, NULL);

    for (;;) {
        HANDLE pipe = CreateNamedPipeA(
            BKPIPE_NAME,
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            BK_BUF_SIZE, BK_BUF_SIZE, 0, NULL);

        if (pipe == INVALID_HANDLE_VALUE) { Sleep(1000); continue; }

        if (!ConnectNamedPipe(pipe, NULL) &&
            GetLastError() != ERROR_PIPE_CONNECTED) {
            CloseHandle(pipe); continue;
        }

        if (g_connCount >= MAX_CONNS) { CloseHandle(pipe); continue; }

        AgentConn* c = (AgentConn*)HeapAlloc(
            GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(AgentConn));
        c->pipe = pipe;
        InitializeCriticalSection(&c->writeMutex);

        EnterCriticalSection(&g_connsCs);
        g_conns[g_connCount++] = c;
        LeaveCriticalSection(&g_connsCs);

        CreateThread(NULL, 0, ConnectionHandler, c, 0, NULL);
    }
    return 0;
}

// ==========================================================================
// DllMain
// ==========================================================================
BOOL WINAPI DllMain(HINSTANCE, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH)
        CreateThread(NULL, 0, AgentMain, NULL, 0, NULL);
    return TRUE;
}
```

- [ ] **Step 2: Write build.sh**

```bash
#!/bin/bash
# Run from repo root: bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
set -e
cd "$(dirname "$0")"

x86_64-w64-mingw32-g++ \
    -shared -o BKAutoOpAgent.dll BKAutoOpAgent.cpp \
    -lkernel32 -O2 -std=c++11 \
    -static-libgcc -static-libstdc++

echo "Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll"
```

- [ ] **Step 3: Build**

```bash
cd /mnt/c/tools/bidking
bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
```

Expected: `Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`

- [ ] **Step 4: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/
git commit -m "feat: add BKAutoOpAgent.dll skeleton (pipe server + heartbeat)"
```

---

### Task 5: BKAutoOpAgent.cpp — IL2CPP layer

Add IL2CPP helpers (ported from `BKPayload64.cpp`) and wire `InitIl2cpp` into `AgentMain`.

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`

- [ ] **Step 1: Add the `#define GETFN` macro and helper functions**

Insert after the global variable declarations (after `static fn_string_new g_string_new;`) and before the connection state section:

```cpp
#define GETFN(mod, name, var) \
    var = (decltype(var))GetProcAddress(mod, #name); \
    if (!var) return false;

// --- IL2CPP helpers ---

static Il2CppClass* FindClass(const char* name) {
    if (!g_domain) return nullptr;
    size_t count;
    const Il2CppAssembly** asms = g_domain_get_assemblies(g_domain, &count);
    const char* ns[] = { "", "BidKing", "Game", "Main", nullptr };
    for (size_t ai = 0; ai < count; ai++) {
        Il2CppImage* img = g_assembly_get_image(asms[ai]);
        if (!img) continue;
        for (int ni = 0; ns[ni]; ni++) {
            Il2CppClass* k = g_class_from_name(img, ns[ni], name);
            if (k) return k;
        }
    }
    return nullptr;
}

static Il2CppObject* GetSingleton(Il2CppClass* klass) {
    if (!klass) return nullptr;
    Il2CppFieldInfo* f = g_class_get_field_from_name(klass, "Instance");
    if (f) {
        Il2CppObject* inst = nullptr;
        g_field_static_get_value(f, &inst);
        if (inst) return inst;
    }
    const Il2CppMethod* m = g_class_get_method_from_name(klass, "get_Instance", 0);
    if (m) return (Il2CppObject*)g_runtime_invoke(m, nullptr, nullptr, nullptr);
    return nullptr;
}

static Il2CppObject* SafeInvoke(const Il2CppMethod* m, void* obj, void** args) {
    if (!m) return nullptr;
    Il2CppObject* exc = nullptr;
    Il2CppObject* res = g_runtime_invoke(m, obj, args, &exc);
    return exc ? nullptr : res;
}

static int ReadListCount(Il2CppObject* list) {
    if (!list) return 0;
    Il2CppClass* klass = g_object_get_class(list);
    const Il2CppMethod* m = g_class_get_method_from_name(klass, "get_Count", 0);
    if (!m) return 0;
    Il2CppObject* res = SafeInvoke(m, list, nullptr);
    return res ? UNBOX_INT32(res) : 0;
}

// List<T> internal layout: [klass 8][monitor 8][_items ptr 8][_size 4]...
// Array layout:            [klass 8][monitor 8][bounds 8][max_length 4][pad 4][data...]
static Il2CppObject* ReadListItem(Il2CppObject* list, int index) {
    if (!list) return nullptr;
    Il2CppObject* arr = *(Il2CppObject**)((char*)list + 16);
    if (!arr) return nullptr;
    return ((Il2CppObject**)((char*)arr + 32))[index];
}

static const char* ObjClassName(Il2CppObject* obj) {
    if (!obj || !g_object_get_class) return "null";
    Il2CppClass* k = g_object_get_class(obj);
    return k ? g_class_get_name(k) : "unknown";
}

// --- InitIl2cpp ---

static bool InitIl2cpp() {
    HMODULE hGame = GetModuleHandleA("GameAssembly.dll");
    if (!hGame) return false;
    GETFN(hGame, il2cpp_domain_get,               g_domain_get)
    GETFN(hGame, il2cpp_domain_get_assemblies,     g_domain_get_assemblies)
    GETFN(hGame, il2cpp_assembly_get_image,        g_assembly_get_image)
    GETFN(hGame, il2cpp_class_from_name,           g_class_from_name)
    GETFN(hGame, il2cpp_class_get_name,            g_class_get_name)
    GETFN(hGame, il2cpp_class_get_method_from_name,g_class_get_method_from_name)
    GETFN(hGame, il2cpp_runtime_invoke,            g_runtime_invoke)
    GETFN(hGame, il2cpp_class_get_field_from_name, g_class_get_field_from_name)
    GETFN(hGame, il2cpp_field_static_get_value,    g_field_static_get_value)
    GETFN(hGame, il2cpp_object_get_class,          g_object_get_class)
    GETFN(hGame, il2cpp_thread_attach,             g_thread_attach)
    GETFN(hGame, il2cpp_string_new,                g_string_new)
    g_domain = g_domain_get();
    g_il2cpyReady = (g_domain != nullptr);
    return g_il2cpyReady;
}
```

- [ ] **Step 2: Replace the `// IL2CPP init placeholder` comment in `AgentMain` with actual init**

Find this line in `AgentMain`:
```cpp
    // IL2CPP init placeholder — replaced in Task 5
    // InitIl2cpp();
```

Replace it with:
```cpp
    InitIl2cpp();
    if (g_il2cpyReady && g_thread_attach)
        g_thread_attach(g_domain);
```

- [ ] **Step 3: Build**

```bash
cd /mnt/c/tools/bidking
bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp
git commit -m "feat: add IL2CPP reflection helpers to BKAutoOpAgent"
```

---

### Task 6: BKAutoOpAgent.cpp — command implementations

Replace the stub `DispatchCommand` with a dispatch table and implement all seven commands.

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`

- [ ] **Step 1: Delete the stub `DispatchCommand` function and replace with the full implementation**

Remove:
```cpp
static void DispatchCommand(AgentConn* c, const char* id, const char* cmd,
                             const char* /*json*/) {
    char err[128];
    snprintf(err, sizeof(err), "not implemented: %s", cmd);
    SendResponse(c, id, false, err);
}
```

Replace with:

```cpp
// ==========================================================================
// Command implementations
// ==========================================================================

static void CmdPing(AgentConn* c, const char* id, const char*) {
    SendResponse(c, id, true, "{\"pong\":true}");
}

static void CmdGetCurrentUI(AgentConn* c, const char* id, const char*) {
    if (!g_il2cpyReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    Il2CppClass* cls = FindClass("UIManager");
    Il2CppObject* mgr = GetSingleton(cls);
    if (!mgr) { SendResponse(c, id, false, "UIManager singleton null"); return; }
    const Il2CppMethod* m = g_class_get_method_from_name(cls, "GetCurShowMainUI", 0);
    Il2CppObject* cur = (Il2CppObject*)SafeInvoke(m, mgr, nullptr);
    char result[256];
    snprintf(result, sizeof(result), "{\"panel\":\"%s\"}", ObjClassName(cur));
    SendResponse(c, id, true, result);
}

static void CmdGetVisiblePanels(AgentConn* c, const char* id, const char*) {
    if (!g_il2cpyReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    Il2CppClass* cls = FindClass("UIManager");
    Il2CppObject* mgr = GetSingleton(cls);
    if (!mgr) { SendResponse(c, id, false, "UIManager singleton null"); return; }
    const Il2CppMethod* m = g_class_get_method_from_name(cls, "GetShowUIBehaviours", 0);
    Il2CppObject* list = (Il2CppObject*)SafeInvoke(m, mgr, nullptr);
    int count = ReadListCount(list);
    char arr[4096]; int pos = 0;
    pos += snprintf(arr + pos, sizeof(arr) - pos, "[");
    for (int i = 0; i < count && pos < (int)sizeof(arr) - 64; i++) {
        Il2CppObject* item = ReadListItem(list, i);
        pos += snprintf(arr + pos, sizeof(arr) - pos,
                        "%s\"%s\"", i ? "," : "", ObjClassName(item));
    }
    snprintf(arr + pos, sizeof(arr) - pos, "]");
    char result[4200];
    snprintf(result, sizeof(result), "{\"panels\":%s}", arr);
    SendResponse(c, id, true, result);
}

static void CmdOpenPanel(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cpyReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    char name[64] = {};
    JsonGetString(json, "name", name, sizeof(name));
    if (!name[0]) { SendResponse(c, id, false, "missing name"); return; }
    Il2CppClass* cls = FindClass("UIManager");
    Il2CppObject* mgr = GetSingleton(cls);
    if (!mgr) { SendResponse(c, id, false, "UIManager singleton null"); return; }
    const Il2CppMethod* m = g_class_get_method_from_name(cls, "ShowUIByName", 1);
    if (!m) { SendResponse(c, id, false, "ShowUIByName not found"); return; }
    Il2CppObject* nameStr = g_string_new(name);
    void* args[] = { nameStr };
    SafeInvoke(m, mgr, args);
    SendResponse(c, id, true, "{\"opened\":true}");
}

static void CmdClosePanel(AgentConn* c, const char* id, const char*) {
    if (!g_il2cpyReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    Il2CppClass* cls = FindClass("UIManager");
    Il2CppObject* mgr = GetSingleton(cls);
    if (!mgr) { SendResponse(c, id, false, "UIManager singleton null"); return; }
    const Il2CppMethod* m = g_class_get_method_from_name(cls, "AsyncClosePanel", 0);
    if (!m) { SendResponse(c, id, false, "AsyncClosePanel not found"); return; }
    SafeInvoke(m, mgr, nullptr);
    SendResponse(c, id, true, "{}");
}

// CollectionPrices: iterate all collection items, fetch trade info for each.
// NOTE: this command blocks the connection handler for its full duration
// (several minutes for a large collection) due to per-item rate-limit Sleep.
static void CmdCollectionPrices(AgentConn* c, const char* id, const char*) {
    if (!g_il2cpyReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) { SendResponse(c, id, false, "PlayerManager singleton null"); return; }
    const Il2CppMethod* getAllItems =
        g_class_get_method_from_name(pmClass, "GetAllCollectionItems", 0);
    Il2CppObject* itemList = (Il2CppObject*)SafeInvoke(getAllItems, pmInst, nullptr);
    int itemCount = ReadListCount(itemList);
    const Il2CppMethod* getTradeInfo =
        g_class_get_method_from_name(pmClass, "GetItemTradeInfo", 1);

    // Heap-allocate the output buffer (itemCount * ~80 bytes per entry)
    int bufSize = itemCount * 100 + 32;
    char* arr = (char*)HeapAlloc(GetProcessHeap(), 0, bufSize);
    int pos = 0;
    pos += snprintf(arr + pos, bufSize - pos, "[");

    for (int i = 0; i < itemCount; i++) {
        Il2CppObject* item = ReadListItem(itemList, i);
        if (!item) continue;
        Il2CppClass* itemClass = g_object_get_class(item);
        Il2CppFieldInfo* cidField = g_class_get_field_from_name(itemClass, "itemCid");
        if (!cidField) continue;
        int32_t cid = *(int32_t*)((char*)item + FIELDINFO_OBJECT_OFFSET(cidField));
        void* args[] = { (void*)(intptr_t)cid };
        Il2CppObject* ti = (Il2CppObject*)SafeInvoke(getTradeInfo, pmInst, args);
        if (!ti) continue;
        Il2CppClass* tiClass = g_object_get_class(ti);
        auto field32 = [&](const char* fname) -> int32_t {
            Il2CppFieldInfo* f = g_class_get_field_from_name(tiClass, fname);
            return f ? *(int32_t*)((char*)ti + FIELDINFO_OBJECT_OFFSET(f)) : 0;
        };
        pos += snprintf(arr + pos, bufSize - pos,
            "%s{\"cid\":%d,\"minPrice\":%d,\"tradeCount\":%d}",
            i ? "," : "", cid, field32("minPrice"), field32("tradeCount"));
        Sleep(500 + rand() % 500);
    }
    snprintf(arr + pos, bufSize - pos, "]");

    char* result = (char*)HeapAlloc(GetProcessHeap(), 0, bufSize + 16);
    snprintf(result, bufSize + 16, "{\"items\":%s}", arr);
    SendResponse(c, id, true, result);
    HeapFree(GetProcessHeap(), 0, arr);
    HeapFree(GetProcessHeap(), 0, result);
}

// InvokeMethod: find class, get singleton, call method with 0 or 1 int arg.
// Pass arg0 in args JSON for 1-arg methods: {"class":"X","method":"Y","arg0":42}
static void CmdInvokeMethod(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cpyReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    char cls[64] = {}, meth[64] = {};
    JsonGetString(json, "class",  cls,  sizeof(cls));
    JsonGetString(json, "method", meth, sizeof(meth));
    if (!cls[0] || !meth[0]) { SendResponse(c, id, false, "missing class or method"); return; }
    Il2CppClass* klass = FindClass(cls);
    if (!klass) { SendResponse(c, id, false, "class not found"); return; }
    Il2CppObject* inst = GetSingleton(klass);
    // Try 0-arg first
    const Il2CppMethod* m = g_class_get_method_from_name(klass, meth, 0);
    Il2CppObject* result = nullptr;
    if (m) {
        result = (Il2CppObject*)SafeInvoke(m, inst, nullptr);
    } else {
        // Try 1-arg int32
        m = g_class_get_method_from_name(klass, meth, 1);
        if (!m) { SendResponse(c, id, false, "method not found"); return; }
        int argVal = JsonGetInt(json, "arg0");
        if (argVal == INT_MIN) { SendResponse(c, id, false, "missing arg0"); return; }
        void* args[] = { (void*)(intptr_t)argVal };
        result = (Il2CppObject*)SafeInvoke(m, inst, args);
    }
    char res[256];
    snprintf(res, sizeof(res), "{\"resultClass\":\"%s\"}", ObjClassName(result));
    SendResponse(c, id, true, res);
}

// ==========================================================================
// Dispatch table
// ==========================================================================
typedef void (*CmdFn)(AgentConn*, const char*, const char*);
struct CmdEntry { const char* name; CmdFn fn; };
static const CmdEntry kCommands[] = {
    { "Ping",             CmdPing             },
    { "GetCurrentUI",     CmdGetCurrentUI     },
    { "GetVisiblePanels", CmdGetVisiblePanels },
    { "OpenPanel",        CmdOpenPanel        },
    { "ClosePanel",       CmdClosePanel       },
    { "CollectionPrices", CmdCollectionPrices },
    { "InvokeMethod",     CmdInvokeMethod     },
    { nullptr,            nullptr             },
};

static void DispatchCommand(AgentConn* c, const char* id, const char* cmd,
                             const char* json) {
    for (int i = 0; kCommands[i].name; i++) {
        if (strcmp(kCommands[i].name, cmd) == 0) {
            kCommands[i].fn(c, id, json);
            return;
        }
    }
    char err[128];
    snprintf(err, sizeof(err), "unknown command: %s", cmd);
    SendResponse(c, id, false, err);
}
```

- [ ] **Step 2: Build**

```bash
cd /mnt/c/tools/bidking
bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp
git commit -m "feat: implement BKAutoOpAgent command dispatch (Ping, GetCurrentUI, GetVisiblePanels, OpenPanel, ClosePanel, CollectionPrices, InvokeMethod)"
```

---

### Task 7: Smoke test

Verify both DLLs build cleanly and the Agent responds to a Ping command via pipe.

**Files:** none

- [ ] **Step 1: Clean build of both DLLs**

```bash
cd /mnt/c/tools/bidking
bash tools/inject/AutoOperation/BKAutoOpClient/build.sh
bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
```

Expected: both print their `Done:` lines with exit code 0.

- [ ] **Step 2: Verify client exports**

```bash
x86_64-w64-mingw32-nm \
  tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.dll \
  | grep " T " | grep -v DllMain
```

Expected: five lines containing `BKBuildCommand`, `BKConnect`, `BKDisconnect`, `BKSendCommand`, `BKSetEventCallback`.

- [ ] **Step 3: Inject agent into BidKing (Windows PowerShell)**

With BidKing running:

```powershell
$dll = "C:\tools\bidking\tools\inject\AutoOperation\BKAutoOpAgent\BKAutoOpAgent.dll"
& "C:\tools\bidking\tools\inject\BKPayload64\inject.ps1" -DllPath $dll
```

Expected: PowerShell exits without error.

- [ ] **Step 4: Send Ping via PowerShell named-pipe client**

In a second PowerShell window:

```powershell
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream(
    ".", "BKAutoOp", [System.IO.Pipes.PipeDirection]::InOut)
$pipe.Connect(3000)

$msg   = '{"cmd":"Ping","args":{}}'
$frame = [System.Text.Encoding]::UTF8.GetBytes($msg)
$len   = [BitConverter]::GetBytes([uint32]$frame.Length)
# Inject id manually to satisfy the protocol
$full  = [System.Text.Encoding]::UTF8.GetBytes('{"id":"1","cmd":"Ping","args":{}}')
$lenFull = [BitConverter]::GetBytes([uint32]$full.Length)
$pipe.Write($lenFull, 0, 4)
$pipe.Write($full, 0, $full.Length)

$lenBuf = New-Object byte[] 4
$pipe.Read($lenBuf, 0, 4)
$respLen = [BitConverter]::ToUInt32($lenBuf, 0)
$respBuf = New-Object byte[] $respLen
$pipe.Read($respBuf, 0, $respLen)
[System.Text.Encoding]::UTF8.GetString($respBuf)
$pipe.Dispose()
```

Expected output:
```
{"id":"1","ok":true,"result":{"pong":true}}
```

- [ ] **Step 5: Test GetCurrentUI**

Same pipe pattern, frame payload:
```
{"id":"2","cmd":"GetCurrentUI","args":{}}
```

Expected output (varies by current game state):
```
{"id":"2","ok":true,"result":{"panel":"UIMain"}}
```

- [ ] **Step 6: Final commit**

```bash
git add tools/inject/AutoOperation/
git commit -m "chore: complete AutoOperation IPC smoke test verification"
```
