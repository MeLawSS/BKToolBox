#pragma once

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
