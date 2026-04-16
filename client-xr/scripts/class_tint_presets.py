from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ClassPreset:
    key: str
    model_name: str
    body_meshes: tuple[str, ...]
    skin_extras: tuple[str, ...]
    weapon_meshes: tuple[str, ...]


PRESETS: dict[str, ClassPreset] = {
    "warrior": ClassPreset(
        key="warrior",
        model_name="Warrior",
        body_meshes=("Warrior_Body",),
        skin_extras=("Face",),
        weapon_meshes=("Warrior_Sword",),
    ),
    "ranger": ClassPreset(
        key="ranger",
        model_name="Ranger",
        body_meshes=("Ranger",),
        skin_extras=(),
        weapon_meshes=("Ranger_Bow",),
    ),
    "wizard": ClassPreset(
        key="wizard",
        model_name="Wizard",
        body_meshes=("Wizard.001",),
        skin_extras=("Face",),
        weapon_meshes=("Wizard_Staff",),
    ),
    "cleric": ClassPreset(
        key="cleric",
        model_name="Cleric",
        body_meshes=("Cleric",),
        skin_extras=("Head",),
        weapon_meshes=("Cleric_Staff",),
    ),
    "rogue": ClassPreset(
        key="rogue",
        model_name="Rogue",
        body_meshes=("Rogue",),
        skin_extras=("Face",),
        weapon_meshes=("Rogue_Dagger",),
    ),
    "monk": ClassPreset(
        key="monk",
        model_name="Monk",
        body_meshes=("Monk", "Monk.001"),
        skin_extras=(),
        weapon_meshes=(),
    ),
}
