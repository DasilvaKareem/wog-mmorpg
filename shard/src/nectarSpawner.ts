import { randomUUID } from "crypto";
import { getOrCreateZone, type Entity } from "./zoneRuntime.js";
import { NECTAR_CATALOG, type NectarType } from "./nectarCatalog.js";

interface NectarSpawnDef {
  zoneId: string;
  nectarType: NectarType;
  x: number;
  y: number;
}

const NECTAR_SPAWN_DEFS: NectarSpawnDef[] = [
  // village-square — common nectars only (starter zone)
  { zoneId: "village-square", nectarType: "dew-nectar", x: 180, y: 140 },
  { zoneId: "village-square", nectarType: "dew-nectar", x: 440, y: 280 },
  { zoneId: "village-square", nectarType: "dew-nectar", x: 320, y: 520 },

  // wild-meadow — common + uncommon
  { zoneId: "wild-meadow", nectarType: "dew-nectar", x: 120, y: 180 },
  { zoneId: "wild-meadow", nectarType: "dew-nectar", x: 380, y: 420 },
  { zoneId: "wild-meadow", nectarType: "suncrest-nectar", x: 500, y: 200 },
  { zoneId: "wild-meadow", nectarType: "suncrest-nectar", x: 250, y: 500 },

  // dark-forest — uncommon + rare
  { zoneId: "dark-forest", nectarType: "suncrest-nectar", x: 180, y: 250 },
  { zoneId: "dark-forest", nectarType: "moonpetal-nectar", x: 420, y: 180 },
  { zoneId: "dark-forest", nectarType: "moonpetal-nectar", x: 550, y: 420 },
  { zoneId: "dark-forest", nectarType: "gloomveil-nectar", x: 320, y: 500 },

  // auroral-plains — uncommon + rare
  { zoneId: "auroral-plains", nectarType: "suncrest-nectar", x: 200, y: 320 },
  { zoneId: "auroral-plains", nectarType: "moonpetal-nectar", x: 450, y: 200 },
  { zoneId: "auroral-plains", nectarType: "stormwell-nectar", x: 350, y: 480 },

  // emerald-woods — rare nectars
  { zoneId: "emerald-woods", nectarType: "moonpetal-nectar", x: 280, y: 150 },
  { zoneId: "emerald-woods", nectarType: "suncrest-nectar", x: 480, y: 350 },
  { zoneId: "emerald-woods", nectarType: "emberveil-nectar", x: 150, y: 480 },

  // viridian-range — rare + epic (volcanic zone = emberveil)
  { zoneId: "viridian-range", nectarType: "emberveil-nectar", x: 300, y: 200 },
  { zoneId: "viridian-range", nectarType: "emberveil-nectar", x: 500, y: 450 },
  { zoneId: "viridian-range", nectarType: "stormwell-nectar", x: 180, y: 400 },

  // moondancer-glade — rare + epic (shadow zone = gloomveil)
  { zoneId: "moondancer-glade", nectarType: "gloomveil-nectar", x: 350, y: 250 },
  { zoneId: "moondancer-glade", nectarType: "gloomveil-nectar", x: 150, y: 500 },
  { zoneId: "moondancer-glade", nectarType: "moonpetal-nectar", x: 480, y: 380 },

  // felsrock-citadel — epic nectars
  { zoneId: "felsrock-citadel", nectarType: "emberveil-nectar", x: 250, y: 200 },
  { zoneId: "felsrock-citadel", nectarType: "stormwell-nectar", x: 450, y: 350 },
  { zoneId: "felsrock-citadel", nectarType: "gloomveil-nectar", x: 350, y: 500 },

  // lake-lumina — rare + epic
  { zoneId: "lake-lumina", nectarType: "moonpetal-nectar", x: 200, y: 300 },
  { zoneId: "lake-lumina", nectarType: "stormwell-nectar", x: 400, y: 200 },
  { zoneId: "lake-lumina", nectarType: "emberveil-nectar", x: 500, y: 450 },

  // azurshard-chasm — epic nectars only
  { zoneId: "azurshard-chasm", nectarType: "stormwell-nectar", x: 250, y: 200 },
  { zoneId: "azurshard-chasm", nectarType: "gloomveil-nectar", x: 450, y: 350 },
  { zoneId: "azurshard-chasm", nectarType: "emberveil-nectar", x: 300, y: 500 },
];

export function spawnNectarNodes(): void {
  for (const def of NECTAR_SPAWN_DEFS) {
    const zone = getOrCreateZone(def.zoneId);
    const nectarProps = NECTAR_CATALOG[def.nectarType];

    const entity: Entity = {
      id: randomUUID(),
      type: "nectar-node",
      name: nectarProps.label,
      x: def.x,
      y: def.y,
      hp: 9999,
      maxHp: 9999,
      createdAt: Date.now(),
      nectarType: def.nectarType,
      charges: nectarProps.maxCharges,
      maxCharges: nectarProps.maxCharges,
      depletedAtTick: undefined,
      respawnTicks: nectarProps.respawnTicks,
    };

    zone.entities.set(entity.id, entity);
  }
  console.log(
    `[nectar] Spawned ${NECTAR_SPAWN_DEFS.length} nectar nodes across ${new Set(NECTAR_SPAWN_DEFS.map((d) => d.zoneId)).size} zones`
  );
}
