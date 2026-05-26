import "dotenv/config";
import { getPostgres, initPostgres, isPostgresConfigured, postgresQuery } from "../src/db/postgres.js";

type Args = {
  wallet?: string;
  limit: number;
  json: boolean;
};

type Row = Record<string, unknown>;

const GOLD_OPERATION_TYPES = [
  "gold-mint",
  "gold-transfer",
  "item-burn",
  "item-mint",
  "wallet-registration",
  "sfuel-distribute",
];

function usage(exitCode = 1): never {
  console.log(
    [
      "Usage:",
      "  pnpm run debug:gold -- [--wallet 0x...] [--limit 20] [--json]",
      "",
      "Reports read-only gold economy state from Postgres:",
      "  - wallet gold totals, reservations, and spend totals",
      "  - gold/item chain operation status and recent failures",
      "  - batched mob-loot gold transfer intents",
      "  - merchant wallet liquidity",
      "  - optional per-wallet drilldown",
    ].join("\n")
  );
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 20, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next) usage();
    if (arg === "--wallet") {
      args.wallet = next.toLowerCase();
      i++;
      continue;
    }
    if (arg === "--limit") {
      args.limit = Math.max(1, Math.min(Number.parseInt(next, 10) || 20, 100));
      i++;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    usage();
  }
  if (args.wallet && !/^0x[a-f0-9]{40}$/.test(args.wallet)) {
    throw new Error(`Invalid wallet address: ${args.wallet}`);
  }
  return args;
}

function fmt(value: unknown): string {
  if (value == null) return "-";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/\.?0+$/, "");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function printSection(title: string, rows: Row[], columns?: string[]): void {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  none");
    return;
  }
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const widths = cols.map((col) =>
    Math.min(
      48,
      Math.max(col.length, ...rows.map((row) => fmt(row[col]).length))
    )
  );
  console.log(cols.map((col, i) => col.padEnd(widths[i])).join("  "));
  console.log(cols.map((_, i) => "-".repeat(widths[i])).join("  "));
  for (const row of rows) {
    console.log(
      cols
        .map((col, i) => {
          const text = fmt(row[col]);
          return (text.length > widths[i] ? `${text.slice(0, widths[i] - 1)}...` : text).padEnd(widths[i]);
        })
        .join("  ")
    );
  }
}

function summarizePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "-";
  const p = payload as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["toAddress", "fromAddress", "amount", "tokenId", "quantity", "address", "walletAddress", "goldAmount"]) {
    if (p[key] != null) parts.push(`${key}=${String(p[key])}`);
  }
  return parts.length ? parts.join(" ") : JSON.stringify(payload);
}

async function query<T extends Row>(text: string, values: unknown[] = []): Promise<T[]> {
  const { rows } = await postgresQuery<T>(text, values);
  return rows;
}

