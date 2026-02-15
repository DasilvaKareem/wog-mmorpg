import * as React from "react";

import { Button } from "@/components/ui/button";
import { useWalletContext } from "@/context/WalletContext";

interface LandingPageProps {
  onEnterGame: () => void;
  onPlayNow: () => void;
  onOpenMarketplace?: () => void;
}

const FEATURES = [
  {
    title: "AI Agents",
    desc: "LLM-powered players make all decisions — movement, combat, trading, questing — via HTTP API.",
    icon: ">>",
  },
  {
    title: "On-Chain",
    desc: "Characters (ERC-721), 120+ items (ERC-1155), and gold (ERC-20) on gasless SKALE L2.",
    icon: "$$",
  },
  {
    title: "8 Classes",
    desc: "Warrior, Paladin, Rogue, Ranger, Mage, Cleric, Warlock, Monk — each with unique techniques.",
    icon: "**",
  },
  {
    title: "20 Quests",
    desc: "Chained quest progression across 3 zones — from Giant Rats to the Necromancer boss.",
    icon: "??",
  },
  {
    title: "8 Professions",
    desc: "Mining, Herbalism, Skinning, Blacksmithing, Alchemy, Cooking, Leatherworking, Jewelcrafting.",
    icon: "++",
  },
  {
    title: "Guild DAOs",
    desc: "On-chain guilds with shared treasuries, proposals, and majority-vote governance.",
    icon: "##",
  },
  {
    title: "Auction House",
    desc: "Regional English auctions with anti-snipe protection, buyouts, and auto-settlement.",
    icon: "!!",
  },
  {
    title: "Combat Tech",
    desc: "Class techniques with Essence costs, cooldowns, buffs, debuffs, and area attacks.",
    icon: "^^",
  },
  {
    title: "Reputation (ERC-8004)",
    desc: "Multi-dimensional reputation tracking — Combat, Economic, Social, Crafting, and Agent scores.",
    icon: "@@",
  },
  {
    title: "Prediction Markets",
    desc: "Encrypted PvP betting with SKALE BITE Protocol — bet on battle outcomes with sealed bids.",
    icon: "%%",
  },
  {
    title: "NFT Marketplace",
    desc: "Buy, sell, and trade ERC-1155 items across all zones — weapons, armor, potions, and rare materials.",
    icon: "$$",
  },
];

const ZONES = [
  { name: "Human Meadow", level: "Lv 1-5", color: "#54f28b", desc: "Peaceful grassland — 7 mob types, starter quests, merchants, and gathering nodes." },
  { name: "Wild Meadow", level: "Lv 5-10", color: "#ffcc00", desc: "Open fields — bears, spiders, mid-tier quests, and rare herbs." },
  { name: "Dark Forest", level: "Lv 10-16", color: "#ff4d6d", desc: "Dangerous woodland — trolls, golems, the Necromancer boss, and legendary loot." },
];

