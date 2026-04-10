/**
 * Extracts individual armor pieces from Quaternius GLB models and layers them
 * onto BaseCharacter. All models share the same 23-bone skeleton, so extracted
 * SkinnedMesh primitives can be re-bound to any character's skeleton.
 *
 * Equipment slots: weapon, chest, shoulders, legs, helm, belt, boots
 * Each piece is a sub-geometry extracted from a donor model's SkinnedMesh.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getGradientMap } from "./ToonPipeline.js";

const CHAR_BASE = new URL(
  "models/characters/",
  new URL(import.meta.env.BASE_URL, window.location.href),
).href;

/* ── Armor piece definitions ─────────────────────────────────────── */

/** Which donor model + material index to extract for each armor piece */
interface ArmorPieceDef {
  /** Donor GLB model name */
  donor: string;
  /** Material name(s) to extract from the donor */
  materials: string[];
  /** Default tint color (can be overridden per-item) */
  defaultColor?: number;
}

function normalizeMaterialName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s.-]+/g, "_");
}

function materialMatches(name: string, targets: string[]): boolean {
  const normalized = normalizeMaterialName(name);
  if (!normalized) return false;
  return targets.some((target) => {
    const token = normalizeMaterialName(target);
    return normalized === token
      || normalized.startsWith(`${token}_`)
      || normalized.endsWith(`_${token}`)
      || normalized.includes(`_${token}_`);
  });
}

/**
 * Armor catalog: maps a piece ID to its donor model and materials.
 * Multiple tiers/styles per slot give variety.
 */
