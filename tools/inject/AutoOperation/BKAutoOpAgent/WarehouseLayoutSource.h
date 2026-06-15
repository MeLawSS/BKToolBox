#pragma once

enum WarehouseLayoutSource {
    WAREHOUSE_LAYOUT_SOURCE_NONE = 0,
    WAREHOUSE_LAYOUT_SOURCE_PLAYER_MANAGER_METHOD = 1,
    WAREHOUSE_LAYOUT_SOURCE_PLAYER_GAME_DATA_FIELD = 2,
};

template <typename TryPlayerManagerFn, typename TryPlayerGameDataFn>
inline WarehouseLayoutSource ResolveWarehouseLayoutSource(
    TryPlayerManagerFn tryPlayerManager,
    TryPlayerGameDataFn tryPlayerGameData
) {
    if (tryPlayerManager()) return WAREHOUSE_LAYOUT_SOURCE_PLAYER_MANAGER_METHOD;
    if (tryPlayerGameData()) return WAREHOUSE_LAYOUT_SOURCE_PLAYER_GAME_DATA_FIELD;
    return WAREHOUSE_LAYOUT_SOURCE_NONE;
}
