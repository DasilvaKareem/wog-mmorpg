import "dotenv/config";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { initPostgres, postgresQuery, withPostgresClient } from "../src/db/postgres.js";

const TARGET_WALLET = "0x4be619301fd68724763dd016552eb18535c36e63";
const TARGET_NORMALIZED_NAME = "jacktheripper";
const CLASS_TO_DELETE = "warlock";
const CLASS_TO_KEEP = "warrior";

type ProjectionRow = {
  wallet_address: string;
  normalized_name: string;
  character_name: string;
  class_id: string;
  level: number;
  xp: number;
  snapshot_class: string | null;
  source: string;
  updated_at: string;
};

type CharacterRow = {
  wallet_address: string;
  normalized_name: string;
  character_name: string;
  class_id: string;
  level: number;
  xp: number;
  snapshot_class: string | null;
  updated_at: string;
};

async function fetchProjectionRows(): Promise<ProjectionRow[]> {
  const { rows } = await postgresQuery<ProjectionRow>(
    `
      select
        wallet_address,
        normalized_name,
        character_name,
        class_id,
        level,
        xp,
        snapshot_json->>'classId' as snapshot_class,
        source,
        updated_at::text
      from game.character_projections
      where wallet_address = $1 and normalized_name = $2
      order by class_id
    `,
    [TARGET_WALLET, TARGET_NORMALIZED_NAME]
  );
  return rows;
}

async function fetchCharacterRows(): Promise<CharacterRow[]> {
  const { rows } = await postgresQuery<CharacterRow>(
    `
      select
        wallet_address,
        normalized_name,
        character_name,
        class_id,
        level,
        xp,
        snapshot_json->>'classId' as snapshot_class,
        updated_at::text
      from game.characters
      where wallet_address = $1 and normalized_name = $2
      order by class_id
    `,
    [TARGET_WALLET, TARGET_NORMALIZED_NAME]
  );
  return rows;
}

function requireExactPair<T extends { class_id: string }>(rows: T[], label: string): void {
  if (rows.length !== 2) {
    throw new Error(`[${label}] expected 2 rows, found ${rows.length}`);
  }
  const classes = rows.map((r) => r.class_id).sort();
  const expected = [CLASS_TO_DELETE, CLASS_TO_KEEP].sort();
  if (classes[0] !== expected[0] || classes[1] !== expected[1]) {
    throw new Error(`[${label}] unexpected class_ids: [${classes.join(", ")}] (expected [${expected.join(", ")}])`);
  }
}

function logRow(label: string, row: { class_id: string; level: number; xp: number; snapshot_class: string | null; updated_at: string }): void {
  console.log(
    `  ${label} class_id=${row.class_id} level=${row.level} xp=${row.xp} snapshot.classId=${row.snapshot_class ?? "<null>"} updated_at=${row.updated_at}`
  );
}

function resolveBackupPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join("/tmp", `wog-repair-jacktheripper-${timestamp}.json`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  await initPostgres();

  const projectionRows = await fetchProjectionRows();
  const characterRows = await fetchCharacterRows();

  console.log(`[repair] target: wallet=${TARGET_WALLET} normalized_name=${TARGET_NORMALIZED_NAME}`);
  console.log(`[repair] plan: keep ${CLASS_TO_KEEP}, delete ${CLASS_TO_DELETE}`);
  console.log(`[repair] game.character_projections rows: ${projectionRows.length}`);
  for (const row of projectionRows) {
    logRow("projection", row);
  }
  console.log(`[repair] game.characters rows: ${characterRows.length}`);
  for (const row of characterRows) {
    logRow("character ", row);
  }

  requireExactPair(projectionRows, "projection");
  requireExactPair(characterRows, "character");

  if (!apply) {
    console.log("[repair] dry run only; pass --apply to delete the warrior rows");
    return;
  }

  const backupPath = resolveBackupPath();
  const backupPayload = {
    createdAt: new Date().toISOString(),
    target: { wallet: TARGET_WALLET, normalizedName: TARGET_NORMALIZED_NAME },
    plan: { keep: CLASS_TO_KEEP, delete: CLASS_TO_DELETE },
    projectionRows,
    characterRows,
  };
  await writeFile(backupPath, JSON.stringify(backupPayload, null, 2), "utf8");
  console.log(`[repair] backup written to ${backupPath}`);

  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      const deletedProjection = await client.query(
        `delete from game.character_projections where wallet_address = $1 and normalized_name = $2 and class_id = $3`,
        [TARGET_WALLET, TARGET_NORMALIZED_NAME, CLASS_TO_DELETE]
      );
      const deletedCharacter = await client.query(
        `delete from game.characters where wallet_address = $1 and normalized_name = $2 and class_id = $3`,
        [TARGET_WALLET, TARGET_NORMALIZED_NAME, CLASS_TO_DELETE]
      );

      if (deletedProjection.rowCount !== 1 || deletedCharacter.rowCount !== 1) {
        throw new Error(
          `unexpected delete count: projection=${deletedProjection.rowCount} character=${deletedCharacter.rowCount}`
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });

  const remainingProjection = await fetchProjectionRows();
  const remainingCharacter = await fetchCharacterRows();
  console.log(`[repair] post-apply: projections=${remainingProjection.length} characters=${remainingCharacter.length}`);
  for (const row of remainingProjection) logRow("projection", row);
  for (const row of remainingCharacter) logRow("character ", row);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
