#!/usr/bin/env bash
set -euo pipefail

# Install a pinned Emscripten SDK in the build environment.
PROJECT_DIR="$PWD"
EMSDK_DIR="${TMPDIR:-/tmp}/emsdk-flatmate"
if [ ! -d "$EMSDK_DIR" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi
cd "$EMSDK_DIR"
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
cd "$PROJECT_DIR"

# Compile the existing C++ OOP matching strategy/service into a browser module.
em++ matching_core.cpp -std=c++17 -O2 -I. --bind \
  -sWASM=1 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createMatchingModule \
  -sENVIRONMENT=web \
  -sALLOW_MEMORY_GROWTH=1 \
  -o matching.js

echo "FlatMate C++ matching WebAssembly build completed."
