import * as React from "react";
import { API_URL } from "@/config";
import { useGameBridge } from "@/hooks/useGameBridge";
import { useItemCatalog, type CatalogItem } from "@/hooks/useItemCatalog";
import { useTechniques } from "@/hooks/useTechniques";
import { ItemTooltip } from "@/components/ItemTooltip";
import type { Entity, CharacterStats, ActiveEffect } from "@/types";

/* ── 8-bit retro palette ─────────────────────────────────────── */
const BG = "#11182b";
const BORDER = "#29334d";
const TEXT = "#f1f5ff";
const DIM = "#6b7a9e";
const ACCENT = "#54f28b";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── Equipment Slot UI ────────────────────────────────────────── */
const SLOT_ORDER_LEFT = ["helm", "shoulders", "chest", "belt", "legs", "boots"] as const;
const SLOT_ORDER_RIGHT = ["amulet", "ring", "gloves", "weapon"] as const;

type SlotKey = "weapon" | "chest" | "legs" | "boots" | "helm" | "shoulders" | "gloves" | "belt" | "ring" | "amulet";

interface EquipSlotProps {
  slot: SlotKey;
  equipped?: { tokenId: number; durability: number; maxDurability: number; broken?: boolean; quality?: string; rolledStats?: Partial<CharacterStats>; bonusAffix?: string };
  getItem: (tokenId: number) => CatalogItem | undefined;
}

function EquipSlot({ slot, equipped, getItem }: EquipSlotProps): React.ReactElement {
  const [hovered, setHovered] = React.useState(false);
  const item = equipped ? getItem(equipped.tokenId) : undefined;

  const qualityBorder = equipped?.quality
    ? { common: BORDER, uncommon: "#54f28b", rare: "#5dadec", epic: "#b48efa", legendary: "#ffcc00" }[equipped.quality] ?? BORDER
    : BORDER;

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="flex items-center justify-center border-2 text-[9px] font-bold uppercase"
        style={{
          width: 56,
          height: 32,
          background: equipped ? "#1a2240" : "#0d1220",
          borderColor: equipped ? qualityBorder : "#1e2842",
          color: equipped ? TEXT : "#2e3a55",
          fontFamily: "monospace",
          cursor: equipped ? "pointer" : "default",
        }}
      >
        {item ? (
          <span className="truncate px-0.5 text-[8px]" style={{ color: TEXT }}>
            {item.name}
          </span>
        ) : (
          slot
        )}
      </div>
      {hovered && equipped && item && (
        <ItemTooltip
          item={item}
          equipped={equipped}
          style={{ top: "100%", left: 0, marginTop: 4 }}
        />
      )}
    </div>
  );
}

/* ── HP / XP bars ─────────────────────────────────────────────── */
function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }): React.ReactElement {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-1 text-[10px]" style={{ fontFamily: "monospace" }}>
      <span style={{ color: DIM, width: 18 }}>{label}</span>
      <div className="flex-1 h-[8px] border" style={{ borderColor: BORDER, background: "#0a0e18" }}>
        <div className="h-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ color: TEXT, width: 70, textAlign: "right" }}>{value}/{max}</span>
    </div>
  );
}

/* ── Stat Table ───────────────────────────────────────────────── */
const STAT_KEYS: (keyof CharacterStats)[] = ["str", "def", "hp", "agi", "int", "mp", "faith", "luck"];
const STAT_LABELS: Record<string, string> = {
  str: "STR", def: "DEF", hp: "HP", agi: "AGI", int: "INT", mp: "MP", faith: "FAITH", luck: "LUCK",
};

