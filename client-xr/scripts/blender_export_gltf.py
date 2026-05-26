"""Blender CLI: batch-convert .gltf → .glb, preserving embedded textures + animations.

Quaternius packs ship .gltf with the texture atlas embedded as base64. FBX import
loses the atlas (texture path issue) and mangles animation names. Loading the
.gltf directly via Blender's glTF I/O preserves everything.

Usage:
    blender --background --python scripts/blender_export_gltf.py -- \
        --input-dir  "/path/to/glTF" \
        --output-dir public/models/environment/optimized \
        --prefix "big_" --skip "Alien,Bunny,Dino,Frog"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy


def argv_after_dash() -> list[str]:
    args = sys.argv
    return args[args.index("--") + 1:] if "--" in args else []


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--input-dir",  required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--prefix",     default="")
    p.add_argument("--skip",       default="")
    return p.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for db in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures,
               bpy.data.actions, bpy.data.images, bpy.data.textures):
        for item in list(db):
            db.remove(item)


def slug(name: str) -> str:
    return name.lower().replace(" ", "_").replace("-", "_")


def main() -> None:
    args = parse_args(argv_after_dash())
    input_dir  = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    skip = {s.strip().lower() for s in args.skip.split(",") if s.strip()}
    files = sorted(input_dir.glob("*.gltf"))
    if not files:
        print(f"[export_gltf] No .gltf in {input_dir}", file=sys.stderr)
        sys.exit(1)

    exported = 0
    for src in files:
        if src.stem.lower() in skip:
            print(f"[export_gltf] skip {src.name}")
            continue
        out = output_dir / f"{args.prefix}{slug(src.stem)}.glb"
        print(f"[export_gltf] {src.name} → {out.name}")
        clear_scene()
        bpy.ops.import_scene.gltf(filepath=str(src))
        bpy.ops.export_scene.gltf(
            filepath=str(out),
            export_format="GLB",
            export_animations=True,
            export_nla_strips=False,
            export_image_format="AUTO",
            export_apply=False,
            export_yup=True,
        )
        exported += 1

    print(f"[export_gltf] Done. Exported {exported} files to {output_dir}")


main()
