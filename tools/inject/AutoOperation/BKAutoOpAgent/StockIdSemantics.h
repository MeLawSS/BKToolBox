#pragma once

inline bool IsSupportedStockId(int stockId) {
    return stockId >= 0;
}

inline bool ShouldSkipRawStockContainer(int rawStockId) {
    return !IsSupportedStockId(rawStockId);
}

inline bool IsValidMoveStockId(int stockId) {
    return IsSupportedStockId(stockId);
}

inline bool ShouldKeepStockLayout(int stockId, bool identityConfirmed) {
    return identityConfirmed && IsSupportedStockId(stockId);
}
