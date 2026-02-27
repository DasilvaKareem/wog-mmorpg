import * as React from "react";
import { useGameBridge } from "@/hooks/useGameBridge";
import type { Entity } from "@/types";

/* ── 8-bit retro palette (matches InspectDialog) ──────────── */
const BG = "#11182b";
const BORDER = "#29334d";
const TEXT = "#f1f5ff";
const DIM = "#6b7a9e";
const ACCENT = "#54f28b";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── NPC role metadata ─────────────────────────────────────── */
interface NpcRoleInfo {
  title: string;
  icon: string;
  color: string;
  description: (entity: Entity) => string;
  details: (entity: Entity) => string[];
}

const NPC_ROLES: Record<string, NpcRoleInfo> = {
  "quest-giver": {
    title: "Quest Giver",
    icon: "!",
    color: "#f2c854",
    description: () => "Offers quests and adventures to those brave enough to accept. Complete quests to earn gold and experience.",
    details: () => [
      "Talk to this NPC to view available quests",
      "Quests reward gold, XP, and sometimes items",
      "Some quests unlock access to new areas",
    ],
  },
  trainer: {
    title: "Combat Trainer",
    icon: "T",
    color: "#f25454",
    description: (e) =>
      e.teachesClass
        ? `A master ${capitalize(e.teachesClass)} trainer who can teach powerful combat techniques.`
        : "A combat trainer who teaches fighting techniques to aspiring warriors.",
    details: (e) => {
      const lines = [
        "Teaches combat techniques for gold",
        "Higher-level techniques require more training",
      ];
      if (e.teachesClass) lines.unshift(`Specializes in ${capitalize(e.teachesClass)} techniques`);
      return lines;
    },
  },
  "profession-trainer": {
    title: "Profession Trainer",
    icon: "P",
    color: "#54f28b",
    description: (e) =>
      e.teachesProfession
        ? `A skilled ${capitalize(e.teachesProfession)} trainer who can teach gathering and crafting skills.`
        : "A profession trainer who teaches trade skills to those seeking a livelihood.",
    details: (e) => {
      const lines = [
        "Learn and improve profession skills",
        "Profession skills level up from 1 to 300",
        "Higher skill unlocks better recipes and nodes",
      ];
      if (e.teachesProfession) lines.unshift(`Teaches ${capitalize(e.teachesProfession)}`);
      return lines;
    },
  },
  "lore-npc": {
    title: "Lore Keeper",
    icon: "L",
    color: "#5dadec",
    description: () => "A keeper of ancient knowledge and history. Speaks of the lands, creatures, and legends of Arcadia.",
    details: () => [
      "Shares stories and world lore",
      "May reveal hints about hidden areas",
      "Knowledge of the world's history and secrets",
    ],
  },
  "crafting-master": {
    title: "Crafting Master",
    icon: "C",
    color: "#b48efa",
    description: () => "An expert artisan who oversees the crafting stations. Provides guidance on creating powerful items.",
    details: () => [
      "Access to advanced crafting stations",
      "Can craft weapons, armor, and enchantments",
      "Requires raw materials gathered from the world",
    ],
  },
  forge: {
    title: "Forge",
    icon: "#",
    color: "#f2a854",
    description: () => "A blazing forge for smithing weapons and armor from raw metals and ores.",
    details: () => [
      "Craft weapons and heavy armor",
      "Requires Mining materials (ores, ingots)",
      "Higher Crafting skill unlocks better recipes",
    ],
  },
  "alchemy-lab": {
    title: "Alchemy Lab",
    icon: "%",
    color: "#54f28b",
    description: () => "A bubbling alchemy laboratory for brewing potions, elixirs, and transmutations.",
    details: () => [
      "Brew healing and buff potions",
      "Requires Herbalism materials (herbs, reagents)",
      "Higher Alchemy skill unlocks potent recipes",
    ],
  },
  "enchanting-altar": {
    title: "Enchanting Altar",
    icon: "*",
    color: "#b48efa",
    description: () => "A mystical altar pulsing with arcane energy, used to imbue equipment with magical properties.",
    details: () => [
      "Enchant weapons and armor with stat bonuses",
      "Requires enchanting materials and essences",
      "Higher Enchanting skill unlocks stronger effects",
    ],
  },
  "tanning-rack": {
    title: "Tanning Rack",
    icon: "=",
    color: "#c8a86e",
    description: () => "A sturdy rack for curing hides and leathers into wearable materials.",
    details: () => [
      "Craft leather armor and accessories",
      "Requires Skinning materials (hides, pelts)",
      "Higher Leatherworking skill unlocks better gear",
    ],
  },
  "jewelers-bench": {
    title: "Jeweler's Bench",
    icon: "o",
    color: "#5dadec",
    description: () => "A precision workbench for cutting gems and crafting fine jewelry.",
    details: () => [
      "Craft rings, amulets, and gem upgrades",
      "Requires Mining materials (gems, precious metals)",
      "Higher Jewelcrafting skill unlocks rare pieces",
    ],
  },
  campfire: {
    title: "Campfire",
    icon: "~",
    color: "#f2a854",
    description: () => "A crackling campfire where travelers can cook food from gathered ingredients.",
    details: () => [
      "Cook food that restores HP and grants buffs",
      "Requires ingredients from gathering or shops",
      "Higher Cooking skill unlocks better meals",
    ],
  },
  "essence-forge": {
    title: "Essence Forge",
    icon: "E",
    color: "#b48efa",
    description: () => "A forge infused with raw essence energy, used to create unique signature and ultimate techniques.",
    details: () => [
      "Create powerful essence techniques",
      "Requires essence materials from combat",
      "Techniques are unique to each character",
    ],
  },
};

