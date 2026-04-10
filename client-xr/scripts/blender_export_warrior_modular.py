import bmesh
import sys

import bpy


TORSO_GROUPS = {"Body", "Hips", "Abdomen", "Torso"}
LEG_GROUPS = {"UpperLeg.L", "LowerLeg.L", "Foot.L", "UpperLeg.R", "LowerLeg.R", "Foot.R"}
BELT_GROUPS = {"Body", "Hips", "Abdomen"}


def argv_after_dash() -> list[str]:
    argv = sys.argv
    if "--" in argv:
        return argv[argv.index("--") + 1 :]
    return []


def dominant_group_name(obj: bpy.types.Object, vertex: bpy.types.MeshVertex) -> str | None:
    best_name = None
    best_weight = -1.0
    for assignment in vertex.groups:
        group = obj.vertex_groups[assignment.group]
        if assignment.weight > best_weight:
            best_name = group.name
            best_weight = assignment.weight
    return best_name


def duplicate_mesh_object(obj: bpy.types.Object, name: str) -> bpy.types.Object:
    dup = obj.copy()
    dup.data = obj.data.copy()
    dup.animation_data_clear()
    dup.name = name
    bpy.context.scene.collection.objects.link(dup)
    return dup


def assign_single_material(obj: bpy.types.Object, material_name: str) -> None:
    material = bpy.data.materials.get(material_name)
    if material is None:
        material = bpy.data.materials.new(name=material_name)
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.material_index = 0


def filter_body_region(
    src: bpy.types.Object,
    name: str,
    material_name: str,
    allowed_groups: set[str],
    min_z_ratio: float,
    max_z_ratio: float,
) -> bpy.types.Object:
    dup = duplicate_mesh_object(src, name)
    mesh = dup.data
    z_values = [v.co.z for v in mesh.vertices]
    min_z = min(z_values)
    max_z = max(z_values)
    z_lo = min_z + (max_z - min_z) * min_z_ratio
    z_hi = min_z + (max_z - min_z) * max_z_ratio

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()

    to_delete = []
    for vert in bm.verts:
        src_vert = mesh.vertices[vert.index]
        dominant = dominant_group_name(dup, src_vert)
        z = src_vert.co.z
        keep = dominant in allowed_groups and z_lo <= z <= z_hi
        if not keep:
            to_delete.append(vert)

    bmesh.ops.delete(bm, geom=to_delete, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    assign_single_material(dup, material_name)
    return dup


def prepare_rigid_piece(
    src: bpy.types.Object,
    name: str,
    material_name: str,
    armature: bpy.types.Object,
    bone_name: str,
) -> bpy.types.Object:
    dup = duplicate_mesh_object(src, name)
    dup.parent = armature
    dup.parent_type = "OBJECT"
    modifier = dup.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = armature
    group = dup.vertex_groups.new(name=bone_name)
    indices = [v.index for v in dup.data.vertices]
    group.add(indices, 1.0, "REPLACE")
    assign_single_material(dup, material_name)
    return dup


def export_selection(output_path: str, objects: list[bpy.types.Object]) -> None:
    for obj in bpy.data.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLTF_SEPARATE",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_skins=True,
        export_animations=False,
        export_materials="EXPORT",
    )


def join_objects(name: str, objects: list[bpy.types.Object]) -> bpy.types.Object:
    for obj in bpy.data.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    return joined


def main() -> None:
    args = argv_after_dash()
    if len(args) != 2:
        raise SystemExit("usage: blender_export_warrior_modular.py -- <input_blend> <output_gltf>")

    input_blend, output_gltf = args
    bpy.ops.wm.open_mainfile(filepath=input_blend)

    armature = bpy.data.objects["CharacterArmature"]
    body = bpy.data.objects["Warrior_Body"]
    shoulder_l = bpy.data.objects["ShoulderPad.L"]
    shoulder_r = bpy.data.objects["ShoulderPad.R"]

    chest = filter_body_region(body, "Armor_Chest", "Armor_Chest", TORSO_GROUPS, 0.26, 0.78)
    legs = filter_body_region(body, "Legs_Greaves", "Legs_Greaves", LEG_GROUPS, 0.0, 0.48)
    belt = filter_body_region(body, "Belt_Waist", "Belt_Waist", BELT_GROUPS, 0.33, 0.5)
    shoulder_left = prepare_rigid_piece(shoulder_l, "Shoulders_Pauldrons_L", "Shoulders_Pauldrons", armature, "Shoulder.L")
    shoulder_right = prepare_rigid_piece(shoulder_r, "Shoulders_Pauldrons_R", "Shoulders_Pauldrons", armature, "Shoulder.R")
    shoulders = join_objects("Shoulders_Pauldrons", [shoulder_left, shoulder_right])

    export_selection(output_gltf, [armature, chest, legs, belt, shoulders])


if __name__ == "__main__":
    main()
