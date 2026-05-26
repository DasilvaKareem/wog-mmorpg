import type { Entity } from "../types.js";

interface CatalogEntry {
  label: string;
  requiredSkillLevel: number;
  requiredToolTier?: number;
}

const ores = new Map<string, CatalogEntry>();
const flowers = new Map<string, CatalogEntry>();
const nectars = new Map<string, CatalogEntry>();
const crops = new Map<string, CatalogEntry>();

/** Player's current profession levels — keyed by profession id ("mining",
 *  "herbalism", "skinning", "farming"). Updated by main.ts after each
 *  pollProfessions(). Used to compute the meetsRequirement flag. */
const playerLevels = new Map<string, number>();

let initStarted = false;
let initDone: Promise<void> | null = null;

interface OreCatalogRow { oreType: string; label: string; requiredSkillLevel: number; requiredPickaxeTier?: number }
interface FlowerCatalogRow { flowerType: string; label: string; requiredSkillLevel: number; requiredSickleTier?: number }
interface NectarCatalogRow { nectarType: string; label: string; requiredSkillLevel: number; requiredSickleTier?: number }
interface CropCatalogRow { cropType: string; label: string; minSkill: number; requiredHoeTier?: number }

export function initProfessionCatalogs(apiBase: string): Promise<void> {
  if (initStarted && initDone) return initDone;
  initStarted = true;
  initDone = (async () => {
    const fetchJson = async <T,>(path: string): Promise<T | null> => {
      try {
        const r = await fetch(`${apiBase}${path}`);
        if (!r.ok) return null;
        return (await r.json()) as T;
      } catch {
        return null;
      }
    };
    const [oreRows, flowerRows, nectarRows, cropRows] = await Promise.all([
      fetchJson<OreCatalogRow[]>("/mining/catalog"),
      fetchJson<FlowerCatalogRow[]>("/herbalism/catalog"),
      fetchJson<NectarCatalogRow[]>("/herbalism/nectars/catalog"),
      fetchJson<CropCatalogRow[]>("/farming/catalog"),
    ]);
    for (const r of oreRows ?? []) {
      ores.set(r.oreType, { label: r.label, requiredSkillLevel: r.requiredSkillLevel, requiredToolTier: r.requiredPickaxeTier });
    }
    for (const r of flowerRows ?? []) {
      flowers.set(r.flowerType, { label: r.label, requiredSkillLevel: r.requiredSkillLevel, requiredToolTier: r.requiredSickleTier });
    }
    for (const r of nectarRows ?? []) {
      nectars.set(r.nectarType, { label: r.label, requiredSkillLevel: r.requiredSkillLevel, requiredToolTier: r.requiredSickleTier });
    }
    for (const r of cropRows ?? []) {
      crops.set(r.cropType, { label: r.label, requiredSkillLevel: r.minSkill, requiredToolTier: r.requiredHoeTier });
    }
  })();
  return initDone;
}

/** Push current player profession levels so getNodeResourceInfo can compute
 *  meetsRequirement. Call after each pollProfessions(). */
export function setPlayerProfessionLevels(skills: Record<string, { level: number }>) {
  for (const [id, s] of Object.entries(skills)) playerLevels.set(id, s.level);
}

export interface ResourceInfo {
  label: string;
  profession: "Mining" | "Herbalism" | "Skinning" | "Farming";
  professionId: string;
  requiredSkillLevel: number;
  requiredToolTier?: number;
  toolName?: string;
  playerLevel: number;
  meetsRequirement: boolean;
}

function buildInfo(
  label: string,
  profession: ResourceInfo["profession"],
  professionId: string,
  requiredSkillLevel: number,
  toolName: string,
  requiredToolTier?: number,
): ResourceInfo {
  const playerLevel = playerLevels.get(professionId) ?? 0;
  return {
    label,
    profession,
    professionId,
    requiredSkillLevel,
    requiredToolTier,
    toolName,
    playerLevel,
    meetsRequirement: playerLevel >= requiredSkillLevel,
  };
}

/** Resolve the resource a gather-node (or corpse) would yield. Returns null
 *  for unknown types or when the relevant catalog hasn't loaded yet. */
export function getNodeResourceInfo(entity: Entity): ResourceInfo | null {
  if (entity.oreType) {
    const c = ores.get(entity.oreType);
    if (!c) return null;
    return buildInfo(c.label, "Mining", "mining", c.requiredSkillLevel, "Pickaxe", c.requiredToolTier);
  }
  if (entity.flowerType) {
    const c = flowers.get(entity.flowerType);
    if (!c) return null;
    return buildInfo(c.label, "Herbalism", "herbalism", c.requiredSkillLevel, "Sickle", c.requiredToolTier);
  }
  if (entity.nectarType) {
    const c = nectars.get(entity.nectarType);
    if (!c) return null;
    return buildInfo(c.label, "Herbalism", "herbalism", c.requiredSkillLevel, "Sickle", c.requiredToolTier);
  }
  if (entity.cropType) {
    const c = crops.get(entity.cropType);
    if (!c) return null;
    return buildInfo(c.label, "Farming", "farming", c.requiredSkillLevel, "Hoe", c.requiredToolTier);
  }
  // Corpses don't use a catalog — required level is derived from the mob's
  // level via the server formula `max(1, level*2 - 1)`. Entity.level is the
  // source mob's level for corpse entities.
  if (entity.type === "corpse") {
    const corpseLevel = entity.level ?? 1;
    const required = Math.max(1, corpseLevel * 2 - 1);
    const label = entity.name || `Lv ${corpseLevel} Corpse`;
    return buildInfo(label, "Skinning", "skinning", required, "Knife");
  }
  return null;
}
