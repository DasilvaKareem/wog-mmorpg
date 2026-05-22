"""Blender CLI script: generate a 'skin' animation (0.7 s, 17 frames @ 24 fps).

Usage:
    blender --background --python scripts/blender_anim_skin.py -- \
        --input  public/models/characters/Cowboy_Male.glb \
        --output public/models/characters/skin_anim.glb
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
    p = argparse.ArgumentParser(description="Generate 'skin' animation NLA clip.")
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
    action = bpy.data.actions.new("skin")
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

    # Frame 3 — crouch: legs flex forward, hips sink
    euler_kf(arm, "Hips",       3, rx=20)
    euler_kf(arm, "UpperLegL",  3, rx=30)
    euler_kf(arm, "UpperLegR",  3, rx=30)
    euler_kf(arm, "LowerLegL",  3, rx=-30)
    euler_kf(arm, "LowerLegR",  3, rx=-30)
    loc_kf(arm,  "Hips",        3, y=-0.1)

    # Frame 6 — right arm extends forward-down (stroke start), left arm braces
    euler_kf(arm, "Hips",       6, rx=25)
    euler_kf(arm, "Torso",      6, rx=10, ry=10)
    euler_kf(arm, "UpperArmR",  6, rx=50, ry=-15)
    euler_kf(arm, "LowerArmR",  6, rx=20)
    euler_kf(arm, "UpperArmL",  6, rx=30)
    euler_kf(arm, "LowerArmL",  6, rx=40)

    # Frame 10 — right arm pulls back (blade draw stroke), wrist pronates
    euler_kf(arm, "Hips",       10, rx=20)
    euler_kf(arm, "Torso",      10, rx=8, ry=-5)
    euler_kf(arm, "UpperArmR",  10, rx=20, ry=20)
    euler_kf(arm, "LowerArmR",  10, rx=10)
    euler_kf(arm, "FistR",      10, rz=60)

    # Frame 13 — pause at end of stroke, left arm holds
    euler_kf(arm, "Hips",       13, rx=18)
    euler_kf(arm, "UpperArmR",  13, rx=15, ry=25)
    euler_kf(arm, "FistR",      13, rz=45)
    euler_kf(arm, "UpperArmL",  13, rx=30)
    euler_kf(arm, "LowerArmL",  13, rx=40)

    # Frame 17 — return to rest
    for bn in BONES_REST:
        euler_kf(arm, bn, 17)
    loc_kf(arm, "Hips", 17)

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
    bpy.context.scene.frame_end   = 17
    bpy.context.scene.render.fps  = 24

    build_action(arm)
    export_glb(output_path)
    print(f"[blender_anim_skin] Exported → {output_path}")


main()
