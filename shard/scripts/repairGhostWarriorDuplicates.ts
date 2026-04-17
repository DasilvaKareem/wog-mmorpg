import "dotenv/config";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { initPostgres, postgresQuery, withPostgresClient } from "../src/db/postgres.js";

type ProjectionDuplicateRow = {
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

type CharacterDuplicateRow = {
  wallet_address: string;
  normalized_name: string;
  character_name: string;
  class_id: string;
  level: number;
  xp: number;
  snapshot_class: string | null;
  updated_at: string;
};

type ClassifiedCandidate = {
  walletAddress: string;
  normalizedName: string;
  survivorClassId: string;
  projectionRows: ProjectionDuplicateRow[];
  characterRows: CharacterDuplicateRow[];
};

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function buildGroupKey(walletAddress: string, normalizedName: string): string {
  return `${walletAddress}::${normalizedName}`;
}

function groupRows<T extends { wallet_address: string; normalized_name: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = buildGroupKey(row.wallet_address, row.normalized_name);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}

function sortRows<T extends { class_id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.class_id.localeCompare(b.class_id));
}

function isGhostWarriorRow(
  row: { class_id: string; level: number; xp: number; snapshot_class: string | null },
  survivorClassId: string
): boolean {
  return (
    row.class_id === "warrior" &&
    row.level === 1 &&
    row.xp === 0 &&
    (row.snapshot_class === "warrior" || row.snapshot_class === survivorClassId)
  );
}

function isValidSurvivorRow(row: { class_id: string; snapshot_class: string | null }): boolean {
  if (!row.class_id || row.class_id === "warrior") return false;
  return !row.snapshot_class || row.snapshot_class === row.class_id;
}

function classifyProjectionGroup(rows: ProjectionDuplicateRow[]): { survivorClassId: string } | null {
  if (rows.length !== 2) return null;
  const warriorRows = rows.filter((row) => row.class_id === "warrior");
  const survivorRows = rows.filter((row) => row.class_id !== "warrior");
  if (warriorRows.length !== 1 || survivorRows.length !== 1) return null;
  const survivorClassId = survivorRows[0].class_id;
  if (!isGhostWarriorRow(warriorRows[0], survivorClassId)) return null;
  if (!isValidSurvivorRow(survivorRows[0])) return null;
  return { survivorClassId };
}

function classifyCharacterGroup(rows: CharacterDuplicateRow[]): { survivorClassId: string } | null {
  if (rows.length !== 2) return null;
  const warriorRows = rows.filter((row) => row.class_id === "warrior");
  const survivorRows = rows.filter((row) => row.class_id !== "warrior");
  if (warriorRows.length !== 1 || survivorRows.length !== 1) return null;
  const survivorClassId = survivorRows[0].class_id;
  if (!isGhostWarriorRow(warriorRows[0], survivorClassId)) return null;
  if (!isValidSurvivorRow(survivorRows[0])) return null;
  return { survivorClassId };
}

async function fetchProjectionDuplicateRows(): Promise<ProjectionDuplicateRow[]> {
  const { rows } = await postgresQuery<ProjectionDuplicateRow>(
    `
      with duplicated as (
        select wallet_address, normalized_name
        from game.character_projections
        group by wallet_address, normalized_name
        having count(*) > 1
      )
      select
        p.wallet_address,
        p.normalized_name,
        p.character_name,
        p.class_id,
        p.level,
        p.xp,
        p.snapshot_json->>'classId' as snapshot_class,
        p.source,
        p.updated_at::text
      from game.character_projections p
      join duplicated d
        on d.wallet_address = p.wallet_address
       and d.normalized_name = p.normalized_name
      order by p.wallet_address, p.normalized_name, p.class_id
    `
  );
  return rows;
}

async function fetchCharacterDuplicateRows(): Promise<CharacterDuplicateRow[]> {
  const { rows } = await postgresQuery<CharacterDuplicateRow>(
    `
      with duplicated as (
        select wallet_address, normalized_name
        from game.characters
        group by wallet_address, normalized_name
        having count(*) > 1
      )
      select
        c.wallet_address,
        c.normalized_name,
        c.character_name,
        c.class_id,
        c.level,
        c.xp,
        c.snapshot_json->>'classId' as snapshot_class,
        c.updated_at::text
      from game.characters c
      join duplicated d
        on d.wallet_address = c.wallet_address
       and d.normalized_name = c.normalized_name
      order by c.wallet_address, c.normalized_name, c.class_id
    `
  );
  return rows;
}

async function countDuplicateProjectionPairs(): Promise<number> {
  const { rows } = await postgresQuery<{ count: string }>(
    `
      select count(*)::text as count
      from (
        select wallet_address, normalized_name
        from game.character_projections
        group by wallet_address, normalized_name
        having count(*) > 1
      ) duplicated
    `
  );
  return Number(rows[0]?.count ?? "0") || 0;
}

