import type { FastifyInstance } from "fastify";
import { getAllZones, type Entity } from "./zoneRuntime.js";

interface LeaderboardEntry {
  rank: number;
  entityId: string;
  name: string;
  level: number;
  xp: number;
  kills: number;
  raceId: string | null;
  classId: string | null;
  zoneId: string;
  powerScore: number;
}

type SortBy = "power" | "level" | "kills";

function computePowerScore(entity: Entity): number {
  const level = entity.level ?? 1;
  const kills = entity.kills ?? 0;
  const stats = entity.effectiveStats;

  let score = level * 100 + kills * 10;

  if (stats) {
    score +=
      stats.str * 2 +
      stats.def * 1.5 +
      stats.agi * 1.5 +
      stats.int * 2 +
      stats.hp * 0.5 +
      stats.mp * 0.5 +
      stats.faith * 1 +
      stats.luck * 0.5;
  }

  return Math.round(score);
}

export function registerLeaderboardRoutes(server: FastifyInstance) {
  server.get<{
    Querystring: { limit?: string; sortBy?: string };
  }>("/leaderboard", async (request) => {
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 20));
    const sortBy: SortBy =
      request.query.sortBy === "level" || request.query.sortBy === "kills"
        ? request.query.sortBy
        : "power";

    const players: Array<{ entity: Entity; zoneId: string; powerScore: number }> = [];

    for (const [zoneId, zone] of getAllZones()) {
      for (const entity of zone.entities.values()) {
        if (entity.type !== "player") continue;
        players.push({
          entity,
          zoneId,
          powerScore: computePowerScore(entity),
        });
      }
    }

    // Sort
    players.sort((a, b) => {
      if (sortBy === "level") {
        const ld = (b.entity.level ?? 1) - (a.entity.level ?? 1);
        return ld !== 0 ? ld : b.powerScore - a.powerScore;
      }
      if (sortBy === "kills") {
        const kd = (b.entity.kills ?? 0) - (a.entity.kills ?? 0);
        return kd !== 0 ? kd : b.powerScore - a.powerScore;
      }
      return b.powerScore - a.powerScore;
    });

    const entries: LeaderboardEntry[] = players.slice(0, limit).map((p, i) => ({
      rank: i + 1,
      entityId: p.entity.id,
      name: p.entity.name,
      level: p.entity.level ?? 1,
      xp: p.entity.xp ?? 0,
      kills: p.entity.kills ?? 0,
      raceId: p.entity.raceId ?? null,
      classId: p.entity.classId ?? null,
      zoneId: p.zoneId,
      powerScore: p.powerScore,
    }));

    return { timestamp: Date.now(), sortBy, entries };
  });
}
