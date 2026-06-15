#include "TradeListSummary.h"

#include <assert.h>
#include <string.h>

int main() {
    const int prices[] = { 6200, 6300, 0, 6400 };
    const int counts[] = { 2, 3, 99, 4 };
    char json[512] = {};

    TradeListSummary summary = {};
    bool ok = BuildTradeListSummaryJson(
        1032006,
        "List`1",
        prices,
        counts,
        4,
        3,
        json,
        sizeof(json),
        &summary
    );

    assert(ok);
    assert(summary.minPrice == 6200);
    assert(summary.tierCount == 3);
    assert(summary.totalCount == 9);
    assert(strcmp(json,
        "{\"itemCid\":1032006,\"resultClass\":\"List`1\",\"minPrice\":6200,"
        "\"tierCount\":3,\"totalCount\":9,\"tiers\":["
        "{\"price\":6200,\"count\":2},{\"price\":6300,\"count\":3},"
        "{\"price\":6400,\"count\":4}]}") == 0);

    return 0;
}
