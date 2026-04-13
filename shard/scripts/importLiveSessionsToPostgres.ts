import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { initPostgres } from "../src/db/postgres.js";
import { ensureGameSchema } from "../src/db/gameSchema.js";
import { upsertLiveSession } from "../src/db/liveSessionStore.js";

type LiveSessionExport = {
  counts?: { liveSessions?: number };
  liveSessions?: Array<{
    walletAddress: string;
    entityId?: string | null;
    zoneId: string;
    sessionState: Record<string, unknown>;
  }>;
};

function normalizeWallet(value: string): string {
  return value.trim().toLowerCase();
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    throw new Error("Usage: tsx scripts/importLiveSessionsToPostgres.ts <live-session-json-path>");
  }

  const resolvedPath = path.resolve(process.cwd(), sourcePath);
  const raw = await readFile(resolvedPath, "utf8");
  const payload = JSON.parse(raw) as LiveSessionExport;

  await initPostgres();
  await ensureGameSchema();

  const sessions = payload.liveSessions ?? [];
  console.log(`[live-import] source ${resolvedPath}`);
  console.log(`[live-import] sessions ${sessions.length}`);

  let imported = 0;
  for (const session of sessions) {
    await upsertLiveSession({
      walletAddress: normalizeWallet(session.walletAddress),
      entityId: session.entityId ?? null,
      zoneId: session.zoneId ?? "village-square",
      sessionState: session.sessionState ?? {},
    });
    imported += 1;
    if (imported % 25 === 0 || imported === sessions.length) {
      console.log(`[live-import] ${imported}/${sessions.length}`);
    }
  }

  console.log("[live-import] done");
}

main().catch((error) => {
  console.error("[live-import] failed", error);
  process.exit(1);
});
