#pragma once

#include <ctype.h>
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

inline std::string StripAutoAuctionLobbyRoomEntryCounterFormatting(const std::string& text) {
    std::string plainText;
    plainText.reserve(text.size());
    bool insideTag = false;
    for (size_t i = 0; i < text.size(); ++i) {
        const char ch = text[i];
        if (insideTag) {
            if (ch == '>') {
                insideTag = false;
            }
            continue;
        }
        if (ch == '<') {
            insideTag = true;
            continue;
        }
        plainText.push_back(ch);
    }
    return plainText;
}

inline bool TryParseAutoAuctionLobbyRoomEntryCounterText(
    const std::string& text,
    int* currentCount,
    int* limitCount
) {
    if (currentCount) *currentCount = 0;
    if (limitCount) *limitCount = 0;

    const std::string plainText = StripAutoAuctionLobbyRoomEntryCounterFormatting(text);
    for (size_t i = 0; i < plainText.size(); ++i) {
        if (!isdigit((unsigned char)plainText[i])) {
            continue;
        }

        int parsedCurrentCount = 0;
        size_t j = i;
        while (j < plainText.size() && isdigit((unsigned char)plainText[j])) {
            parsedCurrentCount = parsedCurrentCount * 10 + (plainText[j] - '0');
            ++j;
        }

        while (j < plainText.size() && isspace((unsigned char)plainText[j])) {
            ++j;
        }
        if (j >= plainText.size() || plainText[j] != '/') {
            continue;
        }
        ++j;

        while (j < plainText.size() && isspace((unsigned char)plainText[j])) {
            ++j;
        }
        if (j >= plainText.size() || !isdigit((unsigned char)plainText[j])) {
            continue;
        }

        int parsedLimitCount = 0;
        while (j < plainText.size() && isdigit((unsigned char)plainText[j])) {
            parsedLimitCount = parsedLimitCount * 10 + (plainText[j] - '0');
            ++j;
        }

        if (currentCount) *currentCount = parsedCurrentCount;
        if (limitCount) *limitCount = parsedLimitCount;
        return true;
    }

    return false;
}

inline bool IsAutoAuctionLobbyRoomEntryLimitReachedText(const std::string& text) {
    int currentCount = 0;
    int limitCount = 0;
    return TryParseAutoAuctionLobbyRoomEntryCounterText(text, &currentCount, &limitCount) &&
        currentCount == 100 &&
        limitCount == 100;
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

// --- AutoAuction polling infrastructure ---

enum PollResult {
    POLL_OK = 0,
    POLL_TIMEOUT = 1,
    POLL_AUTHCODE = 2,
    POLL_INTERRUPTED = 3
};

struct PollWaitResult {
    PollResult result;
    int waitedMs;
};

// Bid-loop throttle: minimum interval between same-round click attempts.
// The current implementation provides an implicit ~1000ms floor via the
// per-iteration SleepInterruptibly(1000). The spec requires this floor
// be preserved even when observation polling runs faster.
inline int GetAutoAuctionBidRetryCooldownMs() {
    return 1000;
}

// Step 5 staged-polling intervals (spec §Timeouts and Polling Policy):
//   Fast initial window (first 3000ms):  100ms poll interval
//   Medium window (3000ms – 15000ms):    500ms poll interval
//   Sustained wait (>15000ms):          1500ms poll interval
inline int GetWaitForAuctionInProgressFastWindowMs()   { return 3000; }
inline int GetWaitForAuctionInProgressMediumWindowMs() { return 15000; }
inline int GetWaitForAuctionInProgressPollFastMs()     { return 100; }
inline int GetWaitForAuctionInProgressPollMediumMs()   { return 500; }
inline int GetWaitForAuctionInProgressPollSlowMs()     { return 1500; }

inline int ResolveAutoAuctionReportedExpectedPrice(
    int lastExpectedPrice,
    int notifiedExpectedPrice
) {
    return lastExpectedPrice > 0 ? lastExpectedPrice : notifiedExpectedPrice;
}
