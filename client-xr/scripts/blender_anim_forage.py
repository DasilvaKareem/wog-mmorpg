"""Blender CLI script: generate a 'forage' animation (0.9 s, 22 frames @ 24 fps).

Usage:
    blender --background --python scripts/blender_anim_forage.py -- \
        --input  public/models/characters/Chef_Female.glb \
        --output public/models/characters/forage_anim.glb
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy


# ── helpers ────────────────────────────────────────────────────────────────


def argv_after_dash() -> list[str]:
    args = sys.argv
    if "--" not in args:
        return []
    return args[args.index("--") + 1:]


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate 'forage' animation NLA clip.")
    p.add_argument("--input",  required=True, help="Source .glb/.blend")
    p.add_argument("--output", required=True, help="Output .glb path")
    return p.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for db in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for item in list(db):
            if item.users == 0:
                db.remove(item)


def load_glb(path: Path) -> None:
    bpy.ops.import_scene.gltf(filepath=str(path))


def get_armature() -> bpy.types.Object:
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            return obj
    raise RuntimeError("No armature found in scene.")


def euler_kf(arm: bpy.types.Object, bone_name: str, frame: int,
             rx: float = 0.0, ry: float = 0.0, rz: float = 0.0) -> None:
    pb = arm.pose.bones.get(bone_name)
    if pb is None:
        return
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (math.radians(rx), math.radians(ry), math.radians(rz))
    pb.keyframe_insert("rotation_euler", frame=frame)


def loc_kf(arm: bpy.types.Object, bone_name: str, frame: int,
           x: float = 0.0, y: float = 0.0, z: float = 0.0) -> None:
    pb = arm.pose.bones.get(bone_name)
    if pb is None:
        return
    pb.location = (x, y, z)
    pb.keyframe_insert("location", frame=frame)


# ── animation ──────────────────────────────────────────────────────────────


def build_action(arm: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new("forage")
    arm.animation_data_create()
    arm.animation_data.action = action

    BONES_REST = [
        "Hips", "Abdomen", "Torso", "Neck", "Head",
        "ShoulderL", "ShoulderR",
        "UpperArmL", "UpperArmR",
        "LowerArmL", "LowerArmR",
        "FistL", "FistR",
        "UpperLegL", "UpperLegR",
        "LowerLegL", "LowerLegR",
        "FootL", "FootR",
    ]

    # Frame 1 — rest
    for bn in BONES_REST:
        euler_kf(arm, bn, 1)
    loc_kf(arm, "Hips", 1)

    # Frame 5 — bend forward, arms lower toward ground
    euler_kf(arm, "Hips",       5, rx=25)
    euler_kf(arm, "Abdomen",    5, rx=18)
    euler_kf(arm, "Torso",      5, rx=12)
    euler_kf(arm, "UpperArmL",  5, rx=40)
    euler_kf(arm, "UpperArmR",  5, rx=40)
    euler_kf(arm, "LowerArmL",  5, rx=20)
    euler_kf(arm, "LowerArmR",  5, rx=20)

    # Frame 11 — hands at ground level, wrists open
    euler_kf(arm, "Hips",       11, rx=45)
    euler_kf(arm, "Abdomen",    11, rx=30)
    euler_kf(arm, "Torso",      11, rx=20)
    euler_kf(arm, "UpperArmL",  11, rx=80)
    euler_kf(arm, "UpperArmR",  11, rx=80)
    euler_kf(arm, "LowerArmL",  11, rx=40)
    euler_kf(arm, "LowerArmR",  11, rx=40)
    euler_kf(arm, "FistL",      11, rx=20)
    euler_kf(arm, "FistR",      11, rx=20)

    # Frame 15 — grasp and pull up slightly
    euler_kf(arm, "Hips",       15, rx=35)
    euler_kf(arm, "Abdomen",    15, rx=22)
    euler_kf(arm, "Torso",      15, rx=15)
    euler_kf(arm, "UpperArmL",  15, rx=55)
    euler_kf(arm, "UpperArmR",  15, rx=55)
    euler_kf(arm, "LowerArmL",  15, rx=25)
    euler_kf(arm, "LowerArmR",  15, rx=25)
    euler_kf(arm, "FistL",      15, rz=-20)
    euler_kf(arm, "FistR",      15, rz=20)

    # Frame 22 — return to rest
    for bn in BONES_REST:
        euler_kf(arm, bn, 22)
    loc_kf(arm, "Hips", 22)

    return action


def export_glb(output: Path) -> None:
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        export_animations=True,
        export_nla_strips=False,
    )


# ── main ───────────────────────────────────────────────────────────────────


def main() -> None:
    args = parse_args(argv_after_dash())
    input_path  = Path(args.input).resolve()
    output_path = Path(args.output).resolve()

    clear_scene()
    load_glb(input_path)

    arm = get_armature()
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end   = 22
    bpy.context.scene.render.fps  = 24

    build_action(arm)
    export_glb(output_path)
    print(f"[blender_anim_forage] Exported → {output_path}")


main()
