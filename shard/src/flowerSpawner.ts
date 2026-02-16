import { randomUUID } from "crypto";
import { getOrCreateZone, type Entity } from "./zoneRuntime.js";
import { FLOWER_CATALOG, type FlowerType } from "./flowerCatalog.js";

interface FlowerSpawnDef {
  zoneId: string;
  flowerType: FlowerType;
  x: number;
  y: number;
}

const FLOWER_SPAWN_DEFS: FlowerSpawnDef[] = [
  // village-square (starter zone) - common flowers everywhere
  { zoneId: "village-square", flowerType: "meadow-lily", x: 96, y: 192 },
  { zoneId: "village-square", flowerType: "meadow-lily", x: 256, y: 128 },
  { zoneId: "village-square", flowerType: "wild-rose", x: 128, y: 224 },
  { zoneId: "village-square", flowerType: "wild-rose", x: 320, y: 160 },
  { zoneId: "village-square", flowerType: "dandelion", x: 192, y: 96 },
  { zoneId: "village-square", flowerType: "dandelion", x: 384, y: 256 },
  { zoneId: "village-square", flowerType: "dandelion", x: 288, y: 352 },
  { zoneId: "village-square", flowerType: "clover", x: 160, y: 320 },
  { zoneId: "village-square", flowerType: "clover", x: 448, y: 192 },
  { zoneId: "village-square", flowerType: "lavender", x: 352, y: 288 },
  { zoneId: "village-square", flowerType: "sage", x: 512, y: 384 },

  // wild-meadow (mid-tier) - uncommon and rare flowers
  { zoneId: "wild-meadow", flowerType: "meadow-lily", x: 100, y: 200 },
  { zoneId: "wild-meadow", flowerType: "wild-rose", x: 200, y: 300 },
  { zoneId: "wild-meadow", flowerType: "dandelion", x: 150, y: 400 },
  { zoneId: "wild-meadow", flowerType: "clover", x: 300, y: 150 },
  { zoneId: "wild-meadow", flowerType: "lavender", x: 250, y: 250 },
  { zoneId: "wild-meadow", flowerType: "lavender", x: 400, y: 350 },
  { zoneId: "wild-meadow", flowerType: "sage", x: 350, y: 200 },
  { zoneId: "wild-meadow", flowerType: "mint", x: 300, y: 450 },
  { zoneId: "wild-meadow", flowerType: "mint", x: 450, y: 300 },
  { zoneId: "wild-meadow", flowerType: "moonflower", x: 400, y: 100 },
  { zoneId: "wild-meadow", flowerType: "starbloom", x: 500, y: 450 },

  // dark-forest (high-tier) - rare and epic flowers
  { zoneId: "dark-forest", flowerType: "lavender", x: 200, y: 300 },
  { zoneId: "dark-forest", flowerType: "sage", x: 300, y: 200 },
  { zoneId: "dark-forest", flowerType: "mint", x: 250, y: 450 },
  { zoneId: "dark-forest", flowerType: "mint", x: 450, y: 250 },
  { zoneId: "dark-forest", flowerType: "moonflower", x: 350, y: 350 },
  { zoneId: "dark-forest", flowerType: "moonflower", x: 500, y: 400 },
  { zoneId: "dark-forest", flowerType: "starbloom", x: 300, y: 150 },
  { zoneId: "dark-forest", flowerType: "starbloom", x: 550, y: 500 },
  { zoneId: "dark-forest", flowerType: "dragons-breath", x: 400, y: 300 },
  { zoneId: "dark-forest", flowerType: "dragons-breath", x: 450, y: 450 },
];

export function spawnFlowerNodes(): void {
  for (const def of FLOWER_SPAWN_DEFS) {
    const zone = getOrCreateZone(def.zoneId);
    const flowerProps = FLOWER_CATALOG[def.flowerType];

    const entity: Entity = {
      id: randomUUID(),
      type: "flower-node",
      name: flowerProps.label,
      x: def.x,
      y: def.y,
      hp: 9999,
      maxHp: 9999,
      createdAt: Date.now(),
      flowerType: def.flowerType,
      charges: flowerProps.maxCharges,
      maxCharges: flowerProps.maxCharges,
      depletedAtTick: undefined,
      respawnTicks: flowerProps.respawnTicks,
    };

    zone.entities.set(entity.id, entity);
  }
  console.log(`[herbalism] Spawned ${FLOWER_SPAWN_DEFS.length} flower nodes across 3 zones`);
}
