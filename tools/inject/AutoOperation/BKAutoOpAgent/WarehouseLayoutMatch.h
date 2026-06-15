#pragma once

#include <cstddef>
#include <stdint.h>
#include <vector>

struct WarehouseLayoutMatchCandidate {
    int stockId = 0;
    int stockCid = 0;
    std::vector<int64_t> itemUids;

    WarehouseLayoutMatchCandidate() = default;

    WarehouseLayoutMatchCandidate(int stockIdValue, int stockCidValue, std::vector<int64_t> itemUidValues)
        : stockId(stockIdValue), stockCid(stockCidValue), itemUids(itemUidValues) {}
};

inline int FindWarehouseLayoutMatchIndex(
    const std::vector<WarehouseLayoutMatchCandidate>& layouts,
    int rawStockId,
    int rawStockCid,
    int64_t itemUid
) {
    for (std::size_t i = 0; i < layouts.size(); i++) {
        if (layouts[i].stockId == rawStockId) return (int)i;
    }

    if (rawStockCid > 0) {
        for (std::size_t i = 0; i < layouts.size(); i++) {
            if (layouts[i].stockId > 0) continue;
            if (layouts[i].stockCid == rawStockCid) return (int)i;
        }
    }

    if (itemUid > 0) {
        for (std::size_t i = 0; i < layouts.size(); i++) {
            if (layouts[i].stockId > 0) continue;
            for (std::size_t ii = 0; ii < layouts[i].itemUids.size(); ii++) {
                if (layouts[i].itemUids[ii] == itemUid) return (int)i;
            }
        }
    }

    return -1;
}
