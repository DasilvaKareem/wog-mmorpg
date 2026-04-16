from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Iterable

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from class_tint_presets import PRESETS


def argv_after_dash() -> list[str]:
    import sys

    args = sys.argv
    if "--" not in args:
        return []
    return args[args.index("--") + 1 :]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Import a class body from .gltf/.glb/.blend, apply painted atlas masks, "
            "and export tintable Skin/Hair layers plus a baked outfit layer."
        )
    )
    parser.add_argument("--input", required=True, help="Source .gltf, .glb, or .blend")
    parser.add_argument("--output", required=True, help="Output .gltf/.glb path")
    parser.add_argument(
        "--preset",
        required=True,
        choices=sorted(PRESETS.keys()),
        help="Class preset that defines body/face/weapon mesh names",
    )
    parser.add_argument("--skin-mask", required=True, help="PNG mask for tintable skin regions")
    parser.add_argument("--hair-mask", required=True, help="PNG mask for tintable hair regions")
    parser.add_argument("--outfit-mask", required=True, help="PNG mask for baked outfit regions")
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for datablock in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures):
        for item in list(datablock):
            if item.users == 0:
                datablock.remove(item)


def load_scene(input_path: Path) -> None:
    suffix = input_path.suffix.lower()
    if suffix == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(input_path))
        return

    clear_scene()
    if suffix not in {".gltf", ".glb"}:
        raise SystemExit(f"unsupported input type: {input_path.suffix}")
    bpy.ops.import_scene.gltf(filepath=str(input_path))


def find_armature() -> bpy.types.Object:
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            return obj
    raise SystemExit("no armature found after loading input scene")


def mesh_lookup() -> dict[str, bpy.types.Object]:
    return {obj.name: obj for obj in bpy.data.objects if obj.type == "MESH"}


def require_meshes(names: Iterable[str], lookup: dict[str, bpy.types.Object], label: str) -> list[bpy.types.Object]:
    found: list[bpy.types.Object] = []
    missing: list[str] = []
    for name in names:
        obj = lookup.get(name)
        if obj is None:
            missing.append(name)
        else:
            found.append(obj)
    if missing:
        raise SystemExit(f"missing {label} mesh objects: {', '.join(missing)}")
    return found


def unique_objects(items: Iterable[bpy.types.Object]) -> list[bpy.types.Object]:
    seen: set[str] = set()
    ordered: list[bpy.types.Object] = []
    for obj in items:
        if obj.name in seen:
            continue
        seen.add(obj.name)
        ordered.append(obj)
    return ordered


def find_primary_image(objects: Iterable[bpy.types.Object]) -> bpy.types.Image:
    for obj in objects:
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image:
                    return node.image
    raise SystemExit("could not locate the class atlas image in imported materials")


def load_mask_image(path: Path, expected_width: int, expected_height: int) -> bpy.types.Image:
    if not path.exists():
        raise SystemExit(f"mask image not found: {path}")
    image = bpy.data.images.load(str(path), check_existing=True)
    width, height = image.size
    if width != expected_width or height != expected_height:
        raise SystemExit(
            f"mask image {path} is {width}x{height}; expected {expected_width}x{expected_height}"
        )
    return image


def create_masked_texture(
    atlas_image: bpy.types.Image,
    mask_image: bpy.types.Image,
    output_path: Path,
    image_name: str,
    *,
    color_mode: str,
) -> bpy.types.Image:
    width, height = atlas_image.size
    atlas_pixels = list(atlas_image.pixels[:])
    mask_pixels = list(mask_image.pixels[:])
    out_pixels = [0.0] * len(atlas_pixels)

    for i in range(0, len(atlas_pixels), 4):
        mask_alpha = (mask_pixels[i] + mask_pixels[i + 1] + mask_pixels[i + 2]) / 3.0
        if color_mode == "atlas":
            out_pixels[i] = atlas_pixels[i]
            out_pixels[i + 1] = atlas_pixels[i + 1]
            out_pixels[i + 2] = atlas_pixels[i + 2]
        elif color_mode == "grayscale":
            luminance = (
                atlas_pixels[i] * 0.2126
                + atlas_pixels[i + 1] * 0.7152
                + atlas_pixels[i + 2] * 0.0722
            )
            out_pixels[i] = luminance
            out_pixels[i + 1] = luminance
            out_pixels[i + 2] = luminance
        else:
            out_pixels[i] = 1.0
            out_pixels[i + 1] = 1.0
            out_pixels[i + 2] = 1.0
        out_pixels[i + 3] = atlas_pixels[i + 3] * mask_alpha

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image = bpy.data.images.new(name=image_name, width=width, height=height, alpha=True)
    image.pixels[:] = out_pixels
    image.file_format = "PNG"
    image.filepath_raw = str(output_path)
    image.save()
    bpy.data.images.remove(image)
    return bpy.data.images.load(str(output_path), check_existing=True)


