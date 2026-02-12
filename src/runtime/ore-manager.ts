import type { Vec2 } from "../types/zone.js";
import { TILE_SIZE } from "../types/terrain.js";
import type { TerrainGrid } from "./terrain-grid.js";
import {
  ORE_CATALOG,
  ORE_RESPAWN_TICKS,
  type OreType,
  type OreDeposit,
  type OreDepositData,
  type OreDepositInfo,
} from "../types/ore.js";

export class OreManager {
  private deposits: Map<string, OreDeposit> = new Map();
  private terrain: TerrainGrid;

  constructor(terrain: TerrainGrid, depositData: OreDepositData[]) {
    this.terrain = terrain;

    for (const d of depositData) {
      const props = ORE_CATALOG[d.oreType];
      const key = `${d.tx},${d.tz}`;
      this.deposits.set(key, {
        oreType: d.oreType,
        charges: props.maxCharges,
        maxCharges: props.maxCharges,
        depletedAtTick: null,
      });
    }
  }

  /** Get ore deposit at a world position, or null */
  getOreAt(pos: Vec2): OreDeposit | null {
    const { tx, tz } = this.terrain.worldToTile(pos);
    return this.deposits.get(`${tx},${tz}`) ?? null;
  }

  /** Mine the ore at a world position. Returns item info or error string. */
  mine(pos: Vec2, tick: number): { oreType: OreType; quantity: number; chargesRemaining: number } | string {
    const { tx, tz } = this.terrain.worldToTile(pos);
    const key = `${tx},${tz}`;
    const deposit = this.deposits.get(key);

    if (!deposit) return "no ore deposit at this position";
    if (deposit.depletedAtTick !== null) return "deposit depleted";
    if (deposit.charges <= 0) return "deposit depleted";

    deposit.charges -= 1;
    const chargesRemaining = deposit.charges;

    if (deposit.charges <= 0) {
      deposit.depletedAtTick = tick;
    }

    return { oreType: deposit.oreType, quantity: 1, chargesRemaining };
  }

  /** Restore depleted deposits whose cooldown has elapsed */
  tickRespawn(currentTick: number): void {
    for (const deposit of this.deposits.values()) {
      if (
        deposit.depletedAtTick !== null &&
        currentTick - deposit.depletedAtTick >= ORE_RESPAWN_TICKS
      ) {
        deposit.charges = deposit.maxCharges;
        deposit.depletedAtTick = null;
      }
    }
  }

  /** Get deposits within a tile-coordinate rectangle */
  getDepositsInRegion(fromTx: number, fromTz: number, toTx: number, toTz: number): OreDepositInfo[] {
    const results: OreDepositInfo[] = [];
    for (const [key, deposit] of this.deposits) {
      const [txStr, tzStr] = key.split(",");
      const tx = Number(txStr);
      const tz = Number(tzStr);
      if (tx >= fromTx && tx <= toTx && tz >= fromTz && tz <= toTz) {
        const props = ORE_CATALOG[deposit.oreType];
        results.push({
          tx, tz,
          oreType: deposit.oreType,
          label: props.label,
          rarity: props.rarity,
          charges: deposit.charges,
          maxCharges: deposit.maxCharges,
          depleted: deposit.depletedAtTick !== null,
        });
      }
    }
    return results;
  }

  /** Get all deposits in this zone */
  getAllDeposits(): OreDepositInfo[] {
    const results: OreDepositInfo[] = [];
    for (const [key, deposit] of this.deposits) {
      const [txStr, tzStr] = key.split(",");
      const props = ORE_CATALOG[deposit.oreType];
      results.push({
        tx: Number(txStr),
        tz: Number(tzStr),
        oreType: deposit.oreType,
        label: props.label,
        rarity: props.rarity,
        charges: deposit.charges,
        maxCharges: deposit.maxCharges,
        depleted: deposit.depletedAtTick !== null,
      });
    }
    return results;
  }

  /** World position from tile coords (center of tile) */
  tileToWorld(tx: number, tz: number): Vec2 {
    return this.terrain.tileToWorld(tx, tz);
  }

  /** Total deposit count */
  get size(): number {
    return this.deposits.size;
  }
}
