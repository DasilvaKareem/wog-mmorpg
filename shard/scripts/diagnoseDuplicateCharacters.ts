import "dotenv/config";
import { initPostgres, postgresQuery } from "../src/db/postgres.js";

async function main() {
  await initPostgres();

  console.log("=== 1. Rows with empty/null class_id in game.character_projections ===");
  const { rows: emptyProjections } = await postgresQuery<{
    wallet_address: string;
    normalized_name: string;
    class_id: string | null;
    snapshot_class: string | null;
    level: number;
    updated_at: string;
  }>(
    `
      select
        wallet_address,
        normalized_name,
        class_id,
        snapshot_json->>'classId' as snapshot_class,
        level,
        updated_at::text
      from game.character_projections
      where class_id is null or class_id = ''
      order by wallet_address, normalized_name
    `
  );
  console.log(`  ${emptyProjections.length} rows with empty class_id`);
  for (const row of emptyProjections.slice(0, 20)) {
    console.log(
      `    ${row.wallet_address} "${row.normalized_name}" class_id=<${row.class_id ?? "null"}> snapshot.classId=${row.snapshot_class ?? "<null>"} level=${row.level}`
    );
  }
  if (emptyProjections.length > 20) console.log(`    ... +${emptyProjections.length - 20} more`);

  console.log("\n=== 2. Same (wallet, normalized_name) across multiple class_ids ===");
  const { rows: multiClass } = await postgresQuery<{
    wallet_address: string;
    normalized_name: string;
    class_ids: string[];
    row_count: string;
  }>(
    `
      select
        wallet_address,
        normalized_name,
        array_agg(distinct coalesce(nullif(class_id, ''), '<empty>')) as class_ids,
        count(*)::text as row_count
      from game.character_projections
      group by wallet_address, normalized_name
      having count(*) > 1
      order by wallet_address, normalized_name
    `
  );
  console.log(`  ${multiClass.length} (wallet, name) pairs with >1 row`);
  for (const row of multiClass.slice(0, 20)) {
    console.log(
      `    ${row.wallet_address} "${row.normalized_name}" classes=[${row.class_ids.join(", ")}] rows=${row.row_count}`
    );
  }
  if (multiClass.length > 20) console.log(`    ... +${multiClass.length - 20} more`);

  console.log("\n=== 3. Rows with empty class_id in game.characters ===");
  const { rows: emptyCharacters } = await postgresQuery<{ count: string }>(
    `select count(*)::text as count from game.characters where class_id is null or class_id = ''`
  );
  console.log(`  ${emptyCharacters[0]?.count ?? "0"} rows in game.characters with empty class_id`);

  console.log("\n=== 4. Totals ===");
  const { rows: totals } = await postgresQuery<{ table: string; count: string }>(
    `
      select 'character_projections' as table, count(*)::text as count from game.character_projections
      union all
      select 'characters' as table, count(*)::text as count from game.characters
    `
  );
  for (const row of totals) {
    console.log(`  ${row.table}: ${row.count}`);
  }

  console.log(
    `\nverdict: ${
      emptyProjections.length === 0 && multiClass.length === 0
        ? "clean"
        : "duplicates present — run the repair migration"
    }`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
