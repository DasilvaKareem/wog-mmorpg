import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { PlotState } from "../farming/plotSystem.js";

interface PlotStateRow {
  plot_id: string;
  zone_id: string;
  x: number;
  y: number;
  owner_wallet: string | null;
  owner_name: string | null;
  claimed_at_ms: string | null;
  building_type: string | null;
  building_stage: number;
}

function mapRow(row: PlotStateRow): PlotState {
  return {
    plotId: row.plot_id,
    zoneId: row.zone_id,
    x: row.x,
    y: row.y,
    owner: row.owner_wallet,
    ownerName: row.owner_name,
    claimedAt: row.claimed_at_ms ? Number(row.claimed_at_ms) : null,
    buildingType: row.building_type,
    buildingStage: row.building_stage,
  };
}

export async function upsertPlotState(state: PlotState): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.plot_state (
      plot_id, zone_id, x, y, owner_wallet, owner_name,
      claimed_at_ms, building_type, building_stage, updated_at
    ) values (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, now()
    )
    on conflict (plot_id) do update set
      zone_id = excluded.zone_id,
      x = excluded.x,
      y = excluded.y,
      owner_wallet = excluded.owner_wallet,
      owner_name = excluded.owner_name,
      claimed_at_ms = excluded.claimed_at_ms,
      building_type = excluded.building_type,
      building_stage = excluded.building_stage,
      updated_at = now()`,
    [
      state.plotId,
      state.zoneId,
      state.x,
      state.y,
      state.owner,
      state.ownerName,
      state.claimedAt,
      state.buildingType,
      state.buildingStage,
    ]
  );
}

export async function listPersistedPlotStates(): Promise<PlotState[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<PlotStateRow>(
    `select plot_id, zone_id, x, y, owner_wallet, owner_name,
            claimed_at_ms, building_type, building_stage
       from game.plot_state`
  );
  return rows.map(mapRow);
}

export async function getPersistedPlotState(plotId: string): Promise<PlotState | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<PlotStateRow>(
    `select plot_id, zone_id, x, y, owner_wallet, owner_name,
            claimed_at_ms, building_type, building_stage
       from game.plot_state
      where plot_id = $1
      limit 1`,
    [plotId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getPersistedOwnedPlotState(walletAddress: string): Promise<PlotState | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<PlotStateRow>(
    `select plot_id, zone_id, x, y, owner_wallet, owner_name,
            claimed_at_ms, building_type, building_stage
       from game.plot_state
      where owner_wallet = $1
      limit 1`,
    [walletAddress.toLowerCase()]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listPersistedPlotStatesByZone(zoneId: string): Promise<PlotState[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<PlotStateRow>(
    `select plot_id, zone_id, x, y, owner_wallet, owner_name,
            claimed_at_ms, building_type, building_stage
       from game.plot_state
      where zone_id = $1`,
    [zoneId]
  );
  return rows.map(mapRow);
}
