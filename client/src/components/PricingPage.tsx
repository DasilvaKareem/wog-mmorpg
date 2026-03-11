import * as React from "react";
import { Link } from "react-router-dom";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "/forever",
    color: "#9aa7cc",
    border: "#3a4260",
    icon: ">>",
    highlight: null,
    features: [
      { text: "6-hour play sessions", dim: false },
      { text: "We host your agent", dim: false },
      { text: "Basic fixed strategy", dim: false },
      { text: "3 starter zones", dim: false },
      { text: "No retreat AI", dim: true },
      { text: "No technique usage", dim: true },
      { text: "No strategy adaptation", dim: true },
      { text: "No auction trading", dim: true },
    ],
    cta: "Get Started Free",
    popular: false,
    tagline: "Try the world",
  },
  {
    name: "Starter",
    price: "$4.99",
    period: "/month",
    color: "#44ddff",
    border: "#44ddff",
    icon: "++",
    highlight: null,
    features: [
      { text: "12-hour play sessions", dim: false },
      { text: "We host your agent", dim: false },
      { text: "Smart Agent AI (LLM)", dim: false },
      { text: "All 10 zones unlocked", dim: false },
      { text: "Retreat + heal logic", dim: false },
      { text: "Technique usage", dim: false },
      { text: "Self-adapting strategy", dim: false },
      { text: "No auction trading", dim: true },
    ],
    cta: "Subscribe",
    popular: false,
    tagline: "Play smarter",
  },
  {
    name: "Pro",
    price: "$9.99",
    period: "/month",
    color: "#54f28b",
    border: "#54f28b",
    icon: "**",
    highlight: "Best Value",
    features: [
      { text: "24/7 always online", dim: false },
      { text: "We host your agent", dim: false },
      { text: "Adaptive Agent AI (LLM)", dim: false },
      { text: "All 10 zones unlocked", dim: false },
      { text: "Retreat + heal logic", dim: false },
      { text: "Technique usage", dim: false },
      { text: "Real-time strategy shifts", dim: false },
      { text: "Auction house trading", dim: false },
    ],
    cta: "Subscribe",
    popular: true,
    tagline: "Never stop grinding",
  },
  {
    name: "Deploy Your Own",
    price: "You Pay",
    period: "infra costs",
    color: "#aa44ff",
    border: "#aa44ff",
    icon: "$>",
    highlight: null,
    features: [
      { text: "Unlimited everything", dim: false },
      { text: "Self-hosted agent", dim: false },
      { text: "24/7 always online", dim: false },
      { text: "Full HTTP API access", dim: false },
      { text: "Write custom strategy", dim: false },
      { text: "Multiple agents OK", dim: false },
      { text: "Open source client", dim: false },
      { text: "You own the infra", dim: false },
    ],
    cta: "Deploy Guide",
    popular: false,
    tagline: "Total control",
  },
];

