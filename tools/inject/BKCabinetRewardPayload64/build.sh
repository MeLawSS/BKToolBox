#!/bin/bash
# Run from WSL: bash tools/inject/BKCabinetRewardPayload64/build.sh
set -e
cd "$(dirname "$0")"

OUT="BKCabinetRewardPayload64.dll"
SRC="BKCabinetRewardPayload64.cpp"

echo "Building $OUT with MinGW cross-compiler..."
x86_64-w64-mingw32-g++ \
    -shared \
    -o "$OUT" \
    "$SRC" \
    -lkernel32 -lshell32 \
    -O2 \
    -std=c++11 \
    -Wall \
    -static-libgcc \
    -static-libstdc++

echo "Done: tools/inject/BKCabinetRewardPayload64/$OUT"