const FALLBACK_ROLE: NpcRoleInfo = {
  title: "NPC",
  icon: "?",
  color: DIM,
  description: () => "A denizen of the world.",
  details: () => [],
};

/* ── Main Component ───────────────────────────────────────── */
export function NpcInfoDialog(): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const [entity, setEntity] = React.useState<Entity | null>(null);

  useGameBridge("npcInfoClick", (npc) => {
    setEntity(npc);
    setOpen(true);
  });

  if (!open || !entity) return null;

  const role = NPC_ROLES[entity.type] ?? FALLBACK_ROLE;
  const description = role.description(entity);
  const details = role.details(entity);

  return (
    <div
      className="fixed z-50 border-2 shadow-2xl select-none"
      style={{
        background: BG,
        borderColor: BORDER,
        fontFamily: "monospace",
        color: TEXT,
        width: 320,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        maxHeight: "80vh",
        overflow: "auto",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center border-2 text-sm font-bold"
            style={{
              width: 28,
              height: 28,
              borderColor: role.color,
              color: role.color,
              background: "#0a1020",
            }}
          >
            {role.icon}
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: TEXT }}>{entity.name}</div>
            <div className="text-[10px] font-bold uppercase" style={{ color: role.color }}>
              {role.title}
            </div>
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-xs font-bold px-2 py-0.5 border"
          style={{ borderColor: BORDER, color: DIM, background: "transparent", cursor: "pointer" }}
        >
          X
        </button>
      </div>

      {/* Specialization badge */}
      {(entity.teachesClass || entity.teachesProfession) && (
        <div className="px-3 py-1.5 border-b" style={{ borderColor: BORDER }}>
          <div
            className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 border"
            style={{
              borderColor: role.color,
              color: role.color,
              background: "#0d1628",
            }}
          >
            {entity.teachesClass && `${capitalize(entity.teachesClass)} Specialist`}
            {entity.teachesProfession && `${capitalize(entity.teachesProfession)} Master`}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="px-3 py-2 border-b" style={{ borderColor: BORDER }}>
        <div className="text-[11px] leading-relaxed" style={{ color: DIM }}>
          {description}
        </div>
      </div>

      {/* Details */}
      {details.length > 0 && (
        <div className="px-3 py-2 border-b" style={{ borderColor: BORDER }}>
          <div className="text-[10px] font-bold uppercase mb-1.5" style={{ color: ACCENT }}>
            Services
          </div>
          <div className="space-y-1">
            {details.map((line, i) => (
              <div key={i} className="flex gap-1.5 text-[11px]">
                <span style={{ color: role.color }}>{">"}</span>
                <span style={{ color: TEXT }}>{line}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Location */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 text-[10px]" style={{ color: DIM }}>
          <span>Position: ({Math.round(entity.x)}, {Math.round(entity.y)})</span>
          {entity.zoneId && <span>| {entity.zoneId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</span>}
        </div>
      </div>
    </div>
  );
}