def build_material(name: str, image: bpy.types.Image) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    material.blend_method = "BLEND"
    material.shadow_method = "HASHED"
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    out = nodes.new(type="ShaderNodeOutputMaterial")
    out.location = (300, 0)
    bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    tex = nodes.new(type="ShaderNodeTexImage")
    tex.location = (-300, 0)
    tex.image = image

    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return material


def duplicate_mesh_object(obj: bpy.types.Object, name: str) -> bpy.types.Object:
    dup = obj.copy()
    dup.data = obj.data.copy()
    dup.animation_data_clear()
    dup.name = name
    bpy.context.scene.collection.objects.link(dup)
    return dup


def assign_single_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.material_index = 0


def duplicate_layer(
    objects: Iterable[bpy.types.Object],
    suffix: str,
    material: bpy.types.Material,
) -> list[bpy.types.Object]:
    duplicates: list[bpy.types.Object] = []
    for obj in objects:
        dup = duplicate_mesh_object(obj, f"{obj.name}_{suffix}")
        assign_single_material(dup, material)
        duplicates.append(dup)
    return duplicates


def export_selection(output_path: Path, objects: list[bpy.types.Object]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    for obj in bpy.data.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

    export_format = "GLB" if output_path.suffix.lower() == ".glb" else "GLTF_SEPARATE"
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format=export_format,
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_skins=True,
        export_animations=False,
        export_materials="EXPORT",
    )


def main() -> None:
    args = parse_args(argv_after_dash())
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    preset = PRESETS[args.preset]

    load_scene(input_path)
    armature = find_armature()
    meshes = mesh_lookup()

    body_objects = require_meshes(preset.body_meshes, meshes, "body")
    skin_extra_objects = require_meshes(preset.skin_extras, meshes, "skin extra") if preset.skin_extras else []
    weapon_names = set(preset.weapon_meshes)
    non_weapon_meshes = [obj for name, obj in meshes.items() if name not in weapon_names]

    atlas_image = find_primary_image(body_objects)
    width, height = atlas_image.size
    skin_mask = load_mask_image(Path(args.skin_mask).expanduser().resolve(), width, height)
    hair_mask = load_mask_image(Path(args.hair_mask).expanduser().resolve(), width, height)
    outfit_mask = load_mask_image(Path(args.outfit_mask).expanduser().resolve(), width, height)

    stem = output_path.stem
    output_dir = output_path.parent
    skin_image = create_masked_texture(
        atlas_image,
        skin_mask,
        output_dir / f"{stem}_skin.png",
        f"{stem}_Skin",
        color_mode="grayscale",
    )
    hair_image = create_masked_texture(
        atlas_image,
        hair_mask,
        output_dir / f"{stem}_hair.png",
        f"{stem}_Hair",
        color_mode="grayscale",
    )
    outfit_image = create_masked_texture(
        atlas_image,
        outfit_mask,
        output_dir / f"{stem}_outfit.png",
        f"{stem}_Outfit",
        color_mode="atlas",
    )

    skin_material = build_material("Skin", skin_image)
    hair_material = build_material("Hair", hair_image)
    outfit_material = build_material(f"{args.preset.title()}_Outfit_Texture", outfit_image)

    skin_layer = duplicate_layer(unique_objects([*body_objects, *skin_extra_objects]), "Skin", skin_material)
    hair_layer = duplicate_layer(body_objects, "Hair", hair_material)
    outfit_layer = duplicate_layer(non_weapon_meshes, "Outfit", outfit_material)

    export_selection(output_path, [armature, *skin_layer, *hair_layer, *outfit_layer])


if __name__ == "__main__":
    main()
