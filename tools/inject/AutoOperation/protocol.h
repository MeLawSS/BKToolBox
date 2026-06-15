#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <limits.h>

#define BKPIPE_NAME "\\\\.\\pipe\\BKAutoOp"
#define BK_BUF_SIZE 262144

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

static bool JsonGetBool(const char* json, const char* field, bool* out) {
    if (!json || !field || !out) return false;
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\":", field);
    const char* p = strstr(json, needle);
    if (!p) return false;
    p += strlen(needle);
    while (*p == ' ') p++;
    if (strncmp(p, "true", 4) == 0) {
        *out = true;
        return true;
    }
    if (strncmp(p, "false", 5) == 0) {
        *out = false;
        return true;
    }
    if (*p == '1') {
        *out = true;
        return true;
    }
    if (*p == '0') {
        *out = false;
        return true;
    }
    return false;
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