const ARMOR_CATALOG: Record<string, ArmorPieceDef> = {
  // ═══════════════════════════════════════════════════════════════════
  // CHEST / TORSO
  // ═══════════════════════════════════════════════════════════════════
  knight_plate:       { donor: "Knight_Male",          materials: ["Armor"],        defaultColor: 0x4c4c4c },
  knight_gold_plate:  { donor: "Knight_Golden_Male",   materials: ["Armor"],        defaultColor: 0x8a7a32 },
  soldier_jacket:     { donor: "Soldier_Male",         materials: ["Main"],         defaultColor: 0x48553b },
  blue_soldier_jacket:{ donor: "BlueSoldier_Male",     materials: ["Main"],         defaultColor: 0x2e394c },
  ninja_suit:         { donor: "Ninja_Male",           materials: ["Main"],         defaultColor: 0x1c1c1c },
  sand_ninja_suit:    { donor: "Ninja_Sand",           materials: ["Main"],         defaultColor: 0x7b6f4c },
  wizard_robe:        { donor: "Wizard",               materials: ["Clothes"],      defaultColor: 0x2b445d },
  witch_robe:         { donor: "Witch",                materials: ["Clothes"],      defaultColor: 0x2a2c4a },
  elf_tunic:          { donor: "Elf",                  materials: ["Clothes"],      defaultColor: 0x375d2c },
  kimono:             { donor: "Kimono_Male",          materials: ["Clothes"],      defaultColor: 0xc3c3c3 },
  pirate_coat:        { donor: "Pirate_Male",          materials: ["Clothes"],      defaultColor: 0x242a3d },
  doctor_coat:        { donor: "Doctor_Male_Old",      materials: ["Main"],         defaultColor: 0xadadad },
  suit_jacket:        { donor: "Suit_Male",            materials: ["Black"],        defaultColor: 0x181818 },
  chef_coat:          { donor: "Chef_Hat",             materials: ["Clothes"],      defaultColor: 0xc3c3c3 },
  worker_shirt:       { donor: "Worker_Male",          materials: ["Shirt"],        defaultColor: 0xa8b1a8 },
  cowboy_top:         { donor: "Cowboy_Male",           materials: ["Top"],          defaultColor: 0x4f3a20 },
  viking_chest:       { donor: "Viking_Male",          materials: ["Main"],         defaultColor: 0x45312d },
  oldclassy_shirt:    { donor: "OldClassy_Male",       materials: ["Shirt"],        defaultColor: 0xcfcfcf },
  worker_vest:        { donor: "Worker_Male",          materials: ["Vest"],         defaultColor: 0x77553a },
  cowboy_jacket:      { donor: "Cowboy_Male",           materials: ["Jacket"],       defaultColor: 0x814824 },
  zombie_rags:        { donor: "Zombie_Male",          materials: ["Clothes"],      defaultColor: 0x53457b },
  // Blender modular donor target: split Warrior into skinned torso/armor regions.
  warrior_chest:      { donor: "Warrior_Modular",      materials: ["Armor", "Chest", "Torso", "Clothes"], defaultColor: 0x7d7b82 },

  // ═══════════════════════════════════════════════════════════════════
  // SHOULDERS / OVERLAY
  // ═══════════════════════════════════════════════════════════════════
  knight_pauldrons:   { donor: "Knight_Male",          materials: ["Armor_Dark"],   defaultColor: 0x333333 },
  gold_pauldrons:     { donor: "Knight_Golden_Male",   materials: ["Armor_Dark"],   defaultColor: 0x292929 },
  soldier_gear:       { donor: "Soldier_Male",         materials: ["Black"],        defaultColor: 0x2b2b2b },
  blue_soldier_gear:  { donor: "BlueSoldier_Male",     materials: ["Black"],        defaultColor: 0x2b2b2b },
  ninja_wraps:        { donor: "Ninja_Male",           materials: ["Details"],      defaultColor: 0x451e43 },
  sand_ninja_wraps:   { donor: "Ninja_Sand",           materials: ["Details"],      defaultColor: 0x451239 },
  pirate_gold:        { donor: "Pirate_Male",          materials: ["Gold"],         defaultColor: 0x9c7536 },
  chef_apron:         { donor: "Chef_Hat",             materials: ["DarkClothes"],  defaultColor: 0x9a9a9a },
  suit_details:       { donor: "Suit_Male",            materials: ["Details"],      defaultColor: 0x484848 },
  oldclassy_detail:   { donor: "OldClassy_Male",       materials: ["Detail"],       defaultColor: 0x8d5c39 },
  warrior_shoulders:  { donor: "Warrior_Modular",      materials: ["Shoulder", "Shoulders", "Pauldron"], defaultColor: 0x6e727c },

  // ═══════════════════════════════════════════════════════════════════
  // LEGS / PANTS
  // ═══════════════════════════════════════════════════════════════════
  viking_pants:       { donor: "Viking_Male",          materials: ["Pants"],        defaultColor: 0x30241e },
  soldier_pants:      { donor: "Soldier_Male",         materials: ["DarkGreen"],    defaultColor: 0x353c22 },
  blue_soldier_pants: { donor: "BlueSoldier_Male",     materials: ["Grey"],         defaultColor: 0x3c3c3c },
  ninja_legs:         { donor: "Ninja_Male",           materials: ["Grey"],         defaultColor: 0x4c4c4c },
  cowboy_pants:       { donor: "Cowboy_Male",           materials: ["Pants"],        defaultColor: 0x3f251b },
  oldclassy_pants:    { donor: "OldClassy_Male",       materials: ["Pants"],        defaultColor: 0x7d7c5e },
  pirate_boots:       { donor: "Pirate_Male",          materials: ["Black"],        defaultColor: 0x252525 },
  worker_pants:       { donor: "Worker_Male",          materials: ["Pants"],        defaultColor: 0x3f586f },
  zombie_pants:       { donor: "Zombie_Male",          materials: ["Pants"],        defaultColor: 0x9a9171 },
  knight_detail:      { donor: "Knight_Male",          materials: ["Detail"],       defaultColor: 0x54321f },
  doctor_scrubs:      { donor: "Doctor_Male_Old",      materials: ["Brown"],        defaultColor: 0x1f3436 },
  warrior_legs:       { donor: "Warrior_Modular",      materials: ["Legs", "Pants", "Greaves"], defaultColor: 0x665a4a },

  // ═══════════════════════════════════════════════════════════════════
  // HELM / HAT
  // ═══════════════════════════════════════════════════════════════════
  viking_helm:        { donor: "VikingHelmet",         materials: ["Helmet", "Horns"], defaultColor: 0x474747 },
  soldier_helm:       { donor: "Soldier_Male",         materials: ["Helmet"],       defaultColor: 0x3c4c2c },
  blue_soldier_helm:  { donor: "BlueSoldier_Male",     materials: ["Helmet"],       defaultColor: 0x2e394c },
  wizard_hat:         { donor: "Wizard",               materials: ["Hat"],          defaultColor: 0x192a3c },
  witch_hat:          { donor: "Witch",                materials: ["Hat"],          defaultColor: 0x22293c },
  elf_hood:           { donor: "Elf",                  materials: ["Hat"],          defaultColor: 0x223c2a },
  cowboy_hat:         { donor: "Cowboy_Male",           materials: ["HatBrown", "HatLightBrown"], defaultColor: 0x81593e },
  chef_hat:           { donor: "Chef_Hat",             materials: ["Hat"],          defaultColor: 0xf4f3e8 },
  worker_hat:         { donor: "Worker_Male",          materials: ["Hat"],          defaultColor: 0xa19741 },
  oldclassy_hat:      { donor: "OldClassy_Male",       materials: ["Hat"],          defaultColor: 0x1b1a16 },
  warrior_helm:       { donor: "Warrior_Modular",      materials: ["Helm", "Helmet", "Headgear"], defaultColor: 0x8d8f95 },

  // ═══════════════════════════════════════════════════════════════════
  // BELT / ACCESSORY
  // ═══════════════════════════════════════════════════════════════════
  knight_tabard:      { donor: "Knight_Male",          materials: ["Red"],          defaultColor: 0x642420 },
  gold_tabard:        { donor: "Knight_Golden_Male",   materials: ["Red"],          defaultColor: 0x5a212e },
  elf_belt:           { donor: "Elf",                  materials: ["Belt", "Gold"], defaultColor: 0x906e38 },
  wizard_belt:        { donor: "Wizard",               materials: ["Belt", "Gold"], defaultColor: 0x906e38 },
  pirate_sash:        { donor: "Pirate_Male",          materials: ["Brown", "Red"], defaultColor: 0x583e2c },
  pirate_undershirt:  { donor: "Pirate_Male",          materials: ["Beige"],        defaultColor: 0xb7b09b },
  kimono_sash:        { donor: "Kimono_Male",          materials: ["Band"],         defaultColor: 0x83382b },
  chef_band:          { donor: "Chef_Hat",             materials: ["Band"],         defaultColor: 0x83382b },
  cowboy_scarf:       { donor: "Cowboy_Male",           materials: ["Scarf"],        defaultColor: 0x811e19 },
  viking_accents:     { donor: "Viking_Male",          materials: ["Light"],        defaultColor: 0xc0a98f },
  suit_belt:          { donor: "Suit_Male",            materials: ["Belt"],         defaultColor: 0x191b29 },
  suit_shirt:         { donor: "Suit_Male",            materials: ["Shirt"],        defaultColor: 0xcccccc },
  oldclassy_belt:     { donor: "OldClassy_Male",       materials: ["Belt"],         defaultColor: 0x523724 },
  doctor_stethoscope: { donor: "Doctor_Male_Old",      materials: ["Black"],        defaultColor: 0x46806e },
  warrior_belt:       { donor: "Warrior_Modular",      materials: ["Belt", "Waist", "Tabard"], defaultColor: 0x8b5c36 },

  // ═══════════════════════════════════════════════════════════════════
  // HAIR (equippable styles)
  // ═══════════════════════════════════════════════════════════════════
  pirate_dreads:      { donor: "Pirate_Female",        materials: ["Hair"],         defaultColor: 0x7e6135 },
  ninja_hair:         { donor: "Ninja_Female",         materials: ["Hair"],         defaultColor: 0x4a7e78 },
  wizard_beard:       { donor: "Wizard",               materials: ["Hair"],         defaultColor: 0xcfcfcf },
  witch_hair:         { donor: "Witch",                materials: ["Hair"],         defaultColor: 0xcfcfcf },
  chef_stache:        { donor: "Chef_Hat",             materials: ["Moustache"],    defaultColor: 0xfffff7 },
  viking_braids:      { donor: "Viking_Male",          materials: ["Hair"],         defaultColor: 0x6a3825 },
};

