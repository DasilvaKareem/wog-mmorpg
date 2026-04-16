from __future__ import annotations

import base64
import json
import math
import struct
from collections import Counter
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

from class_tint_presets import PRESETS, ClassPreset


HEAD_JOINTS = {"Head", "Neck"}


def read_gltf(path: Path) -> tuple[dict, bytes]:
    gltf = json.loads(path.read_text(encoding="utf-8"))
    blob = base64.b64decode(gltf["buffers"][0]["uri"].split(",", 1)[1])
    return gltf, blob


def read_accessor(gltf: dict, blob: bytes, idx: int):
    acc = gltf["accessors"][idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    count = acc["count"]
    component_type = acc["componentType"]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    fmt = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}[component_type]
    stride = bv.get("byteStride", struct.calcsize("<" + fmt * ncomp))
    size = struct.calcsize("<" + fmt * ncomp)
    out = []
    for i in range(count):
        chunk = blob[offset + i * stride : offset + i * stride + size]
        out.append(struct.unpack("<" + fmt * ncomp, chunk))
    return out


def mesh_nodes(gltf: dict) -> dict[str, dict]:
    return {node["name"]: node for node in gltf["nodes"] if "mesh" in node}


def union_masks(size: tuple[int, int], masks: list[Image.Image]) -> Image.Image:
    result = Image.new("L", size, 0)
    for mask in masks:
        result = ImageChops.lighter(result, mask)
    return result


def rasterize_mesh_uv_mask(gltf: dict, blob: bytes, node: dict, size: tuple[int, int]) -> Image.Image:
    mesh = gltf["meshes"][node["mesh"]]
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    for primitive in mesh["primitives"]:
        attrs = primitive["attributes"]
        if "TEXCOORD_0" not in attrs:
            continue
        uvs = read_accessor(gltf, blob, attrs["TEXCOORD_0"])
        indices = [row[0] for row in read_accessor(gltf, blob, primitive["indices"])]
        points = [(u * (size[0] - 1), (1 - v) * (size[1] - 1)) for u, v in uvs]
        for i in range(0, len(indices), 3):
            draw.polygon([points[indices[i]], points[indices[i + 1]], points[indices[i + 2]]], fill=255)
    return mask