function resolveBackupPath(): string {
  const requested = getArgValue("--backup");
  if (requested) return path.resolve(process.cwd(), requested);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join("/tmp", `wog-ghost-warrior-duplicates-${timestamp}.json`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  await initPostgres();

  const projectionRows = await fetchProjectionDuplicateRows();
  const characterRows = await fetchCharacterDuplicateRows();
  const projectionGroups = groupRows(projectionRows);
  const characterGroups = groupRows(characterRows);

  const candidates: ClassifiedCandidate[] = [];
  const skippedGroups: Array<{ walletAddress: string; normalizedName: string; projectionClasses: string[]; characterClasses: string[] }> = [];

  for (const [key, rawProjectionRows] of projectionGroups.entries()) {
    const projectionGroup = sortRows(rawProjectionRows);
    const characterGroup = sortRows(characterGroups.get(key) ?? []);
    const projectionClassification = classifyProjectionGroup(projectionGroup);
    const characterClassification = classifyCharacterGroup(characterGroup);
    const [walletAddress, normalizedName] = key.split("::");

    if (
      projectionClassification &&
      characterClassification &&
      projectionClassification.survivorClassId === characterClassification.survivorClassId
    ) {
      candidates.push({
        walletAddress,
        normalizedName,
        survivorClassId: projectionClassification.survivorClassId,
        projectionRows: projectionGroup,
        characterRows: characterGroup,
      });
      continue;
    }

    skippedGroups.push({
      walletAddress,
      normalizedName,
      projectionClasses: projectionGroup.map((row) => row.class_id),
      characterClasses: characterGroup.map((row) => row.class_id),
    });
  }

  const backupPath = resolveBackupPath();
  const backupPayload = {
    createdAt: new Date().toISOString(),
    apply,
    candidateCount: candidates.length,
    skippedGroupCount: skippedGroups.length,
    candidates,
    skippedGroups,
  };

  console.log(`[repair] duplicate projection pairs: ${projectionGroups.size}`);
  console.log(`[repair] ghost warrior candidates: ${candidates.length}`);
  console.log(`[repair] skipped duplicate groups: ${skippedGroups.length}`);

  for (const candidate of candidates.slice(0, 10)) {
    const warriorProjection = candidate.projectionRows.find((row) => row.class_id === "warrior");
    const survivorProjection = candidate.projectionRows.find((row) => row.class_id !== "warrior");
    console.log(
      `[repair] candidate ${candidate.walletAddress} "${candidate.normalizedName}" warrior(level=${warriorProjection?.level}, xp=${warriorProjection?.xp}, source=${warriorProjection?.source}) -> keep ${survivorProjection?.class_id}(level=${survivorProjection?.level}, xp=${survivorProjection?.xp})`
    );
  }
  if (candidates.length > 10) {
    console.log(`[repair] ... +${candidates.length - 10} more candidates`);
  }

  for (const skipped of skippedGroups.slice(0, 10)) {
    console.log(
      `[repair] skipped ${skipped.walletAddress} "${skipped.normalizedName}" projections=[${skipped.projectionClasses.join(", ")}] characters=[${skipped.characterClasses.join(", ")}]`
    );
  }
  if (skippedGroups.length > 10) {
    console.log(`[repair] ... +${skippedGroups.length - 10} more skipped groups`);
  }

  if (!apply) {
    console.log("[repair] dry run only; pass --apply to delete ghost warrior rows");
    return;
  }

  if (candidates.length === 0) {
    console.log("[repair] no candidates found; nothing to apply");
    return;
  }

  await writeFile(backupPath, JSON.stringify(backupPayload, null, 2), "utf8");
  console.log(`[repair] backup written to ${backupPath}`);

  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      for (const candidate of candidates) {
        const params = [candidate.walletAddress, candidate.normalizedName, "warrior"];
        const deletedProjection = await client.query(
          `
            delete from game.character_projections
            where wallet_address = $1
              and normalized_name = $2
              and class_id = $3
          `,
          params
        );
        const deletedCharacter = await client.query(
          `
            delete from game.characters
            where wallet_address = $1
              and normalized_name = $2
              and class_id = $3
          `,
          params
        );

        if (deletedProjection.rowCount !== 1 || deletedCharacter.rowCount !== 1) {
          throw new Error(
            `unexpected delete count for ${candidate.walletAddress}:${candidate.normalizedName} projection=${deletedProjection.rowCount} character=${deletedCharacter.rowCount}`
          );
        }
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });

  const remainingPairs = await countDuplicateProjectionPairs();
  console.log(`[repair] deleted ${candidates.length} ghost warrior duplicates`);
  console.log(`[repair] remaining duplicate projection pairs: ${remainingPairs}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
