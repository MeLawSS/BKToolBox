#include "WarehouseIdentity.h"

#include <assert.h>

int main() {
    {
        WarehouseIdentity identity = ResolveWarehouseIdentity(101, 201, 0, 0, 1, 2);
        assert(identity.stockId == 101);
        assert(identity.stockCid == 201);
    }

    {
        WarehouseIdentity identity = ResolveWarehouseIdentity(0, 0, 303, 404, 1, 2);
        assert(identity.stockId == 303);
        assert(identity.stockCid == 404);
    }

    {
        WarehouseIdentity identity = ResolveWarehouseIdentity(0, 0, 0, 0, 505, 606);
        assert(identity.stockId == 505);
        assert(identity.stockCid == 606);
    }

    return 0;
}
