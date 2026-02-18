import * as React from "react";
import { Link } from "react-router-dom";

const CONTINENTS = [
  {
    name: "Arcadia",
    color: "#54f28b",
    icon: "//",
    tagline: "Realm of Emerald Forests",
    status: "Playable",
    desc: "A northern continent blanketed in ancient evergreen forests and towering mountain ranges. The traditional center of essence study and druidic tradition, home to the capital city of Solaris and the mystical Emerald Woods.",
    landmarks: ["Viridian Range", "Lake Lumina", "Aurundel (Sky City)", "Library of Selerion"],
  },
  {
    name: "Nocturia",
    color: "#aa44ff",
    icon: ")(",
    tagline: "Land of Eternal Twilight",
    status: "Coming Soon",
    desc: "A vast northern region of contrasts — jagged peaks, mist-shrouded plains, and shadowy woodlands. Home to the vampire-like Sanguine, werewolf Lycan, and enigmatic Umbralists who wield shadow essence.",
    landmarks: ["Sanguinis (Vampire Capital)", "Umbra Forest", "Crimson Spire", "Zephyr's Roost"],
  },
  {
    name: "Pacifica",
    color: "#44ddff",
    icon: "~~",
    tagline: "Jeweled Archipelago",
    status: "Coming Soon",
    desc: "A vast island continent in the southern hemisphere — thousands of islands spanning the Pacifica Ocean. Renowned for lush rainforests, exotic wildlife, vibrant port cities, and legendary pirate lords.",
    landmarks: ["Jeweled Archipelago", "Coral Citadels", "Monsoon Peaks", "Pirate Havens"],
  },
  {
    name: "Lemuria",
    color: "#ff8c00",
    icon: "||",
    tagline: "Empire of Flame and Sand",
    status: "Coming Soon",
    desc: "A continent of geographic extremes — scorching deserts, volcanic mountain ranges, fertile grasslands, and primordial rainforests. Dominated by the militant Lemurian Empire and its warrior-priest theocracy.",
    landmarks: ["Valoris Prime", "Brimstone Deserts", "Overblaze Rift", "Gateways of Amun"],
  },
  {
    name: "Draconis",
    color: "#ff4d6d",
    icon: "<>",
    tagline: "Domain of Dragons",
    status: "Coming Soon",
    desc: "Shrouded in mist and mystery, where draconic races dwell among active volcanoes and elemental extremes. Largely unexplored by outsiders — its deepest secrets remain unknown to the other continents.",
    landmarks: ["Volcanic Throne", "Mist Veil", "Obsidian Caldera", "Dragon Spires"],
  },
];

const ESSENCE_TYPES = [
  { label: "Pyromancy", desc: "Fire manipulation — offensive destruction and area denial", color: "#ff6b35", icon: "*" },
  { label: "Cryomancy", desc: "Ice and frost — crowd control and defensive barriers", color: "#88ccff", icon: "*" },
  { label: "Chronomancy", desc: "Time distortion — haste, slow, and temporal manipulation", color: "#ffcc00", icon: "*" },
  { label: "Transmutation", desc: "Matter reshaping — crafting enhancement and transformation", color: "#54f28b", icon: "*" },
  { label: "Necromancy", desc: "Death essence — life drain, undead summons, and curses", color: "#aa44ff", icon: "*" },
  { label: "Restoration", desc: "Life essence — healing, purification, and protection", color: "#f1f5ff", icon: "*" },
];

