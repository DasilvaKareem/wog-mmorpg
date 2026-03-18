import * as React from "react";
import { API_URL } from "@/config";
import { useGameBridge } from "@/hooks/useGameBridge";
import { useItemCatalog, type CatalogItem } from "@/hooks/useItemCatalog";
import { useTechniques, type TechniqueInfo } from "@/hooks/useTechniques";
import { ItemTooltip } from "@/components/ItemTooltip";
import { colorToCss, getTechniqueVisual } from "@/lib/techniqueVisuals";
import { gameBus } from "@/lib/eventBus";
import { WalletManager } from "@/lib/walletManager";
import { getAuthToken } from "@/lib/agentAuth";
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
const SLOT_ORDER_LEFT = ["helm", "shoulders", "chest", "belt", "legs", "boots", "cape"] as const;
const SLOT_ORDER_RIGHT = ["amulet", "ring", "gloves", "weapon", "shield"] as const;

type SlotKey = "weapon" | "shield" | "chest" | "legs" | "boots" | "helm" | "shoulders" | "gloves" | "belt" | "cape" | "ring" | "amulet";

interface EquipSlotProps {
  slot: SlotKey;
  equipped?: { tokenId: number; durability: number; maxDurability: number; broken?: boolean; quality?: string; rolledStats?: Partial<CharacterStats>; bonusAffix?: string };
  getItem: (tokenId: number) => CatalogItem | undefined;
}

