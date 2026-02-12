import * as React from "react";

import { Button } from "@/components/ui/button";
import { useWalletContext } from "@/context/WalletContext";

interface LandingPageProps {
  onEnterGame: () => void;
  onPlayNow: () => void;
}

const FEATURES = [
  {
    title: "AI Agents",
    desc: "LLM-powered players explore, fight, and trade autonomously in a living world.",
    icon: ">>",
  },
  {
    title: "On-Chain",
    desc: "Characters, items, and gold live on SKALE as NFTs and ERC-20 tokens.",
    icon: "$$",
  },
  {
    title: "Guild DAOs",
    desc: "Form guilds with shared treasuries, vote on proposals, and govern together.",
    icon: "##",
  },
  {
    title: "Auction House",
    desc: "Trade gear in regional auctions with anti-snipe protection and buyouts.",
    icon: "!!",
  },
];

const ZONES = [
  { name: "Village Square", level: "Lv 1+", color: "#54f28b", desc: "A peaceful starting area with merchants and trainers." },
  { name: "Wild Meadow", level: "Lv 5+", color: "#ffcc00", desc: "Open fields teeming with creatures and resources." },
  { name: "Dark Forest", level: "Lv 10+", color: "#ff4d6d", desc: "A dangerous woodland hiding rare loot and bosses." },
];

export function LandingPage({ onEnterGame, onPlayNow }: LandingPageProps): React.ReactElement {
  const { isConnected, connect, loading, address } = useWalletContext();

  const [frameIndex, setFrameIndex] = React.useState(0);
  const frames = ["|", "/", "-", "\\"];

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length);
    }, 200);
    return () => window.clearInterval(interval);
  }, [frames.length]);

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
                Play Now
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

        {/* Read the Docs */}
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 border-2 border-[#2a3450] bg-[#11192d] px-4 py-2 text-[9px] text-[#9aa7cc] shadow-[3px_3px_0_0_#000] transition hover:border-[#ffcc00] hover:text-[#ffcc00]"
        >
          {">>>"} Read the Docs — Build Your Agent {"<<<"}
        </a>
      </header>

      {/* ── FEATURES ── */}
      <section className="z-10 w-full max-w-3xl px-4 py-10">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          Features
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
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
            { step: "01", text: "Connect your wallet (MetaMask)" },
            { step: "02", text: "Mint a character NFT — pick race & class" },
            { step: "03", text: "Your AI agent enters the world and plays autonomously" },
            { step: "04", text: "Spectate, trade gear, and manage your guild" },
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

      {/* ── BOTTOM CTA ── */}
      <section className="z-10 flex w-full max-w-3xl flex-col items-center px-4 pt-6 pb-16">
        <div className="mb-6 w-full border-t-4 border-[#ffcc00]" />
        <p className="mb-4 text-[10px] text-[#9aa7cc]">
          Ready to enter the world?
        </p>
        <div className="flex flex-col items-center gap-4 sm:flex-row">
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
              Play Now
            </Button>
          )}
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
