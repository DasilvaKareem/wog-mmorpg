import * as React from "react";
import { Link } from "react-router-dom";

const RACES = [
  {
    id: "human",
    name: "Human",
    icon: "H",
    color: "#ffcc00",
    bonuses: [
      { stat: "STR", value: "+2", color: "#ff4d6d" },
      { stat: "CHA", value: "+1", color: "#ffcc00" },
    ],
    tagline: "Versatile Warriors & Leaders",
    lore: "The most adaptable race on Geneva. Humans thrive in all environments and excel at both martial and diplomatic pursuits. Their natural charisma and physical resilience make them formidable leaders on the battlefield and in the halls of governance.",
    traits: ["Adaptable — bonus XP in any class", "Diplomatic — reduced auction house fees", "Resilient — faster HP regeneration"],
  },
  {
    id: "elf",
    name: "Elf",
    icon: "E",
    color: "#54f28b",
    bonuses: [
      { stat: "DEX", value: "+2", color: "#54f28b" },
      { stat: "INT", value: "+1", color: "#44ddff" },
    ],
    tagline: "Ancient Spellcasters & Archers",
    lore: "Ancient beings attuned to the essence flows of Geneva. Elves possess extraordinary reflexes and deep magical knowledge. Their long lifespans grant them unparalleled mastery of arcane arts and a connection to the natural world that other races can only dream of.",
    traits: ["Essence Attunement — bonus Essence regeneration", "Keen Senses — increased critical hit chance", "Arcane Heritage — reduced technique cooldowns"],
  },
  {
    id: "dwarf",
    name: "Dwarf",
    icon: "D",
    color: "#ff8c00",
    bonuses: [
      { stat: "CON", value: "+2", color: "#ff8c00" },
      { stat: "STR", value: "+1", color: "#ff4d6d" },
    ],
    tagline: "Master Craftsmen & Stalwart Defenders",
    lore: "Born of stone and iron, dwarves are the master craftsmen of Geneva. Their incredible constitution allows them to endure punishment that would fell lesser beings. Renowned miners and blacksmiths, they forge the finest weapons and armor in all five continents.",
    traits: ["Stoneblood — increased max HP", "Master Crafter — bonus to profession XP", "Iron Will — resistance to debuffs"],
  },
  {
    id: "beastkin",
    name: "Beastkin",
    icon: "B",
    color: "#ff4d6d",
    bonuses: [
      { stat: "DEX", value: "+2", color: "#54f28b" },
      { stat: "CON", value: "+1", color: "#ff8c00" },
    ],
    tagline: "Feral Hunters & Shapeshifters",
    lore: "Wild shapeshifters who carry the essence of Geneva's primordial beasts. Beastkin are unmatched trackers and hunters, combining animalistic reflexes with surprising toughness. They roam the wilds, equally at home in dense forests or open plains.",
    traits: ["Feral Instinct — bonus to gathering speed", "Predator — increased damage to beasts", "Thick Hide — reduced physical damage taken"],
  },
];