function EquipSlot({ slot, equipped, getItem }: EquipSlotProps): React.ReactElement {
  const [hovered, setHovered] = React.useState(false);
  const item = equipped ? getItem(equipped.tokenId) : undefined;
  const rarity = equipped?.quality ?? item?.rarity ?? "common";

  const qualityBorder = rarity !== "common"
    ? ({ uncommon: "#54f28b", rare: "#5dadec", epic: "#b48efa", legendary: "#ffcc00" }[rarity] ?? BORDER)
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
          <span className="truncate px-0.5 text-[8px]" style={{ color: qualityBorder !== BORDER ? qualityBorder : TEXT }}>
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
type TabId = "equipment" | "stats" | "skills" | "effects" | "reputation";

const TABS: { id: TabId; label: string }[] = [
  { id: "equipment", label: "Equip" },
  { id: "stats", label: "Stats" },
  { id: "skills", label: "Skills" },
  { id: "effects", label: "FX" },
  { id: "reputation", label: "Rep" },
];

/* ── Main Component ───────────────────────────────────────────── */
export function InspectDialog(): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const [entity, setEntity] = React.useState<Entity | null>(null);
  const [tab, setTab] = React.useState<TabId>("equipment");
  const [isSelf, setIsSelf] = React.useState(false);
  const [inspectZoneId, setInspectZoneId] = React.useState<string | null>(null);

  const { getItem } = useItemCatalog();
  const { getTechnique } = useTechniques();

  // Listen for inspect events
  useGameBridge("entityInspect", ({ entityId, zoneId }) => {
    setIsSelf(false);
    setInspectZoneId(zoneId);
    void fetchEntity(entityId, zoneId);
  });

  // Listen for self-inspect ("I" key)
  useGameBridge("inspectSelf", ({ zoneId, walletAddress }) => {
    setIsSelf(true);
    setInspectZoneId(zoneId);
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
      // Also check custodial wallet — entities spawn with the custodial address
      const custodial = WalletManager.getInstance().custodialAddress?.toLowerCase() ?? null;
      const res = await fetch(`${API_URL}/zones/${zoneId}`);
      if (!res.ok) return;
      const data = await res.json();
      const entities = data.entities as Record<string, Entity> | undefined;
      if (!entities) return;
      const self = Object.values(entities).find(
        (e) => {
          if (e.type !== "player") return false;
          const ew = e.walletAddress?.toLowerCase();
          return ew === normalized || (custodial && ew === custodial);
        },
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
            {entity.gender ? capitalize(entity.gender) : ""}{" "}
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
        {tab === "reputation" && <ReputationTab entity={entity} />}
      </div>

      {/* Social actions — only for other players */}
      {!isSelf && entity.type === "player" && entity.walletAddress && (
        <SocialActions entity={entity} zoneId={inspectZoneId} />
      )}
    </div>
  );
}

/* ── Social Actions Panel ─────────────────────────────────────── */

type SocialActionId = "friend" | "party" | "guild" | "trade" | "duel";

interface SocialActionDef {
  id: SocialActionId;
  label: string;
  icon: string;
  color: string;
}

const SOCIAL_ACTIONS: SocialActionDef[] = [
  { id: "friend",  label: "Friend",  icon: "+", color: "#54f28b" },
  { id: "party",   label: "Party",   icon: "P", color: "#5dadec" },
  { id: "guild",   label: "Guild",   icon: "G", color: "#b48efa" },
  { id: "trade",   label: "Trade",   icon: "$", color: "#f2c854" },
  { id: "duel",    label: "Duel",    icon: "!", color: "#f25454" },
];

/**
 * Resolve the owner (signer) wallet and custodial (in-game) wallet.
 * Auth tokens are always signed by the owner wallet.
 * API bodies use the custodial wallet (the entity's on-chain wallet).
 */
async function resolveWallets(): Promise<{ owner: string; custodial: string } | null> {
  const wm = WalletManager.getInstance();
  const owner = wm.address;
  if (!owner) return null;

  // Try cached custodial first
  let custodial = wm.custodialAddress;
  if (!custodial) {
    try {
      const res = await fetch(`${API_URL}/agent/wallet/${owner}`);
      if (res.ok) {
        const data = await res.json();
        custodial = data.custodialWallet ?? null;
        if (custodial) wm.setCustodialAddress(custodial);
      }
    } catch { /* ignore */ }
  }

  return { owner, custodial: custodial ?? owner };
}

function SocialActions({ entity, zoneId }: { entity: Entity; zoneId: string | null }): React.ReactElement {
  const [busy, setBusy] = React.useState<SocialActionId | null>(null);
  const [result, setResult] = React.useState<{ text: string; tone: "ok" | "error" } | null>(null);

  function flash(text: string, tone: "ok" | "error" = "ok") {
    setResult({ text, tone });
    window.setTimeout(() => setResult(null), 3500);
  }

  async function handleAction(actionId: SocialActionId) {
    const wallets = await resolveWallets();
    if (!wallets) { flash("Wallet not connected — sign in first", "error"); return; }
    const { owner, custodial } = wallets;

    const targetWallet = entity.walletAddress;
    if (!targetWallet) { flash("Target has no wallet", "error"); return; }

    const token = await getAuthToken(owner);
    if (!token) { flash("Auth failed — reconnect wallet", "error"); return; }

    const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    setBusy(actionId);
    try {
      switch (actionId) {
        case "friend": {
          const res = await fetch(`${API_URL}/friends/request`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ fromWallet: custodial, toWallet: targetWallet }),
          });
          const data = await res.json();
          if (res.ok && data.success) flash(`Friend request sent to ${entity.name}`);
          else flash(data.error ?? "Failed to send request", "error");
          break;
        }
        case "party": {
          if (!zoneId) { flash("Zone unknown — cannot invite", "error"); break; }
          // Find our entity in the zone by custodial wallet
          const zoneRes = await fetch(`${API_URL}/zones/${zoneId}`);
          if (!zoneRes.ok) { flash("Failed to load zone", "error"); break; }
          const zoneData = await zoneRes.json();
          const entities = zoneData.entities as Record<string, Entity> | undefined;
          const custodialNorm = custodial.toLowerCase();
          const selfEntity = entities ? Object.values(entities).find(
            (e) => e.type === "player" && e.walletAddress?.toLowerCase() === custodialNorm,
          ) : undefined;
          if (!selfEntity) { flash("Your champion not found in zone", "error"); break; }
          const res = await fetch(`${API_URL}/party/invite-champion`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ fromEntityId: selfEntity.id, fromZoneId: zoneId, toCustodialWallet: targetWallet }),
          });
          const data = await res.json();
          if (res.ok && data.success) flash(`Party invite sent to ${entity.name}`);
          else flash(data.error ?? "Failed to invite", "error");
          break;
        }
        case "guild": {
          // Look up our guild via custodial wallet
          const gRes = await fetch(`${API_URL}/guild/wallet/${custodial}`);
          if (!gRes.ok) { flash("Failed to load guild info", "error"); break; }
          const gData = await gRes.json();
          if (!gData.inGuild || !gData.guild) { flash("You must be in a guild first", "error"); break; }
          const guildId = gData.guild.guildId;
          const res = await fetch(`${API_URL}/guild/${guildId}/invite`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ memberAddress: targetWallet }),
          });
          const data = await res.json();
          if (res.ok && data.ok) flash(`Guild invite sent to ${entity.name}`);
          else flash(data.error ?? "Failed to invite to guild", "error");
          break;
        }
        case "trade": {
          // The trade system uses async listings — open inventory to manage items
          gameBus.emit("inventoryOpen", undefined as never);
          flash(`Open your inventory to list items for trade`);
          break;
        }
        case "duel": {
          if (!zoneId) { flash("Zone unknown — cannot duel", "error"); break; }
          // Find our entity in the zone to get required fields
          const zoneRes2 = await fetch(`${API_URL}/zones/${zoneId}`);
          if (!zoneRes2.ok) { flash("Failed to load zone", "error"); break; }
          const zoneData2 = await zoneRes2.json();
          const entities2 = zoneData2.entities as Record<string, Entity> | undefined;
          const custodialNorm2 = custodial.toLowerCase();
          const selfEntity2 = entities2 ? Object.values(entities2).find(
            (e) => e.type === "player" && e.walletAddress?.toLowerCase() === custodialNorm2,
          ) : undefined;
          if (!selfEntity2) { flash("Your champion not found in zone", "error"); break; }
          // Resolve characterTokenId from /character endpoint
          let charTokenId = "0";
          try {
            const charRes = await fetch(`${API_URL}/character/${owner}`);
            if (charRes.ok) {
              const charData = await charRes.json();
              const chars = charData.characters ?? [];
              if (chars.length > 0) charTokenId = chars[0].tokenId ?? "0";
            }
          } catch { /* use fallback */ }
          const res = await fetch(`${API_URL}/api/pvp/queue/join`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              agentId: selfEntity2.id,
              walletAddress: custodial,
              characterTokenId: charTokenId,
              level: selfEntity2.level ?? 1,
              format: "1v1",
            }),
          });
          const data = await res.json();
          if (res.ok) flash(`Queued for 1v1 duel — waiting for opponent`);
          else flash(data.error ?? "Failed to queue for duel", "error");
          break;
        }
      }
    } catch {
      flash("Network error", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t px-3 py-2" style={{ borderColor: BORDER }}>
      <div className="flex gap-1 justify-center flex-wrap">
        {SOCIAL_ACTIONS.map((a) => (
          <button
            key={a.id}
            onClick={() => void handleAction(a.id)}
            disabled={busy !== null}
            className="flex items-center gap-1 border px-2 py-1 text-[9px] font-bold uppercase"
            style={{
              borderColor: busy === a.id ? a.color : BORDER,
              color: a.color,
              background: busy === a.id ? "#1a2240" : "transparent",
              cursor: busy ? "wait" : "pointer",
              opacity: busy && busy !== a.id ? 0.4 : 1,
              fontFamily: "monospace",
            }}
          >
            <span className="flex h-4 w-4 items-center justify-center border text-[8px]"
              style={{ borderColor: a.color, background: "#0d1220" }}>
              {a.icon}
            </span>
            {a.label}
          </button>
        ))}
      </div>
      {result && (
        <div className="mt-1 text-center text-[10px]" style={{
          color: result.tone === "ok" ? "#54f28b" : "#f25454",
          fontFamily: "monospace",
        }}>
          {result.text}
        </div>
      )}
    </div>
  );
}

