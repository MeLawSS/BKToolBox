#pragma once

struct WarehouseIdentity {
    int stockId = 0;
    int stockCid = 0;
};

inline WarehouseIdentity ResolveWarehouseIdentity(
    int fieldStockId,
    int fieldStockCid,
    int methodStockId,
    int methodStockCid,
    int warehouseUuid,
    int warehouseCid
) {
    WarehouseIdentity identity = {};
    identity.stockId = fieldStockId > 0
        ? fieldStockId
        : (methodStockId > 0 ? methodStockId : warehouseUuid);
    identity.stockCid = fieldStockCid > 0
        ? fieldStockCid
        : (methodStockCid > 0 ? methodStockCid : warehouseCid);
    return identity;
}
