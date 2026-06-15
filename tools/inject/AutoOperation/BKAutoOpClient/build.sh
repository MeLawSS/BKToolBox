#!/bin/bash
# Run from repo root: bash tools/inject/AutoOperation/BKAutoOpClient/build.sh
set -e
cd "$(dirname "$0")"

x86_64-w64-mingw32-g++ \
    -shared -o BKAutoOpClient.dll BKAutoOpClient.cpp \
    -lkernel32 -O2 -std=c++11 \
    -static-libgcc -static-libstdc++ \
    -Wl,--export-all-symbols

echo "Done: tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.dll"