def rasterize_body_head_mask(gltf: dict, blob: bytes, node: dict, size: tuple[int, int]) -> Image.Image:
    skin = gltf["skins"][0]
    joint_names = [gltf["nodes"][idx]["name"] for idx in skin["joints"]]
    mesh = gltf["meshes"][node["mesh"]]
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    for primitive in mesh["primitives"]:
        attrs = primitive["attributes"]
        if not {"POSITION", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"} <= attrs.keys():
            continue
        positions = read_accessor(gltf, blob, attrs["POSITION"])
        uvs = read_accessor(gltf, blob, attrs["TEXCOORD_0"])
        joints = read_accessor(gltf, blob, attrs["JOINTS_0"])
        weights = read_accessor(gltf, blob, attrs["WEIGHTS_0"])
        indices = [row[0] for row in read_accessor(gltf, blob, primitive["indices"])]
        ys = [p[1] for p in positions]
        y_threshold = min(ys) + (max(ys) - min(ys)) * 0.72

        head_vertex = []
        for pos, joint_row, weight_row in zip(positions, joints, weights):
            best = max(range(4), key=lambda i: weight_row[i])
            best_joint = joint_names[joint_row[best]]
            head_vertex.append(best_joint in HEAD_JOINTS or pos[1] >= y_threshold)

        points = [(u * (size[0] - 1), (1 - v) * (size[1] - 1)) for u, v in uvs]
        for i in range(0, len(indices), 3):
            tri = [indices[i], indices[i + 1], indices[i + 2]]
            if sum(1 for idx in tri if head_vertex[idx]) >= 2:
                draw.polygon([points[idx] for idx in tri], fill=255)
    return mask


def color_distance(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def luminance(c: tuple[int, int, int, int]) -> float:
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722


def saturation(c: tuple[int, int, int, int]) -> float:
    mx = max(c[:3])
    mn = min(c[:3])
    return 0.0 if mx == 0 else (mx - mn) / mx


def is_skinlike(c: tuple[int, int, int, int]) -> bool:
    r, g, b, a = c
    if a < 10:
        return False
    sat = saturation(c)
    return (
        r > g > b
        and r >= 75
        and g >= 40
        and b >= 20
        and (r - b) >= 10
        and 0.08 <= sat <= 0.7
    )


def is_hairlike(c: tuple[int, int, int, int]) -> bool:
    if c[3] < 10:
        return False
    sat = saturation(c)
    lum = luminance(c)
    return (lum <= 120 and sat <= 0.6) or (sat <= 0.18 and 80 <= lum <= 220)


def collect_pixels(image: Image.Image, mask: Image.Image) -> list[tuple[int, int, int, int]]:
    img = image.load()
    m = mask.load()
    width, height = image.size
    out = []
    for y in range(height):
        for x in range(width):
            if m[x, y] > 0:
                out.append(img[x, y])
    return out


def top_colors(pixels: list[tuple[int, int, int, int]], predicate, limit: int = 8) -> list[tuple[int, int, int, int]]:
    counter = Counter(c for c in pixels if predicate(c))
    return [color for color, _ in counter.most_common(limit)]


def write_mask(path: Path, size: tuple[int, int], predicate) -> None:
    mask = Image.new("L", size, 0)
    px = mask.load()
    for y in range(size[1]):
        for x in range(size[0]):
            if predicate(x, y):
                px[x, y] = 255
    mask.save(path)


def auto_paint_class(root: Path, preset: ClassPreset) -> dict[str, float]:
    gltf, blob = read_gltf(root / "public/models/characters" / f"{preset.model_name}.gltf")
    atlas_path = root / "public/models/characters/tint-work" / preset.key / "atlas.png"
    atlas = Image.open(atlas_path).convert("RGBA")
    size = atlas.size
    nodes = mesh_nodes(gltf)

    body_masks = [rasterize_mesh_uv_mask(gltf, blob, nodes[name], size) for name in preset.body_meshes if name in nodes]
    body_mask = union_masks(size, body_masks)
    extra_skin_masks = [rasterize_mesh_uv_mask(gltf, blob, nodes[name], size) for name in preset.skin_extras if name in nodes]
    extra_skin_mask = union_masks(size, extra_skin_masks)

    accessory_names = [
        name
        for name in nodes
        if name not in set(preset.body_meshes) | set(preset.skin_extras) | set(preset.weapon_meshes)
    ]
    accessory_masks = [rasterize_mesh_uv_mask(gltf, blob, nodes[name], size) for name in accessory_names]
    accessory_mask = union_masks(size, accessory_masks)

    head_masks = [rasterize_body_head_mask(gltf, blob, nodes[name], size) for name in preset.body_meshes if name in nodes]
    head_mask = union_masks(size, head_masks)

    head_pixels = collect_pixels(atlas, head_mask)
    face_pixels = collect_pixels(atlas, extra_skin_mask)
    body_pixels = collect_pixels(atlas, body_mask)

    skin_palette = top_colors(face_pixels, is_skinlike)
    if not skin_palette:
        skin_palette = top_colors(head_pixels, is_skinlike)
    if not skin_palette:
        skin_palette = top_colors(body_pixels, is_skinlike)

    hair_palette = [
        color
        for color in top_colors(head_pixels, is_hairlike)
        if all(color_distance(color, skin) > 28 for skin in skin_palette)
    ]
    if not hair_palette:
        hair_palette = [
            color
            for color in top_colors(body_pixels, is_hairlike)
            if all(color_distance(color, skin) > 28 for skin in skin_palette)
        ]

    atlas_px = atlas.load()
    body_px = body_mask.load()
    extra_skin_px = extra_skin_mask.load()
    accessory_px = accessory_mask.load()
    head_px = head_mask.load()
    width, height = size

    def is_skin_pixel(x: int, y: int) -> bool:
        if extra_skin_px[x, y] > 0:
            return True
        if body_px[x, y] == 0:
            return False
        color = atlas_px[x, y]
        if is_skinlike(color):
            return True
        return any(color_distance(color, seed) <= 32 for seed in skin_palette)

    def is_hair_pixel(x: int, y: int) -> bool:
        if body_px[x, y] == 0 or head_px[x, y] == 0:
            return False
        if is_skin_pixel(x, y):
            return False
        color = atlas_px[x, y]
        if any(color_distance(color, seed) <= 30 for seed in hair_palette):
            return True
        return is_hairlike(color)

    skin_path = root / "public/models/characters/tint-work" / preset.key / "skin_mask.png"
    hair_path = root / "public/models/characters/tint-work" / preset.key / "hair_mask.png"
    outfit_path = root / "public/models/characters/tint-work" / preset.key / "outfit_mask.png"

    write_mask(skin_path, size, is_skin_pixel)
    write_mask(hair_path, size, is_hair_pixel)
    write_mask(outfit_path, size, lambda x, y: accessory_px[x, y] > 0 or (body_px[x, y] > 0 and not is_skin_pixel(x, y) and not is_hair_pixel(x, y)))

    total = width * height
    skin_img = Image.open(skin_path).convert("L")
    hair_img = Image.open(hair_path).convert("L")
    outfit_img = Image.open(outfit_path).convert("L")
    skin_count = sum(1 for p in skin_img.getdata() if p)
    hair_count = sum(1 for p in hair_img.getdata() if p)
    outfit_count = sum(1 for p in outfit_img.getdata() if p)
    return {
        "skin_pct": round(skin_count / total * 100, 2),
        "hair_pct": round(hair_count / total * 100, 2),
        "outfit_pct": round(outfit_count / total * 100, 2),
    }


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    for key in sorted(PRESETS):
        stats = auto_paint_class(root, PRESETS[key])
        print(key, stats)


if __name__ == "__main__":
    main()
