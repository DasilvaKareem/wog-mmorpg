import type { FastifyInstance } from "fastify";
import {
  getChainIntent,
  getChainIntentStats,
  listChainIntents,
  listChainTxAttempts,
  type ChainIntentStatus,
} from "./chainIntentStore.js";

const ADMIN_SECRET = process.env.ADMIN_SECRET?.trim() || null;
const STALE_SUBMITTED_MS = Math.max(
  30_000,
  Number.parseInt(process.env.CHAIN_INTENT_SUBMITTED_RECOVERY_MS ?? "120000", 10) || 120_000
);

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
    const recentAttempts = await listChainTxAttempts({ limit: 50, offset: 0 });

    return {
      stats,
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
