"""Blender CLI script: generate a 'mine' animation (1 s, 24 frames @ 24 fps).

Usage:
    blender --background --python scripts/blender_anim_mine.py -- \
        --input  public/models/characters/Worker_Male.glb \
        --output public/models/characters/mine_anim.glb
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
    p = argparse.ArgumentParser(description="Generate 'mine' animation NLA clip.")
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


def bone(arm: bpy.types.Object, name: str) -> bpy.types.PoseBone | None:
    return arm.pose.bones.get(name)


def euler_kf(arm: bpy.types.Object, bone_name: str, frame: int,
             rx: float = 0.0, ry: float = 0.0, rz: float = 0.0) -> None:
    pb = bone(arm, bone_name)
    if pb is None:
        return
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (math.radians(rx), math.radians(ry), math.radians(rz))
    pb.keyframe_insert("rotation_euler", frame=frame)


def loc_kf(arm: bpy.types.Object, bone_name: str, frame: int,
           x: float = 0.0, y: float = 0.0, z: float = 0.0) -> None:
    pb = bone(arm, bone_name)
    if pb is None:
        return
    pb.location = (x, y, z)
    pb.keyframe_insert("location", frame=frame)


# ── animation ──────────────────────────────────────────────────────────────


def build_action(arm: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new("mine")
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

    for bn in BONES_REST:
        euler_kf(arm, bn, 1)
    loc_kf(arm, "Hips", 1)

    # Frame 4 — wind-up: hips rotate right, right shoulder raises
    euler_kf(arm, "Hips",       4, ry=25)
    euler_kf(arm, "Abdomen",    4, ry=15)
    euler_kf(arm, "Torso",      4, ry=10)
    euler_kf(arm, "ShoulderR",  4, rz=-60)
    euler_kf(arm, "UpperArmR",  4, rx=-30)

    # Frame 8 — overhead raise
    euler_kf(arm, "Hips",       8, rx=-10, ry=20)
    euler_kf(arm, "Abdomen",    8, rx=-8)
    euler_kf(arm, "Torso",      8, rx=-6)
    euler_kf(arm, "UpperArmR",  8, rx=-110)
    euler_kf(arm, "LowerArmR",  8, rx=-20)

    # Frame 14 — explosive downswing
    euler_kf(arm, "Hips",       14, ry=-20)
    euler_kf(arm, "Abdomen",    14, rx=15, ry=-12)
    euler_kf(arm, "Torso",      14, rx=12, ry=-8)
    euler_kf(arm, "UpperArmR",  14, rx=90)
    euler_kf(arm, "LowerArmR",  14, rx=30)
    euler_kf(arm, "FistR",      14, rx=15)

    # Frame 18 — follow-through
    euler_kf(arm, "Hips",       18, ry=-15)
    euler_kf(arm, "UpperArmR",  18, rx=70, ry=-20)
    euler_kf(arm, "LowerArmR",  18, rx=50)
    euler_kf(arm, "FistR",      18, rx=30)

    # Frame 24 — return to rest
    for bn in BONES_REST:
        euler_kf(arm, bn, 24)
    loc_kf(arm, "Hips", 24)

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
    bpy.context.scene.frame_end   = 24
    bpy.context.scene.render.fps  = 24

    build_action(arm)
    export_glb(output_path)
    print(f"[blender_anim_mine] Exported → {output_path}")


main()
