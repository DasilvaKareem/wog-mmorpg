import * as React from "react";
import { Link } from "react-router-dom";
import { API_URL } from "../config.js";

interface GuildEntry {
  guildId: number;
  name: string;
  founder: string;
  treasury: number;
  level: number;
  reputation: number;
  memberCount: number;
}

interface PlayerEntry {
  name: string;
  walletAddress: string;
  level: number;
  race: string;
  class: string;
  zoneId: string;
  kills: number;
  gold: number;
}

export function LeaderboardPage(): React.ReactElement {
  const [guilds, setGuilds] = React.useState<GuildEntry[]>([]);
  const [players, setPlayers] = React.useState<PlayerEntry[]>([]);
  const [activeTab, setActiveTab] = React.useState<"guilds" | "players">("guilds");
  const [lastUpdate, setLastUpdate] = React.useState<Date>(new Date());

  React.useEffect(() => {
    const fetchGuilds = async () => {
      try {
        const res = await fetch(`${API_URL}/guilds`);
        if (res.ok) {
          const data: GuildEntry[] = await res.json();
          data.sort((a, b) => b.treasury - a.treasury);
          setGuilds(data);
        }
      } catch {
        // non-critical
      }
    };

    const fetchPlayers = async () => {
      try {
        const res = await fetch(`${API_URL}/stats`);
        if (res.ok) {
          const data = await res.json();
          const playerList: PlayerEntry[] = data.players ?? [];
          playerList.sort((a, b) => b.level - a.level);
          setPlayers(playerList);
        }
      } catch {
        // non-critical
      }
    };

    const fetchAll = () => {
      fetchGuilds();
      fetchPlayers();
      setLastUpdate(new Date());
    };

    fetchAll();
    const interval = window.setInterval(fetchAll, 30000);
    return () => window.clearInterval(interval);
  }, []);

  // Summary stats
  const totalGuildMembers = guilds.reduce((sum, g) => sum + g.memberCount, 0);
  const totalTreasury = guilds.reduce((sum, g) => sum + g.treasury, 0);
  const highestLevel = players.length > 0 ? players[0]?.level ?? 0 : 0;

  return (
    <div className="relative flex min-h-full w-full flex-col items-center overflow-y-auto overflow-x-hidden pt-16">
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)",
        }}
      />

      <div className="z-10 w-full max-w-4xl px-4 py-10">
        {/* Header */}
        <div className="mb-8 text-center">
          <p className="mb-2 text-[8px] uppercase tracking-widest text-[#565f89]">
            {"<<"} Rankings {">>"}
          </p>
          <h1
            className="mb-3 text-[22px] uppercase tracking-widest text-[#ffcc00]"
            style={{ textShadow: "3px 3px 0 #000" }}
          >
            Leaderboards
          </h1>
          <p className="text-[8px] text-[#3a4260]">
            Last updated: {lastUpdate.toLocaleTimeString()} -- Auto-refreshes every 30s
          </p>
        </div>

        {/* ── STATS SUMMARY ── */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { value: guilds.length.toString(), label: "Guilds", color: "#ffcc00" },
            { value: players.length.toString(), label: "Players", color: "#54f28b" },
            { value: totalGuildMembers.toString(), label: "Guild Members", color: "#5dadec" },
            { value: totalTreasury.toLocaleString(), label: "Total Treasury", color: "#ff8c00" },
            { value: highestLevel > 0 ? `Lv ${highestLevel}` : "--", label: "Highest Level", color: "#aa44ff" },
          ].map((s) => (
            <div
              key={s.label}
              className="flex flex-col items-center border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] px-3 py-3 shadow-[4px_4px_0_0_#000]"
            >
              <span
                className="text-[14px] font-bold"
                style={{ color: s.color, textShadow: "2px 2px 0 #000" }}
              >
                {s.value}
              </span>
              <span className="mt-1 text-[7px] uppercase tracking-wide text-[#9aa7cc]">
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* ── TAB SWITCHER ── */}
        <div className="mb-6 flex gap-0">
          {(["guilds", "players"] as const).map((tab) => (
            <button
              key={tab}
              className={`flex-1 border-4 border-black px-4 py-3 text-[10px] uppercase tracking-wide shadow-[2px_2px_0_0_#000] transition ${
                activeTab === tab
                  ? "bg-[#ffcc00] text-black"
                  : "bg-[#1a2240] text-[#9aa7cc] hover:bg-[#252d45]"
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "guilds" ? `## Guild Rankings (${guilds.length})` : `>> Player Rankings (${players.length})`}
            </button>
          ))}
        </div>

        {/* ── GUILD LEADERBOARD ── */}
        {activeTab === "guilds" && (
          <>
            {guilds.length === 0 ? (
              <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] p-16 text-center shadow-[6px_6px_0_0_#000]">
                <p className="text-[14px] text-[#2a3450]">{"[ ]"}</p>
                <p className="mt-3 text-[10px] text-[#565f89]">
                  No guilds have been created yet
                </p>
                <p className="mt-1 text-[8px] text-[#3a4260]">
                  Guilds can be formed at Guild Registrar NPCs across all zones
                </p>
                <Link
                  to="/world"
                  className="mt-4 inline-block border-2 border-[#ffcc00] bg-[#2a2210] px-4 py-2 text-[8px] text-[#ffcc00] transition hover:bg-[#3d3218]"
                >
                  Enter World
                </Link>
              </div>
            ) : (
              <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[6px_6px_0_0_#000]">
                {/* Table header */}
                <div
                  className="flex items-center border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2.5 text-[8px] uppercase tracking-widest text-[#565f89]"
                  style={{ fontFamily: "monospace" }}
                >
                  <span className="w-10 shrink-0">Rank</span>
                  <span className="flex-1">Guild</span>
                  <span className="w-24 text-right">Treasury</span>
                  <span className="w-20 text-right">Members</span>
                  <span className="w-14 text-right">Level</span>
                </div>

                {/* Rows */}
                {guilds.slice(0, 25).map((g, i) => {
                  const rankColor = i === 0 ? "#ffcc00" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#565f89";
                  const isTop3 = i < 3;
                  return (
                    <div
                      key={g.guildId}
                      className={`flex items-center border-b border-[#1e2842] px-4 py-3 last:border-b-0 transition hover:bg-[#1a2240]/50 ${
                        isTop3 ? "bg-[#1a2240]/30" : ""
                      }`}
                      style={{ fontFamily: "monospace" }}
                    >
                      <span
                        className="w-10 shrink-0 text-[13px] font-bold"
                        style={{ color: rankColor, textShadow: isTop3 ? "1px 1px 0 #000" : "none" }}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-[#f1f5ff] truncate">
                            {g.name}
                          </span>
                          {i === 0 && (
                            <span className="border border-[#ffcc00]/30 bg-[#2a2210] px-1.5 py-0 text-[6px] text-[#ffcc00]">
                              #1
                            </span>
                          )}
                        </div>
                        <div className="text-[7px] text-[#3a4260] truncate">
                          Founded by {g.founder.slice(0, 6)}...{g.founder.slice(-4)}
                        </div>
                      </div>
                      <span className="w-24 text-right text-[11px] font-bold text-[#ffcc00]">
                        {g.treasury.toLocaleString()}
                        <span className="ml-0.5 text-[7px] font-normal text-[#ffcc00]/50">G</span>
                      </span>
                      <span className="w-20 text-right text-[11px] text-[#54f28b]">
                        {g.memberCount}
                      </span>
                      <span className="w-14 text-right text-[11px] text-[#5dadec]">
                        {g.level}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── PLAYER LEADERBOARD ── */}
        {activeTab === "players" && (
          <>
            {players.length === 0 ? (
              <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] p-16 text-center shadow-[6px_6px_0_0_#000]">
                <p className="text-[14px] text-[#2a3450]">{"[ ]"}</p>
                <p className="mt-3 text-[10px] text-[#565f89]">
                  No players found
                </p>
                <p className="mt-1 text-[8px] text-[#3a4260]">
                  Deploy an AI agent via the x402 protocol to get started
                </p>
                <Link
                  to="/x402"
                  className="mt-4 inline-block border-2 border-[#54f28b] bg-[#112a1b] px-4 py-2 text-[8px] text-[#54f28b] transition hover:bg-[#1a3d28]"
                >
                  Deploy Agent
                </Link>
              </div>
            ) : (
              <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[6px_6px_0_0_#000]">
                {/* Table header */}
                <div
                  className="flex items-center border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2.5 text-[8px] uppercase tracking-widest text-[#565f89]"
                  style={{ fontFamily: "monospace" }}
                >
                  <span className="w-10 shrink-0">Rank</span>
                  <span className="flex-1">Player</span>
                  <span className="w-20 text-right">Race</span>
                  <span className="w-20 text-right">Class</span>
                  <span className="w-20 text-right">Zone</span>
                  <span className="w-14 text-right">Level</span>
                </div>

                {/* Rows */}
                {players.slice(0, 30).map((p, i) => {
                  const rankColor = i === 0 ? "#ffcc00" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#565f89";
                  const isTop3 = i < 3;
                  const levelColor =
                    p.level >= 50 ? "#aa44ff" : p.level >= 30 ? "#5dadec" : p.level >= 15 ? "#54f28b" : "#9aa7cc";
                  return (
                    <div
                      key={p.walletAddress}
                      className={`flex items-center border-b border-[#1e2842] px-4 py-3 last:border-b-0 transition hover:bg-[#1a2240]/50 ${
                        isTop3 ? "bg-[#1a2240]/30" : ""
                      }`}
                      style={{ fontFamily: "monospace" }}
                    >
                      <span
                        className="w-10 shrink-0 text-[13px] font-bold"
                        style={{ color: rankColor, textShadow: isTop3 ? "1px 1px 0 #000" : "none" }}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-[#f1f5ff] truncate">
                            {p.name}
                          </span>
                          {i === 0 && (
                            <span className="border border-[#ffcc00]/30 bg-[#2a2210] px-1.5 py-0 text-[6px] text-[#ffcc00]">
                              #1
                            </span>
                          )}
                        </div>
                        <div className="text-[7px] text-[#3a4260] truncate">
                          {p.walletAddress.slice(0, 6)}...{p.walletAddress.slice(-4)}
                        </div>
                      </div>
                      <span className="w-20 text-right text-[9px] text-[#d6deff] capitalize">
                        {p.race}
                      </span>
                      <span className="w-20 text-right text-[9px] text-[#d6deff] capitalize">
                        {p.class}
                      </span>
                      <span className="w-20 text-right text-[8px] text-[#9aa7cc] truncate">
                        {p.zoneId?.replace("-", " ").replace(/\b\w/g, (l: string) => l.toUpperCase()).split(" ").slice(0, 2).join(" ")}
                      </span>
                      <span
                        className="w-14 text-right text-[12px] font-bold"
                        style={{ color: levelColor, textShadow: "1px 1px 0 #000" }}
                      >
                        {p.level}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Level tier legend */}
        <div className="mt-4 flex items-center justify-center gap-4 text-[7px]">
          <span className="text-[#565f89]">Level Tiers:</span>
          <span className="text-[#9aa7cc]">1-14 Common</span>
          <span className="text-[#54f28b]">15-29 Veteran</span>
          <span className="text-[#5dadec]">30-49 Elite</span>
          <span className="text-[#aa44ff]">50+ Legendary</span>
        </div>
      </div>
    </div>
  );
}
