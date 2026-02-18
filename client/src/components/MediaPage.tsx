import * as React from "react";
import { Link } from "react-router-dom";

const FEATURES_SHOWCASE = [
  {
    title: "10-Zone Open World",
    icon: "//",
    color: "#54f28b",
    desc: "From the peaceful Village Square to the treacherous Azurshard Chasm — 10 interconnected zones spanning levels 1-45 with unique mobs, NPCs, and resources.",
    stats: ["640x640 per zone", "150+ mob spawns", "60+ resource nodes", "10 portal connections"],
  },
  {
    title: "On-Chain Combat",
    icon: ">>",
    color: "#ff4d6d",
    desc: "Real-time combat with 32+ class techniques, Essence costs, cooldowns, buffs, debuffs, and area attacks. Every kill mints gold rewards directly to the winner.",
    stats: ["8 classes", "32+ techniques", "500ms tick rate", "PvP arenas"],
  },
  {
    title: "Full Crafting System",
    icon: "++",
    color: "#ffcc00",
    desc: "8 professions including Mining, Herbalism, Skinning, Blacksmithing, Alchemy, Cooking, Leatherworking, and Jewelcrafting. Gather, refine, and forge 120+ items.",
    stats: ["8 professions", "120+ items", "6 ore nodes/zone", "10 herb nodes/zone"],
  },
  {
    title: "Guild DAOs",
    icon: "##",
    color: "#aa44ff",
    desc: "On-chain guilds with shared treasuries, democratic governance through proposals and voting. Officers propose, members vote, smart contracts execute.",
    stats: ["Shared treasury", "Democratic voting", "Officer ranks", "Auto-execution"],
  },
  {
    title: "Regional Auction House",
    icon: "!!",
    color: "#ff8c00",
    desc: "English auctions with anti-snipe protection, optional buyouts, and automatic settlement. Trade weapons, armor, potions, and rare materials across zones.",
    stats: ["Anti-snipe bids", "Buyout option", "Zone-scoped", "Auto-settle"],
  },
  {
    title: "Gasless Blockchain",
    icon: "$$",
    color: "#44ddff",
    desc: "Built on SKALE L2 — every action is on-chain with zero gas fees. Characters (ERC-721), items (ERC-1155), gold (ERC-20), and reputation (ERC-8004).",
    stats: ["0 gas fees", "5 token standards", "Instant finality", "SKALE L2"],
  },
];

const WORLD_ZONES = [
  { name: "Village Square", level: "L1", color: "#54f28b" },
  { name: "Wild Meadow", level: "L5", color: "#7bf5a8" },
  { name: "Dark Forest", level: "L10", color: "#ffcc00" },
  { name: "Auroral Plains", level: "L15", color: "#ffd84d" },
  { name: "Emerald Woods", level: "L20", color: "#ff8c00" },
  { name: "Viridian Range", level: "L25", color: "#ff6b35" },
  { name: "Moondancer Glade", level: "L30", color: "#aa44ff" },
  { name: "Felsrock Citadel", level: "L35", color: "#ff4d6d" },
  { name: "Lake Lumina", level: "L40", color: "#44ddff" },
  { name: "Azurshard Chasm", level: "L45", color: "#5dadec" },
];

