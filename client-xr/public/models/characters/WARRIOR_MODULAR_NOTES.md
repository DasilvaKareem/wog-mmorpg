Warrior modular donor export contract

Goal:
- Turn `Warrior` into the first Blender-split donor that feeds the existing XR armor system.

Requirements:
- Keep all wearable donor pieces on the same skeleton as the body.
- Export wearable donor pieces as skinned meshes, not rigid child meshes.
- Export as `Warrior.glb` or `Warrior.gltf` into this folder.
- Strip the built-in sword from the donor export.

Recommended split regions:
- `Armor_Chest`
- `Shoulders_Pauldrons`
- `Legs_Greaves`
- `Belt_Waist`
- `Helm_Headgear`

Notes:
- The runtime now fuzzy-matches material names, so prefixes/suffixes are fine.
- Examples that work: `Chest_Armor`, `Armor_Chest`, `Shoulders_Left`, `Legs_Greaves`, `Belt_Tabard`.
- If a piece is meant to follow the body during animation, it should remain skinned.

Current XR catalog targets wired for Warrior:
- `warrior_chest`
- `warrior_shoulders`
- `warrior_legs`
- `warrior_belt`
- `warrior_helm`
