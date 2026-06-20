#include "AggregateOperationSemantics.h"

#include <assert.h>
#include <fstream>
#include <sstream>

static std::string ReadTextFile(const char* path) {
    std::ifstream input(path, std::ios::in | std::ios::binary);
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

static bool ContainsText(const std::string& haystack, const char* needle) {
    return haystack.find(needle) != std::string::npos;
}

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

    const std::string metaOperationsSource =
        ReadTextFile("tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp");
    assert(ContainsText(metaOperationsSource, "static std::atomic<int> g_notifiedExpectedPrice{0};"));
    assert(!ContainsText(metaOperationsSource, "static std::atomic<int> g_expectedPrice{0};"));
    assert(!ContainsText(metaOperationsSource, "PriceReaderThreadProc"));
    assert(!ContainsText(metaOperationsSource, "StartPriceReaderThread"));
    assert(!ContainsText(metaOperationsSource, "StopPriceReaderThread"));
    assert(ContainsText(metaOperationsSource, "g_notifiedExpectedPrice.store(price);"));
    assert(ContainsText(metaOperationsSource, "ResolveAutoAuctionReportedExpectedPrice("));
    assert(ContainsText(metaOperationsSource, "ShouldRecordAutoAuctionRoundSeen("));
    assert(ContainsText(metaOperationsSource, "ShouldAttemptExpectedPriceAutoBid("));
    assert(ContainsText(metaOperationsSource, "ShouldAttemptLegacyAutoBid("));
    assert(ContainsText(metaOperationsSource, "currentPrice = g_notifiedExpectedPrice.load();"));

    return 0;
}
