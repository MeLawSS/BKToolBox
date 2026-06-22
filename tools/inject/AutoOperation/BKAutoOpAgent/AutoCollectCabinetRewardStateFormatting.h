#pragma once

#include <stdint.h>
#include <stdio.h>
#include <string>

struct AutoCollectCabinetRewardStateSnapshot {
    bool enabled = true;
    bool running = false;
    int intervalMs = 10800000;
    int64_t nextCheckInMs = -1;
    uint64_t lastCheckAtUnixMs = 0;
    const char* lastResultCode = "never_run";
    const char* lastResultMessage = "";
    const char* lastObservedScreen = "";
};

inline uint64_t ConvertWindowsFileTime100nsToUnixMs(uint64_t fileTime100ns) {
    const uint64_t kWindowsEpochOffset100ns = 116444736000000000ULL;
    if (fileTime100ns <= kWindowsEpochOffset100ns) return 0ULL;
    return (fileTime100ns - kWindowsEpochOffset100ns) / 10000ULL;
}

inline std::string BuildAutoCollectCabinetRewardStateJson(
    const AutoCollectCabinetRewardStateSnapshot& snapshot
) {
    char buf[1024];
    if (snapshot.nextCheckInMs < 0) {
        snprintf(
            buf,
            sizeof(buf),
            "{\"enabled\":%s,\"running\":%s,\"intervalMs\":%d,\"nextCheckInMs\":null,\"lastCheckAtUnixMs\":%llu,\"lastResultCode\":\"%s\",\"lastResultMessage\":\"%s\",\"lastObservedScreen\":\"%s\"}",
            snapshot.enabled ? "true" : "false",
            snapshot.running ? "true" : "false",
            snapshot.intervalMs,
            (unsigned long long)snapshot.lastCheckAtUnixMs,
            snapshot.lastResultCode ? snapshot.lastResultCode : "",
            snapshot.lastResultMessage ? snapshot.lastResultMessage : "",
            snapshot.lastObservedScreen ? snapshot.lastObservedScreen : ""
        );
    } else {
        snprintf(
            buf,
            sizeof(buf),
            "{\"enabled\":%s,\"running\":%s,\"intervalMs\":%d,\"nextCheckInMs\":%lld,\"lastCheckAtUnixMs\":%llu,\"lastResultCode\":\"%s\",\"lastResultMessage\":\"%s\",\"lastObservedScreen\":\"%s\"}",
            snapshot.enabled ? "true" : "false",
            snapshot.running ? "true" : "false",
            snapshot.intervalMs,
            (long long)snapshot.nextCheckInMs,
            (unsigned long long)snapshot.lastCheckAtUnixMs,
            snapshot.lastResultCode ? snapshot.lastResultCode : "",
            snapshot.lastResultMessage ? snapshot.lastResultMessage : "",
            snapshot.lastObservedScreen ? snapshot.lastObservedScreen : ""
        );
    }
    return std::string(buf);
}
