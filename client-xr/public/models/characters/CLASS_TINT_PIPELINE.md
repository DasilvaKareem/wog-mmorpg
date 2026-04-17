Class tint pipeline

Goal:
- Keep the authored default class outfit.
- Recover tintable `Skin` and `Hair` materials for runtime recolor.

How it works:
- Start from an existing class asset such as `Warrior.gltf`.
- Generate per-class work folders with atlas references and empty mask templates:
```bash
python3 scripts/extract_class_tint_templates.py
```
- Paint three atlas-sized mask PNGs inside `public/models/characters/tint-work/<class>/`:
  - `skin_mask.png`
  - `hair_mask.png`
  - `outfit_mask.png`
- White means visible, black means transparent, grayscale is allowed.
- Run `scripts/blender_export_class_tintable.py` for one class, or `scripts/export_all_class_tintables.sh` for all six.
- The exporter strips the built-in weapon mesh, duplicates the class body into three layers, and exports:
  - `Skin`
  - `Hair`
  - `<Class>_Outfit_Texture`

Why this matches the runtime:
- `Skin` and `Hair` are picked up by the existing tint logic in `src/scene/CharacterAssets.ts`.
- `<Class>_Outfit_Texture` keeps the `_Texture` suffix so the authored outfit stays baked and is not class-tinted again.

Single-class example:
```bash
blender --background --python scripts/blender_export_class_tintable.py -- \
  --input public/models/characters/Warrior.gltf \
  --output public/models/characters/Warrior_Tintable.gltf \
  --preset warrior \
  --skin-mask public/models/characters/tint-work/warrior/skin_mask.png \
  --hair-mask public/models/characters/tint-work/warrior/hair_mask.png \
  --outfit-mask public/models/characters/tint-work/warrior/outfit_mask.png
```

All classes:
```bash
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender \
  ./scripts/export_all_class_tintables.sh
```

Supported presets:
- `warrior`
- `ranger`
- `wizard`
- `cleric`
- `rogue`
- `monk`

Current limitation:
- This restores tintable hair and skin colors.
- It does not create swappable hair styles by itself. Hair style swapping still requires separate hair meshes or a hairless body export.
