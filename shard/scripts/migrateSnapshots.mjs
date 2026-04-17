import dotenv from "dotenv";
import fs from "fs";
import Redis from "ioredis";
import pg from "pg";

const envFile = fs.existsSync(".env.production") ? ".env.production" : ".env";
dotenv.config({ path: envFile });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

const keys = await redis.keys("character:0x*");
let updated = 0;

for (const k of keys) {
  try {
    const raw = await redis.hgetall(k);
    if (!raw || !raw.name || !raw.classId) continue;

    const parse = (v) => { try { return v ? JSON.parse(v) : []; } catch { return []; } };
    const parseObj = (v) => { try { return v ? JSON.parse(v) : {}; } catch { return {}; } };

    const snapshot = {
      name: raw.name,
      classId: raw.classId,
      raceId: raw.raceId || "human",
      level: Number(raw.level || 1),
      xp: Number(raw.xp || 0),
      zone: raw.zone || "village-square",
      kills: Number(raw.kills || 0),
      learnedTechniques: parse(raw.learnedTechniques),
      completedQuests: parse(raw.completedQuests),
      activeQuests: parse(raw.activeQuests),
      storyFlags: parse(raw.storyFlags),
      professions: parse(raw.professions),
      professionSkills: parseObj(raw.professionSkills),
    };

    const equipment = parseObj(raw.equipment);
    if (equipment && Object.keys(equipment).length > 0) snapshot.equipment = equipment;
    if (raw.characterTokenId) snapshot.characterTokenId = raw.characterTokenId;
    if (raw.agentId) snapshot.agentId = raw.agentId;
    if (raw.calling) snapshot.calling = raw.calling;
    if (raw.gender) snapshot.gender = raw.gender;
    if (raw.origin) snapshot.origin = raw.origin;

    const wallet = k.split(":")[1].toLowerCase();
    const normalizedName = raw.name.replace(/\s+the\s+\w+$/i, "").trim().toLowerCase();
    const json = JSON.stringify(snapshot);

    const r1 = await pool.query(
      "update game.characters set snapshot_json = $1::jsonb, updated_at = now() where wallet_address = $2 and normalized_name = $3",
      [json, wallet, normalizedName]
    );
    const r2 = await pool.query(
      "update game.character_projections set snapshot_json = $1::jsonb, updated_at = now() where wallet_address = $2 and normalized_name = $3",
      [json, wallet, normalizedName]
    );

    const techs = snapshot.learnedTechniques.length;
    const quests = snapshot.completedQuests.length;
    if (techs > 0 || quests > 0) {
      console.log(`${raw.name}: ${techs} techniques, ${quests} quests, ${snapshot.kills} kills (rows: ${r1.rowCount}/${r2.rowCount})`);
    }
    updated++;
  } catch (err) {
    console.error(`Failed ${k}: ${String(err?.message ?? err).slice(0, 80)}`);
  }
}

console.log(`\nMigrated ${updated} characters to full Postgres snapshots`);
await redis.quit();
await pool.end();
