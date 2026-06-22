#pragma once

#include <stdint.h>
#include <stdio.h>
#include <string.h>

inline uint64_t NextAutoCollectCabinetRewardControlVersion(uint64_t currentVersion) {
    return currentVersion + 1ULL;
}

inline uint64_t ResolveAutoCollectCabinetRewardDueTick(
    bool enabled,
    uint64_t nowTick,
    uint64_t intervalMs
) {
    return enabled ? (nowTick + intervalMs) : 0ULL;
}

inline bool CanAutoCollectCabinetRewardCycleStart(
    bool enabled,
    uint64_t expectedControlVersion,
    uint64_t currentControlVersion
) {
    return enabled && expectedControlVersion == currentControlVersion;
}

inline bool ShouldAutoCollectCabinetRewardWorkerReschedule(
    uint64_t cycleControlVersion,
    uint64_t currentControlVersion
) {
    return cycleControlVersion == currentControlVersion;
}

inline bool IsStrictJsonBooleanTerminator(char ch) {
    return ch == '\0' || ch == ',' || ch == '}' || ch == ']' ||
        ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n';
}

inline bool TryParseStrictJsonBoolField(const char* json, const char* field, bool* out) {
    if (!json || !field || !out) return false;

    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\":", field);
    const char* p = strstr(json, needle);
    if (!p) return false;
    p += strlen(needle);
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;

    if (strncmp(p, "true", 4) == 0 && IsStrictJsonBooleanTerminator(p[4])) {
        *out = true;
        return true;
    }
    if (strncmp(p, "false", 5) == 0 && IsStrictJsonBooleanTerminator(p[5])) {
        *out = false;
        return true;
    }
    return false;
}