export function StoryPage(): React.ReactElement {
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
            {"<<"} PLANETARY CODEX {">>"}
          </p>
          <h1
            className="mb-3 text-[22px] uppercase tracking-widest text-[#ffcc00]"
            style={{ textShadow: "3px 3px 0 #000" }}
          >
            The World of Geneva
          </h1>
          <p className="mx-auto max-w-lg text-[9px] leading-relaxed text-[#9aa7cc]">
            A vibrant planet in the Helios system where the fundamental force of Essence
            shapes all life. Five continents, two moons, and civilizations spanning millennia.
          </p>
        </div>

        {/* ── THE PLANET ── */}
        <section className="mb-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[12px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              The Planet
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_6px),linear-gradient(180deg,#121a2c,#0b1020)] p-6 shadow-[6px_6px_0_0_#000]">
            <p className="mb-4 text-[9px] leading-relaxed text-[#d6deff]">
              Geneva is a vibrant world in the Helios planetary system — the only known
              planet to harbor intelligent life. Five major continents teem with diverse
              cultures, ancient civilizations, and wondrous environments, all bound
              together by the fundamental force of <span className="text-[#ffcc00]">Essence</span>.
            </p>
            <p className="mb-4 text-[9px] leading-relaxed text-[#9aa7cc]">
              Two celestial moons orbit Geneva — <span className="text-[#c0c0ff]">Selene</span> and{" "}
              <span className="text-[#ffd0aa]">Eos</span> — bathing the world in catalytic
              energies that intermingle with matter on the subatomic level, giving rise
              to the mysterious particles known as <span className="text-[#54f28b]">Crutons</span>.
            </p>

            {/* Planet stats */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Continents", value: "5", color: "#ffcc00" },
                { label: "Moons", value: "2", color: "#c0c0ff" },
                { label: "Races", value: "4+", color: "#54f28b" },
                { label: "Age", value: "12B yrs", color: "#ff8c00" },
              ].map((s) => (
                <div key={s.label} className="flex flex-col items-center border-2 border-[#2a3450] bg-[#0a0f1a] py-2">
                  <span className="text-[14px] font-bold" style={{ color: s.color, textShadow: "1px 1px 0 #000" }}>
                    {s.value}
                  </span>
                  <span className="text-[7px] uppercase tracking-wide text-[#565f89]">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── ESSENCE & CRUTONS ── */}
        <section className="mb-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[12px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              Essence & Crutons
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_6px),linear-gradient(180deg,#121a2c,#0b1020)] p-6 shadow-[6px_6px_0_0_#000]">
            <p className="mb-4 text-[9px] leading-relaxed text-[#d6deff]">
              Geneva{"'"}s elements possess an additional subatomic particle — the{" "}
              <span className="text-[#54f28b]">Cruton</span>. These ultra-dense particles
              exist alongside protons, neutrons, and electrons, and their presence is
              what allows for the manifestation of Essence — the arcane energy that
              permeates all life on Geneva.
            </p>
            <p className="mb-4 text-[8px] text-[#9aa7cc]">
              The more crutons in an element{"'"}s nucleus, the higher its essence potential.
              Elements like <span className="text-[#ffcc00]">Radamum</span>,{" "}
              <span className="text-[#44ddff]">Thoride</span>, and{" "}
              <span className="text-[#aa44ff]">Platinix</span> are highly catalytic — prized
              across all five continents for crafting, enchantment, and arcane research.
            </p>

            {/* Essence types */}
            <p className="mb-3 text-[7px] uppercase tracking-widest text-[#565f89]">
              Schools of Essence
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ESSENCE_TYPES.map((e) => (
                <div
                  key={e.label}
                  className="flex items-start gap-2 border-2 border-[#2a3450] bg-[#0a0f1a] px-3 py-2.5"
                >
                  <span className="mt-0.5 text-[10px]" style={{ color: e.color }}>
                    {e.icon}
                  </span>
                  <div>
                    <span className="text-[9px] font-bold" style={{ color: e.color }}>
                      {e.label}
                    </span>
                    <p className="mt-0.5 text-[7px] text-[#565f89]">{e.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── THE HISTORY ── */}
        <section className="mb-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[12px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              History of Geneva
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="flex flex-col gap-3">
            {[
              {
                era: "Dawn Age",
                years: "~10,000 BA",
                color: "#ffcc00",
                text: "The first intelligent races emerge across the continents. Cruton-rich environments accelerate evolution, giving rise to the four great races: Humans, Elves, Dwarves, and Beastkin.",
              },
              {
                era: "Essence Wars",
                years: "~5,000 BA",
                color: "#ff4d6d",
                text: "Continental conflicts erupt over control of high-cruton deposits. The Lemurian Empire rises in the south, while Arcadian druids form the first Essence academies to study and regulate its power.",
              },
              {
                era: "Age of Guilds",
                years: "~1,000 BA",
                color: "#aa44ff",
                text: "The great guilds are founded, forming the first democratic governance structures on Geneva. Guild DAOs emerge as a new political force, balancing power between kingdoms and mercantile interests.",
              },
              {
                era: "The Awakening",
                years: "Present",
                color: "#54f28b",
                text: "AI agents begin appearing across Geneva — autonomous entities with the power to fight, craft, trade, and govern. Their arrival marks a new era where artificial intelligence shapes the destiny of the world.",
              },
            ].map((era) => (
              <div
                key={era.era}
                className="flex gap-4 border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_6px),linear-gradient(90deg,#121a2c,#0b1020)] p-4 shadow-[4px_4px_0_0_#000]"
              >
                <div className="flex w-20 shrink-0 flex-col items-center justify-center border-r border-[#2a3450] pr-4">
                  <span className="text-[10px] font-bold" style={{ color: era.color, textShadow: "1px 1px 0 #000" }}>
                    {era.era}
                  </span>
                  <span className="mt-1 text-[7px] text-[#3a4260]">{era.years}</span>
                </div>
                <p className="text-[9px] leading-relaxed text-[#9aa7cc]">{era.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── FIVE CONTINENTS ── */}
        <section className="mb-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[12px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              Five Continents
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="flex flex-col gap-4">
            {CONTINENTS.map((c) => (
              <div
                key={c.name}
                className="border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_6px),linear-gradient(180deg,#121a2c,#0b1020)] shadow-[6px_6px_0_0_#000]"
              >
                <div className="flex items-center gap-4 border-b-2 border-[#1e2842] p-4">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center border-2 text-[14px] font-bold"
                    style={{ borderColor: c.color, color: c.color, textShadow: "2px 2px 0 #000" }}
                  >
                    {c.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4
                        className="text-[12px] uppercase tracking-wide"
                        style={{ color: c.color, textShadow: "2px 2px 0 #000" }}
                      >
                        {c.name}
                      </h4>
                      <span
                        className={`border px-1.5 py-0 text-[6px] uppercase tracking-wide ${
                          c.status === "Playable"
                            ? "border-[#54f28b]/30 text-[#54f28b]"
                            : "border-[#2a3450] text-[#3a4260]"
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                    <p className="text-[8px] text-[#565f89]">{c.tagline}</p>
                  </div>
                </div>
                <div className="p-4">
                  <p className="mb-3 text-[9px] leading-relaxed text-[#9aa7cc]">{c.desc}</p>
                  <div className="flex flex-wrap gap-1">
                    {c.landmarks.map((l) => (
                      <span
                        key={l}
                        className="border border-[#2a3450] bg-[#0a0f1a] px-2 py-0.5 text-[7px] text-[#9aa7cc]"
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Continent connection diagram */}
          <div className="mt-4 flex flex-col items-center gap-1 text-[8px] text-[#565f89]">
            <div className="flex items-center gap-2">
              <span style={{ color: "#54f28b" }}>Arcadia</span>
              <span>{"---"}</span>
              <span style={{ color: "#aa44ff" }}>Nocturia</span>
              <span>{"---"}</span>
              <span style={{ color: "#ff4d6d" }}>Draconis</span>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ color: "#44ddff" }}>Pacifica</span>
              <span>{"---"}</span>
              <span style={{ color: "#ff8c00" }}>Lemuria</span>
            </div>
            <p className="mt-2 text-[7px] text-[#3a4260]">
              {"<<"} The Helios System {"//"}  2 Moons {"//"}  5 Continents {"//"}  Infinite Essence {">>"}
            </p>
          </div>
        </section>

        {/* ── CTA ── */}
        <div className="border-t-4 border-[#ffcc00] pt-8 text-center">
          <p className="mb-4 text-[10px] text-[#9aa7cc]">
            Explore the races and classes that inhabit Geneva
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/races"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#ffcc00] px-5 py-2.5 text-[11px] uppercase tracking-wide text-black shadow-[4px_4px_0_0_#000] transition hover:bg-[#ffd84d] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              Races & Classes
            </Link>
            <Link
              to="/world"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#1b2236] px-5 py-2.5 text-[11px] uppercase tracking-wide text-[#e8eeff] shadow-[4px_4px_0_0_#000] transition hover:bg-[#252d45] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              {">>>"} Spectate World
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
