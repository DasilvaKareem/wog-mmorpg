import * as React from "react";

const API_URL = import.meta.env.VITE_API_URL || "";

interface TxStats {
  total: number;
  goldMints: number;
  goldTransfers: number;
  itemMints: number;
  itemBurns: number;
  characterMints: number;
  sfuelDistributions: number;
  uptime: string;
  txPerMinute: string;
  recentTxs: Array<{ type: string; hash: string; ts: number }>;
}

interface ZoneInfo {
  zoneId: string;
  entities: number;
  players: number;
  mobs: number;
  npcs: number;
  tick: number;
}

interface AgentSnapshot {
  wallet: string;
  zone: string;
  entityId: string | null;
  currentActivity: string;
  script: { type: string; reason: string | null } | null;
  running: boolean;
}

interface PlayerInfo {
  name: string;
  level: number;
  race: string;
  class: string;
  zone: string;
  hp: number;
  maxHp: number;
  kills: number;
}

interface DashboardData {
  server: { uptime: number; startedAt: number; memoryMB: number };
  blockchain: { rpcHealthy: boolean; lastBlockNumber: number | null; chainId: number; txStats: TxStats };
  zones: { count: number; totalEntities: number; players: number; mobs: number; npcs: number; perZone: ZoneInfo[] };
  agents: { active: number; list: AgentSnapshot[] };
  merchants: { initialized: number; total: number };
  economy: { activeListings: number; totalSales: number; totalVolume: number };
  players: { online: PlayerInfo[] };
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function truncHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return hash.slice(0, 8) + "..." + hash.slice(-4);
}

// Stat box used across the page
function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] px-3 py-3 shadow-[4px_4px_0_0_#000]">
      <span className="text-[14px] font-bold" style={{ color, textShadow: "2px 2px 0 #000" }}>{value}</span>
      <span className="mt-1 text-[7px] uppercase tracking-wide text-[#9aa7cc]">{label}</span>
    </div>
  );
}

