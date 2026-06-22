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
    assert(GetAutoAuctionCleanupMaxAttempts() == 40);
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

    assert(ResolveAutoAuctionReportedExpectedPrice(80000, 11119) == 80000);
    assert(ResolveAutoAuctionReportedExpectedPrice(0, 11119) == 11119);
    assert(ClampAutoAuctionBidAmount(149999, 150000) == 149999);
    assert(ClampAutoAuctionBidAmount(150000, 150000) == 150000);
    assert(ClampAutoAuctionBidAmount(150001, 150000) == 150000);
    assert(ClampAutoAuctionBidAmount(0, 150000) == 0);
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

    return 0;
}
