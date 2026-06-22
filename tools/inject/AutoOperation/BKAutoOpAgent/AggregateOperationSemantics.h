#pragma once

#include <string.h>
#include <string>

inline bool IsStableCabinetRewardEntryScreen(const char* screen) {
    return screen &&
        (strcmp(screen, "main_lobby") == 0 || strcmp(screen, "warehouse") == 0);
}

inline bool ShouldOpenWarehouseForCabinetReward(const char* screen) {
    return screen && strcmp(screen, "main_lobby") == 0;
}

inline bool IsEligibleAutoCollectCabinetRewardScreen(const char* screen) {
    return ShouldOpenWarehouseForCabinetReward(screen);
}

inline bool ShouldSkipAutoCollectCabinetRewardForAutoAuction(bool autoAuctionRunning) {
    return autoAuctionRunning;
}

inline bool ShouldSkipAutoCollectCabinetRewardForBusyFlow(bool rewardFlowRunning) {
    return rewardFlowRunning;
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

inline bool DidCompleteBidConfirmation(
    bool primaryConfirmClicked,
    bool secondaryConfirmRequired,
    bool secondaryConfirmClicked,
    bool bidDialogClosed
) {
    return primaryConfirmClicked &&
        (!secondaryConfirmRequired || secondaryConfirmClicked) &&
        bidDialogClosed;
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

inline bool IsAutoAuctionVerificationScreen(const char* screen) {
    return screen && strcmp(screen, "authcode") == 0;
}

inline int GetAutoAuctionCleanupMaxAttempts() {
    return 40;
}

inline const char* PickAutoAuctionEndedPrimaryActionPath(
    bool hasReceiveButton,
    bool hasContinueButton
) {
    if (hasReceiveButton) return "EndPanel/tuichu/receiveBtn";
    if (hasContinueButton) return "EndPanel/tuichu/continueBtn";
    return nullptr;
}

inline bool ShouldAbortAutoAuction(bool cancelRequested, bool shuttingDown) {
    return cancelRequested || shuttingDown;
}

inline bool ShouldRecordAutoAuctionRoundSeen(
    const std::string& round,
    const std::string& lastRoundSeen
) {
    return !round.empty() && round != lastRoundSeen;
}

inline bool ShouldAttemptExpectedPriceAutoBid(
    int resolvedAmount,
    const std::string& round,
    const std::string& lastBidRound
) {
    return resolvedAmount > 0 && !round.empty() && round != lastBidRound;
}

inline bool ShouldAttemptLegacyAutoBid(
    int secs,
    const std::string& round,
    const std::string& lastBidRound
) {
    return secs < 15 && !round.empty() && round != lastBidRound;
}

inline int ClampAutoAuctionBidAmount(
    int computedAmount,
    int maxAmount
) {
    if (computedAmount <= 0) return computedAmount;
    return computedAmount > maxAmount ? maxAmount : computedAmount;
}

// Hard floor for the first observed round — ensures the opening bid is competitive.
// roundsEncountered is the script-observed counter (not the game's round number).
inline int ClampAutoAuctionFirstRoundBid(
    int amount,
    int roundsEncountered,
    int floorAmount
) {
    if (roundsEncountered == 1 && amount < floorAmount) {
        return floorAmount;
    }
    return amount;
}

inline bool ShouldDisableAutoAuctionPriceUpperLimit(
    bool toggleFound,
    bool toggleActive,
    bool toggleInteractive,
    bool toggleOn
) {
    return toggleFound && toggleActive && toggleInteractive && toggleOn;
}

inline int ResolveAutoAuctionReportedExpectedPrice(
    int lastExpectedPrice,
    int notifiedExpectedPrice
) {
    return lastExpectedPrice > 0 ? lastExpectedPrice : notifiedExpectedPrice;
}