/**
 * Maps item name keywords to armor piece IDs.
 * Checked in order — first match wins.
 */
const ITEM_NAME_TO_PIECE: [RegExp, string][] = [
  // ── Chest (most specific first) ──
  [/gold.*plate|golden.*plate|gold.*chest/i,                "knight_gold_plate"],
  [/plate.*chest|plate.*armor|iron.*plate|steel.*plate|full.*plate/i, "knight_plate"],
  [/chainmail|chain.*shirt|mail.*shirt/i,                   "soldier_jacket"],
  [/ninja.*suit|shadow.*garb/i,                             "ninja_suit"],
  [/desert.*wrap|sand.*suit/i,                              "sand_ninja_suit"],
  [/wizard.*robe|mage.*robe|arcane.*robe/i,                 "wizard_robe"],
  [/witch.*robe|dark.*robe|warlock.*robe/i,                 "witch_robe"],
  [/elf.*tunic|elven.*tunic|ranger.*tunic/i,                "elf_tunic"],
  [/kimono|gi\b/i,                                          "kimono"],
  [/pirate.*coat|buccaneer/i,                               "pirate_coat"],
  [/doctor.*coat|lab.*coat|medic/i,                         "doctor_coat"],
  [/suit.*jacket|formal.*jacket|tuxedo/i,                   "suit_jacket"],
  [/chef.*coat|cook.*coat/i,                                "chef_coat"],
  [/cowboy.*vest|leather.*vest/i,                           "cowboy_top"],
  [/cowboy.*jacket|duster/i,                                "cowboy_jacket"],
  [/worker.*shirt|work.*shirt/i,                            "worker_shirt"],
  [/vest/i,                                                 "worker_vest"],
  [/viking.*chest|fur.*chest|barbarian/i,                   "viking_chest"],
  [/warrior.*chest|mercenary.*armor|gladiator.*armor/i,     "warrior_chest"],
  [/dress.*shirt|fine.*shirt|classy.*shirt/i,               "oldclassy_shirt"],
  [/zombie|undead.*rag|tattered/i,                          "zombie_rags"],
  [/robe|cloak/i,                                           "wizard_robe"],
  [/tunic/i,                                                "elf_tunic"],
  [/leather.*armor|hide.*armor|leather.*chest/i,            "ninja_suit"],
  [/jacket|coat/i,                                          "soldier_jacket"],
  [/shirt|linen/i,                                          "worker_shirt"],

  // ── Shoulders ──
  [/gold.*shoulder|golden.*pauldron/i,                      "gold_pauldrons"],
  [/plate.*shoulder|iron.*shoulder|steel.*shoulder|pauldron/i, "knight_pauldrons"],
  [/ninja.*wrap|shadow.*wrap/i,                             "ninja_wraps"],
  [/desert.*wrap|sand.*wrap/i,                              "sand_ninja_wraps"],
  [/pirate.*epaulette|gold.*buckle/i,                       "pirate_gold"],
  [/apron/i,                                                "chef_apron"],
  [/military.*gear|tactical/i,                              "soldier_gear"],
  [/warrior.*shoulder|mercenary.*pauldron|gladiator.*shoulder/i, "warrior_shoulders"],
  [/shoulder/i,                                             "soldier_gear"],

  // ── Legs ──
  [/viking.*pant|fur.*pant|barbarian.*leg/i,                "viking_pants"],
  [/soldier.*pant|military.*pant|camo.*pant/i,              "soldier_pants"],
  [/ninja.*leg|shadow.*leg/i,                               "ninja_legs"],
  [/cowboy.*pant|chaps|leather.*pant/i,                     "cowboy_pants"],
  [/pirate.*boot|buccaneer.*boot/i,                         "pirate_boots"],
  [/worker.*pant|work.*pant/i,                              "worker_pants"],
  [/warrior.*leg|mercenary.*greave|gladiator.*leg/i,        "warrior_legs"],
  [/fine.*pant|dress.*pant|classy.*pant|trouser/i,          "oldclassy_pants"],
  [/scrub|medic.*pant/i,                                    "doctor_scrubs"],
  [/plate.*greave|iron.*greave|steel.*greave/i,             "knight_detail"],
  [/greave|leg.*guard/i,                                    "soldier_pants"],
  [/pant|legging/i,                                         "viking_pants"],

  // ── Helm / Hat ──
  [/viking.*helm|horned.*helm/i,                            "viking_helm"],
  [/soldier.*helm|military.*helm|combat.*helm/i,            "soldier_helm"],
  [/wizard.*hat|mage.*hat|pointy.*hat/i,                    "wizard_hat"],
  [/witch.*hat|warlock.*hat/i,                              "witch_hat"],
  [/elf.*hood|ranger.*hood|elven.*hood/i,                   "elf_hood"],
  [/cowboy.*hat|ranch.*hat/i,                               "cowboy_hat"],
  [/chef.*hat|cook.*hat|toque/i,                            "chef_hat"],
  [/hard.*hat|worker.*hat|construction/i,                   "worker_hat"],
  [/warrior.*helm|mercenary.*helm|gladiator.*helm/i,        "warrior_helm"],
  [/top.*hat|classy.*hat|formal.*hat/i,                     "oldclassy_hat"],
  [/helm|helmet/i,                                          "soldier_helm"],
  [/hat|cap|hood/i,                                         "worker_hat"],
  [/crown|circlet|tiara/i,                                  "viking_helm"],

  // ── Belt / Accessory ──
  [/knight.*tabard|red.*tabard/i,                           "knight_tabard"],
  [/gold.*tabard|royal.*tabard/i,                           "gold_tabard"],
  [/elf.*belt|elven.*belt/i,                                "elf_belt"],
  [/wizard.*belt|mage.*belt/i,                              "wizard_belt"],
  [/pirate.*sash|buccaneer.*sash/i,                         "pirate_sash"],
  [/kimono.*sash|obi/i,                                     "kimono_sash"],
  [/chef.*band|cook.*band/i,                                "chef_band"],
  [/cowboy.*scarf|bandana|neckerchief/i,                    "cowboy_scarf"],
  [/bone.*accent|viking.*accent/i,                          "viking_accents"],
  [/stethoscope/i,                                          "doctor_stethoscope"],
  [/warrior.*belt|mercenary.*belt|gladiator.*belt/i,        "warrior_belt"],
  [/undershirt|cream.*shirt/i,                              "pirate_undershirt"],
  [/dress.*shirt.*under|suit.*shirt/i,                      "suit_shirt"],
  [/guard.*belt|plate.*belt|iron.*belt/i,                   "oldclassy_belt"],
  [/gold.*belt/i,                                           "elf_belt"],
  [/belt|sash|girdle/i,                                     "elf_belt"],
  [/amulet|necklace|pendant|ring|trinket/i,                 "elf_belt"],

  // ── Hair ──
  [/pirate.*dread|buccaneer.*hair/i,                        "pirate_dreads"],
  [/ninja.*hair|shadow.*hair/i,                             "ninja_hair"],
  [/wizard.*beard|sage.*beard|long.*beard/i,                "wizard_beard"],
  [/witch.*hair|white.*hair|silver.*hair/i,                 "witch_hair"],
  [/chef.*mustache|handlebar/i,                             "chef_stache"],
  [/viking.*braid|warrior.*braid|red.*braid/i,             "viking_braids"],
];

