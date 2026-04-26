#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const projectRoot = process.cwd();
const srcRoot = join(projectRoot, "src");

// Files explicitly allowed to use direct mint APIs.
// Everything else in src/ must use queueItemMint from chainBatcher.
const allowlist = new Set([
  "src/blockchain/blockchain.ts",
  "src/blockchain/chainBatcher.ts",
  "src/economy/auctionHouse.ts",
  "src/economy/auctionHouseTick.ts",
  "src/economy/trade.ts",
  "src/marketplace/adminRoutes.ts",
  "src/marketplace/directBuyRoutes.ts",
  "src/professions/alchemy.ts",
  "src/professions/crafting.ts",
  "src/items/upgrading.ts",
  "src/services/buildingService.ts",
]);

const violations = [];

function toPosixPath(pathValue) {
  return pathValue.split(sep).join("/");
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (!full.endsWith(".ts")) continue;
    checkFile(full);
  }
}

function checkFile(filePath) {
  const rel = toPosixPath(relative(projectRoot, filePath));
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const isAllowed = allowlist.has(rel);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\benqueueItemMint\s*\(/.test(line) || /\bmintItem\s*\(/.test(line)) {
      if (!isAllowed) {
        violations.push(`${rel}:${i + 1} uses direct mint API (${line.trim()})`);
      }
    }
  }
}

walk(srcRoot);

if (violations.length > 0) {
  console.error("[guard:item-mint-paths] Found disallowed direct item mint usage:");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  console.error(
    "\nUse queueItemMint from src/blockchain/chainBatcher.ts instead, or add a file to allowlist with justification."
  );
  process.exit(1);
}

console.log("[guard:item-mint-paths] OK");