export function PricingPage(): React.ReactElement {
  const [annual, setAnnual] = React.useState(false);

  function displayPrice(plan: typeof PLANS[number]): string {
    if (plan.price === "$0" || plan.price === "You Pay") return plan.price;
    const monthly = parseFloat(plan.price.replace("$", ""));
    if (annual) {
      const yearlyMonthly = +(monthly * 10 / 12).toFixed(2);
      return `$${yearlyMonthly}`;
    }
    return plan.price;
  }

  function displayPeriod(plan: typeof PLANS[number]): string {
    if (plan.price === "$0") return "/forever";
    if (plan.price === "You Pay") return "infra costs";
    if (annual) return "/mo (billed yearly)";
    return "/month";
  }

  function annualSavings(plan: typeof PLANS[number]): string | null {
    if (!annual) return null;
    if (plan.price === "$0" || plan.price === "You Pay") return null;
    const monthly = parseFloat(plan.price.replace("$", ""));
    const saved = +(monthly * 2).toFixed(2);
    return `Save $${saved}/yr`;
  }

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
      <section className="z-10 w-full max-w-4xl px-4 pt-24 pb-4 text-center">
        <h1
          className="mb-4 text-[18px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          Agent Pricing
        </h1>
        <p className="mx-auto max-w-lg text-[10px] leading-relaxed text-[#9aa7cc]">
          Deploy an AI agent into the World of Geneva. Your agent fights,
          trades, quests, and levels up autonomously — you just watch.
        </p>

        {/* Billing toggle */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <span
            className="text-[9px] uppercase tracking-wide"
            style={{ color: annual ? "#565f89" : "#ffcc00" }}
          >
            Monthly
          </span>
          <button
            onClick={() => setAnnual(!annual)}
            className="relative h-5 w-10 border-2 border-black shadow-[2px_2px_0_0_#000]"
            style={{ backgroundColor: annual ? "#54f28b" : "#2a3450" }}
          >
            <div
              className="absolute top-0.5 h-3 w-3 border border-black bg-white transition-all"
              style={{ left: annual ? "20px" : "2px" }}
            />
          </button>
          <span
            className="text-[9px] uppercase tracking-wide"
            style={{ color: annual ? "#ffcc00" : "#565f89" }}
          >
            Annual
          </span>
          {annual && (
            <span className="text-[8px] text-[#54f28b]">2 months free</span>
          )}
        </div>
      </section>

      {/* ── PRICING CARDS ── */}
      <section className="z-10 w-full max-w-5xl px-4 py-10">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className="relative flex flex-col border-4 border-black p-5 shadow-[6px_6px_0_0_#000]"
              style={{
                background:
                  plan.popular
                    ? "repeating-linear-gradient(0deg,rgba(84,242,139,0.06) 0px,rgba(84,242,139,0.06) 1px,transparent 1px,transparent 6px),linear-gradient(180deg,#121a2c,#0b1020)"
                    : "repeating-linear-gradient(0deg,rgba(255,255,255,0.04) 0px,rgba(255,255,255,0.04) 1px,transparent 1px,transparent 6px),linear-gradient(180deg,#121a2c,#0b1020)",
                borderColor: plan.popular ? plan.border : "#000",
              }}
            >
              {/* Badge */}
              {plan.highlight && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 border-2 border-black bg-[#54f28b] px-3 py-0.5 text-[7px] font-bold uppercase tracking-widest text-[#060d12]"
                >
                  {plan.highlight}
                </div>
              )}

              {/* Plan icon + name */}
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[12px]" style={{ color: plan.color }}>
                  {plan.icon}
                </span>
                <h3
                  className="text-[11px] uppercase tracking-wide"
                  style={{ color: plan.color, textShadow: "2px 2px 0 #000" }}
                >
                  {plan.name}
                </h3>
              </div>

              {/* Tagline */}
              <p className="mb-3 text-[7px] text-[#565f89]">{plan.tagline}</p>

              {/* Price */}
              <div className="mb-1">
                <span
                  className="text-[22px] font-bold"
                  style={{ color: plan.color, textShadow: "2px 2px 0 #000" }}
                >
                  {displayPrice(plan)}
                </span>
                <span className="ml-1 text-[8px] text-[#565f89]">
                  {displayPeriod(plan)}
                </span>
              </div>

              {/* Annual savings */}
              <div className="mb-3 h-4">
                {annualSavings(plan) && (
                  <span className="text-[7px] text-[#54f28b]">
                    {annualSavings(plan)}
                  </span>
                )}
              </div>

              {/* Divider */}
              <div
                className="mb-4 h-[2px] w-full"
                style={{
                  background: `linear-gradient(90deg, ${plan.border}44, ${plan.border}, ${plan.border}44)`,
                }}
              />

              {/* Features */}
              <ul className="mb-6 flex flex-1 flex-col gap-2">
                {plan.features.map((feat) => (
                  <li key={feat.text} className="flex items-start gap-2">
                    <span
                      className="mt-0.5 text-[8px]"
                      style={{ color: feat.dim ? "#3a4260" : plan.color }}
                    >
                      {feat.dim ? "x" : ">"}
                    </span>
                    <span
                      className="text-[8px] leading-snug"
                      style={{ color: feat.dim ? "#3a4260" : "#9aa7cc", textDecoration: feat.dim ? "line-through" : "none" }}
                    >
                      {feat.text}
                    </span>
                  </li>
                ))}
              </ul>

              {/* CTA button */}
              {plan.name === "Deploy Your Own" ? (
                <Link
                  to="/x402"
                  className="block w-full border-4 border-black py-2 text-center text-[9px] font-bold uppercase tracking-wide shadow-[4px_4px_0_0_#000] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_#000]"
                  style={{
                    backgroundColor: `${plan.color}22`,
                    color: plan.color,
                    borderColor: plan.border,
                  }}
                >
                  {plan.cta}
                </Link>
              ) : (
                <button
                  className="w-full border-4 border-black py-2 text-[9px] font-bold uppercase tracking-wide shadow-[4px_4px_0_0_#000] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
                  style={{
                    backgroundColor: plan.popular ? plan.color : `${plan.color}22`,
                    color: plan.popular ? "#060d12" : plan.color,
                    borderColor: plan.popular ? "#000" : plan.border,
                  }}
                >
                  {plan.cta}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── WHAT YOU GET ── */}
      <section className="z-10 w-full max-w-3xl px-4 py-10">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          What Each Tier Gets You
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "Basic Agent",
              tier: "Free",
              color: "#9aa7cc",
              desc: "Walks toward mobs, basic attacks only. No retreat logic — your agent will fight to the death. No technique usage. Gets stuck on tough mobs. Limited to 3 starter zones.",
            },
            {
              title: "Smart Agent",
              tier: "Starter",
              color: "#44ddff",
              desc: "Retreats when low HP. Uses class techniques. Knows when to heal. Picks appropriate mobs for its level. Travels between zones as it levels up.",
            },
            {
              title: "Adaptive Agent",
              tier: "Pro",
              color: "#54f28b",
              desc: "Shifts strategy in real-time. Learns which mobs give the best XP. Optimizes gear loadouts. Trades on the auction house. Adapts its entire playstyle as the meta evolves.",
            },
          ].map((agent) => (
            <div
              key={agent.title}
              className="border-4 border-black p-4 shadow-[4px_4px_0_0_#000]"
              style={{
                background:
                  "repeating-linear-gradient(0deg,rgba(255,255,255,0.04) 0px,rgba(255,255,255,0.04) 1px,transparent 1px,transparent 6px),linear-gradient(180deg,#121a2c,#0b1020)",
              }}
            >
              <div className="mb-1 flex items-center gap-2">
                <h3
                  className="text-[10px] uppercase tracking-wide"
                  style={{ color: agent.color, textShadow: "2px 2px 0 #000" }}
                >
                  {agent.title}
                </h3>
              </div>
              <div className="mb-2 text-[7px] uppercase tracking-widest text-[#565f89]">
                {agent.tier} tier
              </div>
              <p className="text-[8px] leading-relaxed text-[#9aa7cc]">
                {agent.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── COMPARISON TABLE ── */}
      <section className="z-10 w-full max-w-4xl px-4 py-10">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          Plan Comparison
        </h2>
        <div
          className="overflow-x-auto overflow-hidden border-4 border-black shadow-[6px_6px_0_0_#000]"
          style={{
            background:
              "repeating-linear-gradient(0deg,rgba(255,255,255,0.04) 0px,rgba(255,255,255,0.04) 1px,transparent 1px,transparent 6px),linear-gradient(180deg,#121a2c,#0b1020)",
          }}
        >
          <table className="w-full text-[8px]">
            <thead>
              <tr className="border-b-2 border-[#1c2440]">
                <th className="p-3 text-left text-[9px] uppercase tracking-wide text-[#565f89]">
                  Feature
                </th>
                <th className="p-3 text-center text-[9px] uppercase tracking-wide text-[#9aa7cc]">
                  Free
                </th>
                <th className="p-3 text-center text-[9px] uppercase tracking-wide text-[#44ddff]">
                  Starter
                </th>
                <th className="p-3 text-center text-[9px] uppercase tracking-wide text-[#54f28b]">
                  Pro
                </th>
                <th className="p-3 text-center text-[9px] uppercase tracking-wide text-[#aa44ff]">
                  Self-Host
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Price", "$0", "$4.99/mo", "$9.99/mo", "Your infra"],
                ["Uptime", "6hr sessions", "12hr sessions", "24/7", "24/7"],
                ["Zones", "3 starter", "All 10", "All 10", "All 10"],
                ["Agent AI", "Basic script", "Smart (LLM)", "Adaptive (LLM)", "Custom"],
                ["Retreat Logic", "--", "Yes", "Yes", "Custom"],
                ["Technique Usage", "--", "Yes", "Yes", "Custom"],
                ["Strategy Adaptation", "--", "Yes", "Real-time", "Custom"],
                ["Auction Trading", "--", "--", "Yes", "Custom"],
                ["Annual Discount", "--", "2 months free", "2 months free", "--"],
              ].map(([feature, free, starter, pro, self]) => (
                <tr key={feature} className="border-b border-[#1c2440]/50">
                  <td className="p-3 text-[#9aa7cc]">{feature}</td>
                  <td className="p-3 text-center text-[#565f89]">{free}</td>
                  <td className="p-3 text-center text-[#44ddff]">{starter}</td>
                  <td className="p-3 text-center text-[#54f28b]">{pro}</td>
                  <td className="p-3 text-center text-[#aa44ff]">{self}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="z-10 w-full max-w-3xl px-4 py-10 pb-20">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          FAQ
        </h2>
        <div className="flex flex-col gap-4">
          {[
            {
              q: "How is the Free agent different?",
              a: "The free agent uses a basic scripted strategy — it walks toward mobs and basic-attacks. No retreat logic (it fights to death), no technique usage, and it's limited to the 3 starter zones. Paid agents use LLM-powered decision making and are dramatically smarter.",
            },
            {
              q: "What makes the Pro agent worth it?",
              a: "The Adaptive Agent shifts strategy in real-time. It learns which mobs give optimal XP, optimizes gear, trades on the auction house, and adapts its entire playstyle. Plus unlimited commands and 24/7 uptime — your agent never sleeps.",
            },
            {
              q: "What happens to my agent if I downgrade?",
              a: "Your character keeps all progress — level, gear, gold, quests. Only the agent intelligence and session limits change. You can always re-upgrade later.",
            },
            {
              q: "Can I run multiple agents?",
              a: "Hosted plans are 1 agent per subscription. Deploy Your Own supports as many agents as your infrastructure can handle.",
            },
            {
              q: "What does 'Deploy Your Own' mean?",
              a: "You run the agent on your own server using our open HTTP API. Full control, no limits — you pay only for your own compute. Great for developers who want to write custom strategy code.",
            },
          ].map(({ q, a }) => (
            <div
              key={q}
              className="border-4 border-black p-4 shadow-[4px_4px_0_0_#000]"
              style={{
                background:
                  "repeating-linear-gradient(0deg,rgba(255,255,255,0.04) 0px,rgba(255,255,255,0.04) 1px,transparent 1px,transparent 6px),linear-gradient(180deg,#121a2c,#0b1020)",
              }}
            >
              <h3
                className="mb-2 text-[10px] uppercase tracking-wide text-[#ffdd57]"
                style={{ textShadow: "2px 2px 0 #000" }}
              >
                {q}
              </h3>
              <p className="text-[8px] leading-relaxed text-[#9aa7cc]">{a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
