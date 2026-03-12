import * as React from "react";
import { useGameBridge } from "@/hooks/useGameBridge";
import { API_URL } from "@/config";
import type { Entity } from "@/types";
import { formatCopperString } from "@/lib/currency";
import { useWalletContext } from "@/context/WalletContext";
import { getAuthToken } from "@/lib/agentAuth";
import { colorToCss, getTechniqueVisual } from "@/lib/techniqueVisuals";
import type { TechniqueInfo } from "@/hooks/useTechniques";
import {
  TUTORIAL_MASTER_HOTKEYS,
  TUTORIAL_MASTER_INTRO,
  TUTORIAL_MASTER_SECTIONS,
  getTutorialMasterPortraitUrl,
  isTutorialMaster,
} from "@/lib/tutorialMaster";

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
        "Click 'Send Agent to Trainer' to dispatch your agent here",
        "Higher-level techniques cost more gold to learn",
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

const TUTORIAL_MASTER_ROLE: NpcRoleInfo = {
  title: "Tutorial Master",
  icon: ">>",
  color: "#ffcc00",
  description: () => TUTORIAL_MASTER_INTRO,
  details: () => [
    "Explains the core hotkeys and starter flow",
    "Points new players to quests, rankings, and agent deploy",
    "Summarizes what you can do across Geneva",
  ],
};

