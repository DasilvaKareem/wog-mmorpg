import type { FastifyInstance } from "fastify";
import { ethers } from "ethers";
import {
  getChainIntent,
  getChainIntentStats,
  listChainIntents,
  listChainTxAttempts,
  type ChainIntentStatus,
  type ChainTxAttemptRecord,
} from "./chainIntentStore.js";
import { biteProvider } from "./biteChain.js";

const ADMIN_SECRET = process.env.ADMIN_SECRET?.trim() || null;
const STALE_SUBMITTED_MS = Math.max(
  30_000,
  Number.parseInt(process.env.CHAIN_INTENT_SUBMITTED_RECOVERY_MS ?? "120000", 10) || 120_000
);
const GAS_RATE_WINDOW_MS = 60 * 60 * 1000;

function verifyAdmin(
  request: { headers: Record<string, string | string[] | undefined> },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } }
): boolean {
  if (!ADMIN_SECRET) {
    reply.code(503).send({ error: "Admin route disabled: ADMIN_SECRET is not configured" });
    return false;
  }
  const secret = request.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function parseStatuses(raw?: string): ChainIntentStatus[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as ChainIntentStatus[];
  return values.length > 0 ? values : undefined;
}

type AttemptGasDetails = {
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  feeWei: string | null;
  valueWei: string | null;
  fromAddress: string | null;
  feeSource: "receipt" | "estimate" | "none";
};

type GasSummary = {
  attemptsAnalyzed: number;
  confirmedAttempts: number;
  attemptsWithReceipt: number;
  totalGasUsed: string;
  totalFeeWei: string;
  totalFeeEther: string;
  gasPerHour: string;
  feeWeiPerHour: string;
  feeEtherPerHour: string;
  serverOutgoingValueWei: string;
  serverOutgoingValueEther: string;
  serverOutgoingTxCount: number;
  serverTotalOutflowWei: string;
  serverTotalOutflowEther: string;
  windowMs: number;
};

type ServerWalletSummary = {
  address: string | null;
  balanceWei: string;
  balanceEther: string;
  nonce: number | null;
};

type CachedSummary = {
  expiresAt: number;
  value: GasSummary;
};

const SUMMARY_CACHE_MS = 30_000;
let lifetimeGasSummaryCache: CachedSummary | null = null;

function formatEtherFromWei(value: bigint): string {
  const whole = value / 10n ** 18n;
  const fraction = value % 10n ** 18n;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

function safeBigInt(value?: string | null): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

async function enrichAttemptGas(attempt: ChainTxAttemptRecord): Promise<ChainTxAttemptRecord & { gas: AttemptGasDetails }> {
  if (attempt.txHash) {
    try {
      const [receipt, tx] = await Promise.all([
        biteProvider.getTransactionReceipt(attempt.txHash),
        biteProvider.getTransaction(attempt.txHash),
      ]);
      if (receipt) {
        const gasUsed = receipt.gasUsed ?? null;
        const effectiveGasPrice = receipt.gasPrice ?? null;
        const feeWei =
          gasUsed != null && effectiveGasPrice != null
            ? (gasUsed * effectiveGasPrice)
            : null;
        return {
          ...attempt,
          gas: {
            gasUsed: gasUsed?.toString() ?? null,
            effectiveGasPrice: effectiveGasPrice?.toString() ?? null,
            feeWei: feeWei?.toString() ?? null,
            valueWei: tx?.value?.toString() ?? null,
            fromAddress: tx?.from ?? null,
            feeSource: "receipt",
          },
        };
      }
    } catch {
      // Fall through to estimated fee metadata if receipt lookup fails.
    }
  }

  const gasLimit = safeBigInt(attempt.gasLimit);
  const feePerGas = safeBigInt(attempt.gasPrice) ?? safeBigInt(attempt.maxFeePerGas);
  const estimatedFeeWei =
    gasLimit != null && feePerGas != null
      ? gasLimit * feePerGas
      : null;

  return {
    ...attempt,
    gas: {
      gasUsed: null,
      effectiveGasPrice: feePerGas?.toString() ?? null,
      feeWei: estimatedFeeWei?.toString() ?? null,
      valueWei: null,
      fromAddress: attempt.signerAddress ?? null,
      feeSource: estimatedFeeWei != null ? "estimate" : "none",
    },
  };
}

function summarizeGasUsage(
  attempts: Array<ChainTxAttemptRecord & { gas: AttemptGasDetails }>,
  serverWalletAddress?: string | null
): GasSummary {
  const now = Date.now();
  const normalizedServerWallet = serverWalletAddress?.toLowerCase() ?? null;
  let confirmedAttempts = 0;
  let attemptsWithReceipt = 0;
  let totalGasUsed = 0n;
  let totalFeeWei = 0n;
  let windowGasUsed = 0n;
  let windowFeeWei = 0n;
  let serverOutgoingValueWei = 0n;
  let serverOutgoingTxCount = 0;

  for (const attempt of attempts) {
    if (attempt.status !== "confirmed") continue;
    confirmedAttempts++;
    const gasUsed = safeBigInt(attempt.gas.gasUsed);
    const feeWei = safeBigInt(attempt.gas.feeWei);
    const valueWei = safeBigInt(attempt.gas.valueWei);
    const fromAddress = attempt.gas.fromAddress?.toLowerCase() ?? attempt.signerAddress?.toLowerCase() ?? null;
    if (gasUsed != null) {
      attemptsWithReceipt++;
      totalGasUsed += gasUsed;
      if ((attempt.confirmedAt ?? attempt.createdAt) >= now - GAS_RATE_WINDOW_MS) {
        windowGasUsed += gasUsed;
      }
    }
    if (feeWei != null) {
      totalFeeWei += feeWei;
      if ((attempt.confirmedAt ?? attempt.createdAt) >= now - GAS_RATE_WINDOW_MS) {
        windowFeeWei += feeWei;
      }
    }
    if (
      normalizedServerWallet &&
      fromAddress === normalizedServerWallet &&
      valueWei != null &&
      valueWei > 0n
    ) {
      serverOutgoingValueWei += valueWei;
      serverOutgoingTxCount++;
    }
  }

  return {
    attemptsAnalyzed: attempts.length,
    confirmedAttempts,
    attemptsWithReceipt,
    totalGasUsed: totalGasUsed.toString(),
    totalFeeWei: totalFeeWei.toString(),
    totalFeeEther: formatEtherFromWei(totalFeeWei),
    gasPerHour: windowGasUsed.toString(),
    feeWeiPerHour: windowFeeWei.toString(),
    feeEtherPerHour: formatEtherFromWei(windowFeeWei),
    serverOutgoingValueWei: serverOutgoingValueWei.toString(),
    serverOutgoingValueEther: formatEtherFromWei(serverOutgoingValueWei),
    serverOutgoingTxCount,
    serverTotalOutflowWei: (totalFeeWei + serverOutgoingValueWei).toString(),
    serverTotalOutflowEther: formatEtherFromWei(totalFeeWei + serverOutgoingValueWei),
    windowMs: GAS_RATE_WINDOW_MS,
  };
}

async function getServerWalletSummary(): Promise<ServerWalletSummary> {
  const privateKey = process.env.SERVER_PRIVATE_KEY?.trim();
  if (!privateKey) {
    return {
      address: null,
      balanceWei: "0",
      balanceEther: "0",
      nonce: null,
    };
  }

  try {
    const wallet = new ethers.Wallet(privateKey, biteProvider);
    const [balance, nonce] = await Promise.all([
      biteProvider.getBalance(wallet.address),
      biteProvider.getTransactionCount(wallet.address),
    ]);
    return {
      address: wallet.address,
      balanceWei: balance.toString(),
      balanceEther: formatEtherFromWei(balance),
      nonce,
    };
  } catch {
    return {
      address: null,
      balanceWei: "0",
      balanceEther: "0",
      nonce: null,
    };
  }
}

async function listAllChainTxAttempts(limit = 500): Promise<ChainTxAttemptRecord[]> {
  const all: ChainTxAttemptRecord[] = [];
  for (let offset = 0; ; offset += limit) {
    const page = await listChainTxAttempts({ limit, offset });
    all.push(...page);
    if (page.length < limit) break;
  }
  return all;
}

async function getLifetimeGasSummary(serverWalletAddress?: string | null): Promise<GasSummary> {
  const now = Date.now();
  if (lifetimeGasSummaryCache && lifetimeGasSummaryCache.expiresAt > now) {
    return lifetimeGasSummaryCache.value;
  }
  const attempts = await listAllChainTxAttempts();
  const summary = summarizeGasUsage(await Promise.all(attempts.map((attempt) => enrichAttemptGas(attempt))), serverWalletAddress);
  lifetimeGasSummaryCache = {
    expiresAt: now + SUMMARY_CACHE_MS,
    value: summary,
  };
  return summary;
}

export function registerChainAdminRoutes(server: FastifyInstance): void {
  server.get("/admin/chain/dashboard", async (_request, reply) => {
    reply.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WoG Chain Dashboard</title>
<style>
  *{box-sizing:border-box} body{margin:0;font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0b1220;color:#dbe4f0}
  .wrap{max-width:1400px;margin:0 auto;padding:20px}
  h1{margin:0 0 6px;font-size:22px;color:#fff} .sub{color:#8fa3bf;margin-bottom:18px}
  .controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:18px}
  input,button{background:#111a2b;color:#dbe4f0;border:1px solid #2b3a55;border-radius:8px;padding:10px 12px;font:inherit}
  input{min-width:320px} button{cursor:pointer} button:hover{border-color:#4f6ea1}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px}
  .card{background:#111a2b;border:1px solid #22304a;border-radius:12px;padding:14px}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8fa3bf;margin-bottom:6px}
  .value{font-size:28px;font-weight:700;color:#fff}
  .section{margin-top:20px}
  .section h2{font-size:15px;margin:0 0 10px;color:#fff}
  table{width:100%;border-collapse:collapse;background:#111a2b;border:1px solid #22304a;border-radius:12px;overflow:hidden}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #1b2740;vertical-align:top}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8fa3bf;background:#0e1727}
  td{font-size:12px;word-break:break-word}
  tr:last-child td{border-bottom:none}
  .pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#1b2740;color:#c8d5e6;font-size:11px}
  .error{color:#ff8b8b}.ok{color:#7ee787}.warn{color:#ffd479}
  .muted{color:#8fa3bf}.empty{padding:16px;color:#8fa3bf}
  .small{font-size:11px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Chain Dashboard</h1>
  <div class="sub">Live shard queue status, failures, retries, and recent transaction attempts.</div>
  <div class="controls">
    <input id="secret" type="password" placeholder="Admin secret" />
    <button id="refresh">Refresh</button>
    <label class="small muted"><input id="auto" type="checkbox" checked /> auto refresh 10s</label>
    <span id="updated" class="small muted"></span>
  </div>
  <div id="cards" class="grid"></div>
  <div class="section">
    <h2>By Type</h2>
    <div id="by-type"></div>
  </div>
  <div class="section">
    <h2>Gas Overview</h2>
    <div id="gas-summary"></div>
  </div>
  <div class="section">
    <h2>Server Wallet</h2>
    <div id="server-wallet"></div>
  </div>
  <div class="section">
    <h2>Failed Permanent</h2>
    <div id="failed"></div>
  </div>
  <div class="section">
    <h2>Stale Submitted</h2>
    <div id="stale"></div>
  </div>
  <div class="section">
    <h2>Waiting Funds</h2>
    <div id="funds"></div>
  </div>
  <div class="section">
    <h2>Recent Attempts</h2>
    <div id="attempts"></div>
  </div>
</div>
<script>
const $ = (id) => document.getElementById(id);
let timer = null;

function esc(v) {
  if (v == null) return "";
  const text = typeof v === 'string'
    ? v
    : typeof v === 'object'
      ? JSON.stringify(v, null, 2)
      : String(v);
  return text.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function renderTable(targetId, rows, columns) {
  const el = $(targetId);
  if (!rows || rows.length === 0) {
    el.innerHTML = '<div class="empty">No rows</div>';
    return;
  }
  const head = columns.map((c) => '<th>' + esc(c.label) + '</th>').join('');
  const body = rows.map((row) => '<tr>' + columns.map((c) => '<td>' + (c.render ? c.render(row) : esc(row[c.key])) + '</td>').join('') + '</tr>').join('');
  el.innerHTML = '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

function renderCards(data) {
  const cards = [
    ['Confirmed', Object.values(data.stats || {}).reduce((n, entry) => n + (entry.confirmed || 0), 0), 'ok'],
    ['Pending', Object.values(data.stats || {}).reduce((n, entry) => n + (entry.pending || 0), 0), ''],
    ['Processing', Object.values(data.stats || {}).reduce((n, entry) => n + (entry.processing || 0), 0), 'warn'],
    ['Retryable', Object.values(data.stats || {}).reduce((n, entry) => n + (entry.retryable || 0), 0), 'warn'],
    ['Submitted', data.counts?.submitted || 0, ''],
    ['Stale Submitted', data.counts?.staleSubmitted || 0, 'error'],
    ['Failed Permanent', data.counts?.failedPermanent || 0, 'error'],
    ['Waiting Funds', data.counts?.waitingFunds || 0, 'warn'],
  ];
  $('cards').innerHTML = cards.map(([label, value, cls]) =>
    '<div class="card"><div class="label">' + esc(label) + '</div><div class="value ' + cls + '">' + esc(value) + '</div></div>'
  ).join('');
}

function renderByType(stats) {
  const rows = Object.entries(stats || {}).map(([type, counts]) => ({ type, ...counts }));
  renderTable('by-type', rows, [
    { label: 'Type', key: 'type' },
    { label: 'Pending', key: 'pending' },
    { label: 'Processing', key: 'processing' },
    { label: 'Retryable', key: 'retryable' },
    { label: 'Confirmed', key: 'confirmed' },
  ]);
}

function renderGasSummary(gas) {
  if (!gas?.recent || !gas?.lifetime) {
    $('gas-summary').innerHTML = '<div class="empty">No gas data</div>';
    return;
  }
  const rows = [
    { scope: 'Recent Dashboard Sample', ...gas.recent },
    { scope: 'Lifetime Recorded DB History', ...gas.lifetime },
  ];
  renderTable('gas-summary', rows, [
    { label: 'Scope', key: 'scope' },
    { label: 'Attempts Analyzed', key: 'attemptsAnalyzed' },
    { label: 'Confirmed Attempts', key: 'confirmedAttempts' },
    { label: 'Receipt-backed', key: 'attemptsWithReceipt' },
    { label: 'Total Gas Used', key: 'totalGasUsed' },
    { label: 'Gas Fee', render: (r) => esc(r.totalFeeEther) + ' sFUEL' },
    { label: 'Value Sent', render: (r) => esc(r.serverOutgoingValueEther) + ' sFUEL' },
    { label: 'Value Txs', key: 'serverOutgoingTxCount' },
    { label: 'Total Outflow', render: (r) => esc(r.serverTotalOutflowEther) + ' sFUEL' },
    { label: 'Fee / Hour', render: (r) => esc(r.feeEtherPerHour) + ' sFUEL' },
    { label: 'Window', render: (r) => Math.round((Number(r.windowMs || 0) / 60000)) + ' min' },
  ]);
  $('gas-summary').insertAdjacentHTML(
    'beforeend',
    '<div class="small muted" style="margin-top:8px">Recent sample uses the latest 100 attempts. Lifetime uses all recorded Postgres attempts and includes server-wallet value transfers tracked by tx hash.</div>'
  );
}

function renderServerWallet(wallet) {
  if (!wallet || !wallet.address) {
    $('server-wallet').innerHTML = '<div class="empty">Server wallet unavailable</div>';
    return;
  }
  renderTable('server-wallet', [wallet], [
    { label: 'Address', key: 'address' },
    { label: 'Balance', render: (r) => esc(r.balanceEther) + ' sFUEL' },
    { label: 'Balance (Wei)', key: 'balanceWei' },
    { label: 'On-chain Nonce', key: 'nonce' },
  ]);
}

async function fetchStatus() {
  const secret = $('secret').value.trim();
  if (!secret) {
    $('updated').textContent = 'Enter admin secret';
    return;
  }
  const res = await fetch('/admin/chain/status', { headers: { 'x-admin-secret': secret } });
  if (!res.ok) {
    throw new Error('HTTP ' + res.status);
  }
  const data = await res.json();
  renderCards(data);
  renderByType(data.stats);
  renderGasSummary(data.gas);
  renderServerWallet(data.serverWallet);
  renderTable('failed', data.failedPermanent, [
    { label: 'Type', key: 'type' },
    { label: 'Aggregate', key: 'aggregateKey' },
    { label: 'Attempts', key: 'attemptCount' },
    { label: 'Error', render: (r) => '<span class="error">' + esc(r.lastError) + '</span>' },
    { label: 'Updated', key: 'updatedAt' },
  ]);
  renderTable('stale', data.staleSubmitted, [
    { label: 'Type', key: 'type' },
    { label: 'Aggregate', key: 'aggregateKey' },
    { label: 'TX', render: (r) => r.txHash ? '<span class="pill">' + esc(r.txHash) + '</span>' : '<span class="error">missing</span>' },
    { label: 'Last Submitted', key: 'lastSubmittedAt' },
    { label: 'Updated', key: 'updatedAt' },
  ]);
  renderTable('funds', data.waitingFunds, [
    { label: 'Type', key: 'type' },
    { label: 'Aggregate', key: 'aggregateKey' },
    { label: 'Attempts', key: 'attemptCount' },
    { label: 'Error', render: (r) => '<span class="warn">' + esc(r.lastError) + '</span>' },
    { label: 'Updated', key: 'updatedAt' },
  ]);
  renderTable('attempts', data.recentAttempts, [
    { label: 'Intent', key: 'intentId' },
    { label: 'Queue', key: 'queueLabel' },
    { label: 'Status', key: 'status' },
    { label: 'TX', render: (r) => r.txHash ? '<span class="pill">' + esc(r.txHash) + '</span>' : '<span class="muted">-</span>' },
    { label: 'Gas Used', render: (r) => r.gas?.gasUsed ? esc(r.gas.gasUsed) : '<span class="muted">-</span>' },
    { label: 'Fee', render: (r) => r.gas?.feeWei ? '<span class="pill">' + esc(r.gas.feeWei) + '</span>' : '<span class="muted">-</span>' },
    { label: 'Fee Src', render: (r) => r.gas?.feeSource ? esc(r.gas.feeSource) : '<span class="muted">-</span>' },
    { label: 'Error', render: (r) => r.errorMessage ? '<span class="error">' + esc(r.errorMessage) + '</span>' : '<span class="muted">-</span>' },
    { label: 'Created', key: 'createdAt' },
  ]);
  $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

async function refresh() {
  try {
    await fetchStatus();
  } catch (err) {
    $('updated').textContent = 'Failed: ' + (err?.message || err);
  }
}

function syncAuto() {
  if (timer) clearInterval(timer);
  if ($('auto').checked) timer = setInterval(refresh, 10000);
}

$('refresh').addEventListener('click', refresh);
$('auto').addEventListener('change', syncAuto);
$('secret').addEventListener('keydown', (e) => { if (e.key === 'Enter') refresh(); });
syncAuto();
</script>
</body>
</html>`);
  });

  server.get<{
    Querystring: {
      type?: string;
      wallet?: string;
      statuses?: string;
      limit?: string;
      offset?: string;
    };
  }>("/admin/chain/intents", async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    const intents = await listChainIntents({
      type: request.query.type,
      walletAddress: request.query.wallet,
      statuses: parseStatuses(request.query.statuses),
      limit: request.query.limit ? Number.parseInt(request.query.limit, 10) : 100,
      offset: request.query.offset ? Number.parseInt(request.query.offset, 10) : 0,
    });
    return { total: intents.length, intents };
  });

  server.get<{ Params: { intentId: string } }>("/admin/chain/intents/:intentId", async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    const intent = await getChainIntent(request.params.intentId);
    if (!intent) {
      return reply.code(404).send({ error: "Intent not found" });
    }
    const attempts = await listChainTxAttempts({ intentId: intent.intentId, limit: 50, offset: 0 });
    return { intent, attempts };
  });

  server.get<{
    Querystring: { intentId?: string; limit?: string; offset?: string };
  }>("/admin/chain/attempts", async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    const attempts = await listChainTxAttempts({
      intentId: request.query.intentId,
      limit: request.query.limit ? Number.parseInt(request.query.limit, 10) : 100,
      offset: request.query.offset ? Number.parseInt(request.query.offset, 10) : 0,
    });
    return { total: attempts.length, attempts };
  });

  server.get("/admin/chain/status", async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    const stats = await getChainIntentStats();
    const waitingFunds = await listChainIntents({ statuses: ["waiting_funds"], limit: 200, offset: 0 });
    const permanentFailures = await listChainIntents({ statuses: ["failed_permanent"], limit: 200, offset: 0 });
    const submitted = await listChainIntents({ statuses: ["submitted"], limit: 500, offset: 0 });
    const staleSubmitted = submitted.filter((intent) => {
      const submittedAt = intent.lastSubmittedAt ?? intent.updatedAt;
      return submittedAt <= (Date.now() - STALE_SUBMITTED_MS);
    });
    const recentAttemptsRaw = await listChainTxAttempts({ limit: 100, offset: 0 });
    const recentAttempts = await Promise.all(recentAttemptsRaw.slice(0, 50).map((attempt) => enrichAttemptGas(attempt)));
    const serverWallet = await getServerWalletSummary();
    const gas = {
      recent: summarizeGasUsage(await Promise.all(recentAttemptsRaw.map((attempt) => enrichAttemptGas(attempt))), serverWallet.address),
      lifetime: await getLifetimeGasSummary(serverWallet.address),
    };

    return {
      stats,
      gas,
      serverWallet,
      counts: {
        waitingFunds: waitingFunds.length,
        failedPermanent: permanentFailures.length,
        submitted: submitted.length,
        staleSubmitted: staleSubmitted.length,
      },
      waitingFunds,
      failedPermanent: permanentFailures,
      staleSubmitted,
      recentAttempts,
    };
  });
}
