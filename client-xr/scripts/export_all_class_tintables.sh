#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLENDER_BIN="${BLENDER_BIN:-blender}"
CHAR_DIR="$ROOT_DIR/public/models/characters"
WORK_DIR="$CHAR_DIR/tint-work"

for CLASS_KEY in warrior ranger wizard cleric rogue monk; do
  case "$CLASS_KEY" in
    warrior) MODEL_NAME="Warrior" ;;
    ranger) MODEL_NAME="Ranger" ;;
    wizard) MODEL_NAME="Wizard" ;;
    cleric) MODEL_NAME="Cleric" ;;
    rogue) MODEL_NAME="Rogue" ;;
    monk) MODEL_NAME="Monk" ;;
    *) echo "unsupported class: $CLASS_KEY" >&2; exit 1 ;;
  esac
  CLASS_DIR="$WORK_DIR/$CLASS_KEY"
  INPUT_PATH="$CHAR_DIR/$MODEL_NAME.gltf"
  OUTPUT_PATH="$CHAR_DIR/${MODEL_NAME}_Tintable.gltf"
  SKIN_MASK="$CLASS_DIR/skin_mask.png"
  HAIR_MASK="$CLASS_DIR/hair_mask.png"
  OUTFIT_MASK="$CLASS_DIR/outfit_mask.png"

  if [[ ! -f "$SKIN_MASK" || ! -f "$HAIR_MASK" || ! -f "$OUTFIT_MASK" ]]; then
    echo "missing masks for $CLASS_KEY in $CLASS_DIR" >&2
    exit 1
  fi

  echo "exporting $CLASS_KEY -> $OUTPUT_PATH"
  "$BLENDER_BIN" --background --python "$ROOT_DIR/scripts/blender_export_class_tintable.py" -- \
    --input "$INPUT_PATH" \
    --output "$OUTPUT_PATH" \
    --preset "$CLASS_KEY" \
    --skin-mask "$SKIN_MASK" \
    --hair-mask "$HAIR_MASK" \
    --outfit-mask "$OUTFIT_MASK"
done
