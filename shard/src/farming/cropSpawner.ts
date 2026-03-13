/**
 * Crop Spawner — spawns crop nodes in farmland zones at boot time.
 * Follows the same pattern as oreSpawner.ts and flowerSpawner.ts.
 */

import { randomUUID } from "crypto";
import { getOrCreateZone, type Entity } from "../world/zoneRuntime.js";
import { CROP_CATALOG, type CropType } from "./cropCatalog.js";
import { getZoneOffset } from "../world/worldLayout.js";

interface CropSpawnDef {
  zoneId: string;
  cropType: CropType;
  x: number;
  y: number;
}

const CROP_SPAWN_DEFS: CropSpawnDef[] = [
  // sunflower-fields — 8 nodes: wheat, corn, sunflower-seeds, carrots, berries, turnips, potatoes, mushrooms
  { zoneId: "sunflower-fields", cropType: "wheat", x: 120, y: 150 },
  { zoneId: "sunflower-fields", cropType: "wheat", x: 350, y: 120 },
  { zoneId: "sunflower-fields", cropType: "corn", x: 200, y: 300 },
  { zoneId: "sunflower-fields", cropType: "sunflower-seeds", x: 450, y: 200 },
  { zoneId: "sunflower-fields", cropType: "sunflower-seeds", x: 300, y: 400 },
  { zoneId: "sunflower-fields", cropType: "carrots", x: 500, y: 350 },
  { zoneId: "sunflower-fields", cropType: "berries", x: 150, y: 500 },
  { zoneId: "sunflower-fields", cropType: "turnips", x: 400, y: 520 },

  // harvest-hollow — 10 nodes: wheat, corn, potatoes, rice, barley, mushrooms, berries, carrots, pumpkins, hops
  { zoneId: "harvest-hollow", cropType: "wheat", x: 100, y: 200 },
  { zoneId: "harvest-hollow", cropType: "corn", x: 250, y: 150 },
  { zoneId: "harvest-hollow", cropType: "potatoes", x: 400, y: 200 },
  { zoneId: "harvest-hollow", cropType: "rice", x: 150, y: 350 },
  { zoneId: "harvest-hollow", cropType: "barley", x: 300, y: 300 },
  { zoneId: "harvest-hollow", cropType: "mushrooms", x: 500, y: 350 },
  { zoneId: "harvest-hollow", cropType: "berries", x: 200, y: 480 },
  { zoneId: "harvest-hollow", cropType: "carrots", x: 450, y: 450 },
  { zoneId: "harvest-hollow", cropType: "pumpkins", x: 350, y: 530 },
  { zoneId: "harvest-hollow", cropType: "hops", x: 550, y: 500 },

  // willowfen-pastures — 8 nodes: watercress, rice, mushrooms, berries, wheat, corn, turnips, carrots
  { zoneId: "willowfen-pastures", cropType: "watercress", x: 120, y: 180 },
  { zoneId: "willowfen-pastures", cropType: "watercress", x: 400, y: 300 },
  { zoneId: "willowfen-pastures", cropType: "rice", x: 250, y: 200 },
  { zoneId: "willowfen-pastures", cropType: "mushrooms", x: 500, y: 150 },
  { zoneId: "willowfen-pastures", cropType: "berries", x: 150, y: 400 },
  { zoneId: "willowfen-pastures", cropType: "wheat", x: 350, y: 450 },
  { zoneId: "willowfen-pastures", cropType: "turnips", x: 300, y: 550 },
  { zoneId: "willowfen-pastures", cropType: "carrots", x: 500, y: 500 },

  // bramblewood-homestead — 8 nodes: mushrooms, berries, potatoes, pumpkins, wheat, corn, turnips, barley
  { zoneId: "bramblewood-homestead", cropType: "mushrooms", x: 150, y: 120 },
  { zoneId: "bramblewood-homestead", cropType: "mushrooms", x: 400, y: 250 },
  { zoneId: "bramblewood-homestead", cropType: "berries", x: 250, y: 300 },
  { zoneId: "bramblewood-homestead", cropType: "potatoes", x: 500, y: 180 },
  { zoneId: "bramblewood-homestead", cropType: "pumpkins", x: 350, y: 400 },
  { zoneId: "bramblewood-homestead", cropType: "wheat", x: 100, y: 500 },
  { zoneId: "bramblewood-homestead", cropType: "turnips", x: 450, y: 480 },
  { zoneId: "bramblewood-homestead", cropType: "barley", x: 200, y: 550 },

  // goldenreach-grange — 10 nodes: wheat, corn, barley, hops, pumpkins, rice, potatoes, apples, carrots, sunflower-seeds
  { zoneId: "goldenreach-grange", cropType: "wheat", x: 120, y: 150 },
  { zoneId: "goldenreach-grange", cropType: "wheat", x: 400, y: 120 },
  { zoneId: "goldenreach-grange", cropType: "corn", x: 250, y: 250 },
  { zoneId: "goldenreach-grange", cropType: "barley", x: 500, y: 200 },
  { zoneId: "goldenreach-grange", cropType: "hops", x: 150, y: 380 },
  { zoneId: "goldenreach-grange", cropType: "pumpkins", x: 350, y: 350 },
  { zoneId: "goldenreach-grange", cropType: "rice", x: 200, y: 500 },
  { zoneId: "goldenreach-grange", cropType: "apples", x: 450, y: 450 },
  { zoneId: "goldenreach-grange", cropType: "carrots", x: 550, y: 350 },
  { zoneId: "goldenreach-grange", cropType: "sunflower-seeds", x: 300, y: 530 },

  // dewveil-orchard — 8 nodes: apples, grapes, berries, moonberries, mushrooms, hops, pumpkins, watercress
  { zoneId: "dewveil-orchard", cropType: "apples", x: 150, y: 150 },
  { zoneId: "dewveil-orchard", cropType: "apples", x: 400, y: 200 },
  { zoneId: "dewveil-orchard", cropType: "grapes", x: 250, y: 300 },
  { zoneId: "dewveil-orchard", cropType: "moonberries", x: 500, y: 350 },
  { zoneId: "dewveil-orchard", cropType: "mushrooms", x: 350, y: 450 },
  { zoneId: "dewveil-orchard", cropType: "hops", x: 150, y: 500 },
  { zoneId: "dewveil-orchard", cropType: "pumpkins", x: 300, y: 550 },
  { zoneId: "dewveil-orchard", cropType: "watercress", x: 500, y: 520 },

  // thornwall-ranch — 8 nodes: wheat, corn, potatoes, pumpkins, barley, turnips, berries, carrots
  { zoneId: "thornwall-ranch", cropType: "wheat", x: 200, y: 120 },
  { zoneId: "thornwall-ranch", cropType: "corn", x: 400, y: 180 },
  { zoneId: "thornwall-ranch", cropType: "potatoes", x: 150, y: 300 },
  { zoneId: "thornwall-ranch", cropType: "pumpkins", x: 350, y: 280 },
  { zoneId: "thornwall-ranch", cropType: "barley", x: 500, y: 350 },
  { zoneId: "thornwall-ranch", cropType: "turnips", x: 250, y: 450 },
  { zoneId: "thornwall-ranch", cropType: "berries", x: 450, y: 500 },
  { zoneId: "thornwall-ranch", cropType: "carrots", x: 100, y: 550 },

  // moonpetal-gardens — 8 nodes: moonberries, glowroot, grapes, starfruit, apples, hops, watercress, berries
  { zoneId: "moonpetal-gardens", cropType: "moonberries", x: 180, y: 150 },
  { zoneId: "moonpetal-gardens", cropType: "moonberries", x: 450, y: 200 },
  { zoneId: "moonpetal-gardens", cropType: "glowroot", x: 300, y: 300 },
  { zoneId: "moonpetal-gardens", cropType: "starfruit", x: 150, y: 400 },
  { zoneId: "moonpetal-gardens", cropType: "apples", x: 500, y: 350 },
  { zoneId: "moonpetal-gardens", cropType: "hops", x: 350, y: 480 },
  { zoneId: "moonpetal-gardens", cropType: "watercress", x: 200, y: 550 },
  { zoneId: "moonpetal-gardens", cropType: "grapes", x: 450, y: 530 },

  // ironroot-farmstead — 8 nodes: ironwort, glowroot, potatoes, barley, pumpkins, mushrooms, turnips, wheat
  { zoneId: "ironroot-farmstead", cropType: "ironwort", x: 200, y: 150 },
  { zoneId: "ironroot-farmstead", cropType: "glowroot", x: 450, y: 200 },
  { zoneId: "ironroot-farmstead", cropType: "potatoes", x: 300, y: 300 },
  { zoneId: "ironroot-farmstead", cropType: "barley", x: 150, y: 400 },
  { zoneId: "ironroot-farmstead", cropType: "pumpkins", x: 500, y: 350 },
  { zoneId: "ironroot-farmstead", cropType: "mushrooms", x: 350, y: 500 },
  { zoneId: "ironroot-farmstead", cropType: "turnips", x: 200, y: 550 },
  { zoneId: "ironroot-farmstead", cropType: "wheat", x: 500, y: 520 },

  // crystalbloom-terrace — 8 nodes: crystalmelon, starfruit, moonberries, grapes, glowroot, ironwort, apples, watercress
  { zoneId: "crystalbloom-terrace", cropType: "crystalmelon", x: 180, y: 180 },
  { zoneId: "crystalbloom-terrace", cropType: "starfruit", x: 400, y: 150 },
  { zoneId: "crystalbloom-terrace", cropType: "moonberries", x: 300, y: 300 },
  { zoneId: "crystalbloom-terrace", cropType: "grapes", x: 150, y: 420 },
  { zoneId: "crystalbloom-terrace", cropType: "glowroot", x: 500, y: 350 },
  { zoneId: "crystalbloom-terrace", cropType: "ironwort", x: 250, y: 500 },
  { zoneId: "crystalbloom-terrace", cropType: "apples", x: 450, y: 480 },
  { zoneId: "crystalbloom-terrace", cropType: "watercress", x: 350, y: 560 },
];

export function spawnCropNodes(): void {
  for (const def of CROP_SPAWN_DEFS) {
    const zone = getOrCreateZone(def.zoneId);
    const cropProps = CROP_CATALOG[def.cropType];
    const offset = getZoneOffset(def.zoneId) ?? { x: 0, z: 0 };

    const entity: Entity = {
      id: randomUUID(),
      type: "crop-node",
      name: cropProps.label,
      x: def.x + offset.x,
      y: def.y + offset.z,
      hp: 9999,
      maxHp: 9999,
      region: def.zoneId,
      createdAt: Date.now(),
      cropType: def.cropType,
      charges: cropProps.maxCharges,
      maxCharges: cropProps.maxCharges,
      depletedAtTick: undefined,
      respawnTicks: cropProps.respawnTicks,
    };

    zone.entities.set(entity.id, entity);
  }
  console.log(
    `[farming] Spawned ${CROP_SPAWN_DEFS.length} crop nodes across ${new Set(CROP_SPAWN_DEFS.map((d) => d.zoneId)).size} zones`
  );
}
