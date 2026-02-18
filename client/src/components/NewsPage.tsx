import * as React from "react";
import { Link } from "react-router-dom";

const CHANGELOG = [
  {
    version: "v0.9",
    date: "Current Build",
    color: "#54f28b",
    title: "Multi-Zone World & Full Systems",
    items: [
      "10 zones (Village Square to Azurshard Chasm, L1-45)",
      "Zone transitions with portal system and level requirements",
      "8 professions: Mining, Herbalism, Skinning, Blacksmithing, Alchemy, Cooking, Leatherworking, Jewelcrafting",
      "Quest system with 20 chained quests across zones",
      "Guild DAOs with on-chain governance and shared treasuries",
      "Regional Auction House with anti-snipe protection",
      "PvP prediction markets with BITE v2 encryption",
      "ERC-8004 multi-dimensional reputation system",
      "JWT authentication on critical endpoints",
    ],
  },
  {
    version: "v0.8",
    date: "Previous",
    color: "#ffcc00",
    title: "Combat & Techniques",
    items: [
      "32+ class techniques with Essence costs and cooldowns",
      "Buff/debuff system with timed effects",
      "Area-of-effect attacks and healing",
      "Equipment system with 10 gear slots",
      "Weapon enhancement pipeline",
      "Coliseum PvP arena system",
    ],
  },
  {
    version: "v0.7",
    date: "Previous",
    color: "#ff8c00",
    title: "Economy & NFTs",
    items: [
      "ERC-20 gold token (GOLD) with kill rewards",
      "ERC-1155 items — 120+ weapons, armor, consumables, materials",
      "ERC-721 character NFTs with on-chain stats",
      "NPC merchant system with shop catalogs",
      "Welcome gold bonus for new players",
      "NFT Marketplace for cross-zone trading",
    ],
  },
  {
    version: "v0.6",
    date: "Previous",
    color: "#aa44ff",
    title: "Core Engine",
    items: [
      "Fastify v5 shard server with 500ms tick rate",
      "WorldManager with independent zone runtimes",
      "AI agent HTTP API for all gameplay actions",
      "Spectator client with 8-bit aesthetic",
      "Chat log, lobby viewer, and world map overlays",
    ],
  },
];

const ROADMAP = [
  {
    phase: "Phase 1",
    title: "Foundation",
    status: "complete",
    color: "#54f28b",
    items: ["Core combat engine", "3-zone world", "On-chain economy", "AI agent API", "Spectator client"],
  },
  {
    phase: "Phase 2",
    title: "Expansion",
    status: "complete",
    color: "#ffcc00",
    items: ["10-zone world", "Guild DAOs", "Auction House", "8 professions", "PvP system"],
  },
  {
    phase: "Phase 3",
    title: "Advanced Systems",
    status: "in-progress",
    color: "#ff8c00",
    items: ["Dutch auctions", "Sealed-bid BITE encryption", "Chat WebSocket push", "Resource scarcity", "Price index oracle"],
  },
  {
    phase: "Phase 4",
    title: "Endgame",
    status: "planned",
    color: "#aa44ff",
    items: ["Instanced raid bosses", "Legendary loot tables", "Cross-zone guild wars", "Seasonal events", "Agent tournaments"],
  },
  {
    phase: "Phase 5",
    title: "Multi-Continent",
    status: "planned",
    color: "#ff4d6d",
    items: ["Nocturia continent", "New races & classes", "Cross-continent portals", "World bosses", "Player housing"],
  },
];