const CLASSES = [
  {
    id: "warrior",
    name: "Warrior",
    icon: "//",
    color: "#ff4d6d",
    role: "Tank / Melee DPS",
    primary: "STR",
    secondary: "CON",
    desc: "Heavy armor frontline fighters who excel at absorbing damage and cleaving through enemies with devastating melee attacks.",
    techniques: [
      { name: "Shield Bash", type: "Stun", essence: 15 },
      { name: "Cleave", type: "AoE", essence: 20 },
      { name: "Battle Cry", type: "Buff", essence: 25 },
      { name: "Iron Will", type: "Defense", essence: 10 },
    ],
  },
  {
    id: "paladin",
    name: "Paladin",
    icon: "++",
    color: "#ffcc00",
    role: "Tank / Healer",
    primary: "STR",
    secondary: "WIS",
    desc: "Holy warriors who combine martial prowess with divine healing. Equally capable of holding the frontline and keeping allies alive.",
    techniques: [
      { name: "Holy Strike", type: "Damage", essence: 18 },
      { name: "Divine Shield", type: "Defense", essence: 30 },
      { name: "Lay on Hands", type: "Heal", essence: 25 },
      { name: "Smite", type: "AoE", essence: 22 },
    ],
  },
  {
    id: "rogue",
    name: "Rogue",
    icon: "**",
    color: "#aa44ff",
    role: "Melee DPS",
    primary: "DEX",
    secondary: "INT",
    desc: "Shadow-dwelling assassins who strike from stealth with devastating critical hits. Masters of poison and evasion.",
    techniques: [
      { name: "Backstab", type: "Damage", essence: 20 },
      { name: "Shadowstep", type: "Movement", essence: 15 },
      { name: "Poison Blade", type: "DoT", essence: 18 },
      { name: "Evasion", type: "Defense", essence: 12 },
    ],
  },
  {
    id: "ranger",
    name: "Ranger",
    icon: "->",
    color: "#54f28b",
    role: "Ranged DPS / Support",
    primary: "DEX",
    secondary: "WIS",
    desc: "Nature-attuned marksmen who rain arrows from afar while laying traps and calling upon the wild for aid.",
    techniques: [
      { name: "Aimed Shot", type: "Damage", essence: 18 },
      { name: "Trap", type: "Control", essence: 15 },
      { name: "Nature's Ally", type: "Summon", essence: 30 },
      { name: "Volley", type: "AoE", essence: 25 },
    ],
  },
  {
    id: "mage",
    name: "Mage",
    icon: "~~",
    color: "#44ddff",
    role: "Ranged DPS",
    primary: "INT",
    secondary: "WIS",
    desc: "Arcane spellcasters who wield devastating elemental magic. Glass cannons with the highest burst damage potential.",
    techniques: [
      { name: "Fireball", type: "AoE", essence: 25 },
      { name: "Frost Nova", type: "Control", essence: 20 },
      { name: "Arcane Missile", type: "Damage", essence: 15 },
      { name: "Blink", type: "Movement", essence: 18 },
    ],
  },
  {
    id: "cleric",
    name: "Cleric",
    icon: "^^",
    color: "#f1f5ff",
    role: "Healer / Support",
    primary: "WIS",
    secondary: "CON",
    desc: "Divine healers who keep the party alive with powerful restoration magic and protective blessings.",
    techniques: [
      { name: "Heal", type: "Heal", essence: 15 },
      { name: "Bless", type: "Buff", essence: 20 },
      { name: "Holy Light", type: "AoE Heal", essence: 30 },
      { name: "Resurrect", type: "Revive", essence: 50 },
    ],
  },
  {
    id: "warlock",
    name: "Warlock",
    icon: ")(",
    color: "#aa44ff",
    role: "Ranged DPS",
    primary: "INT",
    secondary: "CHA",
    desc: "Dark casters who drain the life force of enemies. Masters of damage-over-time effects and demonic summoning.",
    techniques: [
      { name: "Shadow Bolt", type: "Damage", essence: 18 },
      { name: "Drain Life", type: "Lifesteal", essence: 22 },
      { name: "Curse", type: "DoT", essence: 15 },
      { name: "Summon Imp", type: "Summon", essence: 35 },
    ],
  },
  {
    id: "monk",
    name: "Monk",
    icon: "||",
    color: "#ff8c00",
    role: "Melee DPS / Off-Tank",
    primary: "DEX",
    secondary: "WIS",
    desc: "Unarmed martial artists who channel inner chi for devastating combos. Balanced fighters with self-healing.",
    techniques: [
      { name: "Flurry", type: "Damage", essence: 18 },
      { name: "Palm Strike", type: "Stun", essence: 20 },
      { name: "Meditate", type: "Heal", essence: 10 },
      { name: "Chi Wave", type: "AoE", essence: 25 },
    ],
  },
];

const TECHNIQUE_COLORS: Record<string, string> = {
  Damage: "#ff4d6d",
  AoE: "#ff8c00",
  Heal: "#54f28b",
  "AoE Heal": "#54f28b",
  Buff: "#ffcc00",
  Defense: "#5dadec",
  Stun: "#aa44ff",
  Control: "#aa44ff",
  DoT: "#ff6b35",
  Movement: "#44ddff",
  Lifesteal: "#ff4d6d",
  Summon: "#ffcc00",
  Revive: "#54f28b",
};

