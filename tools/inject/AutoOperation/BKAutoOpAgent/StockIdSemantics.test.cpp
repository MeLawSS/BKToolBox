#include "StockIdSemantics.h"

#include <assert.h>

int main() {
    assert(ShouldSkipRawStockContainer(-1));
    assert(!ShouldSkipRawStockContainer(0));
    assert(!ShouldSkipRawStockContainer(9));

    assert(!IsValidMoveStockId(-1));
    assert(IsValidMoveStockId(0));
    assert(IsValidMoveStockId(5));

    assert(!ShouldKeepStockLayout(0, false));
    assert(ShouldKeepStockLayout(0, true));
    assert(ShouldKeepStockLayout(7, true));

    return 0;
}
