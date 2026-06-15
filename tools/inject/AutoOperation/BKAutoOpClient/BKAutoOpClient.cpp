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
    if (!c->readThread) {
        CloseHandle(pipe);
        DeleteCriticalSection(&c->cs);
        HeapFree(GetProcessHeap(), 0, c);
        return NULL;
    }
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
