import { randomUUID } from "crypto";
import { getOrCreateZone, type Entity } from "../world/zoneRuntime.js";
import { FLOWER_CATALOG, type FlowerType } from "./flowerCatalog.js";
import { getZoneOffset } from "../world/worldLayout.js";

interface FlowerSpawnDef {
  zoneId: string;
  flowerType: FlowerType;
  x: number;
  y: number;
}

const FLOWER_SPAWN_DEFS: FlowerSpawnDef[] = [
  // village-square (starter zone) - common flowers, spread to avoid NPC overlap
  { zoneId: "village-square", flowerType: "meadow-lily", x: 260, y: 120 },
  { zoneId: "village-square", flowerType: "meadow-lily", x: 560, y: 120 },
  { zoneId: "village-square", flowerType: "wild-rose", x: 120, y: 200 },
  { zoneId: "village-square", flowerType: "wild-rose", x: 420, y: 160 },
  { zoneId: "village-square", flowerType: "dandelion", x: 140, y: 300 },
  { zoneId: "village-square", flowerType: "dandelion", x: 380, y: 380 },
  { zoneId: "village-square", flowerType: "dandelion", x: 280, y: 460 },
  { zoneId: "village-square", flowerType: "clover", x: 160, y: 360 },
  { zoneId: "village-square", flowerType: "clover", x: 520, y: 320 },
  { zoneId: "village-square", flowerType: "lavender", x: 300, y: 200 },
  { zoneId: "village-square", flowerType: "sage", x: 500, y: 400 },

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

  // auroral-plains - lavender x2, sage x2, mint x2, moonflower x2, starbloom x1, dragons-breath x1
  { zoneId: "auroral-plains", flowerType: "lavender", x: 120, y: 150 },
  { zoneId: "auroral-plains", flowerType: "lavender", x: 350, y: 300 },
  { zoneId: "auroral-plains", flowerType: "sage", x: 250, y: 200 },
  { zoneId: "auroral-plains", flowerType: "sage", x: 480, y: 350 },
  { zoneId: "auroral-plains", flowerType: "mint", x: 150, y: 400 },
  { zoneId: "auroral-plains", flowerType: "mint", x: 400, y: 500 },
  { zoneId: "auroral-plains", flowerType: "moonflower", x: 300, y: 150 },
  { zoneId: "auroral-plains", flowerType: "moonflower", x: 520, y: 250 },
  { zoneId: "auroral-plains", flowerType: "starbloom", x: 450, y: 450 },
  { zoneId: "auroral-plains", flowerType: "dragons-breath", x: 560, y: 550 },

  // emerald-woods - lavender x1, sage x2, mint x2, moonflower x2, starbloom x2, dragons-breath x1
  { zoneId: "emerald-woods", flowerType: "lavender", x: 150, y: 300 },
  { zoneId: "emerald-woods", flowerType: "sage", x: 250, y: 200 },
  { zoneId: "emerald-woods", flowerType: "sage", x: 400, y: 350 },
  { zoneId: "emerald-woods", flowerType: "mint", x: 300, y: 400 },
  { zoneId: "emerald-woods", flowerType: "mint", x: 500, y: 300 },
  { zoneId: "emerald-woods", flowerType: "moonflower", x: 200, y: 500 },
  { zoneId: "emerald-woods", flowerType: "moonflower", x: 450, y: 150 },
  { zoneId: "emerald-woods", flowerType: "starbloom", x: 350, y: 250 },
  { zoneId: "emerald-woods", flowerType: "starbloom", x: 550, y: 450 },
  { zoneId: "emerald-woods", flowerType: "dragons-breath", x: 520, y: 550 },

  // viridian-range - sage x1, mint x2, moonflower x2, starbloom x3, dragons-breath x2
  { zoneId: "viridian-range", flowerType: "sage", x: 200, y: 250 },
  { zoneId: "viridian-range", flowerType: "mint", x: 300, y: 150 },
  { zoneId: "viridian-range", flowerType: "mint", x: 150, y: 350 },
  { zoneId: "viridian-range", flowerType: "moonflower", x: 400, y: 200 },
  { zoneId: "viridian-range", flowerType: "moonflower", x: 250, y: 450 },
  { zoneId: "viridian-range", flowerType: "starbloom", x: 500, y: 300 },
  { zoneId: "viridian-range", flowerType: "starbloom", x: 350, y: 500 },
  { zoneId: "viridian-range", flowerType: "starbloom", x: 550, y: 450 },
  { zoneId: "viridian-range", flowerType: "dragons-breath", x: 450, y: 550 },
  { zoneId: "viridian-range", flowerType: "dragons-breath", x: 100, y: 500 },

  // moondancer-glade - mint x1, moonflower x2, starbloom x3, dragons-breath x4
  { zoneId: "moondancer-glade", flowerType: "mint", x: 200, y: 300 },
  { zoneId: "moondancer-glade", flowerType: "moonflower", x: 350, y: 200 },
  { zoneId: "moondancer-glade", flowerType: "moonflower", x: 150, y: 450 },
  { zoneId: "moondancer-glade", flowerType: "starbloom", x: 400, y: 350 },
  { zoneId: "moondancer-glade", flowerType: "starbloom", x: 250, y: 500 },
  { zoneId: "moondancer-glade", flowerType: "starbloom", x: 500, y: 200 },
  { zoneId: "moondancer-glade", flowerType: "dragons-breath", x: 300, y: 150 },
  { zoneId: "moondancer-glade", flowerType: "dragons-breath", x: 450, y: 450 },
  { zoneId: "moondancer-glade", flowerType: "dragons-breath", x: 100, y: 550 },
  { zoneId: "moondancer-glade", flowerType: "dragons-breath", x: 550, y: 350 },

  // felsrock-citadel - moonflower x1, starbloom x3, dragons-breath x6
  { zoneId: "felsrock-citadel", flowerType: "moonflower", x: 200, y: 300 },
  { zoneId: "felsrock-citadel", flowerType: "starbloom", x: 350, y: 150 },
  { zoneId: "felsrock-citadel", flowerType: "starbloom", x: 150, y: 450 },
  { zoneId: "felsrock-citadel", flowerType: "starbloom", x: 500, y: 300 },
  { zoneId: "felsrock-citadel", flowerType: "dragons-breath", x: 100, y: 150 },
  { zoneId: "felsrock-citadel", flowerType: "dragons-breath", x: 300, y: 250 },
  { zoneId: "felsrock-citadel", flowerType: "dragons-breath", x: 450, y: 450 },
  { zoneId: "felsrock-citadel", flowerType: "dragons-breath", x: 250, y: 550 },
  { zoneId: "felsrock-citadel", flowerType: "dragons-breath", x: 550, y: 200 },
  { zoneId: "felsrock-citadel", flowerType: "dragons-breath", x: 400, y: 550 },

  // lake-lumina - starbloom x3, dragons-breath x7
  { zoneId: "lake-lumina", flowerType: "starbloom", x: 150, y: 200 },
  { zoneId: "lake-lumina", flowerType: "starbloom", x: 400, y: 150 },
  { zoneId: "lake-lumina", flowerType: "starbloom", x: 550, y: 300 },
  { zoneId: "lake-lumina", flowerType: "dragons-breath", x: 100, y: 350 },
  { zoneId: "lake-lumina", flowerType: "dragons-breath", x: 250, y: 250 },
  { zoneId: "lake-lumina", flowerType: "dragons-breath", x: 450, y: 400 },
  { zoneId: "lake-lumina", flowerType: "dragons-breath", x: 300, y: 500 },
  { zoneId: "lake-lumina", flowerType: "dragons-breath", x: 500, y: 550 },
  { zoneId: "lake-lumina", flowerType: "dragons-breath", x: 200, y: 550 },
  { zoneId: "lake-lumina", flowerType: "dragons-breath", x: 550, y: 150 },

  // azurshard-chasm - starbloom x3, dragons-breath x7
  { zoneId: "azurshard-chasm", flowerType: "starbloom", x: 200, y: 150 },
  { zoneId: "azurshard-chasm", flowerType: "starbloom", x: 400, y: 250 },
  { zoneId: "azurshard-chasm", flowerType: "starbloom", x: 150, y: 400 },
  { zoneId: "azurshard-chasm", flowerType: "dragons-breath", x: 300, y: 100 },
  { zoneId: "azurshard-chasm", flowerType: "dragons-breath", x: 500, y: 200 },
  { zoneId: "azurshard-chasm", flowerType: "dragons-breath", x: 350, y: 350 },
  { zoneId: "azurshard-chasm", flowerType: "dragons-breath", x: 450, y: 500 },
  { zoneId: "azurshard-chasm", flowerType: "dragons-breath", x: 200, y: 550 },
  { zoneId: "azurshard-chasm", flowerType: "dragons-breath", x: 550, y: 400 },
  { zoneId: "azurshard-chasm", flowerType: "dragons-breath", x: 100, y: 300 },

  // sunflower-fields - meadow-lily x2, wild-rose x2, dandelion x2, clover x2
  { zoneId: "sunflower-fields", flowerType: "meadow-lily", x: 160, y: 180 },
  { zoneId: "sunflower-fields", flowerType: "meadow-lily", x: 420, y: 250 },
  { zoneId: "sunflower-fields", flowerType: "wild-rose", x: 280, y: 350 },
  { zoneId: "sunflower-fields", flowerType: "wild-rose", x: 530, y: 300 },
  { zoneId: "sunflower-fields", flowerType: "dandelion", x: 100, y: 450 },
  { zoneId: "sunflower-fields", flowerType: "dandelion", x: 360, y: 500 },
  { zoneId: "sunflower-fields", flowerType: "clover", x: 200, y: 550 },
  { zoneId: "sunflower-fields", flowerType: "clover", x: 480, y: 420 },

  // harvest-hollow - meadow-lily x1, wild-rose x1, dandelion x1, clover x1, lavender x2, sage x2
  { zoneId: "harvest-hollow", flowerType: "meadow-lily", x: 130, y: 180 },
  { zoneId: "harvest-hollow", flowerType: "wild-rose", x: 350, y: 200 },
  { zoneId: "harvest-hollow", flowerType: "dandelion", x: 500, y: 150 },
  { zoneId: "harvest-hollow", flowerType: "clover", x: 200, y: 350 },
  { zoneId: "harvest-hollow", flowerType: "lavender", x: 400, y: 400 },
  { zoneId: "harvest-hollow", flowerType: "lavender", x: 150, y: 500 },
  { zoneId: "harvest-hollow", flowerType: "sage", x: 300, y: 550 },
  { zoneId: "harvest-hollow", flowerType: "sage", x: 550, y: 450 },

  // willowfen-pastures - meadow-lily x2, wild-rose x2, lavender x2, mint x2
  { zoneId: "willowfen-pastures", flowerType: "meadow-lily", x: 180, y: 150 },
  { zoneId: "willowfen-pastures", flowerType: "meadow-lily", x: 450, y: 250 },
  { zoneId: "willowfen-pastures", flowerType: "wild-rose", x: 300, y: 350 },
  { zoneId: "willowfen-pastures", flowerType: "wild-rose", x: 550, y: 400 },
  { zoneId: "willowfen-pastures", flowerType: "lavender", x: 120, y: 450 },
  { zoneId: "willowfen-pastures", flowerType: "lavender", x: 400, y: 500 },
  { zoneId: "willowfen-pastures", flowerType: "mint", x: 250, y: 550 },
  { zoneId: "willowfen-pastures", flowerType: "mint", x: 500, y: 300 },

  // bramblewood-homestead - lavender x2, sage x2, mint x2, moonflower x2
  { zoneId: "bramblewood-homestead", flowerType: "lavender", x: 180, y: 200 },
  { zoneId: "bramblewood-homestead", flowerType: "lavender", x: 450, y: 300 },
  { zoneId: "bramblewood-homestead", flowerType: "sage", x: 300, y: 400 },
  { zoneId: "bramblewood-homestead", flowerType: "sage", x: 550, y: 180 },
  { zoneId: "bramblewood-homestead", flowerType: "mint", x: 120, y: 500 },
  { zoneId: "bramblewood-homestead", flowerType: "mint", x: 400, y: 550 },
  { zoneId: "bramblewood-homestead", flowerType: "moonflower", x: 250, y: 150 },
  { zoneId: "bramblewood-homestead", flowerType: "moonflower", x: 500, y: 450 },

  // goldenreach-grange - lavender x2, sage x2, mint x2, moonflower x2
  { zoneId: "goldenreach-grange", flowerType: "lavender", x: 150, y: 180 },
  { zoneId: "goldenreach-grange", flowerType: "lavender", x: 400, y: 250 },
  { zoneId: "goldenreach-grange", flowerType: "sage", x: 250, y: 350 },
  { zoneId: "goldenreach-grange", flowerType: "sage", x: 550, y: 300 },
  { zoneId: "goldenreach-grange", flowerType: "mint", x: 120, y: 450 },
  { zoneId: "goldenreach-grange", flowerType: "mint", x: 350, y: 500 },
  { zoneId: "goldenreach-grange", flowerType: "moonflower", x: 200, y: 550 },
  { zoneId: "goldenreach-grange", flowerType: "moonflower", x: 480, y: 400 },

  // dewveil-orchard - sage x2, mint x2, moonflower x2, starbloom x2
  { zoneId: "dewveil-orchard", flowerType: "sage", x: 180, y: 200 },
  { zoneId: "dewveil-orchard", flowerType: "sage", x: 450, y: 300 },
  { zoneId: "dewveil-orchard", flowerType: "mint", x: 300, y: 400 },
  { zoneId: "dewveil-orchard", flowerType: "mint", x: 550, y: 180 },
  { zoneId: "dewveil-orchard", flowerType: "moonflower", x: 120, y: 500 },
  { zoneId: "dewveil-orchard", flowerType: "moonflower", x: 400, y: 550 },
  { zoneId: "dewveil-orchard", flowerType: "starbloom", x: 250, y: 150 },
  { zoneId: "dewveil-orchard", flowerType: "starbloom", x: 500, y: 450 },

  // thornwall-ranch - sage x2, mint x2, moonflower x2, starbloom x2
  { zoneId: "thornwall-ranch", flowerType: "sage", x: 150, y: 180 },
  { zoneId: "thornwall-ranch", flowerType: "sage", x: 400, y: 250 },
  { zoneId: "thornwall-ranch", flowerType: "mint", x: 250, y: 350 },
  { zoneId: "thornwall-ranch", flowerType: "mint", x: 550, y: 300 },
  { zoneId: "thornwall-ranch", flowerType: "moonflower", x: 120, y: 450 },
  { zoneId: "thornwall-ranch", flowerType: "moonflower", x: 350, y: 500 },
  { zoneId: "thornwall-ranch", flowerType: "starbloom", x: 200, y: 550 },
  { zoneId: "thornwall-ranch", flowerType: "starbloom", x: 480, y: 400 },

  // moonpetal-gardens - moonflower x3, starbloom x3, dragons-breath x2
  { zoneId: "moonpetal-gardens", flowerType: "moonflower", x: 180, y: 200 },
  { zoneId: "moonpetal-gardens", flowerType: "moonflower", x: 400, y: 300 },
  { zoneId: "moonpetal-gardens", flowerType: "moonflower", x: 550, y: 150 },
  { zoneId: "moonpetal-gardens", flowerType: "starbloom", x: 250, y: 400 },
  { zoneId: "moonpetal-gardens", flowerType: "starbloom", x: 450, y: 500 },
  { zoneId: "moonpetal-gardens", flowerType: "starbloom", x: 120, y: 550 },
  { zoneId: "moonpetal-gardens", flowerType: "dragons-breath", x: 300, y: 150 },
  { zoneId: "moonpetal-gardens", flowerType: "dragons-breath", x: 500, y: 450 },

  // ironroot-farmstead - moonflower x2, starbloom x3, dragons-breath x3
  { zoneId: "ironroot-farmstead", flowerType: "moonflower", x: 200, y: 200 },
  { zoneId: "ironroot-farmstead", flowerType: "moonflower", x: 450, y: 350 },
  { zoneId: "ironroot-farmstead", flowerType: "starbloom", x: 150, y: 400 },
  { zoneId: "ironroot-farmstead", flowerType: "starbloom", x: 350, y: 500 },
  { zoneId: "ironroot-farmstead", flowerType: "starbloom", x: 550, y: 200 },
  { zoneId: "ironroot-farmstead", flowerType: "dragons-breath", x: 100, y: 550 },
  { zoneId: "ironroot-farmstead", flowerType: "dragons-breath", x: 300, y: 300 },
  { zoneId: "ironroot-farmstead", flowerType: "dragons-breath", x: 500, y: 450 },

  // crystalbloom-terrace - starbloom x3, dragons-breath x5
  { zoneId: "crystalbloom-terrace", flowerType: "starbloom", x: 180, y: 150 },
  { zoneId: "crystalbloom-terrace", flowerType: "starbloom", x: 400, y: 250 },
  { zoneId: "crystalbloom-terrace", flowerType: "starbloom", x: 550, y: 350 },
  { zoneId: "crystalbloom-terrace", flowerType: "dragons-breath", x: 120, y: 300 },
  { zoneId: "crystalbloom-terrace", flowerType: "dragons-breath", x: 300, y: 450 },
  { zoneId: "crystalbloom-terrace", flowerType: "dragons-breath", x: 450, y: 550 },
  { zoneId: "crystalbloom-terrace", flowerType: "dragons-breath", x: 200, y: 500 },
  { zoneId: "crystalbloom-terrace", flowerType: "dragons-breath", x: 500, y: 200 },
];

export function spawnFlowerNodes(): void {
  for (const def of FLOWER_SPAWN_DEFS) {
    const zone = getOrCreateZone(def.zoneId);
    const flowerProps = FLOWER_CATALOG[def.flowerType];
    const offset = getZoneOffset(def.zoneId) ?? { x: 0, z: 0 };

    const worldX = def.x + offset.x;
    const worldY = def.y + offset.z;

    const entity: Entity = {
      id: randomUUID(),
      type: "flower-node",
      name: flowerProps.label,
      x: worldX,
      y: worldY,
      hp: 9999,
      maxHp: 9999,
      region: def.zoneId,
      createdAt: Date.now(),
      flowerType: def.flowerType,
      charges: flowerProps.maxCharges,
      maxCharges: flowerProps.maxCharges,
      depletedAtTick: undefined,
      respawnTicks: flowerProps.respawnTicks,
      spawnX: worldX,
      spawnY: worldY,
    };

    zone.entities.set(entity.id, entity);
  }
  console.log(`[herbalism] Spawned ${FLOWER_SPAWN_DEFS.length} flower nodes across ${new Set(FLOWER_SPAWN_DEFS.map(d => d.zoneId)).size} zones`);
}