/* ── Technique list for trainers ──────────────────────────── */
function TrainerTechniqueList({ className }: { className: string }): React.ReactElement {
  const [techniques, setTechniques] = React.useState<TechniqueInfo[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/techniques/class/${className}`)
      .then((r) => (r.ok ? r.json() : { techniques: [] }))
      .then((data) => setTechniques(data.techniques ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [className]);

  if (loading) {
    return <div className="text-[10px]" style={{ color: DIM }}>Loading techniques...</div>;
  }

  if (techniques.length === 0) {
    return <div className="text-[10px]" style={{ color: DIM }}>No techniques found</div>;
  }

  return (
    <div className="space-y-1.5">
      {techniques.map((tech) => {
        const visual = getTechniqueVisual(tech.id, tech.type);
        const primary = colorToCss(visual.primary);
        const secondary = colorToCss(visual.secondary);
        const accent = colorToCss(visual.accent);
        return (
          <div key={tech.id} className="border p-1.5" style={{ borderColor: primary, background: "#0d1628" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="flex h-5 w-5 items-center justify-center border text-[9px] font-bold"
                  style={{ borderColor: primary, color: accent, background: "#10192d" }}
                >
                  {visual.uiGlyph}
                </span>
                <span className="text-[11px] font-bold" style={{ color: primary }}>
                  {tech.name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[8px] uppercase font-bold px-1 border" style={{ borderColor: "#1e2842", color: DIM }}>
                  Lv{tech.levelRequired}
                </span>
                <span className="text-[9px] uppercase font-bold" style={{ color: secondary }}>
                  {tech.type}
                </span>
              </div>
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: DIM }}>
              {tech.description}
            </div>
            <div className="flex gap-3 mt-0.5 text-[9px]" style={{ color: accent }}>
              <span>CD: {tech.cooldown}s</span>
              <span>ES: {tech.essenceCost}</span>
              <span>Cost: {formatCopperString(tech.copperCost ?? 0)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Agent action button ──────────────────────────────────── */
function AgentActionButton({ entity, onClose }: { entity: Entity; onClose: () => void }): React.ReactElement | null {
  const { address } = useWalletContext();
  const [status, setStatus] = React.useState<"idle" | "sending" | "ok" | "err">("idle");

  const isProfessionTrainer = entity.type === "profession-trainer" && entity.teachesProfession;
  const isClassTrainer = entity.type === "trainer";
  if (!isProfessionTrainer && !isClassTrainer) return null;

  const label = isProfessionTrainer
    ? `Learn ${capitalize(entity.teachesProfession ?? "")}`
    : "Send Agent to Trainer";
  const color = isProfessionTrainer ? "#00ff9d" : "#f25454";

  async function handleClick() {
    if (!address || status === "sending") return;
    setStatus("sending");
    try {
      const token = await getAuthToken(address);
      if (!token) { setStatus("err"); return; }
      const body: Record<string, string> = {
        entityId: entity.id,
        zoneId: (entity.zoneId as string) ?? "",
        name: entity.name,
      };
      if (isProfessionTrainer) {
        body.action = "learn-profession";
        body.profession = entity.teachesProfession ?? "";
      }
      const res = await fetch(`${API_URL}/agent/goto-npc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setStatus("ok");
        setTimeout(() => { onClose(); setStatus("idle"); }, 800);
      } else {
        setStatus("err");
        setTimeout(() => setStatus("idle"), 2000);
      }
    } catch {
      setStatus("err");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  const btnLabel = status === "sending" ? "..." : status === "ok" ? "✓ Sent!" : status === "err" ? "Error" : label;

  return (
    <div className="px-3 py-2 border-t" style={{ borderColor: BORDER }}>
      <button
        onClick={() => void handleClick()}
        disabled={!address || status === "sending"}
        className="w-full py-1.5 text-[10px] uppercase tracking-widest font-bold border-2 transition disabled:opacity-40"
        style={{
          borderColor: status === "ok" ? ACCENT : status === "err" ? "#ff4d6d" : color,
          color: status === "ok" ? ACCENT : status === "err" ? "#ff4d6d" : color,
          background: "#0a1020",
        }}
      >
        {btnLabel}
      </button>
      {!address && (
        <div className="mt-1 text-[9px] text-center" style={{ color: DIM }}>Connect wallet to send your agent</div>
      )}
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────── */
export function NpcInfoDialog(): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const [entity, setEntity] = React.useState<Entity | null>(null);
  const [imageFailed, setImageFailed] = React.useState(false);

  useGameBridge("npcInfoClick", (npc) => {
    setEntity(npc);
    setImageFailed(false);
    setOpen(true);
  });

  if (!open || !entity) return null;

  const tutorialMaster = isTutorialMaster(entity.name);
  const role = tutorialMaster ? TUTORIAL_MASTER_ROLE : (NPC_ROLES[entity.type] ?? FALLBACK_ROLE);
  const description = role.description(entity);
  const details = role.details(entity);
  const trainerClass = entity.type === "trainer" ? (entity.teachesClass ?? "").toLowerCase() : "";

  return (
    <div
      className="fixed z-50 border-2 shadow-2xl select-none"
      style={{
        background: BG,
        borderColor: BORDER,
        fontFamily: "monospace",
        color: TEXT,
        width: 340,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        maxHeight: "85vh",
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

      {tutorialMaster && (
        <div className="px-3 py-3 border-b" style={{ borderColor: BORDER }}>
          {!imageFailed ? (
            <img
              alt={`${entity.name} portrait`}
              className="w-full border"
              onError={() => setImageFailed(true)}
              src={getTutorialMasterPortraitUrl()}
              style={{ borderColor: BORDER, background: "#0a1020" }}
            />
          ) : (
            <div className="border p-3 text-[10px]" style={{ borderColor: BORDER, background: "#0a1020", color: DIM }}>
              Portrait path ready. Add the supplied PNG at `client/public/assets/npcs/tutorial-master.png`.
            </div>
          )}
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

      {tutorialMaster && (
        <>
          <div className="px-3 py-2 border-b" style={{ borderColor: BORDER }}>
            <div className="text-[10px] font-bold uppercase mb-1.5" style={{ color: "#5dadec" }}>
              Hot Keys
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {TUTORIAL_MASTER_HOTKEYS.map((hotkey) => (
                <div key={hotkey.key} className="flex items-center gap-1.5 border px-2 py-1" style={{ borderColor: BORDER, background: "#0a1020" }}>
                  <span className="min-w-[42px] text-[10px] font-bold" style={{ color: role.color }}>{hotkey.key}</span>
                  <span className="text-[10px]" style={{ color: TEXT }}>{hotkey.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="px-3 py-2 border-b" style={{ borderColor: BORDER }}>
            {TUTORIAL_MASTER_SECTIONS.map((section) => (
              <div key={section.title} className="mb-2 last:mb-0">
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: ACCENT }}>
                  {section.title}
                </div>
                <div className="space-y-1">
                  {section.lines.map((line) => (
                    <div key={line} className="flex gap-1.5 text-[11px]">
                      <span style={{ color: role.color }}>{">"}</span>
                      <span style={{ color: TEXT }}>{line}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Techniques list for combat trainers */}
      {trainerClass && (
        <div className="px-3 py-2 border-b" style={{ borderColor: BORDER }}>
          <div className="text-[10px] font-bold uppercase mb-1.5" style={{ color: "#f25454" }}>
            {capitalize(trainerClass)} Techniques
          </div>
          <TrainerTechniqueList className={trainerClass} />
        </div>
      )}

      {/* Agent action button for trainers */}
      <AgentActionButton entity={entity} onClose={() => setOpen(false)} />

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