function StatRow({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="flex justify-between text-[11px]" style={{ fontFamily: "monospace" }}>
      <span style={{ color: DIM }}>{label}</span>
      <span style={{ color: TEXT }}>{value}</span>
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────── */
type TabId = "equipment" | "stats" | "skills" | "effects";

const TABS: { id: TabId; label: string }[] = [
  { id: "equipment", label: "Equip" },
  { id: "stats", label: "Stats" },
  { id: "skills", label: "Skills" },
  { id: "effects", label: "FX" },
];

/* ── Main Component ───────────────────────────────────────────── */
export function InspectDialog(): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const [entity, setEntity] = React.useState<Entity | null>(null);
  const [tab, setTab] = React.useState<TabId>("equipment");

  const { getItem } = useItemCatalog();
  const { getTechnique } = useTechniques();

  // Listen for inspect events
  useGameBridge("entityInspect", ({ entityId, zoneId }) => {
    void fetchEntity(entityId, zoneId);
  });

  // Listen for self-inspect ("I" key)
  useGameBridge("inspectSelf", ({ zoneId, walletAddress }) => {
    void fetchSelfEntity(zoneId, walletAddress);
  });

  async function fetchEntity(entityId: string, zoneId: string): Promise<void> {
    try {
      const res = await fetch(`${API_URL}/zones/${zoneId}`);
      if (!res.ok) return;
      const data = await res.json();
      const found = data.entities?.[entityId] as Entity | undefined;
      if (found) {
        setEntity(found);
        setTab("equipment");
        setOpen(true);
      }
    } catch {
      // silently fail
    }
  }

  async function fetchSelfEntity(zoneId: string, walletAddress: string): Promise<void> {
    try {
      const normalized = walletAddress.toLowerCase();
      const res = await fetch(`${API_URL}/zones/${zoneId}`);
      if (!res.ok) return;
      const data = await res.json();
      const entities = data.entities as Record<string, Entity> | undefined;
      if (!entities) return;
      const self = Object.values(entities).find(
        (e) => e.type === "player" && e.walletAddress?.toLowerCase() === normalized,
      );
      if (self) {
        setEntity(self);
        setTab("equipment");
        setOpen(true);
      }
    } catch {
      // silently fail
    }
  }

  if (!open || !entity) return null;

  const hpColor = entity.maxHp > 0 && entity.hp / entity.maxHp > 0.66 ? "#54f28b" : entity.hp / entity.maxHp > 0.33 ? "#f2c854" : "#f25454";
  const equipment = entity.equipment ?? {};

  return (
    <div
      className="fixed z-50 border-2 shadow-2xl select-none"
      style={{
        background: BG,
        borderColor: BORDER,
        fontFamily: "monospace",
        color: TEXT,
        width: 360,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        maxHeight: "90vh",
        overflow: "auto",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: BORDER }}>
        <div>
          <div className="text-sm font-bold" style={{ color: TEXT }}>{entity.name}</div>
          <div className="text-[10px]" style={{ color: DIM }}>
            {entity.raceId ? capitalize(entity.raceId) : ""}{" "}
            {entity.classId ? capitalize(entity.classId) : ""}{" "}
            {entity.level ? `Lv.${entity.level}` : ""}
            {entity.kills !== undefined ? ` | ${entity.kills} kills` : ""}
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

      {/* HP + Essence bars */}
      <div className="px-3 py-1.5 space-y-0.5">
        <Bar label="HP" value={entity.hp} max={entity.maxHp} color={hpColor} />
        {entity.essence !== undefined && entity.maxEssence !== undefined && entity.maxEssence > 0 && (
          <Bar label="ES" value={entity.essence} max={entity.maxEssence} color="#5dadec" />
        )}
      </div>

      {/* Paper doll + equipment */}
      <div className="px-3 py-2 flex items-start gap-2 justify-center">
        {/* Left slots */}
        <div className="flex flex-col gap-1">
          {SLOT_ORDER_LEFT.map((s) => (
            <EquipSlot key={s} slot={s} equipped={equipment[s] ?? undefined} getItem={getItem} />
          ))}
        </div>

        {/* Center silhouette */}
        <div
          className="flex items-center justify-center border-2"
          style={{
            width: 80,
            height: 200,
            borderColor: ACCENT,
            background: "#0a1020",
          }}
        >
          <div className="text-center text-[10px]" style={{ color: DIM }}>
            <div style={{ fontSize: 32, lineHeight: 1 }}>
              {entity.type === "boss" ? "!!" : entity.type === "mob" ? "??" : "@@"}
            </div>
            <div className="mt-1">{entity.type.toUpperCase()}</div>
          </div>
        </div>

        {/* Right slots */}
        <div className="flex flex-col gap-1">
          {SLOT_ORDER_RIGHT.map((s) => (
            <EquipSlot key={s} slot={s} equipped={equipment[s] ?? undefined} getItem={getItem} />
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-t" style={{ borderColor: BORDER }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex-1 py-1.5 text-[10px] font-bold uppercase border-r last:border-r-0"
            style={{
              borderColor: BORDER,
              background: tab === t.id ? "#1a2240" : "transparent",
              color: tab === t.id ? ACCENT : DIM,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-3 py-2 min-h-[100px]">
        {tab === "equipment" && <EquipmentTab entity={entity} getItem={getItem} />}
        {tab === "stats" && <StatsTab entity={entity} />}
        {tab === "skills" && <SkillsTab entity={entity} getTechnique={getTechnique} />}
        {tab === "effects" && <EffectsTab entity={entity} getTechnique={getTechnique} />}
      </div>
    </div>
  );
}

/* ── Equipment Tab ────────────────────────────────────────────── */
function EquipmentTab({ entity, getItem }: { entity: Entity; getItem: (id: number) => CatalogItem | undefined }): React.ReactElement {
  const equipment = entity.equipment ?? {};
  const slots = [...SLOT_ORDER_LEFT, ...SLOT_ORDER_RIGHT] as SlotKey[];
  const equipped = slots.filter((s) => equipment[s]);

  if (equipped.length === 0) {
    return <div className="text-[11px]" style={{ color: DIM }}>No equipment</div>;
  }

  return (
    <div className="space-y-1">
      {equipped.map((slot) => {
        const eq = equipment[slot]!;
        const item = getItem(eq.tokenId);
        const qualityColor = eq.quality
          ? { common: "#9aa7cc", uncommon: "#54f28b", rare: "#5dadec", epic: "#b48efa", legendary: "#ffcc00" }[eq.quality] ?? "#9aa7cc"
          : "#9aa7cc";
        return (
          <div key={slot} className="flex justify-between text-[11px]">
            <span style={{ color: DIM, width: 60 }}>{slot.toUpperCase()}</span>
            <span className="flex-1 truncate" style={{ color: qualityColor }}>
              {item?.name ?? `Item #${eq.tokenId}`}
            </span>
            <span style={{ color: eq.broken ? "#f25454" : "#6b7a9e" }}>
              {eq.durability}/{eq.maxDurability}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Stats Tab ────────────────────────────────────────────────── */
function StatsTab({ entity }: { entity: Entity }): React.ReactElement {
  const stats = entity.effectiveStats;
  if (!stats) {
    return <div className="text-[11px]" style={{ color: DIM }}>No stats available</div>;
  }

  return (
    <div className="space-y-0.5">
      {STAT_KEYS.map((key) => (
        <StatRow key={key} label={STAT_LABELS[key]} value={stats[key]} />
      ))}
      {entity.xp !== undefined && (
        <div className="mt-2">
          <StatRow label="XP" value={entity.xp} />
        </div>
      )}
    </div>
  );
}

/* ── Skills Tab ───────────────────────────────────────────────── */
function SkillsTab({ entity, getTechnique }: { entity: Entity; getTechnique: (id: string) => { id: string; name: string; description: string; cooldown: number; essenceCost: number; type: string; targetType: string } | undefined }): React.ReactElement {
  const ids = entity.learnedTechniques ?? [];

  if (ids.length === 0) {
    return <div className="text-[11px]" style={{ color: DIM }}>No techniques learned</div>;
  }

  return (
    <div className="space-y-1.5">
      {ids.map((techId) => {
        const tech = getTechnique(techId);
        if (!tech) {
          return (
            <div key={techId} className="text-[10px]" style={{ color: DIM }}>
              {techId}
            </div>
          );
        }
        const typeColor = { attack: "#f25454", buff: "#54f28b", debuff: "#b48efa", healing: "#5dadec" }[tech.type] ?? DIM;
        return (
          <div key={techId} className="border p-1.5" style={{ borderColor: "#1e2842" }}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold" style={{ color: TEXT }}>{tech.name}</span>
              <span className="text-[9px] uppercase font-bold" style={{ color: typeColor }}>{tech.type}</span>
            </div>
            <div className="text-[10px]" style={{ color: DIM }}>{tech.description}</div>
            <div className="flex gap-3 mt-0.5 text-[9px]" style={{ color: "#5dadec" }}>
              <span>CD: {tech.cooldown}s</span>
              <span>Cost: {tech.essenceCost} ES</span>
              <span>{tech.targetType}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Effects Tab ──────────────────────────────────────────────── */
function EffectsTab({ entity, getTechnique }: { entity: Entity; getTechnique: (id: string) => { name: string } | undefined }): React.ReactElement {
  const effects: ActiveEffect[] = entity.activeEffects ?? [];

  if (effects.length === 0) {
    return <div className="text-[11px]" style={{ color: DIM }}>No active effects</div>;
  }

  const now = Date.now();

  return (
    <div className="space-y-1">
      {effects.map((fx, i) => {
        const tech = getTechnique(fx.techniqueId);
        const name = tech?.name ?? fx.techniqueId;
        const remaining = Math.max(0, Math.round((fx.expiresAt - now) / 1000));
        const isBuff = fx.type === "buff";

        return (
          <div key={i} className="flex justify-between text-[11px] border-l-2 pl-2" style={{ borderColor: isBuff ? "#54f28b" : "#b48efa" }}>
            <div>
              <span style={{ color: isBuff ? "#54f28b" : "#b48efa" }}>{name}</span>
              {fx.statBonus && (
                <span className="ml-1 text-[9px]" style={{ color: DIM }}>
                  {Object.entries(fx.statBonus).map(([s, v]) => `+${v}% ${s}`).join(", ")}
                </span>
              )}
              {fx.statReduction && (
                <span className="ml-1 text-[9px]" style={{ color: DIM }}>
                  {Object.entries(fx.statReduction).map(([s, v]) => `-${v}% ${s}`).join(", ")}
                </span>
              )}
              {fx.dotDamage && (
                <span className="ml-1 text-[9px]" style={{ color: "#f25454" }}>
                  {fx.dotDamage} dmg/tick
                </span>
              )}
              {fx.shield && (
                <span className="ml-1 text-[9px]" style={{ color: "#5dadec" }}>
                  shield: {fx.shield}%
                </span>
              )}
            </div>
            <span style={{ color: remaining > 5 ? DIM : "#f2c854" }}>{remaining}s</span>
          </div>
        );
      })}
    </div>
  );
}
