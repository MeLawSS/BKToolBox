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
