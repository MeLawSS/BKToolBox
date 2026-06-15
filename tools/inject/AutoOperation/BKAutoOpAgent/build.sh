#!/bin/bash
# Run from repo root: bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
set -e
cd "$(dirname "$0")"

x86_64-w64-mingw32-g++ \
    -shared -o BKAutoOpAgent.dll BKAutoOpAgent.cpp \
    -lkernel32 -O2 -std=c++11 \
    -static-libgcc -static-libstdc++

echo "Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll"