async function collect(args: Args): Promise<Record<string, unknown>> {
  const walletFilter = args.wallet ? `%${args.wallet}%` : null;

  const [
    overview,
    operationStatus,
    recentOperationsRaw,
    failedOperationsRaw,
    goldIntentStatus,
    recentGoldIntentsRaw,
    recentGoldAttemptsRaw,
    merchantLiquidity,
    topWallets,
    walletRows,
    walletItems,
  ] = await Promise.all([
    query(`
      select
        (select coalesce(sum(balance), 0)::double precision from game.wallet_gold_balances) as total_wallet_gold,
        (select count(*)::int from game.wallet_gold_balances where balance > 0) as wallets_with_gold,
        (select coalesce(sum(reserved_amount), 0)::double precision from game.gold_reservations) as total_reserved_gold,
        (select coalesce(sum(spent_amount), 0)::double precision from game.gold_spend_totals) as total_spent_gold,
        (select count(*)::int from game.chain_operations where type in ('gold-mint','gold-transfer') and status in ('queued','processing','submitted','failed_retryable','waiting_funds')) as open_gold_operations,
        (select count(*)::int from game.chain_write_intents where type = 'batch-gold-transfer' and status in ('pending','processing','submitted','retryable','waiting_funds')) as open_batch_gold_intents,
        (select count(*)::int from game.merchant_states) as merchant_count
    `),
    query(`
      select type, status, count(*)::int as count, min(created_at) as oldest, max(updated_at) as newest
      from game.chain_operations
      where type = any($1::text[])
      group by type, status
      order by type, status
    `, [GOLD_OPERATION_TYPES]),
    query(`
      select operation_id, type, status, attempt_count, subject, payload_json, tx_hash,
             left(coalesce(last_error, ''), 220) as last_error,
             created_at, updated_at
      from game.chain_operations
      where type = any($1::text[])
        and ($2::text is null or lower(subject) like $2 or lower(payload_json::text) like $2)
      order by updated_at desc
      limit $3
    `, [GOLD_OPERATION_TYPES, walletFilter, args.limit]),
    query(`
      select operation_id, type, status, attempt_count, subject,
             left(coalesce(last_error, ''), 220) as last_error,
             tx_hash, updated_at
      from game.chain_operations
      where type = any($1::text[])
        and status in ('failed_retryable','waiting_funds','failed_permanent')
        and ($2::text is null or lower(subject) like $2 or lower(payload_json::text) like $2)
      order by updated_at desc
      limit $3
    `, [GOLD_OPERATION_TYPES, walletFilter, args.limit]),
    query(`
      select status, count(*)::int as count,
             coalesce(sum(case
               when payload_json ? 'goldAmount' then (payload_json->>'goldAmount')::double precision
               else 0
             end), 0)::double precision as queued_gold,
             min(created_at) as oldest,
             max(updated_at) as newest
      from game.chain_write_intents
      where type = 'batch-gold-transfer'
      group by status
      order by status
    `),
    query(`
      select intent_id, status, wallet_address, aggregate_key, payload_json, attempt_count,
             tx_hash, left(coalesce(last_error, ''), 220) as last_error,
             created_at, updated_at
      from game.chain_write_intents
      where type = 'batch-gold-transfer'
        and ($1::text is null or lower(coalesce(wallet_address, '')) like $1 or lower(aggregate_key) like $1 or lower(payload_json::text) like $1)
      order by updated_at desc
      limit $2
    `, [walletFilter, args.limit]),
    query(`
      select a.attempt_id, i.status as intent_status, a.status as attempt_status,
             i.wallet_address, a.signer_address, a.tx_hash,
             left(coalesce(a.error_message, ''), 220) as error_message,
             a.receipt_gas_used, a.receipt_fee_wei, a.created_at, a.confirmed_at
      from game.chain_tx_attempts a
      join game.chain_write_intents i on i.intent_id = a.intent_id
      where i.type = 'batch-gold-transfer'
        and ($1::text is null or lower(coalesce(i.wallet_address, '')) like $1 or lower(i.aggregate_key) like $1 or lower(i.payload_json::text) like $1)
      order by a.created_at desc
      limit $2
    `, [walletFilter, args.limit]),
    query(`
      select merchant_id, zone_id, npc_name, wallet_address,
             case
               when jsonb_typeof(payload_json->'goldBalance') in ('number','string')
               then (payload_json->>'goldBalance')::double precision
               else 0
             end as gold_balance,
             updated_at
      from game.merchant_states
      order by gold_balance asc, updated_at asc
      limit $1
    `, [args.limit]),
    query(`
      select wallet_address, balance, updated_at
      from game.wallet_gold_balances
      where balance > 0
      order by balance desc
      limit $1
    `, [args.limit]),
    args.wallet
      ? query(`
          select
            coalesce(g.wallet_address, $1) as wallet_address,
            coalesce(g.balance, 0)::double precision as gold_balance,
            coalesce(r.reserved_amount, 0)::double precision as reserved_gold,
            coalesce(s.spent_amount, 0)::double precision as spent_gold,
            g.updated_at as gold_updated_at
          from (select $1::text as wallet_address) w
          left join game.wallet_gold_balances g on g.wallet_address = w.wallet_address
          left join game.gold_reservations r on r.wallet_address = w.wallet_address
          left join game.gold_spend_totals s on s.wallet_address = w.wallet_address
        `, [args.wallet])
      : Promise.resolve([]),
    args.wallet
      ? query(`
          select token_id, quantity, updated_at
          from game.wallet_item_balances
          where wallet_address = $1 and quantity > 0
          order by quantity desc, token_id asc
          limit $2
        `, [args.wallet, args.limit])
      : Promise.resolve([]),
  ]);

  const recentOperations = recentOperationsRaw.map((row) => ({
    ...row,
    payload: summarizePayload(row.payload_json),
  }));
  const recentGoldIntents = recentGoldIntentsRaw.map((row) => ({
    ...row,
    payload: summarizePayload(row.payload_json),
  }));

  return {
    generatedAt: new Date().toISOString(),
    walletFilter: args.wallet ?? null,
    overview: overview[0] ?? {},
    operationStatus,
    failedOperations: failedOperationsRaw,
    recentOperations,
    goldIntentStatus,
    recentGoldIntents,
    recentGoldAttempts: recentGoldAttemptsRaw,
    merchantLiquidity,
    topWallets,
    walletDebug: walletRows[0] ?? null,
    walletItems,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await initPostgres();
  if (!isPostgresConfigured()) {
    throw new Error("DATABASE_URL/POSTGRES_URL/POSTGRES_DSN is not configured");
  }
  if (!getPostgres()) {
    throw new Error("Postgres is configured but unavailable");
  }

  const report = await collect(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Gold economy debug generatedAt=${report.generatedAt}`);
  if (args.wallet) console.log(`Wallet filter: ${args.wallet}`);
  printSection("Overview", [report.overview as Row]);
  if (report.walletDebug) printSection("Wallet", [report.walletDebug as Row]);
  if ((report.walletItems as Row[]).length) printSection("Wallet Items", report.walletItems as Row[]);
  printSection("Chain Operation Status", report.operationStatus as Row[]);
  printSection("Problem Chain Operations", report.failedOperations as Row[]);
  printSection("Recent Chain Operations", report.recentOperations as Row[], [
    "operation_id",
    "type",
    "status",
    "attempt_count",
    "subject",
    "payload",
    "tx_hash",
    "last_error",
    "updated_at",
  ]);
  printSection("Batch Gold Intent Status", report.goldIntentStatus as Row[]);
  printSection("Recent Batch Gold Intents", report.recentGoldIntents as Row[], [
    "intent_id",
    "status",
    "wallet_address",
    "payload",
    "attempt_count",
    "tx_hash",
    "last_error",
    "updated_at",
  ]);
  printSection("Recent Batch Gold Attempts", report.recentGoldAttempts as Row[]);
  printSection("Lowest Merchant Gold", report.merchantLiquidity as Row[]);
  printSection("Top Wallet Gold Balances", report.topWallets as Row[]);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPostgres()?.end().catch(() => undefined);
  });