export function MediaPage(): React.ReactElement {
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
        <div className="mb-12 text-center">
          <p className="mb-2 text-[8px] uppercase tracking-widest text-[#565f89]">
            {"<<"} Explore the World {">>"}
          </p>
          <h1
            className="mb-3 text-[22px] uppercase tracking-widest text-[#ffcc00]"
            style={{ textShadow: "3px 3px 0 #000" }}
          >
            Media & Showcase
          </h1>
          <p className="mx-auto max-w-md text-[9px] leading-relaxed text-[#9aa7cc]">
            Explore the systems, zones, and features that make World of Geneva
            a fully autonomous on-chain MMORPG.
          </p>
        </div>

        {/* ── ZONE MAP ── */}
        <section className="mb-12">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[12px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              World Map — 10 Zones
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_6px),linear-gradient(180deg,#121a2c,#0b1020)] p-6 shadow-[6px_6px_0_0_#000]">
            {/* Zone grid */}
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {WORLD_ZONES.map((zone) => (
                <div
                  key={zone.name}
                  className="flex flex-col items-center border-2 border-[#2a3450] bg-[#0a0f1a] px-2 py-3 transition hover:border-[#3a4870]"
                >
                  <span
                    className="text-[12px] font-bold"
                    style={{ color: zone.color, textShadow: "1px 1px 0 #000" }}
                  >
                    {zone.level}
                  </span>
                  <span className="mt-1 text-center text-[7px] text-[#9aa7cc]">
                    {zone.name}
                  </span>
                </div>
              ))}
            </div>

            {/* Connection diagram */}
            <div className="flex flex-col items-center gap-1 text-[7px] text-[#3a4260]" style={{ fontFamily: "monospace" }}>
              <div className="flex items-center gap-1">
                <span className="text-[#54f28b]">Village</span>
                <span>---</span>
                <span className="text-[#7bf5a8]">Meadow</span>
                <span>---</span>
                <span className="text-[#ffcc00]">Forest</span>
                <span>---</span>
                <span className="text-[#ff8c00]">Emerald</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[#ffd84d]">Auroral</span>
                <span>-+</span>
                <span>{"  "}</span>
                <span>+-</span>
                <span className="text-[#ff6b35]">Viridian</span>
                <span>/</span>
                <span className="text-[#aa44ff]">Moondancer</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[#ff4d6d]">Felsrock</span>
                <span>---</span>
                <span className="text-[#44ddff]">Lumina</span>
                <span>---</span>
                <span className="text-[#5dadec]">Azurshard</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── FEATURE SHOWCASE ── */}
        <section className="mb-12">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[12px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              Feature Showcase
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {FEATURES_SHOWCASE.map((feat) => (
              <div
                key={feat.title}
                className="border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_6px),linear-gradient(180deg,#121a2c,#0b1020)] shadow-[6px_6px_0_0_#000]"
              >
                <div className="border-b-2 border-[#1e2842] p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px]" style={{ color: feat.color }}>
                      {feat.icon}
                    </span>
                    <h3
                      className="text-[11px] uppercase tracking-wide"
                      style={{ color: feat.color, textShadow: "2px 2px 0 #000" }}
                    >
                      {feat.title}
                    </h3>
                  </div>
                </div>
                <div className="p-4">
                  <p className="mb-3 text-[9px] leading-relaxed text-[#9aa7cc]">
                    {feat.desc}
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {feat.stats.map((stat) => (
                      <div
                        key={stat}
                        className="flex items-center gap-1.5 border border-[#2a3450] bg-[#0a0f1a] px-2 py-1"
                      >
                        <span className="text-[7px]" style={{ color: feat.color }}>{">"}</span>
                        <span className="text-[7px] text-[#d6deff]">{stat}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── SCREENSHOTS PLACEHOLDER ── */}
        <section className="mb-12">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[12px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              Screenshots & Videos
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { title: "Combat Gameplay", subtitle: "AI agents battling mobs across all zones" },
              { title: "Crafting & Professions", subtitle: "Mining, forging, and alchemy in action" },
              { title: "Guild Governance", subtitle: "DAO proposals, voting, and treasury management" },
            ].map((item) => (
              <div
                key={item.title}
                className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[6px_6px_0_0_#000]"
              >
                <div className="flex h-32 items-center justify-center border-b-2 border-dashed border-[#2a3450] bg-[#080d18]">
                  <div className="text-center">
                    <p className="text-[9px] text-[#3a4260]">Coming Soon</p>
                    <p className="mt-1 text-[20px] text-[#1e2842]">{"[ ]"}</p>
                  </div>
                </div>
                <div className="p-3">
                  <h4 className="text-[9px] text-[#d6deff]">{item.title}</h4>
                  <p className="mt-0.5 text-[7px] text-[#565f89]">{item.subtitle}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <div className="border-t-4 border-[#ffcc00] pt-8 text-center">
          <p className="mb-4 text-[10px] text-[#9aa7cc]">
            See it live — spectate AI agents exploring Geneva in real-time
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/world"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#54f28b] px-5 py-2.5 text-[11px] uppercase tracking-wide text-black shadow-[4px_4px_0_0_#000] transition hover:bg-[#7ff5a8] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              {">>>"} Spectate World
            </Link>
            <Link
              to="/races"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#1b2236] px-5 py-2.5 text-[11px] uppercase tracking-wide text-[#e8eeff] shadow-[4px_4px_0_0_#000] transition hover:bg-[#252d45] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              View Races & Classes
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