// Card wrapper
function Card({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[6px_6px_0_0_#000]">
      <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2.5">
        <span className="text-[9px] uppercase tracking-widest text-[#565f89]" style={{ fontFamily: "monospace" }}>{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// Status dot
function StatusDot({ healthy }: { healthy: boolean }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full border-2 border-black"
      style={{ backgroundColor: healthy ? "#54f28b" : "#f25454", boxShadow: `0 0 6px ${healthy ? "#54f28b" : "#f25454"}` }}
    />
  );
}

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "wog-admin-2026";

export function AdminDashboardPage(): React.ReactElement {
  const [authed, setAuthed] = React.useState(false);
  const [pw, setPw] = React.useState("");
  const [pwError, setPwError] = React.useState(false);
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);

  const fetchData = React.useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/admin/dashboard`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || "Failed to fetch");
    }
  }, []);

  React.useEffect(() => {
    if (!authed) return;
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData, authed]);

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] p-8 shadow-[6px_6px_0_0_#000] w-80">
          <p className="mb-1 text-center text-[8px] uppercase tracking-widest text-[#565f89]">{"<<"} Restricted Access {">>"}</p>
          <h2 className="mb-6 text-center text-[16px] uppercase tracking-widest text-[#ffcc00]" style={{ textShadow: "3px 3px 0 #000", fontFamily: "monospace" }}>
            Admin Login
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pw === ADMIN_PASSWORD) {
                setAuthed(true);
                setPwError(false);
              } else {
                setPwError(true);
              }
            }}
          >
            <input
              type="password"
              value={pw}
              onChange={(e) => { setPw(e.target.value); setPwError(false); }}
              placeholder="Enter password"
              className="mb-3 w-full border-2 border-[#2a3450] bg-[#0d1526] px-3 py-2 text-[11px] text-[#9aa7cc] placeholder-[#565f89] outline-none focus:border-[#ffcc00]"
              style={{ fontFamily: "monospace" }}
              autoFocus
            />
            {pwError && <p className="mb-2 text-[9px] text-[#f25454]" style={{ fontFamily: "monospace" }}>Wrong password</p>}
            <button
              type="submit"
              className="w-full border-2 border-[#ffcc00] bg-[#1a2240] py-2 text-[10px] uppercase tracking-widest text-[#ffcc00] hover:bg-[#ffcc00] hover:text-[#0b1020] transition-colors"
              style={{ fontFamily: "monospace" }}
            >
              Enter
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-full w-full flex-col items-center overflow-y-auto overflow-x-hidden pt-16">
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)" }}
      />

      <div className="z-10 w-full max-w-6xl px-4 py-10">
        {/* Header */}
        <div className="mb-8 text-center">
          <p className="mb-2 text-[8px] uppercase tracking-widest text-[#565f89]">{"<<"} Server Control {">>"}</p>
          <h1
            className="mb-3 text-[22px] uppercase tracking-widest text-[#ffcc00]"
            style={{ textShadow: "3px 3px 0 #000", fontFamily: "monospace" }}
          >
            Server Admin
          </h1>
          <div className="flex items-center justify-center gap-2 text-[8px] text-[#565f89]">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: error ? "#f25454" : "#54f28b", boxShadow: `0 0 4px ${error ? "#f25454" : "#54f28b"}` }}
            />
            <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading..."}</span>
            {error && <span className="text-[#f25454]"> | {error}</span>}
          </div>
        </div>

        {!data ? (
          <div className="text-center text-[10px] uppercase tracking-widest text-[#565f89]">Loading dashboard...</div>
        ) : (
          <>
            {/* Row 1: Key Metrics */}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatBox label="Uptime" value={formatUptime(data.server.uptime)} color="#54f28b" />
              <StatBox label="Memory (MB)" value={data.server.memoryMB} color="#5dadec" />
              <StatBox label="SKALE RPC" value={data.blockchain.rpcHealthy ? "HEALTHY" : "DOWN"} color={data.blockchain.rpcHealthy ? "#54f28b" : "#f25454"} />
              <StatBox label="Players Online" value={data.players.online.length} color="#ffcc00" />
              <StatBox label="Active Agents" value={data.agents.active} color="#aa44ff" />
            </div>

            {/* Row 2: Blockchain Health */}
            <div className="mb-6">
              <Card title="Blockchain Health">
                {/* RPC Status */}
                <div className="mb-4 flex flex-wrap items-center gap-4 text-[10px]" style={{ fontFamily: "monospace" }}>
                  <div className="flex items-center gap-2">
                    <StatusDot healthy={data.blockchain.rpcHealthy} />
                    <span className="text-[#9aa7cc]">RPC {data.blockchain.rpcHealthy ? "Connected" : "Unreachable"}</span>
                  </div>
                  <span className="text-[#565f89]">Chain: <span className="text-[#9aa7cc]">{data.blockchain.chainId}</span></span>
                  <span className="text-[#565f89]">Block: <span className="text-[#ffcc00]">{data.blockchain.lastBlockNumber ?? "N/A"}</span></span>
                </div>

                {/* TX Stats Grid */}
                <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {[
                    { label: "Total TXs", value: data.blockchain.txStats.total, color: "#ffcc00" },
                    { label: "Gold Mints", value: data.blockchain.txStats.goldMints, color: "#54f28b" },
                    { label: "Item Mints", value: data.blockchain.txStats.itemMints, color: "#5dadec" },
                    { label: "Char Mints", value: data.blockchain.txStats.characterMints, color: "#aa44ff" },
                    { label: "sFUEL", value: data.blockchain.txStats.sfuelDistributions, color: "#ff8c00" },
                    { label: "TX/min", value: data.blockchain.txStats.txPerMinute, color: "#ffcc00" },
                  ].map((s) => (
                    <div key={s.label} className="flex flex-col items-center rounded border border-[#2a3450] bg-[#0d1526] px-2 py-2">
                      <span className="text-[12px] font-bold" style={{ color: s.color }}>{s.value}</span>
                      <span className="text-[7px] uppercase text-[#565f89]">{s.label}</span>
                    </div>
                  ))}
                </div>

                {/* Recent TXs */}
                {data.blockchain.txStats.recentTxs.length > 0 && (
                  <div>
                    <p className="mb-2 text-[8px] uppercase tracking-wide text-[#565f89]">Recent Transactions</p>
                    <div className="max-h-40 overflow-y-auto">
                      {data.blockchain.txStats.recentTxs.slice(-10).reverse().map((tx, i) => (
                        <div key={i} className="flex items-center gap-3 border-b border-[#1e2842] px-2 py-1.5 text-[9px] last:border-b-0" style={{ fontFamily: "monospace" }}>
                          <span className="rounded bg-[#1a2240] px-1.5 py-0.5 text-[8px] uppercase text-[#ffcc00]">{tx.type}</span>
                          <span className="text-[#5dadec]">{truncHash(tx.hash)}</span>
                          <span className="ml-auto text-[#565f89]">{timeAgo(tx.ts)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* Row 3: Zones + Agents */}
            <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Zone Overview */}
              <Card title="Zone Overview">
                <div className="max-h-80 overflow-y-auto">
                  {/* Header */}
                  <div className="sticky top-0 flex items-center bg-[#1a2240] px-3 py-2 text-[8px] uppercase tracking-widest text-[#565f89]" style={{ fontFamily: "monospace" }}>
                    <span className="flex-[2]">Zone</span>
                    <span className="w-12 text-center">All</span>
                    <span className="w-12 text-center">Ply</span>
                    <span className="w-12 text-center">Mob</span>
                    <span className="w-12 text-center">NPC</span>
                    <span className="w-14 text-center">Tick</span>
                  </div>
                  {data.zones.perZone.map((z) => (
                    <div key={z.zoneId} className="flex items-center border-b border-[#1e2842] px-3 py-2 text-[9px] last:border-b-0 hover:bg-[#1a2240]/50" style={{ fontFamily: "monospace" }}>
                      <span className="flex-[2] truncate text-[#9aa7cc]">{z.zoneId}</span>
                      <span className="w-12 text-center text-[#9aa7cc]">{z.entities}</span>
                      <span className="w-12 text-center text-[#ffcc00]">{z.players}</span>
                      <span className="w-12 text-center text-[#f25454]">{z.mobs}</span>
                      <span className="w-12 text-center text-[#5dadec]">{z.npcs}</span>
                      <span className="w-14 text-center text-[#565f89]">{z.tick}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Active Agents */}
              <Card title={`Active Agents (${data.agents.active})`}>
                <div className="max-h-80 overflow-y-auto">
                  {data.agents.list.length === 0 ? (
                    <p className="py-4 text-center text-[9px] text-[#565f89]">No active agents</p>
                  ) : (
                    <>
                      <div className="sticky top-0 flex items-center bg-[#1a2240] px-3 py-2 text-[8px] uppercase tracking-widest text-[#565f89]" style={{ fontFamily: "monospace" }}>
                        <span className="flex-[2]">Wallet</span>
                        <span className="flex-1">Zone</span>
                        <span className="flex-[2]">Activity</span>
                      </div>
                      {data.agents.list.map((a, i) => (
                        <div key={i} className="flex items-center border-b border-[#1e2842] px-3 py-2 text-[9px] last:border-b-0 hover:bg-[#1a2240]/50" style={{ fontFamily: "monospace" }}>
                          <span className="flex-[2] truncate text-[#aa44ff]">{a.wallet.slice(0, 8)}...</span>
                          <span className="flex-1 truncate text-[#9aa7cc]">{a.zone}</span>
                          <span className="flex-[2] truncate text-[#54f28b]">
                            {a.script ? `[${a.script.type}]` : ""} {a.currentActivity || "idle"}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </Card>
            </div>

            {/* Row 4: Players + Economy */}
            <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Online Players */}
              <Card title={`Online Players (${data.players.online.length})`}>
                <div className="max-h-80 overflow-y-auto">
                  {data.players.online.length === 0 ? (
                    <p className="py-4 text-center text-[9px] text-[#565f89]">No players online</p>
                  ) : (
                    <>
                      <div className="sticky top-0 flex items-center bg-[#1a2240] px-3 py-2 text-[8px] uppercase tracking-widest text-[#565f89]" style={{ fontFamily: "monospace" }}>
                        <span className="flex-[2]">Name</span>
                        <span className="w-8 text-center">Lv</span>
                        <span className="flex-1">Race/Class</span>
                        <span className="flex-1">Zone</span>
                        <span className="w-20">HP</span>
                      </div>
                      {data.players.online.map((p, i) => (
                        <div key={i} className="flex items-center border-b border-[#1e2842] px-3 py-2 text-[9px] last:border-b-0 hover:bg-[#1a2240]/50" style={{ fontFamily: "monospace" }}>
                          <span className="flex-[2] truncate text-[#ffcc00]">{p.name}</span>
                          <span className="w-8 text-center text-[#5dadec]">{p.level}</span>
                          <span className="flex-1 truncate text-[#9aa7cc]">{p.race}/{p.class}</span>
                          <span className="flex-1 truncate text-[#565f89]">{p.zone}</span>
                          <span className="w-20">
                            <div className="relative h-3 w-full overflow-hidden rounded border border-[#2a3450] bg-[#0d1526]">
                              <div
                                className="absolute inset-y-0 left-0"
                                style={{
                                  width: `${p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 0}%`,
                                  backgroundColor: (p.hp / (p.maxHp || 1)) > 0.5 ? "#54f28b" : (p.hp / (p.maxHp || 1)) > 0.25 ? "#ffcc00" : "#f25454",
                                }}
                              />
                              <span className="absolute inset-0 flex items-center justify-center text-[7px] text-white" style={{ textShadow: "1px 1px 0 #000" }}>
                                {p.hp}/{p.maxHp}
                              </span>
                            </div>
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </Card>

              {/* Economy & Merchants */}
              <Card title="Economy & Merchants">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: "Active Listings", value: data.economy.activeListings, color: "#ffcc00" },
                    { label: "Total Sales", value: data.economy.totalSales, color: "#54f28b" },
                    { label: "Total Volume", value: `${data.economy.totalVolume}g`, color: "#5dadec" },
                  ].map((s) => (
                    <div key={s.label} className="flex flex-col items-center rounded border border-[#2a3450] bg-[#0d1526] px-2 py-3">
                      <span className="text-[14px] font-bold" style={{ color: s.color, textShadow: "2px 2px 0 #000" }}>{s.value}</span>
                      <span className="mt-1 text-[7px] uppercase text-[#565f89]">{s.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-3 rounded border border-[#2a3450] bg-[#0d1526] px-4 py-3">
                  <StatusDot healthy={data.merchants.initialized > 0} />
                  <div className="text-[10px]" style={{ fontFamily: "monospace" }}>
                    <span className="text-[#9aa7cc]">Merchants: </span>
                    <span className="text-[#ffcc00]">{data.merchants.initialized}</span>
                    <span className="text-[#565f89]"> initialized</span>
                  </div>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
