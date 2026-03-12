#!/usr/bin/env tsx
/**
 * Deploy 5 AI agents as a coordinated combat party.
 * Usage: tsx scripts/deployParty.ts [api-url]
 *
 * Each agent gets:
 *  - A fresh custodial wallet
 *  - 5000 copper (0.5 gold) for shopping
 *  - Party membership with XP/gold sharing
 *  - combat-focused strategy
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const API = process.argv[2] || process.env.SHARD_URL || "http://localhost:3000";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
  throw new Error("ADMIN_SECRET environment variable is required");
}
const ZONE = "village-square";
const GOLD_PER_AGENT = 5000; // copper (0.5 GOLD)

const AGENTS = [
  { name: "Thorin",   raceId: "dwarf", classId: "warrior", strategy: "aggressive" },
  { name: "Elara",    raceId: "elf",   classId: "cleric",  strategy: "balanced"   },
  { name: "Zara",     raceId: "human", classId: "mage",    strategy: "balanced"   },
  { name: "Kex",      raceId: "orc",   classId: "rogue",   strategy: "aggressive" },
  { name: "Aria",     raceId: "elf",   classId: "ranger",  strategy: "defensive"  },
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function api(method: string, path: string, body?: object, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

async function authenticate(privateKey: string): Promise<{ token: string; wallet: string }> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const wallet = account.address;

  const challenge = await api("GET", `/auth/challenge?wallet=${wallet}`) as any;
  if (!challenge.message) throw new Error(`Challenge failed for ${wallet}: ${JSON.stringify(challenge)}`);

  const signature = await account.signMessage({ message: challenge.message });

  const result = await api("POST", "/auth/verify", {
    walletAddress: wallet, signature, timestamp: challenge.timestamp,
  }) as any;
  if (!result.success) throw new Error(`Auth failed for ${wallet}: ${JSON.stringify(result)}`);

  return { token: result.token, wallet };
}

async function mintGold(address: string, copper: number): Promise<void> {
  const res = await fetch(`${API}/admin/mint-gold`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-secret": ADMIN_SECRET },
    body: JSON.stringify({ address, copper }),
  });
  const data = await res.json() as any;
  if (!data.ok) throw new Error(`Mint failed: ${JSON.stringify(data)}`);
}

async function main() {
  console.log(`\n🚀 Deploying 5-agent party → ${API}\n`);

  const deployed: Array<{
    name: string; classId: string;
    entityId: string; zoneId: string;
    custodialWallet: string; token: string;
  }> = [];

  // ── Step 1: Deploy all 5 agents ─────────────────────────────────────
  for (const agent of AGENTS) {
    console.log(`📤 Deploying ${agent.name} (${agent.raceId} ${agent.classId})...`);

    const privateKey = generatePrivateKey();
    const { token, wallet } = await authenticate(privateKey);

    const deployData = await api("POST", "/agent/deploy", {
      walletAddress: wallet,
      characterName: agent.name,
      raceId: agent.raceId,
      classId: agent.classId,
    }, token) as any;

    if (!deployData.ok) {
      console.error(`  ❌ Deploy failed: ${JSON.stringify(deployData)}`);
      continue;
    }

    console.log(`  ✅ Spawned → entity: ${deployData.entityId.slice(0, 8)}… zone: ${deployData.zoneId}`);
    console.log(`  💼 Custodial: ${deployData.custodialWallet}`);

    // ── Step 2: Mint gold ──────────────────────────────────────────────
    try {
      await mintGold(deployData.custodialWallet, GOLD_PER_AGENT);
      console.log(`  💰 Minted ${GOLD_PER_AGENT}c (${GOLD_PER_AGENT / 10000} GOLD) → ${deployData.custodialWallet.slice(0, 10)}…`);
    } catch (err: any) {
      console.warn(`  ⚠️  Gold mint failed (non-fatal): ${err.message}`);
    }

    deployed.push({
      name: agent.name,
      classId: agent.classId,
      entityId: deployData.entityId,
      zoneId: deployData.zoneId,
      custodialWallet: deployData.custodialWallet,
      token,
    });

    await sleep(800); // avoid blockchain nonce races
  }

  if (deployed.length < 2) {
    console.error("❌ Not enough agents deployed to form a party");
    process.exit(1);
  }

  // ── Step 3: Create party with leader (first deployed) ───────────────
  console.log(`\n🤝 Forming party — leader: ${deployed[0].name}...`);
  const leader = deployed[0];

  const party = await api("POST", "/party/create", {
    zoneId: leader.zoneId,
    leaderId: leader.entityId,
  }, leader.token) as any;

  if (!party.party) {
    console.error("❌ Party creation failed:", JSON.stringify(party));
    process.exit(1);
  }

  const partyId = party.party.id;
  console.log(`  ✅ Party created: ${partyId}`);

  // ── Step 4: Invite the remaining 4 ──────────────────────────────────
  for (const member of deployed.slice(1)) {
    const invite = await api("POST", "/party/invite", {
      partyId,
      invitedPlayerId: member.entityId,
    }, leader.token) as any;

    if (invite.success) {
      console.log(`  ✅ ${member.name} joined the party`);
    } else {
      console.warn(`  ⚠️  Failed to invite ${member.name}: ${JSON.stringify(invite)}`);
    }
    await sleep(200);
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("\n✨ Party deployed!\n");
  console.log("┌─────────────┬──────────────┬────────────────────┐");
  console.log("│ Name        │ Class        │ Entity ID          │");
  console.log("├─────────────┼──────────────┼────────────────────┤");
  for (const d of deployed) {
    console.log(`│ ${d.name.padEnd(11)} │ ${d.classId.padEnd(12)} │ ${d.entityId.slice(0,18)}… │`);
  }
  console.log("└─────────────┴──────────────┴────────────────────┘");
  console.log(`\n Party ID: ${partyId}`);
  console.log(` Zone:     ${leader.zoneId}`);
  console.log(` Gold:     ${GOLD_PER_AGENT}c each\n`);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
