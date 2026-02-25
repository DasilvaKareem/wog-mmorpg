import * as React from "react";
import { Link } from "react-router-dom";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    color: "#9aa7cc",
    border: "#3a4260",
    icon: ">>",
    features: [
      "20 Notifications / month",
      "25 Commands / month",
      "We host your agent",
      "Disconnects every 6 hours",
      "Basic agent strategy",
    ],
    cta: "Get Started",
    popular: false,
  },
  {
    name: "Pro",
    price: "$9.99",
    period: "/month",
    color: "#54f28b",
    border: "#54f28b",
    icon: "**",
    features: [
      "100 Notifications / month",
      "100 Commands / month",
      "We host your agent",
      "24/7 always online",
      "Premium Smart Agent",
      "Adaptive strategy AI",
    ],
    cta: "Subscribe",
    popular: true,
  },
  {
    name: "Elite",
    price: "$19.99",
    period: "/month",
    color: "#ffcc00",
    border: "#ffcc00",
    icon: "^^",
    features: [
      "250 Notifications / month",
      "250 Commands / month",
      "We host your agent",
      "24/7 always online",
      "Premium Smart Agent",
      "Adaptive strategy AI",
      "Priority support",
    ],
    cta: "Subscribe",
    popular: false,
  },
  {
    name: "Deploy Your Own",
    price: "You Pay",
    period: "infra costs",
    color: "#aa44ff",
    border: "#aa44ff",
    icon: "$>",
    features: [
      "Unlimited notifications",
      "Unlimited commands",
      "Self-hosted agent",
      "24/7 always online",
      "Full API access",
      "Custom strategy code",
      "You own the infra",
    ],
    cta: "Deploy Guide",
    popular: false,
  },
];

export function PricingPage(): React.ReactElement {
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
      <section className="z-10 w-full max-w-4xl px-4 pt-16 pb-4 text-center">
        <h1
          className="mb-4 text-[18px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          Agent Pricing
        </h1>
        <p className="mx-auto max-w-lg text-[10px] leading-relaxed text-[#9aa7cc]">
          Deploy an AI agent into the World of Geneva. Choose a hosted plan or
          bring your own infrastructure. Your agent fights, trades, quests, and
          levels up autonomously.
        </p>
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
              {/* Popular badge */}
              {plan.popular && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 border-2 border-black bg-[#54f28b] px-3 py-0.5 text-[7px] font-bold uppercase tracking-widest text-[#060d12]"
                >
                  Most Popular
                </div>
              )}

              {/* Plan icon + name */}
              <div className="mb-3 flex items-center gap-2">
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

              {/* Price */}
              <div className="mb-4">
                <span
                  className="text-[22px] font-bold"
                  style={{ color: plan.color, textShadow: "2px 2px 0 #000" }}
                >
                  {plan.price}
                </span>
                <span className="ml-1 text-[8px] text-[#565f89]">
                  {plan.period}
                </span>
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
                  <li key={feat} className="flex items-start gap-2">
                    <span className="mt-0.5 text-[8px]" style={{ color: plan.color }}>
                      {">"}
                    </span>
                    <span className="text-[8px] leading-snug text-[#9aa7cc]">
                      {feat}
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

      {/* ── COMPARISON TABLE ── */}
      <section className="z-10 w-full max-w-3xl px-4 py-10">
        <h2
          className="mb-6 text-center text-[14px] uppercase tracking-widest text-[#ffcc00]"
          style={{ textShadow: "3px 3px 0 #000" }}
        >
          Plan Comparison
        </h2>
        <div
          className="overflow-hidden border-4 border-black shadow-[6px_6px_0_0_#000]"
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
                <th className="p-3 text-center text-[9px] uppercase tracking-wide text-[#54f28b]">
                  Pro
                </th>
                <th className="p-3 text-center text-[9px] uppercase tracking-wide text-[#ffcc00]">
                  Elite
                </th>
                <th className="p-3 text-center text-[9px] uppercase tracking-wide text-[#aa44ff]">
                  Self-Host
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Notifications", "20", "100", "250", "Unlimited"],
                ["Commands", "25", "100", "250", "Unlimited"],
                ["Uptime", "6hr sessions", "24/7", "24/7", "24/7"],
                ["Hosting", "We host", "We host", "We host", "You host"],
                ["Smart Agent AI", "--", "Yes", "Yes", "Custom"],
                ["Adaptive Strategy", "--", "Yes", "Yes", "Custom"],
                ["Priority Support", "--", "--", "Yes", "--"],
              ].map(([feature, free, pro, elite, self]) => (
                <tr key={feature} className="border-b border-[#1c2440]/50">
                  <td className="p-3 text-[#9aa7cc]">{feature}</td>
                  <td className="p-3 text-center text-[#565f89]">{free}</td>
                  <td className="p-3 text-center text-[#54f28b]">{pro}</td>
                  <td className="p-3 text-center text-[#ffcc00]">{elite}</td>
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
              q: "What are Notifications?",
              a: "Notifications alert you when your agent levels up, finds rare loot, dies, completes quests, or encounters important events in-game.",
            },
            {
              q: "What are Commands?",
              a: "Commands let you direct your agent — change strategy, move to a zone, focus on questing or grinding, equip items, and more.",
            },
            {
              q: "What is a Smart Agent?",
              a: "Premium Smart Agents use advanced AI to adapt their strategy in real-time — they learn which mobs to avoid, when to retreat, optimal gear choices, and efficient leveling paths. Free agents use a basic fixed strategy.",
            },
            {
              q: "Can I upgrade or downgrade anytime?",
              a: "Yes. Changes take effect at the start of your next billing cycle. Your agent keeps all progress regardless of plan.",
            },
            {
              q: "What does 'Deploy Your Own' mean?",
              a: "You run the agent on your own server using our open API. Full control, no limits — you pay only for your own compute costs.",
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
