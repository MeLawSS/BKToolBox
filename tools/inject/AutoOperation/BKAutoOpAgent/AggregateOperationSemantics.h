#pragma once

#include <ctype.h>
#include <stdio.h>
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

inline const char* GetAutoAuctionVerificationScreenName() {
    return "authcode";
}

inline bool IsAutoAuctionVerificationScreen(const char* screen) {
    return screen && strcmp(screen, GetAutoAuctionVerificationScreenName()) == 0;
}

inline bool TryResolveAutoAuctionVerificationDismissTarget(
    const char* screen,
    const char** panelNameOut,
    const char** pathOut
) {
    if (panelNameOut) *panelNameOut = nullptr;
    if (pathOut) *pathOut = nullptr;
    if (!IsAutoAuctionVerificationScreen(screen)) {
        return false;
    }
    if (panelNameOut) *panelNameOut = "AuthCode_Main";
    if (pathOut) *pathOut = "Main/m_BtnClose";
    return true;
}

inline int GetAutoAuctionCleanupMaxAttempts() {
    return 200;  // ~40s budget at 200ms poll (was 40 × 1000ms)
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

inline int ResolveAutoAuctionFirstRoundFloorAmount(int roomId) {
    return roomId == 102 ? 30000 : 17000;
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

// --- AutoAuction shared constants ---

// Bid-loop throttle: minimum interval between same-round click attempts.
// The current implementation provides an implicit ~1000ms floor via the
// per-iteration SleepInterruptibly(1000). The spec requires this floor
// be preserved even when observation polling runs faster.
inline int GetAutoAuctionBidRetryCooldownMs() {
    return 1000;
}

// Opponent-cap settle window: minimum time the UI must have been on a new
// round before first-attempt reads of opponent name / previous-round bid.
// Shorter than the cooldown; only gates the first read after round change.
inline int GetAutoAuctionOpponentCapSettleWindowMs() {
    return 500;
}

// Step 5 staged-polling intervals (spec §Timeouts and Polling Policy):
//   Fast initial window (first 10000ms):  200ms poll interval
//   Medium window (10000ms – 30000ms):    500ms poll interval
//   Sustained wait (>30000ms):           1500ms poll interval
inline int GetWaitForAuctionInProgressFastWindowMs()   { return 10000; }
inline int GetWaitForAuctionInProgressMediumWindowMs() { return 30000; }
inline int GetWaitForAuctionInProgressPollFastMs()     { return 200; }
inline int GetWaitForAuctionInProgressPollMediumMs()   { return 500; }
inline int GetWaitForAuctionInProgressPollSlowMs()     { return 1500; }

// Returns true when a same-round bid retry is allowed — at least
// GetAutoAuctionBidRetryCooldownMs() must have elapsed since the last attempt,
// OR the round must have advanced.
inline bool ShouldAttemptAutoBidRetry(
    const std::string& currentRound,
    const std::string& lastBidAttemptRound,
    unsigned long lastBidAttemptMs,
    unsigned long nowMs)
{
    if (currentRound.empty()) return false;
    if (currentRound != lastBidAttemptRound) return true;
    unsigned long elapsed = nowMs - lastBidAttemptMs;
    return elapsed >= (unsigned long)GetAutoAuctionBidRetryCooldownMs();
}

// --- AutoAuction error code formatting ---
// These produce stable, machine-readable stage codes per the spec's
// Response and Error Semantics section.
inline std::string BuildAutoAuctionTimeoutError(const char* stage) {
    std::string result = "auto_auction_timeout:";
    result += stage;
    return result;
}

inline std::string BuildAutoAuctionUiError(const char* stage) {
    std::string result = "auto_auction_ui_error:";
    result += stage;
    return result;
}

inline std::string BuildAutoAuctionUnexpectedScreenError(const char* screen) {
    std::string result = "auto_auction_unexpected_screen:";
    result += (screen && screen[0]) ? screen : "null";
    return result;
}

inline int ResolveAutoAuctionReportedExpectedPrice(
    int lastExpectedPrice,
    int notifiedExpectedPrice
) {
    return lastExpectedPrice > 0 ? lastExpectedPrice : notifiedExpectedPrice;
}

// ---- RefreshExchangeSellSlots semantics ---------------------------------

inline bool IsExchangeScreen(const char* screen) {
    return screen && strcmp(screen, "exchange") == 0;
}

inline bool IsMainLobbyScreen(const char* screen) {
    return screen && strcmp(screen, "main_lobby") == 0;
}

inline bool IsExchangeConvergeTargetScreen(const char* screen) {
    return IsMainLobbyScreen(screen) || IsExchangeScreen(screen);
}

inline bool ShouldContinueExchangeConverge(const char* screen) {
    return screen && screen[0] != '\0' && strcmp(screen, "unknown") != 0 && !IsExchangeConvergeTargetScreen(screen);
}

inline bool IsExchangeSellTabReady(const char* screen, bool hasTradingPanel) {
    return IsExchangeScreen(screen) && hasTradingPanel;
}

// ---- Expected-price confirm gate semantics ---------------------------------

enum ConfirmGateResult {
    CONFIRM_GATE_READY_OPPONENT_BID  = 0,
    CONFIRM_GATE_READY_TIME_FALLBACK = 1,
    CONFIRM_GATE_NOT_READY           = 2
};

enum ConfirmGateSoftExitReason {
    CONFIRM_GATE_SOFT_EXIT_NONE          = 0,
    CONFIRM_GATE_SOFT_EXIT_ROUND_CHANGED = 1,
    CONFIRM_GATE_SOFT_EXIT_DIALOG_LOST   = 2
};

// Returns the live UI signal path indicating that the given player has already
// placed a bid in the current round. This is separate from RoundUnit/priceTxt,
// which is populated later as round history rather than live bid state.
inline std::string GetOpponentCurrentRoundBidSignalPath(int slot) {
    char path[256];
    snprintf(path, sizeof(path),
        "Gaming/PlayerContainer/Player_%d/bided",
        slot);
    return std::string(path);
}

inline bool DidAnyNewCurrentRoundBidSignalAppear(
    const bool* entrySignals,
    const bool* currentSignals,
    int slotCount
) {
    if (!entrySignals || !currentSignals || slotCount <= 0) {
        return false;
    }

    for (int i = 0; i < slotCount; ++i) {
        if (!entrySignals[i] && currentSignals[i]) {
            return true;
        }
    }
    return false;
}

inline int CountActiveCurrentRoundBidSignals(const bool* signals, int slotCount) {
    if (!signals || slotCount <= 0) {
        return 0;
    }
    int count = 0;
    for (int i = 0; i < slotCount; ++i) {
        if (signals[i]) {
            count++;
        }
    }
    return count;
}

inline bool DidCurrentRoundBidSignalCountIncrease(
    const bool* entrySignals,
    const bool* currentSignals,
    int slotCount
) {
    return CountActiveCurrentRoundBidSignals(currentSignals, slotCount) >
        CountActiveCurrentRoundBidSignals(entrySignals, slotCount);
}

inline int CountVisibleNamedPlayers(const std::string* playerNames, int slotCount) {
    if (!playerNames || slotCount <= 0) {
        return 0;
    }
    int count = 0;
    for (int i = 0; i < slotCount; ++i) {
        if (!playerNames[i].empty()) {
            count++;
        }
    }
    return count;
}

inline int GetAutoAuctionExpectedPriceConfirmGateMaxPlayerSlots() { return 4; }

inline int GetExpectedPriceConfirmGateRequiredOtherBidCount(int visibleNamedPlayerCount) {
    if (visibleNamedPlayerCount <= 1) {
        return 0;
    }
    return visibleNamedPlayerCount - 1;
}

inline bool IsExpectedPriceConfirmGateVisiblePlayersReady(
    int visibleNamedPlayerCount,
    int activeBidSignalCount
) {
    if (activeBidSignalCount < 0) {
        return false;
    }
    if (visibleNamedPlayerCount <= 1) {
        return false;
    }
    return activeBidSignalCount >=
        GetExpectedPriceConfirmGateRequiredOtherBidCount(visibleNamedPlayerCount);
}

inline bool IsExpectedPriceConfirmGateOpponentBidSignalReady(
    int visibleNamedPlayerCount,
    int activeBidSignalCount
) {
    return IsExpectedPriceConfirmGateVisiblePlayersReady(
        visibleNamedPlayerCount,
        activeBidSignalCount
    );
}

inline bool ShouldWaitForExpectedPriceConfirmGateBidSignalTransition(
    int visibleNamedPlayerCount,
    int entryBidSignalCount
) {
    if (entryBidSignalCount < 0) {
        return false;
    }
    if (visibleNamedPlayerCount <= 1) {
        return false;
    }
    return entryBidSignalCount <
        GetExpectedPriceConfirmGateRequiredOtherBidCount(visibleNamedPlayerCount);
}

inline int GetExpectedPriceConfirmGateOpponentBidConfirmDelayMs() { return 1000; }

inline bool ShouldDelayExpectedPriceConfirmAfterGate(ConfirmGateResult result) {
    return result == CONFIRM_GATE_READY_OPPONENT_BID;
}

inline bool ShouldRecoverExpectedPriceBidDialogAfterGate(
    ConfirmGateResult result,
    bool hasActiveBidDialog
) {
    return result == CONFIRM_GATE_READY_OPPONENT_BID && !hasActiveBidDialog;
}

inline bool DoesExpectedPriceBidInputMatch(const std::string& inputText, int expectedAmount) {
    if (expectedAmount <= 0 || inputText.empty()) {
        return false;
    }

    int parsedAmount = 0;
    for (size_t i = 0; i < inputText.size(); ) {
        const unsigned char ch = static_cast<unsigned char>(inputText[i]);
        if (ch >= '0' && ch <= '9') {
            parsedAmount = parsedAmount * 10 + (ch - '0');
            ++i;
            continue;
        }
        if (ch == ',' || ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') {
            ++i;
            continue;
        }
        if (i + 2 < inputText.size() &&
            static_cast<unsigned char>(inputText[i]) == 0xEF &&
            static_cast<unsigned char>(inputText[i + 1]) == 0xBC &&
            static_cast<unsigned char>(inputText[i + 2]) == 0x8C) {
            i += 3;
            continue;
        }
        return false;
    }
    return parsedAmount == expectedAmount;
}

inline int GetExpectedPriceConfirmGatePollIntervalMs() { return 100; }
