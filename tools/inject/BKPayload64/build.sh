#!/bin/bash
# Run from WSL: bash tools/inject/BKPayload64/build.sh
set -e
cd "$(dirname "$0")"

OUT="BKPayload64.dll"
SRC="BKPayload64.cpp"

echo "Building $OUT with MinGW cross-compiler..."
x86_64-w64-mingw32-g++ \
    -shared \
    -o "$OUT" \
    "$SRC" \
    -lkernel32 -lshell32 \
    -O2 \
    -std=c++11 \
    -Wall \
    -Wno-unused-variable \
    -static-libgcc \
    -static-libstdc++

echo "Done: tools/inject/BKPayload64/$OUT"
