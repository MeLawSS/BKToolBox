#include "MoveStockItemResult.h"

#include <assert.h>
#include <string.h>

int main() {
    char json[512] = {};

    bool ok = BuildMoveStockItemResultJson(
        1,
        0,
        2,
        5,
        false,
        true,
        "{\"containers\":[],\"count\":2,\"source\":\"PlayerManager.MoveItem\"}",
        json,
        sizeof(json)
    );

    assert(ok);
    assert(strcmp(json,
        "{\"moved\":true,\"oldStockId\":1,\"oldSlot\":0,\"newStockId\":2,"
        "\"newSlot\":5,\"isRotate\":false,\"stocksRefreshed\":true,"
        "\"containers\":[],\"count\":2,\"source\":\"PlayerManager.MoveItem\"}") == 0);

    memset(json, 0, sizeof(json));
    ok = BuildMoveStockItemResultJson(
        0,
        3,
        7,
        9,
        true,
        false,
        "{\"containers\":[{\"stockId\":7}],\"count\":1,\"source\":\"PlayerManager.MoveItem\"}",
        json,
        sizeof(json)
    );

    assert(ok);
    assert(strcmp(json,
        "{\"moved\":true,\"oldStockId\":0,\"oldSlot\":3,\"newStockId\":7,"
        "\"newSlot\":9,\"isRotate\":true,\"stocksRefreshed\":false,"
        "\"containers\":[{\"stockId\":7}],\"count\":1,\"source\":\"PlayerManager.MoveItem\"}") == 0);

    return 0;
}
