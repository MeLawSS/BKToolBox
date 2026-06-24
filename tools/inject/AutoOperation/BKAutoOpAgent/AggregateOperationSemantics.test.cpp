#include "AggregateOperationSemantics.h"

#include <assert.h>

int main() {
    assert(IsStableCabinetRewardEntryScreen("main_lobby"));
    assert(IsStableCabinetRewardEntryScreen("warehouse"));
    assert(!IsStableCabinetRewardEntryScreen("mailbox"));

    assert(ShouldOpenWarehouseForCabinetReward("main_lobby"));
    assert(!ShouldOpenWarehouseForCabinetReward("warehouse"));

    assert(!ShouldCountAutoAuctionRound(false, true, true, true, true));
    assert(!ShouldCountAutoAuctionRound(true, false, true, true, true));
    assert(!ShouldCountAutoAuctionRound(true, true, false, true, true));
    assert(!ShouldCountAutoAuctionRound(true, true, true, false, true));
    assert(!ShouldCountAutoAuctionRound(true, true, true, true, false));
    assert(ShouldCountAutoAuctionRound(true, true, true, true, true));
    assert(!DidCompleteBidConfirmation(false, false, false, false));
    assert(!DidCompleteBidConfirmation(true, false, false, false));
    assert(DidCompleteBidConfirmation(true, false, false, true));
    assert(DidCompleteBidConfirmation(true, false, true, true));
    assert(!DidCompleteBidConfirmation(true, true, false, true));
    assert(!DidCompleteBidConfirmation(true, true, true, false));
    assert(DidCompleteBidConfirmation(true, true, true, true));
    assert(!ShouldCountAutoAuctionRound(
        true,
        true,
        true,
        true,
        DidCompleteBidConfirmation(true, true, false, true)
    ));
    assert(ShouldCountAutoAuctionRound(
        true,
        true,
        true,
        true,
        DidCompleteBidConfirmation(true, true, true, true)
    ));

    assert(IsAutoAuctionCleanupCompleteScreen("main_lobby"));
    assert(!IsAutoAuctionCleanupCompleteScreen("auction_lobby_map"));

    assert(IsAutoAuctionCleanupBattlePrevScreen("auction_lobby_map"));
    assert(IsAutoAuctionCleanupBattlePrevScreen("auction_lobby_room"));
    assert(!IsAutoAuctionCleanupBattlePrevScreen("auction_ended"));

    assert(IsAutoAuctionCleanupEndedScreen("auction_ended"));
    assert(!IsAutoAuctionCleanupEndedScreen("main_lobby"));

    assert(IsAutoAuctionCleanupRecoverableScreen("auction_ended"));
    assert(IsAutoAuctionCleanupRecoverableScreen("auction_lobby_map"));
    assert(IsAutoAuctionCleanupRecoverableScreen("main_lobby"));
    assert(!IsAutoAuctionCleanupRecoverableScreen("warehouse"));
    assert(IsAutoAuctionVerificationScreen("authcode"));
    assert(!IsAutoAuctionVerificationScreen("auction_in_progress"));
    const char* verificationPanel = nullptr;
    const char* verificationPath = nullptr;
    assert(TryResolveAutoAuctionVerificationDismissTarget(
        "authcode",
        &verificationPanel,
        &verificationPath
    ));
    assert(strcmp(verificationPanel, "AuthCode_Main") == 0);
    assert(strcmp(verificationPath, "Main/m_BtnClose") == 0);
    verificationPanel = nullptr;
    verificationPath = nullptr;
    assert(!TryResolveAutoAuctionVerificationDismissTarget(
        "auction_lobby_room",
        &verificationPanel,
        &verificationPath
    ));
    assert(GetAutoAuctionCleanupMaxAttempts() == 200);  // ~40s at 200ms poll
    assert(strcmp(PickAutoAuctionEndedPrimaryActionPath(true, false), "EndPanel/tuichu/receiveBtn") == 0);
    assert(strcmp(PickAutoAuctionEndedPrimaryActionPath(false, true), "EndPanel/tuichu/continueBtn") == 0);
    assert(strcmp(PickAutoAuctionEndedPrimaryActionPath(true, true), "EndPanel/tuichu/receiveBtn") == 0);
    assert(PickAutoAuctionEndedPrimaryActionPath(false, false) == nullptr);

    assert(ShouldAbortAutoAuction(true, false));
    assert(ShouldAbortAutoAuction(false, true));
    assert(!ShouldAbortAutoAuction(false, false));

    assert(ShouldRecordAutoAuctionRoundSeen("第1轮", ""));
    assert(!ShouldRecordAutoAuctionRoundSeen("", ""));
    assert(!ShouldRecordAutoAuctionRoundSeen("第1轮", "第1轮"));

    assert(!ShouldAttemptExpectedPriceAutoBid(11119, "", ""));
    assert(!ShouldAttemptExpectedPriceAutoBid(11119, "第1轮", "第1轮"));
    assert(!ShouldAttemptExpectedPriceAutoBid(0, "第1轮", ""));
    assert(ShouldAttemptExpectedPriceAutoBid(11119, "第1轮", ""));

    assert(!ShouldAttemptLegacyAutoBid(15, "第1轮", ""));
    assert(ShouldAttemptLegacyAutoBid(14, "第1轮", ""));
    assert(!ShouldAttemptLegacyAutoBid(14, "第1轮", "第1轮"));
    int currentCount = 0;
    int limitCount = 0;
    assert(TryParseAutoAuctionLobbyRoomEntryCounterText("100/100", &currentCount, &limitCount));
    assert(currentCount == 100 && limitCount == 100);
    assert(TryParseAutoAuctionLobbyRoomEntryCounterText(
        "今日次数：<color=#FF0000>100/100",
        &currentCount,
        &limitCount
    ));
    assert(currentCount == 100 && limitCount == 100);
    assert(TryParseAutoAuctionLobbyRoomEntryCounterText(
        "今日次数： <color=#FF0000> 100 / 100 </color>",
        &currentCount,
        &limitCount
    ));
    assert(currentCount == 100 && limitCount == 100);
    assert(TryParseAutoAuctionLobbyRoomEntryCounterText("100/1000", &currentCount, &limitCount));
    assert(currentCount == 100 && limitCount == 1000);
    assert(!TryParseAutoAuctionLobbyRoomEntryCounterText("今日次数：无", &currentCount, &limitCount));
    assert(IsAutoAuctionLobbyRoomEntryLimitReachedText("100/100"));
    assert(IsAutoAuctionLobbyRoomEntryLimitReachedText("今日次数：<color=#FF0000>100/100"));
    assert(IsAutoAuctionLobbyRoomEntryLimitReachedText("今日次数： <color=#FF0000> 100 / 100 </color>"));
    assert(!IsAutoAuctionLobbyRoomEntryLimitReachedText("100/1000"));
    assert(!IsAutoAuctionLobbyRoomEntryLimitReachedText("99/100"));
    assert(!IsAutoAuctionLobbyRoomEntryLimitReachedText(""));

    assert(ResolveAutoAuctionReportedExpectedPrice(80000, 11119) == 80000);
    assert(ResolveAutoAuctionReportedExpectedPrice(0, 11119) == 11119);
    assert(ClampAutoAuctionBidAmount(149999, 150000) == 149999);
    assert(ClampAutoAuctionBidAmount(150000, 150000) == 150000);
    assert(ClampAutoAuctionBidAmount(150001, 150000) == 150000);
    assert(ClampAutoAuctionBidAmount(0, 150000) == 0);

    // First round floor: clamp amounts below 17000, leave others unchanged
    assert(ClampAutoAuctionFirstRoundBid(11119, 1, 17000) == 17000);
    assert(ClampAutoAuctionFirstRoundBid(15000, 1, 17000) == 17000);
    assert(ClampAutoAuctionFirstRoundBid(16999, 1, 17000) == 17000);
    assert(ClampAutoAuctionFirstRoundBid(17000, 1, 17000) == 17000);
    assert(ClampAutoAuctionFirstRoundBid(25000, 1, 17000) == 25000);
    assert(ClampAutoAuctionFirstRoundBid(80000, 1, 17000) == 80000);
    // Not first round: no clamping
    assert(ClampAutoAuctionFirstRoundBid(11119, 2, 17000) == 11119);
    assert(ClampAutoAuctionFirstRoundBid(11119, 3, 17000) == 11119);
    assert(ClampAutoAuctionFirstRoundBid(11119, 0, 17000) == 11119);
    assert(!ShouldDisableAutoAuctionPriceUpperLimit(false, true, true, true));
    assert(!ShouldDisableAutoAuctionPriceUpperLimit(true, false, true, true));
    assert(!ShouldDisableAutoAuctionPriceUpperLimit(true, true, false, true));
    assert(!ShouldDisableAutoAuctionPriceUpperLimit(true, true, true, false));
    assert(ShouldDisableAutoAuctionPriceUpperLimit(true, true, true, true));

    assert(IsEligibleAutoCollectCabinetRewardScreen("main_lobby"));
    assert(!IsEligibleAutoCollectCabinetRewardScreen("warehouse"));
    assert(!IsEligibleAutoCollectCabinetRewardScreen("cabinet_reward_list"));
    assert(!IsEligibleAutoCollectCabinetRewardScreen(""));
    assert(!IsEligibleAutoCollectCabinetRewardScreen(nullptr));

    assert(ShouldSkipAutoCollectCabinetRewardForAutoAuction(true));
    assert(!ShouldSkipAutoCollectCabinetRewardForAutoAuction(false));

    assert(ShouldSkipAutoCollectCabinetRewardForBusyFlow(true));
    assert(!ShouldSkipAutoCollectCabinetRewardForBusyFlow(false));

    // Bid retry cooldown
    assert(GetAutoAuctionBidRetryCooldownMs() == 1000);

    // Step 5 staged polling constants
    assert(GetWaitForAuctionInProgressFastWindowMs() == 10000);
    assert(GetWaitForAuctionInProgressMediumWindowMs() == 30000);
    assert(GetWaitForAuctionInProgressPollFastMs() == 200);
    assert(GetWaitForAuctionInProgressPollMediumMs() == 500);
    assert(GetWaitForAuctionInProgressPollSlowMs() == 1500);

    // Same-round bid retry throttle
    assert(ShouldAttemptAutoBidRetry("第1轮", "", 0, 0));       // first attempt ever
    assert(ShouldAttemptAutoBidRetry("第2轮", "第1轮", 0, 500)); // round advanced
    assert(!ShouldAttemptAutoBidRetry("第1轮", "第1轮", 0, 500)); // same round, <1000ms
    assert(ShouldAttemptAutoBidRetry("第1轮", "第1轮", 0, 1000)); // same round, exactly 1000ms
    assert(ShouldAttemptAutoBidRetry("第1轮", "第1轮", 0, 1500)); // same round, >1000ms
    assert(!ShouldAttemptAutoBidRetry("", "第1轮", 0, 5000));     // empty round

    // Regression: settle-window ordering — a new round MUST pass the throttle
    // gate BEFORE any click timestamp is written. The throttle gate itself
    // must not record the attempt; that is done at click time later.
    // If round advanced and no click has been recorded for this round yet,
    // the gate fires on round change alone, regardless of lastBidAttemptMs age.
    assert(ShouldAttemptAutoBidRetry("第3轮", "第1轮", 100, 150));
    // After the first click on round 3 is recorded (lastBidAttemptRound="第3轮",
    // lastBidAttemptMs=5000), a retry <1000ms later on the same round is blocked:
    assert(!ShouldAttemptAutoBidRetry("第3轮", "第3轮", 5000, 5500));

    // Opponent-cap settle window constant
    assert(GetAutoAuctionOpponentCapSettleWindowMs() == 500);

    // AutoAuction error code formatting
    assert(BuildAutoAuctionTimeoutError("wait_main_lobby") == "auto_auction_timeout:wait_main_lobby");
    assert(BuildAutoAuctionTimeoutError("wait_lobby_map") == "auto_auction_timeout:wait_lobby_map");
    assert(BuildAutoAuctionTimeoutError("wait_lobby_room") == "auto_auction_timeout:wait_lobby_room");
    assert(BuildAutoAuctionTimeoutError("wait_skill_config") == "auto_auction_timeout:wait_skill_config");
    assert(BuildAutoAuctionUiError("wait_lobby_map") == "auto_auction_ui_error:wait_lobby_map");
    assert(BuildAutoAuctionUiError("wait_lobby_room") == "auto_auction_ui_error:wait_lobby_room");
    assert(BuildAutoAuctionUiError("wait_skill_config") == "auto_auction_ui_error:wait_skill_config");
    assert(BuildAutoAuctionUiError("wait_cleanup_transition") == "auto_auction_ui_error:wait_cleanup_transition");
    assert(BuildAutoAuctionUiError("winner_recycle") == "auto_auction_ui_error:winner_recycle");
    assert(BuildAutoAuctionUnexpectedScreenError("warehouse") == "auto_auction_unexpected_screen:warehouse");
    assert(BuildAutoAuctionUnexpectedScreenError("") == "auto_auction_unexpected_screen:null");
    assert(BuildAutoAuctionUnexpectedScreenError(nullptr) == "auto_auction_unexpected_screen:null");

    // ---- RefreshExchangeSellSlots semantics --------------------------------

    // Exchange screen identification
    assert(IsExchangeScreen("exchange"));
    assert(!IsExchangeScreen("main_lobby"));
    assert(!IsExchangeScreen("warehouse"));
    assert(!IsExchangeScreen("mailbox"));
    assert(!IsExchangeScreen(""));
    assert(!IsExchangeScreen(nullptr));

    // Main lobby identification
    assert(IsMainLobbyScreen("main_lobby"));
    assert(!IsMainLobbyScreen("exchange"));
    assert(!IsMainLobbyScreen("warehouse"));
    assert(!IsMainLobbyScreen(""));
    assert(!IsMainLobbyScreen(nullptr));

    // Converge target screens (the screens we stop closing overlays at)
    assert(IsExchangeConvergeTargetScreen("main_lobby"));
    assert(IsExchangeConvergeTargetScreen("exchange"));
    assert(!IsExchangeConvergeTargetScreen("warehouse"));
    assert(!IsExchangeConvergeTargetScreen("mailbox"));
    assert(!IsExchangeConvergeTargetScreen("auction_lobby_map"));
    assert(!IsExchangeConvergeTargetScreen("unknown"));
    assert(!IsExchangeConvergeTargetScreen(""));
    assert(!IsExchangeConvergeTargetScreen(nullptr));

    // Continue converge — true when we need to keep closing overlays
    assert(ShouldContinueExchangeConverge("warehouse"));
    assert(ShouldContinueExchangeConverge("mailbox"));
    assert(ShouldContinueExchangeConverge("auction_lobby_map"));
    assert(ShouldContinueExchangeConverge("auction_lobby_room"));
    assert(!ShouldContinueExchangeConverge("unknown"));  // unknown is not a navigable screen
    assert(!ShouldContinueExchangeConverge("main_lobby"));
    assert(!ShouldContinueExchangeConverge("exchange"));
    assert(!ShouldContinueExchangeConverge(""));       // detection failure
    assert(!ShouldContinueExchangeConverge(nullptr));  // null guard

    // Exchange sell tab readiness — must be on exchange with trading panel
    assert(IsExchangeSellTabReady("exchange", true));
    assert(!IsExchangeSellTabReady("exchange", false));
    assert(!IsExchangeSellTabReady("main_lobby", true));
    assert(!IsExchangeSellTabReady("warehouse", true));
    assert(!IsExchangeSellTabReady("warehouse", false));
    assert(!IsExchangeSellTabReady("", true));
    assert(!IsExchangeSellTabReady(nullptr, true));

    // ---- Expected-price confirm gate ----------------------------------------

    // Current-round bid path: round 1 uses RoundUnit, round N uses RoundUnit(Clone)[N-2]
    assert(GetOpponentCurrentRoundBidPath(1, 1) ==
        "Gaming/PlayerContainer/Player_1/containers/RoundUnit/priceTxt");
    assert(GetOpponentCurrentRoundBidPath(2, 1) ==
        "Gaming/PlayerContainer/Player_2/containers/RoundUnit/priceTxt");
    assert(GetOpponentCurrentRoundBidPath(1, 2) ==
        "Gaming/PlayerContainer/Player_1/containers/RoundUnit(Clone)[0]/priceTxt");
    assert(GetOpponentCurrentRoundBidPath(2, 3) ==
        "Gaming/PlayerContainer/Player_2/containers/RoundUnit(Clone)[1]/priceTxt");
    assert(GetOpponentCurrentRoundBidPath(1, 5) ==
        "Gaming/PlayerContainer/Player_1/containers/RoundUnit(Clone)[3]/priceTxt");

    // Three-state result: all distinct
    assert(CONFIRM_GATE_READY_OPPONENT_BID  != CONFIRM_GATE_READY_TIME_FALLBACK);
    assert(CONFIRM_GATE_READY_OPPONENT_BID  != CONFIRM_GATE_NOT_READY);
    assert(CONFIRM_GATE_READY_TIME_FALLBACK != CONFIRM_GATE_NOT_READY);

    // Soft-exit reasons: all distinct
    assert(CONFIRM_GATE_SOFT_EXIT_NONE          != CONFIRM_GATE_SOFT_EXIT_ROUND_CHANGED);
    assert(CONFIRM_GATE_SOFT_EXIT_NONE          != CONFIRM_GATE_SOFT_EXIT_DIALOG_LOST);
    assert(CONFIRM_GATE_SOFT_EXIT_ROUND_CHANGED != CONFIRM_GATE_SOFT_EXIT_DIALOG_LOST);

    // CONFIRM_GATE_NOT_READY is not a ready state (soft exit ≠ success)
    assert(CONFIRM_GATE_NOT_READY != CONFIRM_GATE_READY_OPPONENT_BID);
    assert(CONFIRM_GATE_NOT_READY != CONFIRM_GATE_READY_TIME_FALLBACK);

    // Poll interval
    assert(GetExpectedPriceConfirmGatePollIntervalMs() == 100);

    return 0;
}
