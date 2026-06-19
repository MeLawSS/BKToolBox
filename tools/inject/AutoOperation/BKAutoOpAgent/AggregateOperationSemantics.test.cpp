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

    // ComputeBidAmount
    assert(ComputeBidAmount(0, 1)     == 0);     // price not set → 0
    assert(ComputeBidAmount(-1, 1)    == 0);     // negative → 0
    assert(ComputeBidAmount(10000, 1) == 20000); // round 1 → 2.0x
    assert(ComputeBidAmount(10000, 2) == 17000); // round 2 → 1.7x
    assert(ComputeBidAmount(10000, 3) == 10000); // round 3 → 1.0x
    assert(ComputeBidAmount(10000, 5) == 10000); // round 5+ → 1.0x

    return 0;
}
