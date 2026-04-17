import json
import sys

import bpy


def main() -> None:
    argv = sys.argv
    if "--" in argv:
      argv = argv[argv.index("--") + 1 :]
    else:
      argv = []

    target = argv[0] if argv else None
    if target:
        bpy.ops.wm.open_mainfile(filepath=target)

    objects = []
    for obj in bpy.data.objects:
        vertex_groups = [group.name for group in obj.vertex_groups]
        armature_name = None
        armature_modifiers = [mod for mod in obj.modifiers if mod.type == "ARMATURE"]
        if armature_modifiers:
            armature_name = armature_modifiers[0].object.name if armature_modifiers[0].object else None

        materials = []
        if getattr(obj.data, "materials", None):
            for mat in obj.data.materials:
                materials.append(mat.name if mat else None)

        objects.append(
            {
                "name": obj.name,
                "type": obj.type,
                "parent": obj.parent.name if obj.parent else None,
                "armature": armature_name,
                "vertex_group_count": len(obj.vertex_groups),
                "vertex_groups": vertex_groups,
                "materials": materials,
            }
        )

    payload = {
        "file": bpy.data.filepath,
        "scene": bpy.context.scene.name if bpy.context.scene else None,
        "objects": objects,
    }
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