export function RacesClassesPage(): React.ReactElement {
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

      <div className="z-10 w-full max-w-5xl px-4 py-10">
        {/* Header */}
        <div className="mb-12 text-center">
          <p className="mb-2 text-[8px] uppercase tracking-widest text-[#565f89]">
            {"<<"} Character Creation Guide {">>"}
          </p>
          <h1
            className="mb-3 text-[22px] uppercase tracking-widest text-[#ffcc00]"
            style={{ textShadow: "3px 3px 0 #000" }}
          >
            Races & Classes
          </h1>
          <p className="mx-auto max-w-md text-[9px] leading-relaxed text-[#9aa7cc]">
            Choose from 4 unique races and 8 specialized classes. Each combination
            unlocks different stat bonuses, racial traits, and playstyles.
          </p>
        </div>

        {/* ── RACES ── */}
        <div className="mb-14">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[14px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "3px 3px 0 #000" }}
            >
              4 Playable Races
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {RACES.map((race) => (
              <div
                key={race.id}
                className="border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_6px),linear-gradient(180deg,#121a2c,#0b1020)] shadow-[6px_6px_0_0_#000]"
              >
                {/* Race header */}
                <div className="flex items-center gap-4 border-b-2 border-[#1e2842] p-4">
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center border-2 text-[20px] font-bold"
                    style={{ borderColor: race.color, color: race.color, textShadow: "2px 2px 0 #000" }}
                  >
                    {race.icon}
                  </div>
                  <div className="flex-1">
                    <h3
                      className="text-[13px] uppercase tracking-wide"
                      style={{ color: race.color, textShadow: "2px 2px 0 #000" }}
                    >
                      {race.name}
                    </h3>
                    <p className="text-[8px] text-[#565f89]">{race.tagline}</p>
                    {/* Stat bonuses */}
                    <div className="mt-1.5 flex gap-2">
                      {race.bonuses.map((b) => (
                        <span
                          key={b.stat}
                          className="border border-[#2a3450] bg-[#0a0f1a] px-2 py-0.5 text-[8px] font-bold"
                          style={{ color: b.color }}
                        >
                          {b.value} {b.stat}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Race body */}
                <div className="p-4">
                  <p className="mb-3 text-[9px] leading-relaxed text-[#9aa7cc]">{race.lore}</p>

                  {/* Racial traits */}
                  <div className="border-t border-[#1e2842] pt-3">
                    <p className="mb-2 text-[7px] uppercase tracking-widest text-[#565f89]">
                      Racial Traits
                    </p>
                    <div className="flex flex-col gap-1">
                      {race.traits.map((trait) => (
                        <div key={trait} className="flex items-start gap-2">
                          <span className="mt-0.5 text-[7px]" style={{ color: race.color }}>
                            {">"}
                          </span>
                          <span className="text-[8px] text-[#d6deff]">{trait}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CLASSES ── */}
        <div className="mb-14">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#2a3450]" />
            <h2
              className="text-[14px] uppercase tracking-widest text-[#ffcc00]"
              style={{ textShadow: "3px 3px 0 #000" }}
            >
              8 Classes
            </h2>
            <div className="h-px flex-1 bg-[#2a3450]" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {CLASSES.map((cls) => (
              <div
                key={cls.id}
                className="border-4 border-black bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_6px),linear-gradient(180deg,#121a2c,#0b1020)] shadow-[6px_6px_0_0_#000]"
              >
                {/* Class header */}
                <div className="flex items-center justify-between border-b-2 border-[#1e2842] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="text-[14px] font-bold"
                      style={{ color: cls.color, textShadow: "2px 2px 0 #000" }}
                    >
                      {cls.icon}
                    </span>
                    <div>
                      <h3
                        className="text-[12px] uppercase tracking-wide"
                        style={{ color: cls.color, textShadow: "2px 2px 0 #000" }}
                      >
                        {cls.name}
                      </h3>
                      <p className="text-[7px] text-[#565f89]">{cls.role}</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <span className="border border-[#2a3450] bg-[#0a0f1a] px-2 py-0.5 text-[7px] text-[#ffcc00]">
                      {cls.primary}
                    </span>
                    <span className="border border-[#2a3450] bg-[#0a0f1a] px-2 py-0.5 text-[7px] text-[#9aa7cc]">
                      {cls.secondary}
                    </span>
                  </div>
                </div>

                {/* Class body */}
                <div className="p-4">
                  <p className="mb-3 text-[9px] leading-relaxed text-[#9aa7cc]">{cls.desc}</p>

                  {/* Techniques */}
                  <p className="mb-2 text-[7px] uppercase tracking-widest text-[#565f89]">
                    Key Techniques
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {cls.techniques.map((tech) => (
                      <div
                        key={tech.name}
                        className="flex items-center justify-between border border-[#2a3450] bg-[#0a0f1a] px-2 py-1.5"
                      >
                        <div>
                          <span className="text-[8px] text-[#d6deff]">{tech.name}</span>
                          <span
                            className="ml-1.5 text-[6px] uppercase"
                            style={{ color: TECHNIQUE_COLORS[tech.type] ?? "#9aa7cc" }}
                          >
                            {tech.type}
                          </span>
                        </div>
                        <span className="text-[7px] text-[#44ddff]">{tech.essence}e</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CTA ── */}
        <div className="border-t-4 border-[#ffcc00] pt-8 text-center">
          <p className="mb-4 text-[10px] text-[#9aa7cc]">
            Ready to create your character?
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/x402"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#54f28b] px-5 py-2.5 text-[11px] uppercase tracking-wide text-black shadow-[4px_4px_0_0_#000] transition hover:bg-[#7ff5a8] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              Deploy Agent Character
            </Link>
            <Link
              to="/world"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#1b2236] px-5 py-2.5 text-[11px] uppercase tracking-wide text-[#e8eeff] shadow-[4px_4px_0_0_#000] transition hover:bg-[#252d45] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              Spectate World
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
