from __future__ import annotations

import argparse
import base64
import json
import struct
import zlib
from pathlib import Path

from class_tint_presets import PRESETS, ClassPreset


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract embedded class atlas PNGs and create blank mask templates for every class."
    )
    parser.add_argument(
        "--characters-dir",
        default="public/models/characters",
        help="Directory containing the source class .gltf files",
    )
    parser.add_argument(
        "--output-dir",
        default="public/models/characters/tint-work",
        help="Directory where atlas and mask templates will be written",
    )
    return parser.parse_args()


def decode_data_uri(uri: str) -> bytes:
    if not uri.startswith("data:"):
        raise ValueError("only embedded data URIs are supported")
    _, encoded = uri.split(",", 1)
    return base64.b64decode(encoded)


def read_buffer_bytes(gltf: dict) -> bytes:
    uri = gltf["buffers"][0]["uri"]
    return decode_data_uri(uri)


def extract_png_bytes(gltf: dict, image_index: int) -> bytes:
    image = gltf["images"][image_index]
    if image.get("mimeType") != "image/png":
        raise ValueError(f"image {image_index} is not a PNG")
    buffer_view = gltf["bufferViews"][image["bufferView"]]
    data = read_buffer_bytes(gltf)
    start = buffer_view.get("byteOffset", 0)
    end = start + buffer_view["byteLength"]
    return data[start:end]


def png_size(png_bytes: bytes) -> tuple[int, int]:
    if not png_bytes.startswith(PNG_SIGNATURE):
        raise ValueError("invalid PNG signature")
    if png_bytes[12:16] != b"IHDR":
        raise ValueError("IHDR chunk not found")
    width = struct.unpack(">I", png_bytes[16:20])[0]
    height = struct.unpack(">I", png_bytes[20:24])[0]
    return width, height


def write_chunk(handle, chunk_type: bytes, chunk_data: bytes) -> None:
    handle.write(struct.pack(">I", len(chunk_data)))
    handle.write(chunk_type)
    handle.write(chunk_data)
    crc = zlib.crc32(chunk_type)
    crc = zlib.crc32(chunk_data, crc)
    handle.write(struct.pack(">I", crc & 0xFFFFFFFF))


def write_blank_png(path: Path, width: int, height: int) -> None:
    raw_rows = bytearray()
    transparent_row = b"\x00" + (b"\x00\x00\x00\x00" * width)
    for _ in range(height):
        raw_rows.extend(transparent_row)

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.write(PNG_SIGNATURE)
        ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
        write_chunk(handle, b"IHDR", ihdr)
        write_chunk(handle, b"IDAT", zlib.compress(bytes(raw_rows), level=9))
        write_chunk(handle, b"IEND", b"")


def material_names(gltf: dict) -> list[str]:
    return [material.get("name", "") for material in gltf.get("materials", [])]


def primary_atlas_index(gltf: dict) -> int:
    names = material_names(gltf)
    for material_index, name in enumerate(names):
        if name.lower().endswith("_texture") and "weapon" not in name.lower() and "staff" not in name.lower():
            texture_info = gltf["materials"][material_index]["pbrMetallicRoughness"]["baseColorTexture"]
            return texture_info["index"]
    return gltf["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]


def write_notes(path: Path, preset: ClassPreset, width: int, height: int) -> None:
    lines = [
        f"class: {preset.key}",
        f"model: {preset.model_name}",
        f"atlas_size: {width}x{height}",
        f"body_meshes: {', '.join(preset.body_meshes)}",
        f"skin_extras: {', '.join(preset.skin_extras) if preset.skin_extras else '(none)'}",
        f"weapon_meshes: {', '.join(preset.weapon_meshes) if preset.weapon_meshes else '(none)'}",
        "",
        "Paint the three mask PNGs in this folder:",
        "- skin_mask.png",
        "- hair_mask.png",
        "- outfit_mask.png",
        "",
        "White = visible. Black = transparent.",
        "Use atlas.png as the paint reference.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def process_class(characters_dir: Path, output_dir: Path, preset: ClassPreset) -> None:
    source_path = characters_dir / f"{preset.model_name}.gltf"
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    gltf = json.loads(source_path.read_text(encoding="utf-8"))
    atlas_texture_index = primary_atlas_index(gltf)
    atlas_image_index = gltf["textures"][atlas_texture_index]["source"]
    atlas_bytes = extract_png_bytes(gltf, atlas_image_index)
    width, height = png_size(atlas_bytes)

    class_dir = output_dir / preset.key
    class_dir.mkdir(parents=True, exist_ok=True)
    (class_dir / "atlas.png").write_bytes(atlas_bytes)
    write_blank_png(class_dir / "skin_mask.png", width, height)
    write_blank_png(class_dir / "hair_mask.png", width, height)
    write_blank_png(class_dir / "outfit_mask.png", width, height)
    write_notes(class_dir / "README.txt", preset, width, height)


def main() -> None:
    args = parse_args()
    characters_dir = Path(args.characters_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    for key in sorted(PRESETS):
        process_class(characters_dir, output_dir, PRESETS[key])


if __name__ == "__main__":
    main()