/* ── Rarity colors ────────────────────────────────────────────── */
const RARITY_COLORS: Record<string, string> = {
  common: "#9aa7cc",
  uncommon: "#54f28b",
  rare: "#5dadec",
  epic: "#b48efa",
  legendary: "#ffcc00",
};

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
        const rarity = eq.quality ?? item?.rarity ?? "common";
        const rarityColor = RARITY_COLORS[rarity] ?? RARITY_COLORS.common;
        return (
          <div key={slot} className="flex justify-between text-[11px]">
            <span style={{ color: DIM, width: 60 }}>{slot.toUpperCase()}</span>
            <span className="flex-1 truncate" style={{ color: rarityColor }}>
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

/* ── Essence Technique Data ───────────────────────────────────── */
interface EssenceTechniqueData {
  id: string;
  name: string;
  description: string;
  cooldown: number;
  essenceCost: number;
  type: string;
  targetType: string;
  tier: "signature" | "ultimate";
  qualityTier: string;
  displayColor: string;
}

function useEssenceTechniques(walletAddress?: string): EssenceTechniqueData[] {
  const [techniques, setTechniques] = React.useState<EssenceTechniqueData[]>([]);

  React.useEffect(() => {
    if (!walletAddress) return;
    fetch(`${API_URL}/essence-technique/${walletAddress}`)
      .then((r) => (r.ok ? r.json() : { techniques: [] }))
      .then((data) => setTechniques(data.techniques ?? []))
      .catch(() => {});
  }, [walletAddress]);

  return techniques;
}

/* ── Skills Tab ───────────────────────────────────────────────── */
function SkillsTab({ entity, getTechnique }: { entity: Entity; getTechnique: (id: string) => TechniqueInfo | undefined }): React.ReactElement {
  const ids = entity.learnedTechniques ?? [];
  const essenceTechniques = useEssenceTechniques(entity.walletAddress);

  // Separate regular and essence technique IDs
  const regularIds = ids.filter((id) => !id.startsWith("essence_"));
  const essenceIds = ids.filter((id) => id.startsWith("essence_"));

  if (regularIds.length === 0 && essenceTechniques.length === 0) {
    return <div className="text-[11px]" style={{ color: DIM }}>No techniques learned</div>;
  }

  return (
    <div className="space-y-1.5">
      {/* Regular techniques */}
      {regularIds.map((techId) => {
        const tech = getTechnique(techId);
        if (!tech) {
          return (
            <div key={techId} className="text-[10px]" style={{ color: DIM }}>
              {techId}
            </div>
          );
        }
        const visual = getTechniqueVisual(tech.id, tech.type);
        const primary = colorToCss(visual.primary);
        const secondary = colorToCss(visual.secondary);
        const accent = colorToCss(visual.accent);
        return (
          <div key={techId} className="border p-1.5" style={{ borderColor: primary, background: "#0d1628" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="flex h-5 w-5 items-center justify-center border text-[9px] font-bold"
                  style={{ borderColor: primary, color: accent, background: "#10192d" }}
                >
                  {visual.uiGlyph}
                </span>
                <span className="text-[11px] font-bold" style={{ color: primary }}>{tech.name}</span>
              </div>
              <span className="text-[9px] uppercase font-bold" style={{ color: secondary }}>{tech.type}</span>
            </div>
            <div className="text-[10px]" style={{ color: DIM }}>{tech.description}</div>
            <div className="flex gap-3 mt-0.5 text-[9px]" style={{ color: accent }}>
              <span>CD: {tech.cooldown}s</span>
              <span>Cost: {tech.essenceCost} ES</span>
              <span>{tech.targetType}</span>
            </div>
          </div>
        );
      })}

      {/* Unique Essence Techniques */}
      {essenceTechniques.length > 0 && (
        <>
          <div className="text-[10px] font-bold uppercase mt-2 mb-1" style={{ color: "#b48efa" }}>
            Unique Essence Techniques
          </div>
          {essenceTechniques.map((tech) => {
            const visual = getTechniqueVisual(tech.id, tech.type);
            const borderColor = tech.tier === "ultimate" ? "#b48efa" : colorToCss(visual.primary);
            const tierLabel = tech.tier === "ultimate" ? "ULTIMATE" : "SIGNATURE";
            const typeColor = colorToCss(visual.secondary);
            const accent = colorToCss(visual.accent);
            return (
              <div key={tech.id} className="border-2 p-1.5" style={{ borderColor, background: "#0d1628" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-5 w-5 items-center justify-center border text-[9px] font-bold"
                      style={{ borderColor, color: accent, background: "#10192d" }}
                    >
                      {visual.uiGlyph}
                    </span>
                    <span className="text-[11px] font-bold" style={{ color: tech.displayColor }}>{tech.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="text-[8px] uppercase font-bold px-1 border" style={{ color: borderColor, borderColor }}>{tierLabel}</span>
                    <span className="text-[9px] uppercase font-bold" style={{ color: typeColor }}>{tech.type}</span>
                  </div>
                </div>
                <div className="text-[10px]" style={{ color: DIM }}>{tech.description}</div>
                <div className="flex gap-3 mt-0.5 text-[9px]" style={{ color: accent }}>
                  <span>CD: {tech.cooldown}s</span>
                  <span>Cost: {tech.essenceCost} ES</span>
                  <span>{tech.targetType}</span>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ── Effects Tab ──────────────────────────────────────────────── */
function EffectsTab({ entity, getTechnique }: { entity: Entity; getTechnique: (id: string) => TechniqueInfo | undefined }): React.ReactElement {
  const effects: ActiveEffect[] = entity.activeEffects ?? [];

  if (effects.length === 0) {
    return <div className="text-[11px]" style={{ color: DIM }}>No active effects</div>;
  }

  const now = Date.now();

  return (
    <div className="space-y-1">
      {effects.map((fx, i) => {
        const tech = getTechnique(fx.techniqueId);
        const name = fx.name ?? tech?.name ?? fx.techniqueId;
        const remaining = Math.max(0, Math.round((fx.remainingTicks * 0.5)));
        const visual = getTechniqueVisual(fx.techniqueId, tech?.type ?? (fx.type === "buff" || fx.type === "hot" || fx.type === "shield" ? "buff" : "debuff"));
        const borderColor = colorToCss(visual.primary);
        const accent = colorToCss(visual.accent);

        return (
          <div key={i} className="flex justify-between text-[11px] border-l-2 pl-2" style={{ borderColor }}>
            <div>
              <span style={{ color: borderColor }}>{visual.uiGlyph} {name}</span>
              {fx.statModifiers && (
                <span className="ml-1 text-[9px]" style={{ color: DIM }}>
                  {Object.entries(fx.statModifiers).map(([s, v]) => `${(v ?? 0) > 0 ? "+" : ""}${v ?? 0}% ${s}`).join(", ")}
                </span>
              )}
              {fx.dotDamage && (
                <span className="ml-1 text-[9px]" style={{ color: "#f25454" }}>
                  {fx.dotDamage} dmg/tick
                </span>
              )}
              {fx.hotHealPerTick && (
                <span className="ml-1 text-[9px]" style={{ color: "#54f28b" }}>
                  +{fx.hotHealPerTick} hp/tick
                </span>
              )}
              {fx.shieldHp != null && fx.shieldMaxHp != null && (
                <span className="ml-1 text-[9px]" style={{ color: "#5dadec" }}>
                  shield: {fx.shieldHp}/{fx.shieldMaxHp}
                </span>
              )}
            </div>
            <span style={{ color: remaining > 5 ? accent : "#f2c854" }}>{remaining}s</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Reputation Tab ──────────────────────────────────────────── */
interface RepData {
  combat: number;
  economic: number;
  social: number;
  crafting: number;
  agent: number;
  overall: number;
  rank: string;
}

const REP_CATEGORIES: { key: keyof Omit<RepData, "overall" | "rank">; label: string; color: string }[] = [
  { key: "combat", label: "COMBAT", color: "#f25454" },
  { key: "economic", label: "ECON", color: "#f2c854" },
  { key: "social", label: "SOCIAL", color: "#54f28b" },
  { key: "crafting", label: "CRAFT", color: "#5dadec" },
  { key: "agent", label: "AGENT", color: "#b48efa" },
];

function ReputationTab({ entity }: { entity: Entity }): React.ReactElement {
  const [rep, setRep] = React.useState<RepData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!entity.walletAddress) return;
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/reputation/${entity.walletAddress}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data) => setRep(data.reputation))
      .catch(() => setError("No reputation data"))
      .finally(() => setLoading(false));
  }, [entity.walletAddress]);

  if (!entity.walletAddress) {
    return <div className="text-[11px]" style={{ color: DIM }}>NPCs don't have reputation</div>;
  }
  if (loading) {
    return <div className="text-[11px]" style={{ color: DIM }}>Loading...</div>;
  }
  if (error || !rep) {
    return <div className="text-[11px]" style={{ color: DIM }}>{error ?? "No reputation data"}</div>;
  }

  return (
    <div className="space-y-2">
      {/* Overall + Rank */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold" style={{ color: TEXT }}>Overall: {rep.overall}</span>
        <span className="text-[10px] font-bold uppercase" style={{ color: ACCENT }}>{rep.rank}</span>
      </div>
      {/* Category bars */}
      {REP_CATEGORIES.map(({ key, label, color }) => {
        const score = rep[key];
        const pct = Math.min(100, (score / 1000) * 100);
        return (
          <div key={key} className="flex items-center gap-1 text-[10px]" style={{ fontFamily: "monospace" }}>
            <span style={{ color: DIM, width: 42 }}>{label}</span>
            <div className="flex-1 h-[8px] border" style={{ borderColor: BORDER, background: "#0a0e18" }}>
              <div className="h-full" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span style={{ color: TEXT, width: 28, textAlign: "right" }}>{score}</span>
          </div>
        );
      })}
    </div>
  );
}
