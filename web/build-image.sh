#!/usr/bin/env bash
# Build the CheerpX ext2 disk image from Docker.
#
# Requirements:
#   - Docker with buildx (for --platform linux/386)
#   - e2fsprogs (mke2fs) for creating ext2 images
#
# Usage:
#   cd web && ./build-image.sh
#
# Output:
#   web/public/clawzien-vm.ext2
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
IMAGE_NAME="clawzien-vm"
CONTAINER_NAME="clawzien-vm-extract"
OUTPUT="$SCRIPT_DIR/public/clawzien-vm.ext2"

echo "==> Building Docker image (i386)..."
docker buildx build \
  --platform linux/386 \
  -f "$SCRIPT_DIR/Dockerfile.cheerpx" \
  -t "$IMAGE_NAME" \
  "$PROJECT_ROOT"

echo "==> Extracting filesystem from Docker image..."
# Create a container (don't start it) and export its filesystem
docker create --name "$CONTAINER_NAME" "$IMAGE_NAME" /bin/true 2>/dev/null || true
docker export "$CONTAINER_NAME" -o /tmp/clawzien-vm-rootfs.tar
docker rm "$CONTAINER_NAME" 2>/dev/null || true

echo "==> Creating ext2 image..."
# Determine size: rootfs tar size + 50% headroom (min 256MB)
TAR_SIZE=$(stat -c%s /tmp/clawzien-vm-rootfs.tar 2>/dev/null || stat -f%z /tmp/clawzien-vm-rootfs.tar)
IMAGE_SIZE=$(( TAR_SIZE * 3 / 2 ))
MIN_SIZE=$(( 256 * 1024 * 1024 ))
if [ "$IMAGE_SIZE" -lt "$MIN_SIZE" ]; then
  IMAGE_SIZE=$MIN_SIZE
fi

# Create a temp directory, extract tar, then use mke2fs -d
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR" /tmp/clawzien-vm-rootfs.tar' EXIT

tar xf /tmp/clawzien-vm-rootfs.tar -C "$TMPDIR"

# Ensure output directory exists
mkdir -p "$(dirname "$OUTPUT")"

# Create ext2 image from directory contents
# -d populates the image from a directory (e2fsprogs >= 1.43)
IMAGE_BLOCKS=$(( IMAGE_SIZE / 4096 ))
mke2fs -t ext2 -b 4096 -d "$TMPDIR" -r 1 -N 0 "$OUTPUT" "$IMAGE_BLOCKS"

echo "==> Done! Image: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
echo "    CheerpX will lazy-load blocks via HTTP Range requests."
