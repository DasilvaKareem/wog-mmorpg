"""Blender CLI script: batch-convert FBX enemies to GLB with animations.

Reads every *.fbx in --input-dir, exports each as <name>.glb into --output-dir.
Designed for the Quaternius "Easy Animated Enemy Pack" (CC0).

Usage:
    blender --background --python scripts/blender_export_enemies.py -- \
        --input-dir  "/Users/me/Desktop/Easy Animated Enemy Pack - Jan 2019/FBX" \
        --output-dir public/models/environment/optimized
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy


def argv_after_dash() -> list[str]:
    args = sys.argv
    if "--" not in args:
        return []
    return args[args.index("--") + 1:]


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Batch FBX → GLB for monster packs.")
    p.add_argument("--input-dir",  required=True, help="Directory of .fbx files")
    p.add_argument("--output-dir", required=True, help="Directory to write .glb files")
    p.add_argument("--prefix",     default="",    help="Filename prefix, e.g. 'big_'")
    p.add_argument("--skip",       default="",    help="Comma-separated FBX stems to skip")
    return p.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for db in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures,
               bpy.data.actions, bpy.data.images, bpy.data.textures):
        for item in list(db):
            if item.users == 0:
                db.remove(item)


def import_fbx(path: Path) -> None:
    bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=True)


def export_glb(output: Path) -> None:
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        export_animations=True,
        export_nla_strips=True,
        export_apply=True,
        export_yup=True,
    )


def slug(name: str) -> str:
    return name.lower().replace(" ", "_").replace("-", "_")


def main() -> None:
    args = parse_args(argv_after_dash())
    input_dir  = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    fbx_files = sorted(input_dir.glob("*.fbx"))
    if not fbx_files:
        print(f"[export_enemies] No .fbx files in {input_dir}", file=sys.stderr)
        sys.exit(1)

    skip = {s.strip().lower() for s in args.skip.split(",") if s.strip()}
    exported = 0
    for fbx in fbx_files:
        if fbx.stem.lower() in skip:
            print(f"[export_enemies] skip {fbx.name}")
            continue
        out = output_dir / f"{args.prefix}{slug(fbx.stem)}.glb"
        print(f"[export_enemies] {fbx.name} → {out.name}")
        clear_scene()
        import_fbx(fbx)
        export_glb(out)
        exported += 1

    print(f"[export_enemies] Done. Exported {exported} files to {output_dir}")


main()
