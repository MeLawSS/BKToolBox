#include "AutoAuctionOpponentCap.h"

#include <assert.h>

int main() {
    int value = 0;
    assert(TryParseHistoryRoundNumber("第4轮", &value) && value == 4);
    assert(TryParseHistoryRoundNumber("Round 5", &value) && value == 5);
    assert(!TryParseHistoryRoundNumber("--", &value));
    assert(!TryParseHistoryRoundNumber("Round 5 / 6", &value));

    assert(TryParsePriceText("17,986", &value) && value == 17986);
    assert(TryParsePriceText("17，986", &value) && value == 17986);
    assert(TryParsePriceText("17986", &value) && value == 17986);
    assert(!TryParsePriceText("", &value));
    assert(!TryParsePriceText("0", &value));
    assert(!TryParsePriceText("12a34", &value));

    double multiplier = 0.0;
    assert(TryGetOpponentCapMultiplier(2, &multiplier) && multiplier == 1.65);
    assert(TryGetOpponentCapMultiplier(3, &multiplier) && multiplier == 1.4);
    assert(TryGetOpponentCapMultiplier(4, &multiplier) && multiplier == 1.23);
    assert(TryGetOpponentCapMultiplier(5, &multiplier) && multiplier == 1.1);
    assert(!TryGetOpponentCapMultiplier(1, &multiplier));
    assert(!TryGetOpponentCapMultiplier(6, &multiplier));

    int slot = 0;
    assert(TryResolveOpponentSlot("melo", "melo", "澈澈澈", &slot) && slot == 2);
    assert(TryResolveOpponentSlot("melo", "澈澈澈", "melo", &slot) && slot == 1);
    assert(!TryResolveOpponentSlot("melo", "", "", &slot));
    assert(!TryResolveOpponentSlot("melo", "melo", "melo", &slot));
    assert(!TryResolveOpponentSlot("melo", "澈澈澈", "澈澈澈", &slot));

    assert(ComputeOpponentCappedBid(50000, 44444, 1.4) == 50000);
    assert(ComputeOpponentCappedBid(90000, 44444, 1.4) == 62221);
    return 0;
}
