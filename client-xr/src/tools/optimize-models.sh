#!/usr/bin/env bash
# Optimize all environment GLBs for web delivery:
#   1. Simplify meshes (target ratio ~0.005 = ~1-2K triangles)
#   2. Resize textures to 512x512
#   3. Compress with Draco + WebP
#
# Usage: bash src/tools/optimize-models.sh

set -euo pipefail

INPUT_DIR="assets-source"
OUTPUT_DIR="public/models/environment/optimized"

mkdir -p "$OUTPUT_DIR"

GLTF="npx --yes @gltf-transform/cli"

echo ""
echo "Optimizing environment models..."
echo "  Input:  $INPUT_DIR"
echo "  Output: $OUTPUT_DIR"
echo ""

for glb in "$INPUT_DIR"/*.glb; do
  name=$(basename "$glb")
  out="$OUTPUT_DIR/$name"

  if [ -f "$out" ]; then
    echo "  SKIP  $name (already exists)"
    continue
  fi

  echo -n "  OPT   $name ..."

  # Use the optimize command with aggressive settings for game props
  $GLTF optimize "$glb" "$out" \
    --simplify true \
    --simplify-ratio 0.005 \
    --simplify-error 0.01 \
    --texture-size 512 \
    --texture-compress webp \
    --compress draco \
    2>/dev/null

  orig_kb=$(du -k "$glb" | cut -f1)
  opt_kb=$(du -k "$out" | cut -f1)
  echo " ${orig_kb}KB → ${opt_kb}KB"
done

echo ""
echo "Done! Optimized models in $OUTPUT_DIR"
echo ""
du -sh "$OUTPUT_DIR"
echo ""
