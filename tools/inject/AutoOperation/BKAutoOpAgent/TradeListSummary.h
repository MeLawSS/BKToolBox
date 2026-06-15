#pragma once

#include <stddef.h>
#include <stdio.h>
#include <stdarg.h>

struct TradeListSummary {
    int minPrice;
    int tierCount;
    int totalCount;
};

static int AppendJson(char* out, int outSize, int pos, const char* fmt, ...) {
    if (!out || outSize <= 0 || pos >= outSize) return pos;

    va_list ap;
    va_start(ap, fmt);
    int written = vsnprintf(out + pos, (size_t)(outSize - pos), fmt, ap);
    va_end(ap);
    if (written < 0) return pos;
    if (written >= outSize - pos) return outSize - 1;
    return pos + written;
}

static bool BuildTradeListSummaryJson(
    int itemCid,
    const char* resultClass,
    const int* prices,
    const int* counts,
    int sourceCount,
    int maxJsonTiers,
    char* out,
    int outSize,
    TradeListSummary* summaryOut
) {
    if (!out || outSize <= 0) return false;
    if (!resultClass) resultClass = "";
    if (sourceCount < 0) sourceCount = 0;
    if (maxJsonTiers < 0) maxJsonTiers = 0;

    TradeListSummary summary = {};
    for (int i = 0; i < sourceCount; i++) {
        int price = prices ? prices[i] : 0;
        int count = counts ? counts[i] : 0;
        if (price <= 0 || count <= 0) continue;
        if (summary.minPrice == 0 || price < summary.minPrice) summary.minPrice = price;
        summary.tierCount++;
        summary.totalCount += count;
    }

    int pos = 0;
    pos = AppendJson(out, outSize, pos,
        "{\"itemCid\":%d,\"resultClass\":\"%s\",\"minPrice\":%d,"
        "\"tierCount\":%d,\"totalCount\":%d,\"tiers\":[",
        itemCid,
        resultClass,
        summary.minPrice,
        summary.tierCount,
        summary.totalCount
    );

    int writtenTiers = 0;
    for (int i = 0; i < sourceCount && writtenTiers < maxJsonTiers; i++) {
        int price = prices ? prices[i] : 0;
        int count = counts ? counts[i] : 0;
        if (price <= 0 || count <= 0) continue;
        pos = AppendJson(out, outSize, pos,
            "%s{\"price\":%d,\"count\":%d}",
            writtenTiers ? "," : "",
            price,
            count
        );
        writtenTiers++;
    }
    pos = AppendJson(out, outSize, pos, "]}");
    out[outSize - 1] = '\0';

    if (summaryOut) *summaryOut = summary;
    return pos < outSize - 1;
}
