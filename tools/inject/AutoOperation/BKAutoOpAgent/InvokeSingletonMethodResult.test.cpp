#include "InvokeSingletonMethodResult.h"

#include <assert.h>
#include <string.h>

int main() {
    char json[512] = {};

    bool ok = BuildInvokeSingletonMethodResultJson(
        "TableManager",
        "LoadTable",
        "{\"resultKind\":\"textAsset\",\"stringValue\":\"YWJj\"}",
        json,
        sizeof(json)
    );

    assert(ok);
    assert(strcmp(json,
        "{\"className\":\"TableManager\",\"methodName\":\"LoadTable\","
        "\"invokeResult\":{\"resultKind\":\"textAsset\",\"stringValue\":\"YWJj\"}}") == 0);

    return 0;
}
