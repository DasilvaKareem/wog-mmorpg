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

  // auroral-plains - copper x2, silver x2, gold x2
  { zoneId: "auroral-plains", oreType: "copper", x: 120, y: 200 },
  { zoneId: "auroral-plains", oreType: "copper", x: 350, y: 350 },
  { zoneId: "auroral-plains", oreType: "silver", x: 450, y: 200 },
  { zoneId: "auroral-plains", oreType: "silver", x: 250, y: 500 },
  { zoneId: "auroral-plains", oreType: "gold", x: 520, y: 350 },
  { zoneId: "auroral-plains", oreType: "gold", x: 150, y: 550 },

  // emerald-woods - copper x1, silver x2, gold x3
  { zoneId: "emerald-woods", oreType: "copper", x: 300, y: 150 },
  { zoneId: "emerald-woods", oreType: "silver", x: 450, y: 300 },
  { zoneId: "emerald-woods", oreType: "silver", x: 180, y: 350 },
  { zoneId: "emerald-woods", oreType: "gold", x: 520, y: 200 },
  { zoneId: "emerald-woods", oreType: "gold", x: 350, y: 500 },
  { zoneId: "emerald-woods", oreType: "gold", x: 100, y: 550 },

  // viridian-range - silver x2, gold x4
  { zoneId: "viridian-range", oreType: "silver", x: 200, y: 150 },
  { zoneId: "viridian-range", oreType: "silver", x: 400, y: 200 },
  { zoneId: "viridian-range", oreType: "gold", x: 300, y: 300 },
  { zoneId: "viridian-range", oreType: "gold", x: 500, y: 350 },
  { zoneId: "viridian-range", oreType: "gold", x: 150, y: 500 },
  { zoneId: "viridian-range", oreType: "gold", x: 450, y: 550 },

  // moondancer-glade - silver x1, gold x5
  { zoneId: "moondancer-glade", oreType: "silver", x: 300, y: 200 },
  { zoneId: "moondancer-glade", oreType: "gold", x: 150, y: 350 },
  { zoneId: "moondancer-glade", oreType: "gold", x: 400, y: 300 },
  { zoneId: "moondancer-glade", oreType: "gold", x: 250, y: 450 },
  { zoneId: "moondancer-glade", oreType: "gold", x: 500, y: 500 },
  { zoneId: "moondancer-glade", oreType: "gold", x: 100, y: 550 },

  // felsrock-citadel - gold x6
  { zoneId: "felsrock-citadel", oreType: "gold", x: 100, y: 200 },
  { zoneId: "felsrock-citadel", oreType: "gold", x: 300, y: 150 },
  { zoneId: "felsrock-citadel", oreType: "gold", x: 500, y: 200 },
  { zoneId: "felsrock-citadel", oreType: "gold", x: 200, y: 500 },
  { zoneId: "felsrock-citadel", oreType: "gold", x: 400, y: 550 },
  { zoneId: "felsrock-citadel", oreType: "gold", x: 550, y: 400 },

  // lake-lumina - gold x6
  { zoneId: "lake-lumina", oreType: "gold", x: 100, y: 200 },
  { zoneId: "lake-lumina", oreType: "gold", x: 250, y: 150 },
  { zoneId: "lake-lumina", oreType: "gold", x: 500, y: 150 },
  { zoneId: "lake-lumina", oreType: "gold", x: 150, y: 400 },
  { zoneId: "lake-lumina", oreType: "gold", x: 500, y: 500 },
  { zoneId: "lake-lumina", oreType: "gold", x: 350, y: 580 },

  // azurshard-chasm - gold x6
  { zoneId: "azurshard-chasm", oreType: "gold", x: 150, y: 100 },
  { zoneId: "azurshard-chasm", oreType: "gold", x: 350, y: 200 },
  { zoneId: "azurshard-chasm", oreType: "gold", x: 550, y: 150 },
  { zoneId: "azurshard-chasm", oreType: "gold", x: 200, y: 450 },
  { zoneId: "azurshard-chasm", oreType: "gold", x: 400, y: 550 },
  { zoneId: "azurshard-chasm", oreType: "gold", x: 560, y: 400 },
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
  console.log(`[ore] Spawned ${ORE_SPAWN_DEFS.length} ore nodes across ${new Set(ORE_SPAWN_DEFS.map(d => d.zoneId)).size} zones`);
}
