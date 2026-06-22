#pragma once

#include "AggregateOperationSemantics.h"

#include <stdio.h>
#include <string>

inline std::string BuildAutoAuctionAuthCodeRequiredResult(int roundsPlayed, int expectedPrice) {
    char result[192];
    snprintf(
        result,
        sizeof(result),
        "{\"result\":\"authcode_required\",\"reason\":\"authcode_detected\",\"rounds\":%d,\"expectedPrice\":%d}",
        roundsPlayed,
        expectedPrice
    );
    return std::string(result);
}

inline std::string BuildAutoAuctionRoomEntryLimitReachedResult(int roundsPlayed, int expectedPrice) {
    char result[224];
    snprintf(
        result,
        sizeof(result),
        "{\"result\":\"room_entry_limit_reached\",\"reason\":\"daily_room_entry_limit_reached\",\"rounds\":%d,\"expectedPrice\":%d}",
        roundsPlayed,
        expectedPrice
    );
    return std::string(result);
}

inline bool TryBuildAutoAuctionRoomEntryLimitReachedResultFromCountText(
    const std::string& countText,
    int roundsPlayed,
    int reportedExpectedPrice,
    std::string* outResult
) {
    if (!outResult) return false;
    outResult->clear();
    if (!IsAutoAuctionLobbyRoomEntryLimitReachedText(countText)) {
        return false;
    }
    *outResult = BuildAutoAuctionRoomEntryLimitReachedResult(roundsPlayed, reportedExpectedPrice);
    return true;
}
