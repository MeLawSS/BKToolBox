#pragma once

#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

static int AppendMoveStockItemResultJson(char* out, int outSize, int pos, const char* fmt, ...) {
    if (!out || outSize <= 0 || pos >= outSize) return pos;

    va_list ap;
    va_start(ap, fmt);
    int written = vsnprintf(out + pos, (size_t)(outSize - pos), fmt, ap);
    va_end(ap);
    if (written < 0) return pos;
    if (written >= outSize - pos) return outSize - 1;
    return pos + written;
}

static bool BuildMoveStockItemResultJson(
    int oldStockId,
    int oldSlot,
    int newStockId,
    int newSlot,
    bool isRotate,
    bool stocksRefreshed,
    const char* snapshotJson,
    char* out,
    int outSize
) {
    if (!out || outSize <= 0) return false;

    int pos = 0;
    pos = AppendMoveStockItemResultJson(
        out,
        outSize,
        pos,
        "{\"moved\":true,\"oldStockId\":%d,\"oldSlot\":%d,\"newStockId\":%d,"
        "\"newSlot\":%d,\"isRotate\":%s,\"stocksRefreshed\":%s",
        oldStockId,
        oldSlot,
        newStockId,
        newSlot,
        isRotate ? "true" : "false",
        stocksRefreshed ? "true" : "false"
    );

    if (snapshotJson && snapshotJson[0]) {
        const char* suffix = snapshotJson;
        if (suffix[0] == '{') suffix += 1;
        pos = AppendMoveStockItemResultJson(out, outSize, pos, ",%s", suffix);
    } else {
        pos = AppendMoveStockItemResultJson(out, outSize, pos, "}");
    }

    out[outSize - 1] = '\0';
    return pos < outSize - 1;
}
