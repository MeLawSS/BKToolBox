#!/bin/bash
set -e
SOURCE="$1"
OUTPUT="$2"

if [ -z "$SOURCE" ] || [ -z "$OUTPUT" ]; then
    echo "Usage: build_probe.sh <source.cpp (WSL path)> <output.dll (WSL path)>" >&2
    exit 1
fi

INCLUDE_DIR="$(dirname "$(realpath "$0")")"

x86_64-w64-mingw32-g++ \
    -shared \
    -o "$OUTPUT" \
    -I "$INCLUDE_DIR" \
    -O0 -g \
    "$SOURCE" \
    -lkernel32 \
    2>&1

echo "Build complete: $OUTPUT" >&2
