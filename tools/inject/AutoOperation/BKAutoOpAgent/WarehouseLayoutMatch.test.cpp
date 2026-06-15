#include "WarehouseLayoutMatch.h"

#include <assert.h>

int main() {
    {
        std::vector<WarehouseLayoutMatchCandidate> layouts = {
            { 11, 501, { 1001 } },
            { 0, 90210, { 2001, 2002 } },
        };

        int index = FindWarehouseLayoutMatchIndex(layouts, 77, 90210, 2001);
        assert(index == 1);
    }

    {
        std::vector<WarehouseLayoutMatchCandidate> layouts = {
            { 11, 501, { 1001 } },
            { 0, 0, { 2001, 2002 } },
        };

        int index = FindWarehouseLayoutMatchIndex(layouts, 77, 0, 2002);
        assert(index == 1);
    }

    {
        std::vector<WarehouseLayoutMatchCandidate> layouts = {
            { 11, 501, { 1001 } },
            { 0, 90210, { 2001, 2002 } },
        };

        int index = FindWarehouseLayoutMatchIndex(layouts, 11, 90210, 2001);
        assert(index == 0);
    }

    {
        std::vector<WarehouseLayoutMatchCandidate> layouts = {
            { 0, 90210, { 2001 } },
        };

        int index = FindWarehouseLayoutMatchIndex(layouts, 77, 0, 0);
        assert(index == -1);
    }

    return 0;
}