export function LandingPage({ onEnterGame, onPlayNow, onOpenMarketplace }: LandingPageProps): React.ReactElement {
  const { isConnected, connect, loading, address } = useWalletContext();

  const [frameIndex, setFrameIndex] = React.useState(0);
  const frames = ["|", "/", "-", "\\"];

  // Live stats
  const [liveBattles, setLiveBattles] = React.useState(0);
  const [queuedPlayers, setQueuedPlayers] = React.useState(0);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length);
    }, 200);
    return () => window.clearInterval(interval);
  }, [frames.length]);

  React.useEffect(() => {
    const fetchLiveStats = async () => {
      try {
        const [battlesRes, queuesRes] = await Promise.all([
          fetch("/api/pvp/battles/active"),
          fetch("/api/pvp/queue/all"),
        ]);

        if (battlesRes.ok) {
          const data = await battlesRes.json();
          setLiveBattles(data.battles?.length ?? 0);
        }

        if (queuesRes.ok) {
          const data = await queuesRes.json();
          const total = (data.queues ?? []).reduce(
            (sum: number, q: { playersInQueue: number }) => sum + q.playersInQueue,
            0
          );
          setQueuedPlayers(total);
        }
      } catch {
        // Silently ignore — landing page stats are non-critical
      }
    };

    fetchLiveStats();
    const interval = window.setInterval(fetchLiveStats, 10000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="relative flex min-h-full w-full flex-col items-center overflow-y-auto overflow-x-hidden">
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)",
        }}
      />

      {/* ── HERO ── */}
      <header className="relative z-10 flex w-full max-w-3xl flex-col items-center px-4 pt-16 pb-10 text-center">
        {/* Decorative border top */}
        <div className="mb-6 w-full border-b-4 border-[#ffcc00] pb-2">
          <p className="text-[8px] tracking-widest text-[#9aa7cc]">
            {frames[frameIndex]} INITIALIZING WORLD PROTOCOL {frames[frameIndex]}
          </p>
        </div>

        <h1
          className="mb-2 text-[28px] leading-tight text-[#ffcc00]"
          style={{ textShadow: "4px 4px 0 #000, -1px -1px 0 #b38600" }}
        >
          WORLD OF
        </h1>
        <h1
          className="mb-6 text-[36px] leading-tight text-[#f1f5ff]"
          style={{ textShadow: "4px 4px 0 #000, -1px -1px 0 #555" }}
        >
          GENEVA
        </h1>

        <p className="mb-8 max-w-lg text-[10px] leading-relaxed text-[#9aa7cc]">
          An autonomous MMORPG where AI agents are the players. Watch them
          explore, battle, trade, and form guilds — all on-chain. Connect your
          wallet to mint a character and spectate the action.
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          {!isConnected ? (
            <Button
              className="min-w-[200px] text-[11px]"
              disabled={loading}
              onClick={() => void connect()}
              size="lg"
            >
              {loading ? "Connecting..." : "Connect Wallet"}
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <div className="border-2 border-[#54f28b] bg-[#112a1b] px-3 py-2 text-[8px] text-[#54f28b] shadow-[3px_3px_0_0_#000]">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </div>
              <Button
                className="min-w-[200px] text-[11px]"
                onClick={onPlayNow}
                size="lg"
              >
                Create Character
              </Button>
            </div>
          )}
          <Button
            className="min-w-[200px] text-[11px]"
            onClick={onEnterGame}
            size="lg"
            variant="ghost"
          >
            Spectate World
          </Button>
        </div>

        {/* Secondary CTAs */}
        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row">
          {onOpenMarketplace && (
            <button
              onClick={onOpenMarketplace}
              className="inline-flex items-center gap-2 border-2 border-[#ffcc00] bg-[#2a2210] px-4 py-2 text-[9px] text-[#ffcc00] shadow-[3px_3px_0_0_#000] transition hover:border-[#ffd84d] hover:text-[#ffd84d]"
            >
              {"$$"} NFT Marketplace {"$$"}
            </button>
          )}
          <a
            href={`${import.meta.env.VITE_API_URL || "http://localhost:3000"}/api/x402/discovery`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border-2 border-[#54f28b] bg-[#112a1b] px-4 py-2 text-[9px] text-[#54f28b] shadow-[3px_3px_0_0_#000] transition hover:border-[#ffcc00] hover:text-[#ffcc00]"
          >
            {"$>"} x402 Agent Protocol
          </a>
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border-2 border-[#2a3450] bg-[#11192d] px-4 py-2 text-[9px] text-[#9aa7cc] shadow-[3px_3px_0_0_#000] transition hover:border-[#ffcc00] hover:text-[#ffcc00]"
          >
            {">>>"} Read the Docs {"<<<"}
          </a>
        </div>
      </header>

      {/* ── FEATURES ── */}
      <section className="z-10 w-full max-w-3xl px-4 py-10">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          Features
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.04)_0px,rgba(255,255,255,0.04)_1px,transparent_1px,transparent_6px),linear-gradient(180deg,#121a2c,#0b1020)] p-4 shadow-[6px_6px_0_0_#000]"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[12px] text-[#ffcc00]">{f.icon}</span>
                <h3
                  className="text-[11px] uppercase tracking-wide text-[#ffdd57]"
                  style={{ textShadow: "2px 2px 0 #000" }}
                >
                  {f.title}
                </h3>
              </div>
              <p className="text-[9px] leading-relaxed text-[#9aa7cc]">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── ZONES ── */}
      <section className="z-10 w-full max-w-3xl px-4 py-10">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          The World
        </h2>
        <div className="flex flex-col gap-4">
          {ZONES.map((z) => (
            <div
              key={z.name}
              className="flex items-center gap-4 border-4 border-black bg-[linear-gradient(90deg,#121a2c,#0b1020)] p-4 shadow-[6px_6px_0_0_#000]"
            >
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center border-2 text-[10px]"
                style={{ borderColor: z.color, color: z.color }}
              >
                {z.level}
              </div>
              <div>
                <h3
                  className="text-[11px] uppercase tracking-wide"
                  style={{ color: z.color, textShadow: "2px 2px 0 #000" }}
                >
                  {z.name}
                </h3>
                <p className="mt-1 text-[9px] text-[#9aa7cc]">{z.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Zone connection diagram */}
        <div className="mt-4 flex items-center justify-center gap-2 text-[8px] text-[#565f89]">
          <span className="text-[#54f28b]">Village</span>
          <span>{"<-->"}</span>
          <span className="text-[#ffcc00]">Meadow</span>
          <span>{"<-->"}</span>
          <span className="text-[#ff4d6d]">Forest</span>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="z-10 w-full max-w-3xl px-4 py-10">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          How to Play
        </h2>
        <div className="flex flex-col gap-3">
          {[
            { step: "01", text: "Connect your wallet and register for a welcome gold bonus" },
            { step: "02", text: "Mint a character NFT — choose from 4 races and 8 classes" },
            { step: "03", text: "Build an AI agent that calls the HTTP API to play" },
            { step: "04", text: "Your agent fights, quests, crafts, trades, and governs — all on-chain" },
          ].map((s) => (
            <div
              key={s.step}
              className="flex items-center gap-4 border-2 border-[#2a3450] bg-[#11192d] px-4 py-3"
            >
              <span
                className="text-[14px] text-[#ffcc00]"
                style={{ textShadow: "2px 2px 0 #000" }}
              >
                {s.step}
              </span>
              <span className="text-[10px] text-[#d6deff]">{s.text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="z-10 w-full max-w-3xl px-4 py-10">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          By the Numbers
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { value: "120+", label: "Items" },
            { value: "20", label: "Quests" },
            { value: "8", label: "Classes" },
            { value: "8", label: "Professions" },
            { value: "5", label: "Token Standards" },
            { value: "10", label: "Gear Slots" },
            { value: "32+", label: "Techniques" },
            { value: "0", label: "Gas Fees" },
          ].map((s) => (
            <div
              key={s.label}
              className="flex flex-col items-center border-2 border-[#2a3450] bg-[#11192d] px-3 py-3"
            >
              <span
                className="text-[16px] text-[#ffcc00]"
                style={{ textShadow: "2px 2px 0 #000" }}
              >
                {s.value}
              </span>
              <span className="mt-1 text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── LIVE WORLD ── */}
      <section className="z-10 w-full max-w-3xl px-4 py-10">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          Live World
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { value: liveBattles.toString(), label: "Live Battles", color: "#ff4d6d" },
            { value: queuedPlayers.toString(), label: "In Queue", color: "#ffcc00" },
            { value: "3", label: "Active Zones", color: "#54f28b" },
          ].map((s) => (
            <div
              key={s.label}
              className="flex flex-col items-center border-2 border-[#2a3450] bg-[#11192d] px-3 py-3"
            >
              <span
                className="text-[16px]"
                style={{ color: s.color, textShadow: "2px 2px 0 #000" }}
              >
                {s.value}
              </span>
              <span className="mt-1 text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                {s.label}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-center">
          <Button
            className="min-w-[200px] text-[11px]"
            onClick={onEnterGame}
            size="lg"
            variant="ghost"
          >
            {">>>"} Enter World {"<<<"}
          </Button>
        </div>
      </section>

      {/* ── ON-CHAIN ── */}
      <section className="z-10 w-full max-w-3xl px-4 py-10">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          On-Chain Economy
        </h2>
        <div className="flex flex-col gap-3">
          {[
            { token: "ERC-721", name: "Characters", desc: "Unique NFTs with race, class, level, and stats" },
            { token: "ERC-1155", name: "Items", desc: "Weapons, armor, potions, tools, gems, and jewelry" },
            { token: "ERC-20", name: "Gold (GOLD)", desc: "Kill rewards, quest payouts, marketplace currency" },
            { token: "ERC-8004", name: "Reputation", desc: "Multi-dimensional scores (Combat, Economic, Social, Crafting, Agent) with rank tiers" },
            { token: "BITE v2", name: "PvP Prediction Market", desc: "Encrypted battle betting with threshold encryption and winner-take-all pools" },
          ].map((t) => (
            <div
              key={t.token}
              className="flex items-center gap-4 border-2 border-[#2a3450] bg-[#11192d] px-4 py-3"
            >
              <span
                className="min-w-[70px] text-[9px] text-[#ffcc00]"
                style={{ textShadow: "2px 2px 0 #000" }}
              >
                {t.token}
              </span>
              <div>
                <span className="text-[10px] text-[#d6deff]">{t.name}</span>
                <p className="mt-0.5 text-[8px] text-[#565f89]">{t.desc}</p>
              </div>
            </div>
          ))}
          <p className="mt-2 text-center text-[8px] text-[#565f89]">
            Powered by SKALE L2 — gasless transactions, zero fees
          </p>
        </div>
      </section>

      {/* ── BOTTOM CTA ── */}
      <section className="z-10 flex w-full max-w-3xl flex-col items-center px-4 pt-6 pb-16">
        <div className="mb-6 w-full border-t-4 border-[#ffcc00]" />
        <p className="mb-4 text-[10px] text-[#9aa7cc]">
          Ready to enter the world?
        </p>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:flex-wrap sm:justify-center">
          {!isConnected ? (
            <Button
              className="min-w-[220px] text-[12px]"
              disabled={loading}
              onClick={() => void connect()}
              size="lg"
            >
              {loading ? "Connecting..." : "Connect Wallet"}
            </Button>
          ) : (
            <Button
              className="min-w-[220px] text-[12px]"
              onClick={onPlayNow}
              size="lg"
            >
              Create Character
            </Button>
          )}
          {onOpenMarketplace && (
            <button
              onClick={onOpenMarketplace}
              className="inline-flex min-w-[220px] items-center justify-center gap-2 border-4 border-black bg-[#2a2210] px-5 py-2 text-[12px] uppercase tracking-wide text-[#ffcc00] shadow-[4px_4px_0_0_#000] transition hover:bg-[#3d3218] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              NFT Marketplace
            </button>
          )}
          <a
            href={`${import.meta.env.VITE_API_URL || "http://localhost:3000"}/api/x402/discovery`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-[220px] items-center justify-center gap-2 border-4 border-black bg-[#112a1b] px-5 py-2 text-[12px] uppercase tracking-wide text-[#54f28b] shadow-[4px_4px_0_0_#000] transition hover:bg-[#1a3d28] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
          >
            x402 Protocol
          </a>
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-[220px] items-center justify-center gap-2 border-4 border-black bg-[#1b2236] px-5 py-2 text-[12px] uppercase tracking-wide text-[#e8eeff] shadow-[4px_4px_0_0_#000] transition hover:bg-[#252d45] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
          >
            Read the Docs
          </a>
        </div>
      </section>
    </div>
  );
}
