#!/usr/bin/env bash
# Cross-compile Foundry's `cast` binary for i686-unknown-linux-gnu.
#
# Requirements:
#   - Rust toolchain (rustup)
#   - gcc-multilib (apt install gcc-multilib)
#   - git
#
# Output:
#   web/bin/cast-i686
#
# If Foundry doesn't compile cleanly for i686 (some deps may have issues),
# the cast-bridge.sh wrapper will fall back to routing ALL cast commands
# through the browser bridge (cast-browser.ts handles everything).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="$SCRIPT_DIR/bin/cast-i686"

echo "==> Adding i686 Rust target..."
rustup target add i686-unknown-linux-gnu

echo "==> Cloning Foundry (shallow)..."
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
git clone --depth 1 https://github.com/foundry-rs/foundry "$TMPDIR/foundry"

echo "==> Building cast for i686-unknown-linux-gnu..."
cd "$TMPDIR/foundry"

# Set up cross-compilation environment
export PKG_CONFIG_ALLOW_CROSS=1
export CARGO_TARGET_I686_UNKNOWN_LINUX_GNU_LINKER=gcc

cargo build --release --target i686-unknown-linux-gnu -p cast || {
  echo "WARNING: Foundry failed to compile for i686."
  echo "         All cast commands will route through the browser bridge instead."
  echo "         This is fine — cast-browser.ts handles all cast subcommands."
  exit 0
}

mkdir -p "$(dirname "$OUTPUT")"
cp "target/i686-unknown-linux-gnu/release/cast" "$OUTPUT"
strip "$OUTPUT" 2>/dev/null || true

echo "==> Done! Binary: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
