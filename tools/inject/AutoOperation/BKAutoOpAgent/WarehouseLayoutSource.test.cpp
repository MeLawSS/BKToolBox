#include "WarehouseLayoutSource.h"

#include <assert.h>

int main() {
    {
        bool fallbackCalled = false;
        WarehouseLayoutSource source = ResolveWarehouseLayoutSource(
            []() { return true; },
            [&]() {
                fallbackCalled = true;
                return true;
            }
        );

        assert(source == WAREHOUSE_LAYOUT_SOURCE_PLAYER_MANAGER_METHOD);
        assert(!fallbackCalled);
    }

    {
        bool fallbackCalled = false;
        WarehouseLayoutSource source = ResolveWarehouseLayoutSource(
            []() { return false; },
            [&]() {
                fallbackCalled = true;
                return true;
            }
        );

        assert(source == WAREHOUSE_LAYOUT_SOURCE_PLAYER_GAME_DATA_FIELD);
        assert(fallbackCalled);
    }

    {
        WarehouseLayoutSource source = ResolveWarehouseLayoutSource(
            []() { return false; },
            []() { return false; }
        );

        assert(source == WAREHOUSE_LAYOUT_SOURCE_NONE);
    }

    return 0;
}
