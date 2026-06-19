#pragma once

#include <string.h>

inline bool IsStableCabinetRewardEntryScreen(const char* screen) {
    return screen &&
        (strcmp(screen, "main_lobby") == 0 || strcmp(screen, "warehouse") == 0);
}

inline bool ShouldOpenWarehouseForCabinetReward(const char* screen) {
    return screen && strcmp(screen, "main_lobby") == 0;
}

inline bool ShouldCountAutoAuctionRound(
    bool placeBidClicked,
    bool hasBattleMainAfterClick,
    bool hasActiveBidInput,
    bool setBidAmountSucceeded,
    bool confirmBidClicked
) {
    return placeBidClicked &&
        hasBattleMainAfterClick &&
        hasActiveBidInput &&
        setBidAmountSucceeded &&
        confirmBidClicked;
}

inline bool IsAutoAuctionCleanupCompleteScreen(const char* screen) {
    return screen && strcmp(screen, "main_lobby") == 0;
}

inline bool IsAutoAuctionCleanupBattlePrevScreen(const char* screen) {
    return screen &&
        (strcmp(screen, "auction_lobby_map") == 0 || strcmp(screen, "auction_lobby_room") == 0);
}

inline bool IsAutoAuctionCleanupEndedScreen(const char* screen) {
    return screen && strcmp(screen, "auction_ended") == 0;
}

inline bool IsAutoAuctionCleanupRecoverableScreen(const char* screen) {
    return IsAutoAuctionCleanupCompleteScreen(screen) ||
        IsAutoAuctionCleanupBattlePrevScreen(screen) ||
        IsAutoAuctionCleanupEndedScreen(screen);
}

inline bool ShouldAbortAutoAuction(bool cancelRequested, bool shuttingDown) {
    return cancelRequested || shuttingDown;
}

// roundsEncountered: 1-indexed count of distinct auction rounds seen (first round = 1).
// Returns bid amount (truncated). Returns 0 if expectedPrice <= 0 — caller must skip bidding.
inline int ComputeBidAmount(int expectedPrice, int roundsEncountered) {
    if (expectedPrice <= 0) return 0;
    double multiplier = (roundsEncountered == 1) ? 2.0
                      : (roundsEncountered == 2) ? 1.7
                      :                            1.0;
    return static_cast<int>(expectedPrice * multiplier);
}
