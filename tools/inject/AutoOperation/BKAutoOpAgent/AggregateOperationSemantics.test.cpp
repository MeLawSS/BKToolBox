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

    assert(ResolveAutoAuctionFirstRoundFloorAmount(102) == 30000);
    assert(ResolveAutoAuctionFirstRoundFloorAmount(101) == 17000);
    assert(ResolveAutoAuctionFirstRoundFloorAmount(103) == 17000);

    // First round: room 102 clamps to 30000.
    assert(ClampAutoAuctionFirstRoundBid(
        11119,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 30000);
    assert(ClampAutoAuctionFirstRoundBid(
        29999,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 30000);
    assert(ClampAutoAuctionFirstRoundBid(
        30000,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 30000);
    assert(ClampAutoAuctionFirstRoundBid(
        35000,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 35000);

    // First round: non-102 rooms still clamp to 17000.
    assert(ClampAutoAuctionFirstRoundBid(
        11119,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(101)
    ) == 17000);
    assert(ClampAutoAuctionFirstRoundBid(
        16999,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(103)
    ) == 17000);
    assert(ClampAutoAuctionFirstRoundBid(
        25000,
        1,
        ResolveAutoAuctionFirstRoundFloorAmount(101)
    ) == 25000);

    // Later rounds stay unchanged regardless of room.
    assert(ClampAutoAuctionFirstRoundBid(
        11119,
        2,
        ResolveAutoAuctionFirstRoundFloorAmount(102)
    ) == 11119);
    assert(ClampAutoAuctionFirstRoundBid(
        11119,
        3,
        ResolveAutoAuctionFirstRoundFloorAmount(101)
    ) == 11119);
    assert(ClampAutoAuctionFirstRoundBid(
        11119,
        0,
        ResolveAutoAuctionFirstRoundFloorAmount(103)
    ) == 11119);
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

    // Current-round opponent-bid signal: live UI exposes Player_N/bided.
    // priceTxt is populated later as round history, so the confirm gate must
    // key off this marker path instead of current-round price text.
    assert(GetOpponentCurrentRoundBidSignalPath(1) ==
        "Gaming/PlayerContainer/Player_1/bided");
    assert(GetOpponentCurrentRoundBidSignalPath(2) ==
        "Gaming/PlayerContainer/Player_2/bided");
    assert(GetOpponentCurrentRoundBidSignalPath(4) ==
        "Gaming/PlayerContainer/Player_4/bided");

    {
        bool entrySignals[4] = { false, false, false, false };
        bool currentSignals[4] = { false, false, false, false };
        assert(!DidAnyNewCurrentRoundBidSignalAppear(entrySignals, currentSignals, 4));

        currentSignals[1] = true;
        assert(DidAnyNewCurrentRoundBidSignalAppear(entrySignals, currentSignals, 4));

        entrySignals[1] = true;
        assert(!DidAnyNewCurrentRoundBidSignalAppear(entrySignals, currentSignals, 4));

        currentSignals[3] = true;
        assert(DidAnyNewCurrentRoundBidSignalAppear(entrySignals, currentSignals, 4));
    }
    {
        bool entrySignals[2] = { false, false };
        bool currentSignals[2] = { false, false };
        assert(CountActiveCurrentRoundBidSignals(entrySignals, 2) == 0);
        assert(!DidCurrentRoundBidSignalCountIncrease(entrySignals, currentSignals, 2));

        currentSignals[0] = true;
        assert(CountActiveCurrentRoundBidSignals(currentSignals, 2) == 1);
        assert(DidCurrentRoundBidSignalCountIncrease(entrySignals, currentSignals, 2));

        entrySignals[0] = true;
        assert(!DidCurrentRoundBidSignalCountIncrease(entrySignals, currentSignals, 2));

        currentSignals[0] = false;
        currentSignals[1] = true;
        assert(!DidCurrentRoundBidSignalCountIncrease(entrySignals, currentSignals, 2));

        currentSignals[0] = true;
        assert(DidCurrentRoundBidSignalCountIncrease(entrySignals, currentSignals, 2));
    }
    assert(GetAutoAuctionExpectedPriceConfirmGateMaxPlayerSlots() == 4);

    assert(GetExpectedPriceConfirmGateRequiredOtherBidCount(0) == 0);
    assert(GetExpectedPriceConfirmGateRequiredOtherBidCount(1) == 0);
    assert(GetExpectedPriceConfirmGateRequiredOtherBidCount(2) == 1);
    assert(GetExpectedPriceConfirmGateRequiredOtherBidCount(3) == 2);
    assert(GetExpectedPriceConfirmGateRequiredOtherBidCount(4) == 3);

    {
        std::string playerNames[4] = { "melo", "对手A", "", "" };
        assert(CountVisibleNamedPlayers(playerNames, 4) == 2);
        assert(ShouldWaitForExpectedPriceConfirmGateBidSignalTransition(2, 0));
        assert(!ShouldWaitForExpectedPriceConfirmGateBidSignalTransition(2, 1));
        assert(!IsExpectedPriceConfirmGateOpponentBidSignalReady(2, 0));
        assert(IsExpectedPriceConfirmGateOpponentBidSignalReady(2, 1));
    }
    {
        std::string playerNames[4] = { "melo", "对手A", "对手B", "" };
        assert(CountVisibleNamedPlayers(playerNames, 4) == 3);
        assert(ShouldWaitForExpectedPriceConfirmGateBidSignalTransition(3, 0));
        assert(ShouldWaitForExpectedPriceConfirmGateBidSignalTransition(3, 1));
        assert(!ShouldWaitForExpectedPriceConfirmGateBidSignalTransition(3, 2));
        assert(!IsExpectedPriceConfirmGateOpponentBidSignalReady(3, 1));
        assert(IsExpectedPriceConfirmGateOpponentBidSignalReady(3, 2));
    }
    {
        std::string playerNames[4] = { "melo", "对手A", "对手B", "对手C" };
        assert(CountVisibleNamedPlayers(playerNames, 4) == 4);
        assert(ShouldWaitForExpectedPriceConfirmGateBidSignalTransition(4, 2));
        assert(!ShouldWaitForExpectedPriceConfirmGateBidSignalTransition(4, 3));
        assert(!IsExpectedPriceConfirmGateOpponentBidSignalReady(4, 2));
        assert(IsExpectedPriceConfirmGateOpponentBidSignalReady(4, 3));
    }

    assert(!IsExpectedPriceConfirmGateVisiblePlayersReady(0, 0));
    assert(!IsExpectedPriceConfirmGateVisiblePlayersReady(1, 1));

    assert(!IsExpectedPriceConfirmGateVisiblePlayersReady(2, 0));
    assert(IsExpectedPriceConfirmGateVisiblePlayersReady(2, 1));

    assert(!IsExpectedPriceConfirmGateVisiblePlayersReady(3, 1));
    assert(IsExpectedPriceConfirmGateVisiblePlayersReady(3, 2));

    assert(!IsExpectedPriceConfirmGateVisiblePlayersReady(4, 2));
    assert(IsExpectedPriceConfirmGateVisiblePlayersReady(4, 3));
    assert(IsExpectedPriceConfirmGateVisiblePlayersReady(4, 4));

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

    // Confirm-click delay: only opponent-bid release waits an extra 1s.
    assert(GetExpectedPriceConfirmGateOpponentBidConfirmDelayMs() == 1000);
    assert(ShouldDelayExpectedPriceConfirmAfterGate(CONFIRM_GATE_READY_OPPONENT_BID));
    assert(!ShouldDelayExpectedPriceConfirmAfterGate(CONFIRM_GATE_READY_TIME_FALLBACK));
    assert(!ShouldDelayExpectedPriceConfirmAfterGate(CONFIRM_GATE_NOT_READY));
    assert(ShouldRecoverExpectedPriceBidDialogAfterGate(
        CONFIRM_GATE_READY_OPPONENT_BID,
        false
    ));
    assert(!ShouldRecoverExpectedPriceBidDialogAfterGate(
        CONFIRM_GATE_READY_OPPONENT_BID,
        true
    ));
    assert(!ShouldRecoverExpectedPriceBidDialogAfterGate(
        CONFIRM_GATE_READY_TIME_FALLBACK,
        false
    ));
    assert(DoesExpectedPriceBidInputMatch("25575", 25575));
    assert(DoesExpectedPriceBidInputMatch("25,575", 25575));
    assert(!DoesExpectedPriceBidInputMatch("", 25575));
    assert(!DoesExpectedPriceBidInputMatch("25574", 25575));

    // Poll interval
    assert(GetExpectedPriceConfirmGatePollIntervalMs() == 100);

    // GetSelfSlotIndicatorPath
    assert(GetSelfSlotIndicatorPath(1) == "Gaming/PlayerContainer/Player_1/selectBg");
    assert(GetSelfSlotIndicatorPath(2) == "Gaming/PlayerContainer/Player_2/selectBg");
    assert(GetSelfSlotIndicatorPath(4) == "Gaming/PlayerContainer/Player_4/selectBg");

    // TryResolveSelfSlotFromSelectBg — 2-player
    {
        int selfSlot = 0;
        bool active[2] = { true, false };
        assert(TryResolveSelfSlotFromSelectBg(active, 2, &selfSlot) && selfSlot == 1);
    }
    {
        int selfSlot = 0;
        bool active[2] = { false, true };
        assert(TryResolveSelfSlotFromSelectBg(active, 2, &selfSlot) && selfSlot == 2);
    }
    {
        int selfSlot = 0;
        bool active[2] = { false, false };
        assert(!TryResolveSelfSlotFromSelectBg(active, 2, &selfSlot));
    }
    {
        int selfSlot = 0;
        bool active[2] = { true, true };
        assert(!TryResolveSelfSlotFromSelectBg(active, 2, &selfSlot));
    }
    // 4-player
    {
        int selfSlot = 0;
        bool active[4] = { false, false, true, false };
        assert(TryResolveSelfSlotFromSelectBg(active, 4, &selfSlot) && selfSlot == 3);
    }
    // null / zero guard
    assert(!TryResolveSelfSlotFromSelectBg(nullptr, 2, nullptr));

    return 0;
}
