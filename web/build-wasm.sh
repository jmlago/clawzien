#!/bin/bash
set -e
cd "$(dirname "$0")/.."
mkdir -p web/public
emcc -Wall -Wextra -Wno-misleading-indentation -std=c11 -O2 -D_GNU_SOURCE \
    -Isubzeroclaw/src \
    -o web/public/subzeroclaw.js \
    subzeroclaw/src/subzeroclaw.c subzeroclaw/src/cJSON.c \
    --js-library web/src/library_popen.js \
    -s ASYNCIFY \
    -s 'ASYNCIFY_IMPORTS=["popen"]' \
    -s EXPORTED_FUNCTIONS='["_main"]' \
    -s 'EXPORTED_RUNTIME_METHODS=["callMain","FS","ENV"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT=web \
    -s FORCE_FILESYSTEM=1 \
    -s EXIT_RUNTIME=0 \
    -s INVOKE_RUN=0 \
    -lm
echo "Built: web/public/subzeroclaw.{js,wasm}"