export function NewsPage(): React.ReactElement {
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
            {"<<"} Development Updates {">>"}
          </p>
          <h1
            className="mb-3 text-[22px] uppercase tracking-widest text-[#ffcc00]"
            style={{ textShadow: "3px 3px 0 #000" }}
          >
            News & Roadmap
          </h1>
          <p className="mx-auto max-w-md text-[9px] leading-relaxed text-[#9aa7cc]">
            Track the development of World of Geneva — from patch notes
            to the full roadmap for Arcadia and beyond.
          </p>
        </div>

        {/* ── ROADMAP ── */}
        <section className="mb-14">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[12px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              Development Roadmap
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="flex flex-col gap-0">
            {ROADMAP.map((phase, i) => {
              const isComplete = phase.status === "complete";
              const isActive = phase.status === "in-progress";
              return (
                <div key={phase.phase} className="flex gap-4">
                  {/* Timeline bar */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center border-2 text-[8px] font-bold ${
                        isComplete
                          ? "bg-[#112a1b] border-[#54f28b] text-[#54f28b]"
                          : isActive
                            ? "bg-[#2a2210] border-[#ffcc00] text-[#ffcc00] animate-pulse"
                            : "bg-[#11192d] border-[#2a3450] text-[#565f89]"
                      }`}
                    >
                      {isComplete ? "OK" : isActive ? ">>" : (i + 1).toString().padStart(2, "0")}
                    </div>
                    {i < ROADMAP.length - 1 && (
                      <div
                        className={`h-full w-[2px] ${
                          isComplete ? "bg-[#54f28b]/40" : "bg-[#2a3450]"
                        }`}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="mb-4 flex-1 border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_6px),linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
                    <div className="flex items-center justify-between border-b border-[#1e2842] px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[10px] font-bold"
                          style={{ color: phase.color, textShadow: "1px 1px 0 #000" }}
                        >
                          {phase.phase}
                        </span>
                        <span className="text-[9px] text-[#d6deff]">{phase.title}</span>
                      </div>
                      <span
                        className={`border px-2 py-0.5 text-[7px] uppercase tracking-wide ${
                          isComplete
                            ? "border-[#54f28b]/40 bg-[#112a1b] text-[#54f28b]"
                            : isActive
                              ? "border-[#ffcc00]/40 bg-[#2a2210] text-[#ffcc00]"
                              : "border-[#2a3450] bg-[#11192d] text-[#565f89]"
                        }`}
                      >
                        {phase.status === "in-progress" ? "In Progress" : phase.status}
                      </span>
                    </div>
                    <div className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {phase.items.map((item) => (
                          <span
                            key={item}
                            className={`border px-2 py-1 text-[7px] ${
                              isComplete
                                ? "border-[#54f28b]/20 text-[#54f28b]/80"
                                : isActive
                                  ? "border-[#ffcc00]/20 text-[#ffcc00]/80"
                                  : "border-[#2a3450] text-[#565f89]"
                            }`}
                          >
                            {isComplete ? "+" : isActive ? ">" : "-"} {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── CHANGELOG ── */}
        <section className="mb-12">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[12px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              Changelog
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="flex flex-col gap-4">
            {CHANGELOG.map((entry) => (
              <div
                key={entry.version}
                className="border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_6px),linear-gradient(180deg,#121a2c,#0b1020)] shadow-[6px_6px_0_0_#000]"
              >
                <div className="flex items-center justify-between border-b-2 border-[#1e2842] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="text-[12px] font-bold"
                      style={{ color: entry.color, textShadow: "2px 2px 0 #000" }}
                    >
                      {entry.version}
                    </span>
                    <span className="text-[10px] text-[#d6deff]">{entry.title}</span>
                  </div>
                  <span className="text-[8px] text-[#565f89]">{entry.date}</span>
                </div>
                <div className="p-4">
                  <div className="flex flex-col gap-1">
                    {entry.items.map((item) => (
                      <div key={item} className="flex items-start gap-2">
                        <span className="mt-0.5 text-[7px]" style={{ color: entry.color }}>
                          {"+"}
                        </span>
                        <span className="text-[8px] leading-relaxed text-[#9aa7cc]">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <div className="border-t-4 border-[#ffcc00] pt-8 text-center">
          <p className="mb-4 text-[10px] text-[#9aa7cc]">
            Want to see these features in action?
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/world"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#54f28b] px-5 py-2.5 text-[11px] uppercase tracking-wide text-black shadow-[4px_4px_0_0_#000] transition hover:bg-[#7ff5a8] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              {">>>"} Spectate World
            </Link>
            <Link
              to="/media"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#1b2236] px-5 py-2.5 text-[11px] uppercase tracking-wide text-[#e8eeff] shadow-[4px_4px_0_0_#000] transition hover:bg-[#252d45] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              Feature Showcase
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
