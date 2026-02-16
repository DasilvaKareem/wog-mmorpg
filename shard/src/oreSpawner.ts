import { randomUUID } from "crypto";
import { getOrCreateZone, type Entity } from "./zoneRuntime.js";
import { ORE_CATALOG, type OreType } from "./oreCatalog.js";

interface OreSpawnDef {
  zoneId: string;
  oreType: OreType;
  x: number;
  y: number;
}

const ORE_SPAWN_DEFS: OreSpawnDef[] = [
  // village-square (starter zone) - coal, tin, copper, silver
  { zoneId: "village-square", oreType: "coal", x: 205, y: 115 },
  { zoneId: "village-square", oreType: "coal", x: 410, y: 141 },
  { zoneId: "village-square", oreType: "tin", x: 243, y: 179 },
  { zoneId: "village-square", oreType: "tin", x: 461, y: 307 },
  { zoneId: "village-square", oreType: "copper", x: 358, y: 435 },
  { zoneId: "village-square", oreType: "silver", x: 563, y: 461 },

  // wild-meadow (mid-tier) - more copper/silver, rare gold
  { zoneId: "wild-meadow", oreType: "coal", x: 180, y: 340 },
  { zoneId: "wild-meadow", oreType: "tin", x: 280, y: 180 },
  { zoneId: "wild-meadow", oreType: "copper", x: 380, y: 420 },
  { zoneId: "wild-meadow", oreType: "copper", x: 320, y: 120 },
  { zoneId: "wild-meadow", oreType: "silver", x: 420, y: 280 },
  { zoneId: "wild-meadow", oreType: "gold", x: 460, y: 380 },

  // dark-forest (high-tier) - abundant rare ores
  { zoneId: "dark-forest", oreType: "copper", x: 240, y: 420 },
  { zoneId: "dark-forest", oreType: "copper", x: 480, y: 360 },
  { zoneId: "dark-forest", oreType: "silver", x: 380, y: 280 },
  { zoneId: "dark-forest", oreType: "silver", x: 520, y: 480 },
  { zoneId: "dark-forest", oreType: "gold", x: 340, y: 180 },
  { zoneId: "dark-forest", oreType: "gold", x: 560, y: 540 },
];

export function spawnOreNodes(): void {
  for (const def of ORE_SPAWN_DEFS) {
    const zone = getOrCreateZone(def.zoneId);
    const oreProps = ORE_CATALOG[def.oreType];

    const entity: Entity = {
      id: randomUUID(),
      type: "ore-node",
      name: oreProps.label,
      x: def.x,
      y: def.y,
      hp: 9999,
      maxHp: 9999,
      createdAt: Date.now(),
      oreType: def.oreType,
      charges: oreProps.maxCharges,
      maxCharges: oreProps.maxCharges,
      depletedAtTick: undefined,
      respawnTicks: oreProps.respawnTicks,
    };

    zone.entities.set(entity.id, entity);
  }
  console.log(`[ore] Spawned ${ORE_SPAWN_DEFS.length} ore nodes across 3 zones`);
}
