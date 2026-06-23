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

    // PollResult values are distinct
    assert(POLL_OK != POLL_TIMEOUT);
    assert(POLL_OK != POLL_AUTHCODE);
    assert(POLL_OK != POLL_INTERRUPTED);
    assert(POLL_TIMEOUT != POLL_AUTHCODE);

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

    // AutoAuction error code formatting
    assert(BuildAutoAuctionTimeoutError("wait_main_lobby") == "auto_auction_timeout:wait_main_lobby");
    assert(BuildAutoAuctionTimeoutError("wait_lobby_map") == "auto_auction_timeout:wait_lobby_map");
    assert(BuildAutoAuctionTimeoutError("wait_lobby_room") == "auto_auction_timeout:wait_lobby_room");
    assert(BuildAutoAuctionTimeoutError("wait_skill_config") == "auto_auction_timeout:wait_skill_config");
    assert(BuildAutoAuctionUiError("wait_skill_config") == "auto_auction_ui_error:wait_skill_config");
    assert(BuildAutoAuctionUiError("winner_recycle") == "auto_auction_ui_error:winner_recycle");
    assert(BuildAutoAuctionUnexpectedScreenError("warehouse") == "auto_auction_unexpected_screen:warehouse");
    assert(BuildAutoAuctionUnexpectedScreenError("") == "auto_auction_unexpected_screen:null");
    assert(BuildAutoAuctionUnexpectedScreenError(nullptr) == "auto_auction_unexpected_screen:null");

    return 0;
}
