#pragma once

#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>

static int AppendInvokeSingletonMethodResultJson(char* out, int outSize, int pos, const char* fmt, ...) {
    if (!out || outSize <= 0 || pos >= outSize) return pos;

    va_list ap;
    va_start(ap, fmt);
    int written = vsnprintf(out + pos, (size_t)(outSize - pos), fmt, ap);
    va_end(ap);
    if (written < 0) return pos;
    if (written >= outSize - pos) return outSize - 1;
    return pos + written;
}

static bool BuildInvokeSingletonMethodResultJson(
    const char* className,
    const char* methodName,
    const char* invokeResultJson,
    char* out,
    int outSize
) {
    if (!out || outSize <= 0 || !className || !methodName || !invokeResultJson) return false;

    int pos = 0;
    pos = AppendInvokeSingletonMethodResultJson(
        out,
        outSize,
        pos,
        "{\"className\":\"%s\",\"methodName\":\"%s\",\"invokeResult\":%s}",
        className,
        methodName,
        invokeResultJson
    );
    out[outSize - 1] = '\0';
    return pos < outSize - 1;
}