/* ── Extracted piece cache ────────────────────────────────────────── */

interface ExtractedPiece {
  geometry: THREE.BufferGeometry;
  defaultColor: number;
}

export class ArmorSystem {
  private loader = new GLTFLoader();
  private donorCache = new Map<string, THREE.SkinnedMesh[]>();
  private pieceCache = new Map<string, ExtractedPiece>();
  private loading = new Map<string, Promise<void>>();
  private ready = false;

  /** Preload all donor models and extract armor pieces */
  async preload(): Promise<void> {
    // Collect unique donor models
    const donors = new Set<string>();
    for (const def of Object.values(ARMOR_CATALOG)) {
      donors.add(def.donor);
    }

    console.log(`[Armor] Preloading ${donors.size} donor models`);
    const promises = [...donors].map((name) => this.loadDonor(name));
    await Promise.allSettled(promises);

    // Now extract all pieces
    for (const [pieceId, def] of Object.entries(ARMOR_CATALOG)) {
      this.extractPiece(pieceId, def);
    }

    this.ready = true;
    console.log(`[Armor] Extracted ${this.pieceCache.size}/${Object.keys(ARMOR_CATALOG).length} armor pieces`);
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Given an equipment slot and item name from the shard, resolve the best armor piece ID.
   */
  resolveArmorPiece(itemName: string): string | null {
    const lower = itemName.toLowerCase();
    for (const [pattern, pieceId] of ITEM_NAME_TO_PIECE) {
      if (pattern.test(lower)) return pieceId;
    }
    return null;
  }

  /**
   * Create a SkinnedMesh for an armor piece, bound to a target skeleton.
   * Returns null if the piece hasn't been extracted.
   */
  createPiece(
    pieceId: string,
    targetSkeleton: THREE.Skeleton,
    rootBone: THREE.Bone,
    tintColor?: number,
  ): THREE.SkinnedMesh | null {
    const piece = this.pieceCache.get(pieceId);
    if (!piece) return null;

    const color = tintColor ?? piece.defaultColor;
    const material = new THREE.MeshToonMaterial({
      color,
      gradientMap: getGradientMap(),
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.SkinnedMesh(piece.geometry, material);
    mesh.name = `armor_${pieceId}`;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.bind(targetSkeleton, new THREE.Matrix4());
    mesh.bindMode = THREE.AttachedBindMode;

    return mesh;
  }

  /**
   * Equip armor pieces onto a character based on their equipment data.
   * Returns a group containing all armor meshes.
   */
  equipFromEntityData(
    equipment: Record<string, { name?: string; quality?: string; xrVisualId?: string | null }>,
    targetSkeleton: THREE.Skeleton,
    rootBone: THREE.Bone,
  ): THREE.Group {
    const armorGroup = new THREE.Group();
    armorGroup.name = "equipment";

    for (const [_slot, item] of Object.entries(equipment)) {
      const pieceId = (item.xrVisualId && ARMOR_CATALOG[item.xrVisualId])
        ? item.xrVisualId
        : (item.name ? this.resolveArmorPiece(item.name) : null);
      if (!pieceId) continue;

      // Quality-based color tinting
      const qualityTint = this.qualityTint(item.quality);
      const mesh = this.createPiece(pieceId, targetSkeleton, rootBone, qualityTint);
      if (mesh) {
        armorGroup.add(mesh);
      }
    }

    return armorGroup;
  }

  /** Get all available piece IDs */
  getAvailablePieces(): string[] {
    return [...this.pieceCache.keys()];
  }

  /* ── Internal ──────────────────────────────────────────────────── */

  private qualityTint(quality?: string): number | undefined {
    switch (quality) {
      case "legendary": return 0xffaa00;
      case "epic":      return 0xaa44ff;
      case "rare":      return 0x4488ff;
      case "uncommon":  return 0x44cc44;
      default:          return undefined; // use piece default
    }
  }

  private async loadDonor(name: string): Promise<void> {
    if (this.donorCache.has(name)) return;

    const existing = this.loading.get(name);
    if (existing) return existing;

    const promise = new Promise<void>((resolve, reject) => {
      const finalize = (meshes: THREE.SkinnedMesh[]) => {
        this.donorCache.set(name, meshes);
        this.loading.delete(name);
        if (!meshes.length) {
          console.warn(`[Armor] No SkinnedMesh in donor ${name}`);
        }
        resolve();
      };

      const fail = (url: string, err: unknown, allowFallback: boolean) => {
        if (allowFallback) {
          console.warn(`[Armor] Failed to load donor ${url}, trying .gltf fallback`);
          load(CHAR_BASE + name + ".gltf", false);
          return;
        }
        console.error(`[Armor] Failed to load donor ${url}:`, err);
        this.loading.delete(name);
        reject(err);
      };

      const load = (url: string, allowFallback: boolean) => {
        this.loader.load(
          url,
          (gltf) => {
            const meshes: THREE.SkinnedMesh[] = [];
            gltf.scene.traverse((node) => {
              if (node instanceof THREE.SkinnedMesh) {
                meshes.push(node);
              }
            });
            finalize(meshes);
          },
          undefined,
          (err) => fail(url, err, allowFallback),
        );
      };

      load(CHAR_BASE + name + ".glb", true);
    });

    this.loading.set(name, promise);
    return promise;
  }

  private extractPiece(pieceId: string, def: ArmorPieceDef): void {
    const donors = this.donorCache.get(def.donor);
    if (!donors?.length) return;

    const matchingDonor = donors.find((donor) => {
      const materials = Array.isArray(donor.material) ? donor.material : [donor.material];
      return materials.some((mat) => materialMatches((mat as THREE.Material).name ?? "", def.materials));
    });

    if (!matchingDonor) {
      const available = donors
        .flatMap((donor) => (Array.isArray(donor.material) ? donor.material : [donor.material]))
        .map((mat) => (mat as THREE.Material).name ?? "");
      console.warn(`[Armor] No matching materials [${def.materials}] in ${def.donor} (has: ${available.join(", ")})`);
      return;
    }

    const geo = matchingDonor.geometry;
    const materials = Array.isArray(matchingDonor.material) ? matchingDonor.material : [matchingDonor.material];
    const groups = geo.groups;

    if (!groups.length) {
      console.warn(`[Armor] No groups in ${def.donor} geometry`);
      return;
    }

    const matchingGroups: { start: number; count: number }[] = [];
    for (const group of groups) {
      const mat = materials[group.materialIndex ?? 0];
      const matName = (mat as THREE.Material).name ?? "";
      if (materialMatches(matName, def.materials)) {
        matchingGroups.push({ start: group.start, count: group.count });
      }
    }

    if (!matchingGroups.length) {
      console.warn(`[Armor] No matching geometry groups [${def.materials}] in ${def.donor}`);
      return;
    }

    const srcIndex = geo.index;
    if (!srcIndex) return;

    const allIndices: number[] = [];
    for (const g of matchingGroups) {
      for (let i = g.start; i < g.start + g.count; i++) {
        allIndices.push(srcIndex.getX(i));
      }
    }

    const uniqueVerts = [...new Set(allIndices)];
    const oldToNew = new Map<number, number>();
    uniqueVerts.forEach((oldIdx, newIdx) => oldToNew.set(oldIdx, newIdx));

    const newGeo = new THREE.BufferGeometry();

    for (const attrName of ["position", "normal", "uv", "skinIndex", "skinWeight"]) {
      const src = geo.getAttribute(attrName);
      if (!src) continue;
      const itemSize = src.itemSize;
      const ctor = (src.array as ArrayLike<number>) instanceof Float32Array ? Float32Array : Uint16Array;
      const arr = new ctor(uniqueVerts.length * itemSize);
      for (let ni = 0; ni < uniqueVerts.length; ni++) {
        const oi = uniqueVerts[ni];
        for (let c = 0; c < itemSize; c++) {
          arr[ni * itemSize + c] = (src as THREE.BufferAttribute).getComponent(oi, c) as number;
        }
      }
      newGeo.setAttribute(attrName, new THREE.BufferAttribute(arr, itemSize));
    }

    const IndexArray = uniqueVerts.length > 65535 ? Uint32Array : Uint16Array;
    const newIndices = new IndexArray(allIndices.length);
    for (let i = 0; i < allIndices.length; i++) {
      newIndices[i] = oldToNew.get(allIndices[i])!;
    }
    newGeo.setIndex(new THREE.BufferAttribute(newIndices, 1));

    this.pieceCache.set(pieceId, {
      geometry: newGeo,
      defaultColor: def.defaultColor ?? 0x888888,
    });
  }
}

export { ARMOR_CATALOG, ITEM_NAME_TO_PIECE };
