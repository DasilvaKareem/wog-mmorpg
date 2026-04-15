import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { API_URL, getSkaleExplorerTxUrl } from "@/config";
import { useWalletContext } from "@/context/WalletContext";
import { useWogNames } from "@/hooks/useWogNames";
import { HpBar } from "@/components/ui/hp-bar";
import { XpBar } from "@/components/ui/xp-bar";
import { CurrencyInput } from "@/components/ui/currency-input";
import { formatCopperString, formatGoldString } from "@/lib/currency";
import { getAuthToken } from "@/lib/agentAuth";
import { openOnboarding } from "@/lib/onboarding";
import { getRegistrationStatusLabel, isRegistrationSettled, resolveRegistrationTxHash } from "@/lib/characterRegistration";
import { PaymentGate } from "@/components/PaymentGate";

// ── Types ─────────────────────────────────────────────────────────────────

interface LiveEntity {
  name: string;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  agentId?: string;
  characterTokenId?: string;
  raceId?: string;
  classId?: string;
  kills?: number;
  completedQuests?: string[];
  walletAddress?: string;
  zoneId?: string;
}

interface DiaryEntry {
  id: string;
  timestamp: number;
  action: string;
  headline: string;
  narrative: string;
  zoneId: string;
  characterName: string;
  details: Record<string, unknown>;
}

interface InventoryItem {
  tokenId: number;
  name: string;
  displayName: string | null;
  description: string;
  category: "consumable" | "weapon" | "armor" | "material" | "tool";
  equipSlot: string | null;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  quantity: number;
  equipped: boolean;
  equippedCount: number;
  equippedSlot: string | null;
  durability: number | null;
  maxDurability: number | null;
  recyclableQuantity: number;
  recycleCopperValue: number;
}

const ALL_PROFESSIONS = [
  { id: "mining",         name: "Mining",         icon: "⛏" },
  { id: "herbalism",      name: "Herbalism",       icon: "🌿" },
  { id: "skinning",       name: "Skinning",        icon: "🗡" },
  { id: "blacksmithing",  name: "Blacksmithing",   icon: "🔨" },
  { id: "alchemy",        name: "Alchemy",         icon: "⚗" },
  { id: "cooking",        name: "Cooking",         icon: "🍖" },
  { id: "leatherworking", name: "Leatherworking",  icon: "🛡" },
  { id: "jewelcrafting",  name: "Jewelcrafting",   icon: "💎" },
] as const;

const ACTION_COLORS: Record<string, string> = {
  kill:             "#ff6b6b",
  death:            "#9aa7cc",
  level_up:         "#ffcc00",
  zone_transition:  "#5dadec",
  quest_complete:   "#54f28b",
  craft:            "#b48efa",
  brew:             "#b48efa",
  cook:             "#ff8c00",
  mine:             "#cd7f32",
  gather_herb:      "#54f28b",
  skin:             "#c8a062",
  buy:              "#ffcc00",
  sell:             "#ffcc00",
  recycle:          "#54f28b",
  equip:            "#9aa7cc",
  spawn:            "#7a84a8",
  consume:          "#ff8c00",
};

const RARITY_COLORS: Record<string, string> = {
  common:    "#9aa7cc",
  uncommon:  "#54f28b",
  rare:      "#5dadec",
  epic:      "#b48efa",
  legendary: "#ffcc00",
};

const CATEGORY_ICONS: Record<string, string> = {
  weapon:    "⚔",
  armor:     "🛡",
  consumable: "⚗",
  material:  "📦",
  tool:      "⛏",
};

function zoneLabel(zoneId: string): string {
  return zoneId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function levelColor(level: number): string {
  if (level >= 50) return "#aa44ff";
  if (level >= 30) return "#5dadec";
  if (level >= 15) return "#54f28b";
  return "#9aa7cc";
}

// ── Sidebar ───────────────────────────────────────────────────────────────

function ChampionSidebar({
  entity,
  wallet,
  zoneId,
  kills,
  deaths,
}: {
  entity: LiveEntity | null;
  wallet: string;
  zoneId: string | null;
  kills: number;
  deaths: number;
}) {
  const navigate = useNavigate();
  const lc = levelColor(entity?.level ?? 0);

  return (
    <div className="flex flex-col gap-3 font-mono">
      {/* Identity card */}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-3 py-1.5">
          <span className="text-[13px] uppercase tracking-widest text-[#7a84a8]">{">> CHAMPION"}</span>
        </div>
        <div className="px-4 py-4 flex flex-col gap-2">
          {entity ? (
            <>
              <p className="text-[21px] font-bold leading-none" style={{ color: "#ffcc00", textShadow: "2px 2px 0 #000" }}>
                {entity.name}
              </p>
              <div className="flex items-center gap-2">
                <span
                  className="border-2 border-black px-2 py-0.5 text-[13px] font-bold shadow-[2px_2px_0_0_#000]"
                  style={{ backgroundColor: lc + "22", color: lc, borderColor: lc + "66" }}
                >
                  LV {entity.level}
                </span>
                <span className="text-[12px] capitalize text-[#9aa7cc]">
                  {entity.raceId} {entity.classId}
                </span>
              </div>
              <div className="mt-1 flex flex-col gap-1.5">
                <HpBar hp={entity.hp} maxHp={entity.maxHp} />
                <XpBar level={entity.level} xp={entity.xp} />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-[17px] text-[#7a84a8]">Champion offline</p>
              <p className="text-[17px] text-[#596a8a]">Deploy your agent to bring<br />your champion online.</p>
            </div>
          )}
        </div>
      </div>

      {/* Zone */}
      {zoneId && (
        <div className="border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[17px]">
          <span className="text-[#7a84a8]">ZONE  </span>
          <span className="text-[#5dadec]">{zoneLabel(zoneId)}</span>
          <span className="ml-1 text-[12px] animate-pulse text-[#54f28b]">● LIVE</span>
        </div>
      )}

      {/* Wallet */}
      <div className="border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[17px]">
        <span className="text-[#7a84a8]">WALLET  </span>
        <span className="text-[#9aa7cc]">
          {wallet.slice(0, 8)}...{wallet.slice(-6)}
        </span>
      </div>

      {/* Combat stats */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Kills",  value: kills,  color: "#ff6b6b" },
          { label: "Deaths", value: deaths, color: "#9aa7cc" },
        ].map((s) => (
          <div
            key={s.label}
            className="flex flex-col items-center border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] py-3 shadow-[3px_3px_0_0_#000]"
          >
            <span className="text-[19px] font-bold" style={{ color: s.color, textShadow: "2px 2px 0 #000" }}>
              {s.value}
            </span>
            <span className="mt-0.5 text-[13px] uppercase tracking-wide text-[#7a84a8]">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Watch button */}
      <button
        onClick={() => navigate("/world")}
        className="w-full border-4 border-black bg-[#54f28b] px-4 py-2.5 text-[13px] uppercase tracking-wide text-[#060d12] shadow-[4px_4px_0_0_#000] transition hover:bg-[#7bf5a8] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[2px_2px_0_0_#000] font-bold"
      >
        {">>> Watch in World <<<"}
      </button>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

type Tab = "inventory" | "overview" | "professions" | "quests" | "activity" | "inbox" | "party" | "friends" | "guild" | "gold-shop" | "plan" | "reputation";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "inventory",   label: "Inventory"  },
    { id: "overview",    label: "Overview"   },
    { id: "guild",       label: "Guild"      },
    { id: "professions", label: "Professions"},
    { id: "quests",      label: "Quests"     },
    { id: "activity",    label: "Activity"   },
    { id: "inbox",       label: "Inbox"      },
    { id: "party",       label: "Party"      },
    { id: "friends",     label: "Friends"    },
    { id: "reputation",   label: "Reputation" },
    { id: "gold-shop",   label: "Gold Shop"  },
    { id: "plan",         label: "Plan"       },
  ];
  return (
    <div className="flex gap-0 border-b-2 border-[#2a3450] overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`shrink-0 px-4 py-2.5 text-[12px] uppercase tracking-wide transition whitespace-nowrap ${
            active === t.id
              ? "border-b-2 border-[#ffcc00] text-[#ffcc00] bg-[#1a2240]"
              : "text-[#7a84a8] hover:text-[#9aa7cc]"
          }`}
          style={{ marginBottom: active === t.id ? "-2px" : "0" }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Equipment slot config ─────────────────────────────────────────────────

const SLOT_ORDER: { slot: string; label: string; icon: string }[] = [
  { slot: "weapon",    label: "Weapon",    icon: "⚔" },
  { slot: "shield",    label: "Shield",    icon: "🛡" },
  { slot: "helm",      label: "Helm",      icon: "🪖" },
  { slot: "shoulders", label: "Shoulders", icon: "🛡" },
  { slot: "chest",     label: "Chest",     icon: "🛡" },
  { slot: "gloves",    label: "Gloves",    icon: "🧤" },
  { slot: "belt",      label: "Belt",      icon: "📿" },
  { slot: "cape",      label: "Cape",      icon: "🧣" },
  { slot: "legs",      label: "Legs",      icon: "🦿" },
  { slot: "boots",     label: "Boots",     icon: "🥾" },
  { slot: "ring",      label: "Ring",      icon: "💍" },
  { slot: "amulet",    label: "Amulet",    icon: "📿" },
];

// ── Inventory tab ─────────────────────────────────────────────────────────

function InventoryTab({
  items,
  loading,
  wallet,
  ownerWallet,
  entityId,
  zoneId,
  onRefresh,
}: {
  items: InventoryItem[];
  loading: boolean;
  wallet: string | null;
  ownerWallet: string | null;
  entityId: string | null;
  zoneId: string | null;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = React.useState<string>("all");
  const [busy, setBusy] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const categories = ["all", "weapon", "armor", "consumable", "material"] as const;

  const filtered = filter === "all" ? items : items.filter((i) => i.category === filter);

  // Group equipped items first
  const sorted = [...filtered].sort((a, b) => {
    if (a.equipped && !b.equipped) return -1;
    if (!a.equipped && b.equipped) return 1;
    return a.name.localeCompare(b.name);
  });

  // Build equipped slot map from items
  const equippedBySlot = React.useMemo(() => {
    const map: Record<string, InventoryItem> = {};
    for (const item of items) {
      if (item.equipped && item.equippedSlot) {
        map[item.equippedSlot] = item;
      }
    }
    return map;
  }, [items]);

  async function handleEquip(item: InventoryItem) {
    if (!wallet || !zoneId) return;
    setBusy(item.tokenId);
    setError(null);
    setNotice(null);
    try {
      const authWallet = ownerWallet;
      if (!authWallet) { setError("Wallet not connected — please reconnect"); setBusy(null); return; }
      const token = await getAuthToken(authWallet);
      if (!token) { setError("Auth failed — reconnect wallet"); return; }
      const res = await fetch(`${API_URL}/equipment/equip`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ zoneId, tokenId: item.tokenId, walletAddress: wallet, entityId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Equip failed"); return; }
      setNotice(`Equipped ${item.name}.`);
      onRefresh();
    } catch { setError("Network error"); }
    finally { setBusy(null); }
  }

  async function handleUnequip(slot: string) {
    if (!wallet || !zoneId) return;
    setBusy(-1);
    setError(null);
    setNotice(null);
    try {
      const authWallet = ownerWallet;
      if (!authWallet) { setError("Wallet not connected — please reconnect"); setBusy(null); return; }
      const token = await getAuthToken(authWallet);
      if (!token) { setError("Auth failed — reconnect wallet"); return; }
      const res = await fetch(`${API_URL}/equipment/unequip`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ zoneId, slot, walletAddress: wallet, entityId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Unequip failed"); return; }
      setNotice(`Unequipped ${slot}.`);
      onRefresh();
    } catch { setError("Network error"); }
    finally { setBusy(null); }
  }

  async function handleRecycle(item: InventoryItem, quantity: number) {
    if (!wallet || quantity < 1) return;
    setBusy(item.tokenId);
    setError(null);
    setNotice(null);
    try {
      const authWallet = ownerWallet;
      if (!authWallet) { setError("Wallet not connected — please reconnect"); setBusy(null); return; }
      const token = await getAuthToken(authWallet);
      if (!token) { setError("Auth failed — reconnect wallet"); return; }
      const res = await fetch(`${API_URL}/shop/recycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sellerAddress: wallet, tokenId: item.tokenId, quantity }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Recycle failed"); return; }
      setNotice(`Sold ${quantity}x ${item.name} for ${formatCopperString(data.totalPayoutCopper ?? 0)}.`);
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[17px] text-[#596a8a] font-mono animate-pulse">Loading inventory...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Error banner */}
      {error && (
        <div className="border-2 border-[#ff6b6b44] bg-[#1a0a0a] px-3 py-2 text-[11px] text-[#ff6b6b]">
          {error}
        </div>
      )}
      {notice && (
        <div className="border-2 border-[#54f28b44] bg-[#09160d] px-3 py-2 text-[11px] text-[#54f28b]">
          {notice}
        </div>
      )}

      {/* ── Equipment Slots Panel ─────────────────────────────── */}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-3 py-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[#7a84a8]">{">> EQUIPPED GEAR"}</span>
          {!zoneId && <span className="text-[9px] text-[#596a8a]">CHAMPION OFFLINE — EQUIP DISABLED</span>}
        </div>
        <div className="grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-5">
          {SLOT_ORDER.map(({ slot, label, icon }) => {
            const eq = equippedBySlot[slot];
            const rc = eq ? (RARITY_COLORS[eq.rarity] ?? "#9aa7cc") : "#2a3450";
            const durPct = eq?.maxDurability && eq.maxDurability > 0
              ? Math.round(((eq.durability ?? 0) / eq.maxDurability) * 100) : null;
            const durColor = durPct === null ? null : durPct > 66 ? "#54f28b" : durPct > 33 ? "#ffcc00" : "#ff6b6b";

            return (
              <div
                key={slot}
                className="flex flex-col border-2 p-2 min-h-[80px] transition"
                style={{
                  borderColor: eq ? rc + "66" : "#2a3450",
                  backgroundColor: eq ? rc + "08" : "#0a0f1a",
                }}
              >
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[13px]">{icon}</span>
                  <span className="text-[9px] uppercase tracking-wide text-[#7a84a8]">{label}</span>
                </div>
                {eq ? (
                  <>
                    <span className="text-[10px] font-bold leading-tight truncate" style={{ color: rc }}>
                      {eq.displayName ?? eq.name}
                    </span>
                    <span className="text-[8px] uppercase mt-0.5" style={{ color: rc + "99" }}>{eq.rarity}</span>
                    {durPct !== null && (
                      <div className="flex items-center gap-1 mt-1">
                        <div className="h-1 flex-1 border border-black bg-[#0f1528]">
                          <div className="h-full" style={{ width: `${durPct}%`, backgroundColor: durColor ?? "#54f28b" }} />
                        </div>
                        <span className="text-[8px]" style={{ color: durColor ?? "#54f28b" }}>{durPct}%</span>
                      </div>
                    )}
                    {zoneId && (
                      <button
                        onClick={() => handleUnequip(slot)}
                        disabled={busy !== null}
                        className="mt-auto pt-1 text-[9px] uppercase tracking-wide text-[#ff6b6b] hover:text-[#ff9b9b] transition disabled:opacity-40"
                      >
                        [REMOVE]
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-[9px] text-[#2a3450] mt-auto">Empty</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Item List ─────────────────────────────────────────── */}
      <div className="flex gap-1 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1 text-[17px] uppercase tracking-wide border-2 transition ${
              filter === cat
                ? "border-[#ffcc00] bg-[#2a2210] text-[#ffcc00]"
                : "border-[#2a3450] bg-[#0b1020] text-[#7a84a8] hover:text-[#9aa7cc] hover:border-[#3a4460]"
            }`}
          >
            {cat === "all" ? `All (${items.length})` : `${CATEGORY_ICONS[cat] ?? ""} ${cat}`}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000] px-4 py-12 text-center">
          <p className="text-[17px] text-[#596a8a]">
            {items.length === 0
              ? "No items in inventory — champion hasn't looted anything yet."
              : "No items in this category."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {sorted.map((item) => {
            const rc = RARITY_COLORS[item.rarity] ?? "#9aa7cc";
            const durPct =
              item.maxDurability && item.maxDurability > 0
                ? Math.round(((item.durability ?? 0) / item.maxDurability) * 100)
                : null;
            const durColor = durPct === null ? null : durPct > 66 ? "#54f28b" : durPct > 33 ? "#ffcc00" : "#ff6b6b";
            const canEquip = !!item.equipSlot && !item.equipped && !!zoneId;
            const canUnequip = item.equipped && !!item.equippedSlot && !!zoneId;
            const canRecycle = item.recyclableQuantity > 0;
            const recycleValueTotal = item.recycleCopperValue * item.recyclableQuantity;

            return (
              <div
                key={item.tokenId}
                className={`relative border-2 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] p-3 shadow-[2px_2px_0_0_#000] transition hover:bg-[#1a2240]/50 ${
                  item.equipped ? "border-l-4" : ""
                }`}
                style={item.equipped ? { borderLeftColor: rc } : undefined}
              >
                {/* Equipped badge */}
                {item.equipped && (
                  <span
                    className="absolute top-2 right-2 text-[10px] uppercase tracking-wide border px-1 py-0.5"
                    style={{ color: "#54f28b", borderColor: "#54f28b44", backgroundColor: "#0a1a0e" }}
                  >
                    EQUIPPED
                  </span>
                )}

                <div className="flex items-start gap-2">
                  {/* Category icon */}
                  <span className="text-[21px] shrink-0 mt-0.5">
                    {CATEGORY_ICONS[item.category] ?? "📦"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold text-[#d6deff]">{item.displayName ?? item.name}</span>
                      <span
                        className="text-[10px] uppercase tracking-wide border px-1"
                        style={{ color: rc, borderColor: rc + "44", backgroundColor: rc + "11" }}
                      >
                        {item.rarity}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#7a84a8] mt-0.5 leading-relaxed line-clamp-2">
                      {item.description}
                    </p>

                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {/* Token ID */}
                      <span className="text-[9px] text-[#596a8a]">
                        NFT #{item.tokenId}
                      </span>

                      {/* Quantity */}
                      <span className="text-[10px] text-[#9aa7cc]">
                        <span className="text-[#596a8a]">QTY</span>{" "}
                        <span className="font-bold text-[#ffcc00]">{item.quantity}</span>
                      </span>

                      <span className="text-[10px] text-[#54f28b]">
                        <span className="text-[#596a8a]">SELL</span>{" "}
                        <span className="font-bold">{formatCopperString(item.recycleCopperValue)}</span>
                      </span>

                      {/* Equipped slot */}
                      {item.equippedSlot && (
                        <span className="text-[9px] uppercase text-[#7a84a8]">
                          [{item.equippedSlot}]
                        </span>
                      )}

                      {/* Equip slot hint for unequipped items */}
                      {!item.equipped && item.equipSlot && (
                        <span className="text-[9px] uppercase text-[#596a8a]">
                          SLOT: {item.equipSlot}
                        </span>
                      )}

                      {/* Durability */}
                      {durPct !== null && (
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-[#596a8a]">DUR</span>
                          <div className="h-1 w-12 border border-black bg-[#0f1528]">
                            <div
                              className="h-full transition-all"
                              style={{ width: `${durPct}%`, backgroundColor: durColor ?? "#54f28b" }}
                            />
                          </div>
                          <span className="text-[9px]" style={{ color: durColor ?? "#54f28b" }}>
                            {item.durability}/{item.maxDurability}
                          </span>
                        </div>
                      )}
                    </div>

                    {(item.equippedCount > 0 || canRecycle) && (
                      <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[9px] uppercase">
                        {item.equippedCount > 0 && (
                          <span className="text-[#9aa7cc]">
                            Locked Equipped: <span className="font-bold text-[#d6deff]">{item.equippedCount}</span>
                          </span>
                        )}
                        {canRecycle && (
                          <span className="text-[#54f28b]">
                            Sellable: <span className="font-bold">{item.recyclableQuantity}</span>
                            {" "}for {formatCopperString(recycleValueTotal)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Equip / Unequip button */}
                    {(canEquip || canUnequip || canRecycle) && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {canEquip && (
                          <button
                            onClick={() => handleEquip(item)}
                            disabled={busy !== null}
                            className="border-2 border-[#54f28b66] bg-[#0a1a0e] px-3 py-1 text-[10px] uppercase tracking-wide text-[#54f28b] hover:bg-[#54f28b22] transition disabled:opacity-40"
                          >
                            {busy === item.tokenId ? "EQUIPPING..." : `EQUIP → ${item.equipSlot?.toUpperCase()}`}
                          </button>
                        )}
                        {canUnequip && (
                          <button
                            onClick={() => handleUnequip(item.equippedSlot!)}
                            disabled={busy !== null}
                            className="border-2 border-[#ff6b6b44] bg-[#1a0a0a] px-3 py-1 text-[10px] uppercase tracking-wide text-[#ff6b6b] hover:bg-[#ff6b6b22] transition disabled:opacity-40"
                          >
                            {busy === -1 ? "REMOVING..." : "UNEQUIP"}
                          </button>
                        )}
                        {canRecycle && (
                          <>
                            <button
                              onClick={() => handleRecycle(item, 1)}
                              disabled={busy !== null}
                              className="border-2 border-[#54f28b44] bg-[#09160d] px-3 py-1 text-[10px] uppercase tracking-wide text-[#54f28b] hover:bg-[#54f28b22] transition disabled:opacity-40"
                            >
                              {busy === item.tokenId ? "SELLING..." : `SELL 1 · ${formatCopperString(item.recycleCopperValue)}`}
                            </button>
                            {item.recyclableQuantity > 1 && (
                              <button
                                onClick={() => handleRecycle(item, item.recyclableQuantity)}
                                disabled={busy !== null}
                                className="border-2 border-[#54f28b22] bg-[#08110b] px-3 py-1 text-[10px] uppercase tracking-wide text-[#8af7b0] hover:bg-[#54f28b18] transition disabled:opacity-40"
                              >
                                {busy === item.tokenId ? "SELLING..." : `SELL ALL · ${formatCopperString(recycleValueTotal)}`}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────

function OverviewTab({
  entity,
  diary,
  kills,
  deaths,
  quests,
  itemCount,
}: {
  entity: LiveEntity | null;
  diary: DiaryEntry[];
  kills: number;
  deaths: number;
  quests: number;
  itemCount: number;
}) {
  const kd = deaths === 0 ? kills.toFixed(0) : (kills / deaths).toFixed(2);
  const recent = diary.slice(0, 8);

  const stats = [
    { label: "Level",  value: entity ? String(entity.level) : "--", color: "#ffcc00" },
    { label: "Kills",  value: String(kills),                        color: "#ff6b6b" },
    { label: "Deaths", value: String(deaths),                       color: "#9aa7cc" },
    { label: "K / D",  value: kd,                                   color: "#5dadec" },
    { label: "Quests", value: String(quests),                       color: "#54f28b" },
    { label: "Items",  value: String(itemCount),                    color: "#b48efa" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex flex-col items-center border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] py-3 shadow-[3px_3px_0_0_#000]"
          >
            <span className="text-[17px] font-bold font-mono" style={{ color: s.color, textShadow: "2px 2px 0 #000" }}>
              {s.value}
            </span>
            <span className="mt-0.5 text-[12px] uppercase tracking-wide text-[#7a84a8]">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2">
          <span className="text-[13px] uppercase tracking-widest text-[#7a84a8]">Recent Activity</span>
        </div>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-[17px] text-[#596a8a]">No activity yet</p>
        ) : (
          <div>
            {recent.map((e) => (
              <div key={e.id} className="flex items-start gap-3 border-b border-[#1e2842] px-4 py-2.5 last:border-b-0 font-mono">
                <span className="mt-0.5 shrink-0 text-[13px] uppercase tracking-wide" style={{ color: ACTION_COLORS[e.action] ?? "#7a84a8" }}>
                  {e.action.replace(/_/g, " ")}
                </span>
                <span className="flex-1 text-[17px] text-[#d6deff]">{e.headline}</span>
                <span className="shrink-0 text-[13px] text-[#596a8a]">{timeAgo(e.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Professions tab ───────────────────────────────────────────────────────

const RECIPE_ENDPOINTS: Record<string, string> = {
  alchemy: "/alchemy/recipes",
  cooking: "/cooking/recipes",
  blacksmithing: "/crafting/recipes",
  leatherworking: "/leatherworking/recipes",
  jewelcrafting: "/jewelcrafting/recipes",
};

interface RecipeInfo { recipeId?: string; id?: string; name?: string; output?: { name?: string }; }

function ProfessionsTab({
  learned,
  skills,
  custodialWallet,
}: {
  learned: string[];
  skills: Record<string, { level: number; xp: number; actions: number; progress: number }>;
  custodialWallet: string | null;
}) {
  const [expandedProf, setExpandedProf] = React.useState<string | null>(null);
  const [recipes, setRecipes] = React.useState<Record<string, RecipeInfo[]>>({});
  const [loadingRecipes, setLoadingRecipes] = React.useState<string | null>(null);

  async function toggleExpand(profId: string) {
    if (expandedProf === profId) { setExpandedProf(null); return; }
    setExpandedProf(profId);
    if (recipes[profId]) return;
    const endpoint = RECIPE_ENDPOINTS[profId];
    if (!endpoint) return;
    setLoadingRecipes(profId);
    try {
      const res = await fetch(`${API_URL}${endpoint}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.recipes ?? []);
        setRecipes((prev) => ({ ...prev, [profId]: list }));
      }
    } catch { /* non-fatal */ }
    finally { setLoadingRecipes(null); }
  }

  return (
    <div className="flex flex-col gap-3">
      {ALL_PROFESSIONS.map((p) => {
        const isLearned = learned.includes(p.id);
        const skill = skills[p.id];
        const isExpanded = expandedProf === p.id;
        const hasRecipes = !!RECIPE_ENDPOINTS[p.id];
        return (
          <div key={p.id} className={`border-4 border-black shadow-[3px_3px_0_0_#000] transition ${isLearned ? "bg-[linear-gradient(180deg,#0d1f0f,#0b1020)]" : "bg-[#0a0f1a] opacity-50"}`}>
            <button
              type="button"
              onClick={() => isLearned && hasRecipes ? toggleExpand(p.id) : undefined}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left ${isLearned && hasRecipes ? "cursor-pointer hover:bg-[#112a1b]/30" : ""}`}
            >
              <span className="text-[22px] shrink-0">{p.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[15px] uppercase tracking-wide font-mono ${isLearned ? "text-[#54f28b]" : "text-[#596a8a]"}`}>
                    {p.name}
                  </span>
                  {isLearned && skill && (
                    <span className="text-[11px] font-mono text-[#ffcc00]">Lv.{skill.level}</span>
                  )}
                  {!isLearned && <span className="text-[11px] font-mono text-[#596a8a]">[Locked]</span>}
                </div>
                {isLearned && skill && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-[6px] bg-[#1a2240] border border-[#29334d]">
                      <div className="h-full bg-[#54f28b] transition-all" style={{ width: `${Math.min(skill.progress, 100)}%` }} />
                    </div>
                    <span className="text-[9px] font-mono text-[#9aa7cc] shrink-0">{Math.round(skill.progress)}%</span>
                    <span className="text-[9px] font-mono text-[#596a8a] shrink-0">{skill.actions} actions</span>
                  </div>
                )}
              </div>
              {isLearned && hasRecipes && (
                <span className="text-[11px] text-[#596a8a] shrink-0">{isExpanded ? "−" : "+"}</span>
              )}
            </button>
            {isExpanded && isLearned && (
              <div className="border-t-2 border-[#1e2842] px-4 py-3">
                {loadingRecipes === p.id ? (
                  <p className="text-[11px] text-[#596a8a] font-mono">Loading recipes...</p>
                ) : (recipes[p.id] ?? []).length === 0 ? (
                  <p className="text-[11px] text-[#596a8a] font-mono">No recipes available</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {(recipes[p.id] ?? []).map((r, i) => (
                      <div key={r.recipeId ?? r.id ?? i} className="border border-[#29334d] bg-[#0a0f1a] px-2 py-1.5">
                        <p className="text-[11px] font-mono text-[#d6deff] truncate">{r.output?.name ?? r.name ?? r.recipeId ?? "Unknown"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Quests tab ────────────────────────────────────────────────────────────

function QuestsTab({ diary }: { diary: DiaryEntry[] }) {
  const quests = diary.filter((e) => e.action === "quest_complete");
  return (
    <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
      <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2 flex items-center justify-between">
        <span className="text-[13px] uppercase tracking-widest text-[#7a84a8]">Completed Quests</span>
        <span className="text-[17px] font-bold text-[#54f28b] font-mono">{quests.length}</span>
      </div>
      {quests.length === 0 ? (
        <p className="px-4 py-10 text-center text-[17px] text-[#596a8a]">No quests completed yet</p>
      ) : (
        <div>
          {quests.map((e) => {
            const xp = (e.details.xpReward as number) ?? 0;
            const copperReward = ((e.details.copperReward as number) ?? (e.details.goldReward as number) ?? 0);
            return (
              <div key={e.id} className="flex items-start justify-between border-b border-[#1e2842] px-4 py-3 last:border-b-0 font-mono hover:bg-[#1a2240]/30 transition">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-[#54f28b] font-bold">{e.headline}</p>
                  <p className="text-[13px] text-[#7a84a8] mt-0.5">{zoneLabel(e.zoneId)}</p>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0 ml-3">
                  {xp > 0 && <span className="text-[13px] text-[#ffcc00]">+{xp} XP</span>}
                  {copperReward > 0 && (
                    <span className="text-[13px] text-[#ffcc00]">+{formatCopperString(copperReward)}</span>
                  )}
                  <span className="text-[12px] text-[#596a8a]">{timeAgo(e.timestamp)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────

function ActivityTab({ diary }: { diary: DiaryEntry[] }) {
  return (
    <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
      <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2 flex items-center justify-between">
        <span className="text-[13px] uppercase tracking-widest text-[#7a84a8]">Activity Log</span>
        <span className="text-[17px] text-[#596a8a] font-mono">{diary.length} entries</span>
      </div>
      {diary.length === 0 ? (
        <p className="px-4 py-10 text-center text-[17px] text-[#596a8a]">No activity recorded</p>
      ) : (
        <div className="max-h-[520px] overflow-y-auto">
          {diary.map((e) => (
            <div key={e.id} className="border-b border-[#1a2030] px-4 py-2.5 last:border-b-0 font-mono hover:bg-[#1a2240]/20 transition">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[13px] uppercase tracking-wide shrink-0" style={{ color: ACTION_COLORS[e.action] ?? "#7a84a8" }}>
                  [{e.action.replace(/_/g, " ")}]
                </span>
                <span className="text-[17px] text-[#d6deff] flex-1">{e.headline}</span>
                <span className="text-[12px] text-[#596a8a] shrink-0">{timeAgo(e.timestamp)}</span>
              </div>
              <p className="text-[13px] text-[#596a8a] leading-relaxed">{e.narrative}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inbox tab ─────────────────────────────────────────────────────────────

interface InboxMessageEntry {
  id: string;
  from: string;
  fromName: string;
  to: string;
  type: "direct" | "trade-request" | "party-invite" | "broadcast";
  body: string;
  data?: Record<string, unknown>;
  ts: number;
}

const MSG_TYPE_COLORS: Record<string, string> = {
  direct:         "#5dadec",
  "trade-request": "#ffcc00",
  "party-invite":  "#54f28b",
  broadcast:       "#b48efa",
};

const MSG_TYPE_LABELS: Record<string, string> = {
  direct:         "DM",
  "trade-request": "TRADE",
  "party-invite":  "PARTY",
  broadcast:       "BROADCAST",
};

function InboxTab({ wallet }: { wallet: string }) {
  const [messages, setMessages] = React.useState<InboxMessageEntry[]>([]);
  const [total, setTotal]       = React.useState(0);
  const [loading, setLoading]   = React.useState(true);

  React.useEffect(() => {
    if (!wallet) return;
    let cancelled = false;

    async function fetchHistory() {
      try {
        const res = await fetch(`${API_URL}/inbox/${wallet}/history?limit=200`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setMessages(data.messages ?? []);
          setTotal(data.total ?? 0);
        }
      } catch { /* non-fatal */ }
      if (!cancelled) setLoading(false);
    }

    fetchHistory();
    const interval = setInterval(fetchHistory, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [wallet]);

  if (loading) {
    return <p className="px-4 py-10 text-center text-[17px] text-[#596a8a]">Loading inbox...</p>;
  }

  // Show newest first
  const sorted = [...messages].reverse();

  return (
    <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
      <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2 flex items-center justify-between">
        <span className="text-[13px] uppercase tracking-widest text-[#7a84a8]">Message History</span>
        <span className="text-[17px] text-[#596a8a] font-mono">{total} messages</span>
      </div>
      {sorted.length === 0 ? (
        <p className="px-4 py-10 text-center text-[17px] text-[#596a8a]">No messages received yet</p>
      ) : (
        <div className="max-h-[520px] overflow-y-auto">
          {sorted.map((m, i) => (
            <div key={m.id || i} className="border-b border-[#1a2030] px-4 py-2.5 last:border-b-0 font-mono hover:bg-[#1a2240]/20 transition">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className="text-[11px] uppercase tracking-wide shrink-0 px-1.5 py-0.5 border"
                  style={{
                    color: MSG_TYPE_COLORS[m.type] ?? "#7a84a8",
                    borderColor: MSG_TYPE_COLORS[m.type] ?? "#7a84a8",
                  }}
                >
                  {MSG_TYPE_LABELS[m.type] ?? m.type}
                </span>
                <span className="text-[13px] text-[#ffcc00] shrink-0">{m.fromName}</span>
                <span className="text-[17px] text-[#d6deff] flex-1 truncate">{m.body}</span>
                <span className="text-[12px] text-[#596a8a] shrink-0">{timeAgo(m.ts)}</span>
              </div>
              {m.data && Object.keys(m.data).length > 0 && (
                <p className="text-[11px] text-[#596a8a] mt-0.5">
                  {Object.entries(m.data).map(([k, v]) => `${k}: ${v}`).join(" | ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Party tab ─────────────────────────────────────────────────────────────

interface PartyMember {
  entityId: string;
  zoneId?: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  classId?: string;
  raceId?: string;
  walletAddress?: string;
  isLeader: boolean;
}

interface PartyInviteInfo {
  id: string;
  fromName: string;
  fromCustodialWallet: string;
  partyId: string;
  createdAt: number;
}

interface SearchResult {
  entityId: string;
  zoneId: string;
  name: string;
  level: number;
  classId?: string;
  raceId?: string;
  walletAddress?: string;
  inParty: boolean;
}

function PartyTab({
  custodialWallet,
  entityId,
  entityZoneId,
  ownerWallet,
}: {
  custodialWallet: string | null;
  entityId: string | null;
  entityZoneId: string | null;
  ownerWallet: string | null;
}) {
  const [partyStatus, setPartyStatus] = React.useState<{ inParty: boolean; partyId?: string; members: PartyMember[] }>({ inParty: false, members: [] });
  const [invites, setInvites] = React.useState<PartyInviteInfo[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [actionMsg, setActionMsg] = React.useState<string | null>(null);
  const isOnline = Boolean(entityId);

  React.useEffect(() => {
    if (!custodialWallet) return;
    async function poll() {
      try {
        const [statusRes, invitesRes] = await Promise.all([
          fetch(`${API_URL}/party/status/${custodialWallet}`),
          fetch(`${API_URL}/party/invites/${custodialWallet}`),
        ]);
        if (statusRes.ok) { const d = await statusRes.json(); setPartyStatus({ inParty: d.inParty, partyId: d.partyId, members: d.members ?? [] }); }
        if (invitesRes.ok) { const d = await invitesRes.json(); setInvites(d.invites ?? []); }
      } catch { /* non-fatal */ }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [custodialWallet]);

  async function doSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_URL}/party/search?q=${encodeURIComponent(searchQuery.trim())}`);
      if (res.ok) {
        const d = await res.json();
        setSearchResults((d.results ?? []).filter((r: SearchResult) => r.walletAddress?.toLowerCase() !== custodialWallet?.toLowerCase()));
      }
    } catch { /* non-fatal */ }
    finally { setSearching(false); }
  }

  async function sendInvite(target: SearchResult) {
    if (!entityId || !entityZoneId || !ownerWallet) return;
    if (!target.walletAddress) { setActionMsg("Champion has no wallet — cannot invite"); return; }
    try {
      const token = await getAuthToken(ownerWallet);
      if (!token) { setActionMsg("Auth failed"); return; }
      const res = await fetch(`${API_URL}/party/invite-champion`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fromEntityId: entityId, fromZoneId: entityZoneId, toCustodialWallet: target.walletAddress }),
      });
      const d = await res.json();
      if (res.ok) setActionMsg(`Invite sent to ${target.name}!`);
      else setActionMsg(`Error: ${d.error}`);
    } catch { setActionMsg("Failed to send invite"); }
    setTimeout(() => setActionMsg(null), 4000);
  }

  async function acceptInvite(invite: PartyInviteInfo) {
    if (!custodialWallet || !ownerWallet) return;
    const token = await getAuthToken(ownerWallet);
    if (!token) { setActionMsg("Auth failed — try refreshing"); setTimeout(() => setActionMsg(null), 4000); return; }
    try {
      const res = await fetch(`${API_URL}/party/accept-invite`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ custodialWallet, inviteId: invite.id }),
      });
      const d = await res.json();
      if (!res.ok) setActionMsg(`Error: ${d.error}`);
      else { setInvites((prev) => prev.filter((i) => i.id !== invite.id)); setActionMsg("Joined party!"); }
    } catch { setActionMsg("Failed to accept invite"); }
    setTimeout(() => setActionMsg(null), 4000);
  }

  async function declineInvite(invite: PartyInviteInfo) {
    if (!custodialWallet || !ownerWallet) return;
    const token = await getAuthToken(ownerWallet);
    if (!token) { setActionMsg("Auth failed — try refreshing"); setTimeout(() => setActionMsg(null), 4000); return; }
    try {
      const res = await fetch(`${API_URL}/party/decline-invite`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ custodialWallet, inviteId: invite.id }) });
      if (res.ok) setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      else { const d = await res.json().catch(() => ({})); setActionMsg(`Error: ${(d as any).error ?? "Failed"}`); setTimeout(() => setActionMsg(null), 4000); }
    } catch { setActionMsg("Failed to decline invite"); setTimeout(() => setActionMsg(null), 4000); }
  }

  async function leaveParty() {
    if (!custodialWallet || !ownerWallet) return;
    const token = await getAuthToken(ownerWallet);
    if (!token) { setActionMsg("Auth failed — try refreshing"); setTimeout(() => setActionMsg(null), 4000); return; }
    try {
      const res = await fetch(`${API_URL}/party/leave-wallet`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ custodialWallet }) });
      if (res.ok) { setPartyStatus({ inParty: false, members: [] }); setActionMsg("Left party"); }
      else { const d = await res.json().catch(() => ({})); setActionMsg(`Error: ${(d as any).error ?? res.statusText}`); }
    } catch { setActionMsg("Failed to leave party"); }
    setTimeout(() => setActionMsg(null), 4000);
  }

  return (
    <div className="flex flex-col gap-4 font-mono">
      {!isOnline && (
        <div className="border-2 border-[#ffcc00]/40 bg-[#2a2210] px-4 py-3 text-[17px] text-[#ffcc00]">
          [!] Champion must be online to send party invites.
        </div>
      )}
      {actionMsg && (
        <div className="border-2 border-[#54f28b]/40 bg-[#0a1a0e] px-3 py-2 text-[17px] text-[#54f28b]">{actionMsg}</div>
      )}
      {invites.length > 0 && (
        <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
          <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2">
            <span className="text-[13px] uppercase tracking-widest text-[#ffcc00]">Pending Invites ({invites.length})</span>
          </div>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 border-b border-[#1e2842] px-4 py-3 last:border-b-0">
              <div>
                <p className="text-[12px] text-[#d6deff]"><span className="text-[#ffcc00]">{inv.fromName}</span> invited your champion</p>
                <p className="text-[13px] text-[#596a8a] mt-0.5">{timeAgo(inv.createdAt)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => void acceptInvite(inv)} className="border-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-1 text-[17px] text-[#54f28b] hover:bg-[#112a1b] shadow-[2px_2px_0_0_#000]">[✓]</button>
                <button onClick={() => void declineInvite(inv)} className="border-2 border-[#2a3450] px-3 py-1 text-[17px] text-[#7a84a8] hover:text-[#9aa7cc]">[✗]</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2 flex items-center justify-between">
          <span className="text-[13px] uppercase tracking-widest text-[#7a84a8]">Current Party</span>
          {partyStatus.inParty && (
            <button onClick={() => void leaveParty()} className="text-[13px] text-[#ff6b6b] hover:text-[#ff9999]">[Leave]</button>
          )}
        </div>
        {!partyStatus.inParty ? (
          <p className="px-4 py-6 text-center text-[17px] text-[#596a8a]">Not in a party</p>
        ) : (
          <div>
            {partyStatus.members.map((m) => {
              const lc = levelColor(m.level);
              const hpPct = m.maxHp > 0 ? (m.hp / m.maxHp) * 100 : 0;
              const hc = hpPct > 66 ? "#54f28b" : hpPct > 33 ? "#ffcc00" : "#ff6b6b";
              return (
                <div key={m.entityId} className="flex items-center gap-3 border-b border-[#1e2842] px-4 py-3 last:border-b-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-[#d6deff]">{m.name}</span>
                      {m.isLeader && <span className="text-[12px] border border-[#ffcc00]/40 bg-[#2a2210] px-1 text-[#ffcc00]">LEAD</span>}
                      <span className="text-[17px] capitalize" style={{ color: lc }}>Lv {m.level}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[13px] capitalize text-[#7a84a8]">{m.raceId} {m.classId}</span>
                      {m.zoneId && <span className="text-[13px] text-[#596a8a]">• {zoneLabel(m.zoneId)}</span>}
                    </div>
                    <div className="mt-1 h-1.5 w-32 border border-black bg-[#0f1528]">
                      <div className="h-full transition-all" style={{ width: `${hpPct}%`, backgroundColor: hc }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2">
          <span className="text-[13px] uppercase tracking-widest text-[#7a84a8]">Find Champions</span>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search by champion name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }}
              className="flex-1 border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[12px] text-[#d6deff] placeholder-[#596a8a] outline-none focus:border-[#54f28b]"
            />
            <button
              onClick={() => void doSearch()}
              disabled={searching || !searchQuery.trim()}
              className="border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2 text-[12px] text-[#54f28b] shadow-[2px_2px_0_0_#000] hover:bg-[#112a1b] disabled:opacity-40"
            >
              {searching ? "..." : "[Search]"}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="flex flex-col gap-1">
              {searchResults.map((r) => {
                const lc = levelColor(r.level);
                return (
                  <div key={r.entityId} className="flex items-center justify-between border border-[#1e2842] bg-[#0b1020] px-3 py-2.5 hover:bg-[#1a2240]/30">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-[#d6deff]">{r.name}</span>
                        <span className="text-[17px]" style={{ color: lc }}>Lv {r.level}</span>
                        <span className="text-[13px] capitalize text-[#7a84a8]">{r.raceId} {r.classId}</span>
                      </div>
                      <span className="text-[13px] text-[#596a8a]">{zoneLabel(r.zoneId)}</span>
                    </div>
                    <button
                      onClick={() => void sendInvite(r)}
                      disabled={!isOnline || r.inParty}
                      className="border-2 border-[#26a5e4] bg-[#0a1020] px-3 py-1 text-[17px] text-[#26a5e4] shadow-[2px_2px_0_0_#000] hover:bg-[#0e1830] disabled:opacity-30"
                    >
                      {r.inParty ? "In Party" : "[Invite]"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {searchResults.length === 0 && searchQuery && !searching && (
            <p className="text-center text-[17px] text-[#596a8a]">No champions found online</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Friends tab ──────────────────────────────────────────────────────────

const RANK_COLORS: Record<string, string> = {
  "Legendary Hero":     "#FFD700",
  "Renowned Champion":  "#9B59B6",
  "Trusted Veteran":    "#3498DB",
  "Reliable Ally":      "#2ECC71",
  "Average Citizen":    "#95A5A6",
  "Questionable":       "#F39C12",
  "Untrustworthy":      "#E67E22",
  "Notorious":          "#E74C3C",
};

interface FriendInfo {
  wallet: string;
  addedAt: number;
  online: boolean;
  name: string | null;
  wogName: string | null;
  level: number | null;
  classId: string | null;
  raceId: string | null;
  zoneId: string | null;
  reputation: number;
  reputationRank: string;
}

interface FriendRequestInfo {
  id: string;
  fromWallet: string;
  fromName: string;
  createdAt: number;
}

function FriendsTab({
  ownerWallet,
  custodialWallet,
  entityId,
  entityZoneId,
}: {
  ownerWallet: string | null;
  custodialWallet: string | null;
  entityId: string | null;
  entityZoneId: string | null;
}) {
  const [friends, setFriends] = React.useState<FriendInfo[]>([]);
  const [requests, setRequests] = React.useState<FriendRequestInfo[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const friendAddresses = React.useMemo(() => friends.map((f) => f.wallet), [friends]);
  const { dn } = useWogNames(friendAddresses);
  const [wogNameInput, setWogNameInput] = React.useState("");
  const [wogSending, setWogSending] = React.useState(false);
  const [actionMsg, setActionMsg] = React.useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [availableGold, setAvailableGold] = React.useState<number | null>(null);
  const [transferFeeGold, setTransferFeeGold] = React.useState(0.0025);
  const [transferFeeLabel, setTransferFeeLabel] = React.useState("25c");
  const [transferTargetWallet, setTransferTargetWallet] = React.useState<string | null>(null);
  const [transferAmount, setTransferAmount] = React.useState(0);
  const [sendingGold, setSendingGold] = React.useState(false);

  const friendWallets = React.useMemo(
    () => new Set(friends.map((f) => f.wallet.toLowerCase())),
    [friends],
  );

  function showAction(text: string, tone: "ok" | "error" = "ok", timeoutMs = 4000) {
    setActionMsg({ text, tone });
    window.setTimeout(() => setActionMsg(null), timeoutMs);
  }

  async function getOwnerAuthHeaders(): Promise<Record<string, string> | null> {
    if (!ownerWallet) {
      showAction("Wallet not connected — reconnect and try again.", "error");
      return null;
    }
    const token = await getAuthToken(ownerWallet);
    if (!token) {
      showAction("Auth failed. Reconnect wallet and try again.", "error");
      return null;
    }
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }

  async function refreshTransferState() {
    if (!custodialWallet) return;
    try {
      const [balanceRes, feeRes] = await Promise.all([
        fetch(`${API_URL}/wallet/${custodialWallet}/balance`),
        fetch(`${API_URL}/gold/transfer/config`),
      ]);

      if (balanceRes.ok) {
        const data = await balanceRes.json();
        const parsed = parseFloat(data.gold ?? "0");
        setAvailableGold(Number.isFinite(parsed) ? parsed : 0);
      }

      if (feeRes.ok) {
        const data = await feeRes.json();
        const parsed = parseFloat(data.feeGold ?? "0.0025");
        if (Number.isFinite(parsed) && parsed >= 0) setTransferFeeGold(parsed);
        if (typeof data.feeLabel === "string" && data.feeLabel.trim()) setTransferFeeLabel(data.feeLabel);
      }
    } catch {
      // non-fatal
    }
  }

  // Poll friends list
  React.useEffect(() => {
    if (!custodialWallet) return;
    async function poll() {
      try {
        const res = await fetch(`${API_URL}/friends/${custodialWallet}`);
        if (res.ok) {
          const d = await res.json();
          setFriends(d.friends ?? []);
        }
      } catch { /* non-fatal */ }
    }
    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  }, [custodialWallet]);

  React.useEffect(() => {
    if (!custodialWallet) return;
    refreshTransferState();
    const interval = setInterval(() => { void refreshTransferState(); }, 15_000);
    return () => clearInterval(interval);
  }, [custodialWallet]);

  // Poll friend requests
  React.useEffect(() => {
    if (!custodialWallet) return;
    async function poll() {
      try {
        const res = await fetch(`${API_URL}/friends/requests/${custodialWallet}`);
        if (res.ok) {
          const d = await res.json();
          setRequests(d.requests ?? []);
        }
      } catch { /* non-fatal */ }
    }
    poll();
    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, [custodialWallet]);

  async function doSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_URL}/party/search?q=${encodeURIComponent(searchQuery.trim())}`);
      if (res.ok) {
        const d = await res.json();
        setSearchResults(
          (d.results ?? []).filter(
            (r: SearchResult) => r.walletAddress?.toLowerCase() !== custodialWallet?.toLowerCase(),
          ),
        );
      }
    } catch { /* non-fatal */ }
    finally { setSearching(false); }
  }

  async function sendFriendRequest(target: SearchResult) {
    if (!custodialWallet || !target.walletAddress) return;
    try {
      const headers = await getOwnerAuthHeaders();
      if (!headers) return;
      const res = await fetch(`${API_URL}/friends/request`, {
        method: "POST",
        headers,
        body: JSON.stringify({ fromWallet: custodialWallet, toWallet: target.walletAddress }),
      });
      const d = await res.json();
      if (res.ok) showAction(`Friend request sent to ${target.name}!`);
      else showAction(`Error: ${d.error}`, "error");
    } catch { showAction("Failed to send request", "error"); }
  }

  async function sendByWogName() {
    if (!custodialWallet || !wogNameInput.trim()) return;
    setWogSending(true);
    try {
      const headers = await getOwnerAuthHeaders();
      if (!headers) return;
      const res = await fetch(`${API_URL}/friends/request-by-name`, {
        method: "POST",
        headers,
        body: JSON.stringify({ fromWallet: custodialWallet, toName: wogNameInput.trim() }),
      });
      const d = await res.json();
      if (res.ok) { showAction(`Friend request sent to ${wogNameInput.trim().replace(/\.wog$/i, "")}.wog!`); setWogNameInput(""); }
      else showAction(`Error: ${d.error}`, "error");
    } catch { showAction("Failed to send request", "error"); }
    finally { setWogSending(false); }
  }

  async function acceptRequest(req: FriendRequestInfo) {
    if (!custodialWallet) return;
    try {
      const headers = await getOwnerAuthHeaders();
      if (!headers) return;
      const res = await fetch(`${API_URL}/friends/accept`, {
        method: "POST",
        headers,
        body: JSON.stringify({ wallet: custodialWallet, requestId: req.id }),
      });
      const d = await res.json();
      if (res.ok) {
        setRequests((prev) => prev.filter((r) => r.id !== req.id));
        showAction(`You are now friends with ${req.fromName}!`);
      } else showAction(`Error: ${d.error}`, "error");
    } catch { showAction("Failed to accept", "error"); }
  }

  async function declineRequest(req: FriendRequestInfo) {
    if (!custodialWallet) return;
    const headers = await getOwnerAuthHeaders();
    if (!headers) return;
    const res = await fetch(`${API_URL}/friends/decline`, {
      method: "POST",
      headers,
      body: JSON.stringify({ wallet: custodialWallet, requestId: req.id }),
    });
    if (res.ok) {
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } else {
      const d = await res.json().catch(() => ({}));
      showAction(`Error: ${d.error ?? "Failed to decline request"}`, "error");
    }
  }

  async function removeFriend(f: FriendInfo) {
    if (!custodialWallet) return;
    const headers = await getOwnerAuthHeaders();
    if (!headers) return;
    const res = await fetch(`${API_URL}/friends/remove`, {
      method: "POST",
      headers,
      body: JSON.stringify({ wallet: custodialWallet, targetWallet: f.wallet }),
    });
    if (res.ok) {
      setFriends((prev) => prev.filter((x) => x.wallet !== f.wallet));
      if (transferTargetWallet === f.wallet) {
        setTransferTargetWallet(null);
        setTransferAmount(0);
      }
      showAction("Friend removed.", "ok", 3000);
    } else {
      const d = await res.json().catch(() => ({}));
      showAction(`Error: ${d.error ?? "Failed to remove friend"}`, "error");
    }
  }

  async function inviteFriend(f: FriendInfo) {
    if (!entityId || !entityZoneId || !f.wallet) return;
    try {
      const headers = await getOwnerAuthHeaders();
      if (!headers) return;
      const res = await fetch(`${API_URL}/party/invite-champion`, {
        method: "POST",
        headers,
        body: JSON.stringify({ fromEntityId: entityId, fromZoneId: entityZoneId, toCustodialWallet: f.wallet }),
      });
      const d = await res.json();
      if (res.ok) showAction(`Party invite sent to ${f.name}!`);
      else showAction(`Error: ${d.error}`, "error");
    } catch { showAction("Failed to invite", "error"); }
  }

  async function sendGold(friend: FriendInfo) {
    if (!ownerWallet || !custodialWallet) return;
    if (!transferTargetWallet || transferTargetWallet !== friend.wallet) return;

    const normalizedAmount = Math.floor(transferAmount * 10000) / 10000;
    if (normalizedAmount <= 0) {
      showAction("Enter a gold amount greater than 0.", "error");
      return;
    }

    const totalGold = normalizedAmount + transferFeeGold;
    if (availableGold !== null && totalGold > availableGold) {
      showAction("Not enough spendable gold for amount plus fee.", "error");
      return;
    }

    setSendingGold(true);
    try {
      const headers = await getOwnerAuthHeaders();
      if (!headers) return;

      const res = await fetch(`${API_URL}/gold/transfer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ toWallet: friend.wallet, amount: normalizedAmount }),
      });
      const data = await res.json();
      if (!res.ok) {
        showAction(data.error ?? "Gold transfer failed", "error");
        return;
      }

      const remaining = parseFloat(data.remainingGold ?? "0");
      if (Number.isFinite(remaining)) setAvailableGold(remaining);
      setTransferTargetWallet(null);
      setTransferAmount(0);
      showAction(`Sent ${formatGoldString(normalizedAmount)} to ${friend.name ?? friend.wogName ?? dn(friend.wallet)}. Fee: ${data.feeLabel ?? transferFeeLabel}.`);
      void refreshTransferState();
    } catch {
      showAction("Gold transfer failed", "error");
    } finally {
      setSendingGold(false);
    }
  }

  const isOnline = Boolean(entityId);
  const transferTotal = transferAmount + transferFeeGold;

  return (
    <div className="flex flex-col gap-4 font-mono">
      {actionMsg && (
        <div
          className="border-2 px-3 py-2 text-[17px]"
          style={{
            borderColor: actionMsg.tone === "error" ? "#ff6b6b66" : "#54f28b66",
            backgroundColor: actionMsg.tone === "error" ? "#1a0a0a" : "#0a1a0e",
            color: actionMsg.tone === "error" ? "#ff6b6b" : "#54f28b",
          }}
        >
          {actionMsg.text}
        </div>
      )}

      {/* Friend Requests */}
      {requests.length > 0 && (
        <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
          <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2">
            <span className="text-[13px] uppercase tracking-widest text-[#ffcc00]">Friend Requests ({requests.length})</span>
          </div>
          {requests.map((req) => (
            <div key={req.id} className="flex items-center justify-between gap-3 border-b border-[#1e2842] px-4 py-3 last:border-b-0">
              <div>
                <p className="text-[12px] text-[#d6deff]"><span className="text-[#ffcc00]">{req.fromName}</span> wants to be friends</p>
                <p className="text-[13px] text-[#596a8a] mt-0.5">{timeAgo(req.createdAt)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => void acceptRequest(req)} className="border-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-1 text-[17px] text-[#54f28b] hover:bg-[#112a1b] shadow-[2px_2px_0_0_#000]">[&#10003;]</button>
                <button onClick={() => void declineRequest(req)} className="border-2 border-[#2a3450] px-3 py-1 text-[17px] text-[#7a84a8] hover:text-[#9aa7cc]">[&#10007;]</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Friends List */}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2 flex items-center justify-between">
          <span className="text-[13px] uppercase tracking-widest text-[#7a84a8]">Friends List</span>
          <div className="text-right">
            <span className="block text-[17px] text-[#596a8a] font-mono">{friends.length} / {50}</span>
            {availableGold !== null && (
              <span className="block text-[12px] text-[#ffcc00]">Spendable: {formatGoldString(availableGold)}</span>
            )}
          </div>
        </div>
        {friends.length === 0 ? (
          <p className="px-4 py-6 text-center text-[17px] text-[#596a8a]">No friends yet — search below to add some!</p>
        ) : (
          <div>
            {friends.map((f) => {
              const lc = levelColor(f.level ?? 0);
              return (
                <React.Fragment key={f.wallet}>
                  <div className="flex items-center gap-3 border-b border-[#1e2842] px-4 py-3 last:border-b-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {f.online ? (
                          <span className="text-[12px] text-[#54f28b]">●</span>
                        ) : (
                          <span className="text-[12px] text-[#596a8a]">●</span>
                        )}
                        <span className="text-[13px] font-bold text-[#d6deff]">{f.name ?? f.wogName ?? dn(f.wallet)}</span>
                        {f.wogName && <span className="text-[12px] text-[#5dadec]">{f.wogName}</span>}
                        {f.level != null && <span className="text-[17px]" style={{ color: lc }}>Lv {f.level}</span>}
                        {f.raceId && <span className="text-[13px] capitalize text-[#7a84a8]">{f.raceId} {f.classId}</span>}
                        {f.reputationRank && (
                          <span
                            className="text-[12px] border px-1 py-0.5 uppercase tracking-wide"
                            style={{ color: RANK_COLORS[f.reputationRank] ?? "#95A5A6", borderColor: (RANK_COLORS[f.reputationRank] ?? "#95A5A6") + "44", backgroundColor: (RANK_COLORS[f.reputationRank] ?? "#95A5A6") + "11" }}
                          >
                            {f.reputationRank}
                          </span>
                        )}
                      </div>
                      <span className="text-[13px] text-[#596a8a]">
                        {f.online && f.zoneId ? zoneLabel(f.zoneId) : "Offline"}
                      </span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => {
                          if (transferTargetWallet === f.wallet) {
                            setTransferTargetWallet(null);
                            setTransferAmount(0);
                            return;
                          }
                          setTransferTargetWallet(f.wallet);
                          setTransferAmount(0);
                        }}
                        className="border-2 border-[#ffcc00] bg-[#1f1807] px-3 py-1 text-[17px] text-[#ffcc00] shadow-[2px_2px_0_0_#000] hover:bg-[#2b220c]"
                      >
                        {transferTargetWallet === f.wallet ? "[Close]" : "[Send Gold]"}
                      </button>
                      {f.online && isOnline && (
                        <button
                          onClick={() => void inviteFriend(f)}
                          className="border-2 border-[#26a5e4] bg-[#0a1020] px-3 py-1 text-[17px] text-[#26a5e4] shadow-[2px_2px_0_0_#000] hover:bg-[#0e1830]"
                        >
                          [Invite]
                        </button>
                      )}
                      <button
                        onClick={() => void removeFriend(f)}
                        className="border-2 border-[#2a3450] px-3 py-1 text-[17px] text-[#7a84a8] hover:text-[#ff6b6b] hover:border-[#ff6b6b]/40"
                      >
                        [Remove]
                      </button>
                    </div>
                  </div>
                  {transferTargetWallet === f.wallet && (
                    <div className="border-b border-[#1e2842] bg-[#0a0f1a] px-4 py-4 last:border-b-0">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                        <div className="flex flex-col gap-2">
                          <p className="text-[13px] text-[#d6deff]">
                            Send ERC20 gold to <span className="text-[#ffcc00]">{f.name ?? f.wogName ?? dn(f.wallet)}</span>
                          </p>
                          <CurrencyInput
                            value={transferAmount}
                            onChange={setTransferAmount}
                            min={0}
                            max={availableGold !== null ? Math.max(0, availableGold - transferFeeGold) : undefined}
                            disabled={sendingGold}
                            size="md"
                          />
                          <p className="text-[12px] text-[#596a8a]">
                            Recipient wallet: {f.wallet.slice(0, 8)}...{f.wallet.slice(-6)}
                          </p>
                        </div>
                        <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
                          <p className="text-[12px] uppercase tracking-wide text-[#7a84a8]">Transfer Summary</p>
                          <div className="mt-2 space-y-1 text-[13px]">
                            <div className="flex items-center justify-between">
                              <span className="text-[#7a84a8]">Amount</span>
                              <span className="text-[#d6deff]">{formatGoldString(transferAmount)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[#7a84a8]">Fee</span>
                              <span className="text-[#ff8c42]">{transferFeeLabel}</span>
                            </div>
                            <div className="flex items-center justify-between border-t border-[#1e2842] pt-2">
                              <span className="text-[#7a84a8]">Total</span>
                              <span className="text-[#ffcc00]">{formatGoldString(transferTotal)}</span>
                            </div>
                            {availableGold !== null && (
                              <div className="flex items-center justify-between">
                                <span className="text-[#7a84a8]">Available</span>
                                <span className="text-[#54f28b]">{formatGoldString(availableGold)}</span>
                              </div>
                            )}
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => void sendGold(f)}
                              disabled={sendingGold || transferAmount <= 0 || !ownerWallet}
                              className="flex-1 border-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-2 text-[12px] text-[#54f28b] shadow-[2px_2px_0_0_#000] hover:bg-[#112a1b] disabled:opacity-40"
                            >
                              {sendingGold ? "Sending..." : "[Confirm Send]"}
                            </button>
                            <button
                              onClick={() => {
                                setTransferTargetWallet(null);
                                setTransferAmount(0);
                              }}
                              disabled={sendingGold}
                              className="border-2 border-[#2a3450] px-3 py-2 text-[12px] text-[#7a84a8] hover:text-[#9aa7cc] disabled:opacity-40"
                            >
                              [Cancel]
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Add by .wog Name */}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2">
          <span className="text-[13px] uppercase tracking-widest text-[#5dadec]">Add by .wog Name</span>
        </div>
        <div className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="e.g. Aelric"
                value={wogNameInput}
                onChange={(e) => setWogNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void sendByWogName(); }}
                className="w-full border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 pr-12 text-[12px] text-[#d6deff] placeholder-[#596a8a] outline-none focus:border-[#5dadec]"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#5dadec] pointer-events-none">.wog</span>
            </div>
            <button
              onClick={() => void sendByWogName()}
              disabled={wogSending || !wogNameInput.trim()}
              className="border-2 border-[#5dadec] bg-[#0a1020] px-4 py-2 text-[12px] text-[#5dadec] shadow-[2px_2px_0_0_#000] hover:bg-[#0e1830] disabled:opacity-40"
            >
              {wogSending ? "..." : "[Add]"}
            </button>
          </div>
          <p className="mt-2 text-[13px] text-[#596a8a]">Send a friend request by .wog name — works even if they're offline.</p>
        </div>
      </div>

      {/* Search Online Champions */}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2">
          <span className="text-[13px] uppercase tracking-widest text-[#7a84a8]">Search Online Champions</span>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search by champion name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }}
              className="flex-1 border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[12px] text-[#d6deff] placeholder-[#596a8a] outline-none focus:border-[#54f28b]"
            />
            <button
              onClick={() => void doSearch()}
              disabled={searching || !searchQuery.trim()}
              className="border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2 text-[12px] text-[#54f28b] shadow-[2px_2px_0_0_#000] hover:bg-[#112a1b] disabled:opacity-40"
            >
              {searching ? "..." : "[Search]"}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="flex flex-col gap-1">
              {searchResults.map((r) => {
                const lc = levelColor(r.level);
                const alreadyFriend = r.walletAddress ? friendWallets.has(r.walletAddress.toLowerCase()) : false;
                return (
                  <div key={r.entityId} className="flex items-center justify-between border border-[#1e2842] bg-[#0b1020] px-3 py-2.5 hover:bg-[#1a2240]/30">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-[#d6deff]">{r.name}</span>
                        <span className="text-[17px]" style={{ color: lc }}>Lv {r.level}</span>
                        <span className="text-[13px] capitalize text-[#7a84a8]">{r.raceId} {r.classId}</span>
                      </div>
                      <span className="text-[13px] text-[#596a8a]">{zoneLabel(r.zoneId)}</span>
                    </div>
                    <button
                      onClick={() => void sendFriendRequest(r)}
                      disabled={alreadyFriend || !r.walletAddress}
                      className="border-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-1 text-[17px] text-[#54f28b] shadow-[2px_2px_0_0_#000] hover:bg-[#112a1b] disabled:opacity-30"
                    >
                      {alreadyFriend ? "Friends" : "[Add]"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {searchResults.length === 0 && searchQuery && !searching && (
            <p className="text-center text-[17px] text-[#596a8a]">No champions found online</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Guild tab ────────────────────────────────────────────────────────────

interface GuildInfo {
  guildId: number;
  name: string;
  description: string;
  founder: string;
  treasury: number;
  level: number;
  reputation: number;
  status: string;
  createdAt: number;
  memberCount: number;
}

interface GuildMemberInfo {
  address: string;
  rank: string;
  joinedAt: number;
  contributedGold: number;
}

interface GuildProposalInfo {
  proposalId: number;
  proposalType: string;
  description: string;
  proposer: string;
  yesVotes: number;
  noVotes: number;
  status: string;
  timeRemaining: number;
  targetAddress: string;
  targetAmount: number;
}

const RANK_BADGE_COLORS: Record<string, string> = {
  Founder: "#ff6b6b",
  Officer: "#ffcc00",
  Member:  "#9aa7cc",
};

const PROPOSAL_ICONS: Record<string, string> = {
  "withdraw-gold":   "G",
  "kick-member":     "K",
  "promote-officer": "+",
  "demote-officer":  "-",
  "disband-guild":   "X",
};

const PROPOSAL_STATUS_COLORS: Record<string, string> = {
  active:   "#5dadec",
  passed:   "#54f28b",
  failed:   "#ff6b6b",
  executed: "#b48efa",
  cancelled: "#7a84a8",
};

function GuildTab({ custodialWallet, ownerWallet }: { custodialWallet: string | null; ownerWallet: string | null }) {
  const [loading, setLoading] = React.useState(true);
  const [inGuild, setInGuild] = React.useState(false);
  const [guild, setGuild] = React.useState<GuildInfo | null>(null);
  const [myRole, setMyRole] = React.useState<string | null>(null);
  const [members, setMembers] = React.useState<GuildMemberInfo[]>([]);
  const [proposals, setProposals] = React.useState<GuildProposalInfo[]>([]);
  const [subTab, setSubTab] = React.useState<"members" | "proposals">("members");
  const [showCreate, setShowCreate] = React.useState(false);
  const [guildName, setGuildName] = React.useState("");
  const [guildDesc, setGuildDesc] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!custodialWallet) { setLoading(false); return; }
    let cancelled = false;

    async function fetchGuild() {
      try {
        const res = await fetch(`${API_URL}/guild/wallet/${custodialWallet}`);
        if (!res.ok) { if (!cancelled) setLoading(false); return; }
        const data = await res.json();
        if (cancelled) return;
        setInGuild(data.inGuild ?? false);
        setGuild(data.guild ?? null);
        setMyRole(data.member?.rank ?? null);
        setMembers(data.members ?? []);
        setProposals(data.proposals ?? []);
      } catch { /* non-fatal */ }
      if (!cancelled) setLoading(false);
    }

    fetchGuild();
    const interval = setInterval(fetchGuild, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [custodialWallet, refreshKey]);

  async function handleCreateGuild() {
    if (!custodialWallet || !ownerWallet || !guildName.trim() || !guildDesc.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const token = await getAuthToken(ownerWallet);
      if (!token) { setCreateError("Auth failed — reconnect wallet"); return; }
      const res = await fetch(`${API_URL}/guild/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          founderAddress: custodialWallet,
          name: guildName.trim(),
          description: guildDesc.trim(),
          initialDeposit: 100,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setShowCreate(false);
        setGuildName("");
        setGuildDesc("");
        setRefreshKey((k) => k + 1);
      } else {
        setCreateError(data.error ?? "Failed to create guild");
      }
    } catch (err: any) {
      setCreateError(err.message ?? "Network error");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <p className="px-4 py-10 text-center text-[13px] text-[#7a84a8] animate-pulse">Loading guild data...</p>;
  }

  if (!inGuild || !guild) {
    return (
      <div className="flex flex-col gap-4 font-mono">
        <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000] px-4 py-8 text-center">
          <p className="text-[14px] text-[#7a84a8]">Not in a guild</p>
          <p className="text-[12px] text-[#596a8a] mt-2 mb-4">
            Incorporate your own guild or visit a Guild Registrar NPC to join one.
          </p>
          {!showCreate && custodialWallet && (
            <button
              onClick={() => setShowCreate(true)}
              className="border-2 border-[#54f28b] bg-[#0a1a0e] px-5 py-2 text-[12px] uppercase tracking-wide text-[#54f28b] shadow-[3px_3px_0_0_#000] hover:bg-[#112a1b] transition"
            >
              [+] Incorporate Guild — 500 Gold
            </button>
          )}
        </div>

        {showCreate && (
          <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
            <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-3 py-1.5">
              <span className="text-[10px] uppercase tracking-widest text-[#54f28b]">{">> INCORPORATE GUILD"}</span>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wide text-[#7a84a8] mb-1 block">Guild Name (3-32 chars)</label>
                <input
                  type="text"
                  value={guildName}
                  onChange={(e) => setGuildName(e.target.value)}
                  maxLength={32}
                  placeholder="e.g. Knights of Geneva"
                  className="w-full border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[12px] text-[#d6deff] placeholder-[#596a8a] outline-none focus:border-[#54f28b]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-[#7a84a8] mb-1 block">Description</label>
                <input
                  type="text"
                  value={guildDesc}
                  onChange={(e) => setGuildDesc(e.target.value)}
                  maxLength={200}
                  placeholder="What is your guild about?"
                  className="w-full border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[12px] text-[#d6deff] placeholder-[#596a8a] outline-none focus:border-[#54f28b]"
                />
              </div>

              <div className="border border-[#2a3450] bg-[#0a0f1a] px-3 py-2 text-[11px]">
                <div className="flex justify-between text-[#9aa7cc]">
                  <span>Creation Fee</span><span className="text-[#ffcc00]">400 Gold</span>
                </div>
                <div className="flex justify-between text-[#9aa7cc] mt-1">
                  <span>Treasury Deposit</span><span className="text-[#ffcc00]">100 Gold</span>
                </div>
                <div className="flex justify-between text-[#d6deff] mt-1 pt-1 border-t border-[#2a3450] font-bold">
                  <span>Total</span><span className="text-[#ffcc00]">500 Gold</span>
                </div>
              </div>

              {createError && (
                <div className="border border-[#ff6b6b44] bg-[#1a0a0a] px-3 py-2 text-[11px] text-[#ff6b6b]">
                  {createError}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => void handleCreateGuild()}
                  disabled={creating || guildName.trim().length < 3 || !guildDesc.trim()}
                  className="flex-1 border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2 text-[12px] uppercase tracking-wide text-[#54f28b] shadow-[3px_3px_0_0_#000] hover:bg-[#112a1b] transition disabled:opacity-40"
                >
                  {creating ? "Incorporating..." : "Incorporate Guild"}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setCreateError(null); }}
                  className="border-2 border-[#2a3450] px-4 py-2 text-[12px] text-[#7a84a8] hover:text-[#9aa7cc] transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const activeProposals = proposals.filter((p) => p.status === "active");
  const pastProposals = proposals.filter((p) => p.status !== "active");

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Guild header card */}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-3 py-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[#7a84a8]">{">> GUILD"}</span>
          {myRole && (
            <span
              className="text-[10px] uppercase tracking-wide border px-2 py-0.5"
              style={{ color: RANK_BADGE_COLORS[myRole] ?? "#9aa7cc", borderColor: (RANK_BADGE_COLORS[myRole] ?? "#9aa7cc") + "44" }}
            >
              {myRole}
            </span>
          )}
        </div>
        <div className="px-4 py-4">
          <p className="text-[18px] font-bold text-[#54f28b]" style={{ textShadow: "2px 2px 0 #000" }}>
            {guild.name}
          </p>
          <p className="text-[11px] text-[#9aa7cc] mt-1">{guild.description}</p>

          <div className="grid grid-cols-2 gap-2 mt-3 sm:grid-cols-4">
            {[
              { label: "Members", value: String(guild.memberCount), color: "#5dadec" },
              { label: "Treasury", value: `${guild.treasury.toFixed(2)}g`, color: "#ffcc00" },
              { label: "Level", value: String(guild.level), color: "#54f28b" },
              { label: "Reputation", value: String(guild.reputation), color: "#b48efa" },
            ].map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center border-2 border-[#2a3450] bg-[#0a0f1a] py-2"
              >
                <span className="text-[15px] font-bold" style={{ color: s.color }}>{s.value}</span>
                <span className="text-[9px] uppercase tracking-wide text-[#7a84a8]">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sub-tabs: Members | Proposals */}
      <div className="flex gap-0 border-b-2 border-[#2a3450]">
        {(["members", "proposals"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-2 text-[11px] uppercase tracking-wide transition ${
              subTab === t
                ? "border-b-2 border-[#54f28b] text-[#54f28b] bg-[#0a1a0e]"
                : "text-[#7a84a8] hover:text-[#9aa7cc]"
            }`}
            style={{ marginBottom: subTab === t ? "-2px" : "0" }}
          >
            {t === "members" ? `Members (${members.length})` : `Proposals (${proposals.length})`}
          </button>
        ))}
      </div>

      {/* Members list */}
      {subTab === "members" && (
        <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
          {members.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-[#7a84a8]">No members</p>
          ) : (
            <div>
              {members.map((m) => (
                <div key={m.address} className="flex items-center justify-between border-b border-[#1e2842] px-4 py-3 last:border-b-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-[10px] uppercase tracking-wide border px-1.5 py-0.5 shrink-0"
                      style={{ color: RANK_BADGE_COLORS[m.rank] ?? "#9aa7cc", borderColor: (RANK_BADGE_COLORS[m.rank] ?? "#9aa7cc") + "44" }}
                    >
                      {m.rank}
                    </span>
                    <span className="text-[12px] text-[#d6deff] truncate">
                      {m.address.slice(0, 8)}...{m.address.slice(-6)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] text-[#ffcc00]">{m.contributedGold.toFixed(2)}g</span>
                    <span className="text-[10px] text-[#596a8a]">{timeAgo(m.joinedAt * 1000)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Proposals list */}
      {subTab === "proposals" && (
        <div className="flex flex-col gap-3">
          {proposals.length === 0 ? (
            <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000] px-4 py-6 text-center">
              <p className="text-[13px] text-[#7a84a8]">No proposals yet</p>
            </div>
          ) : (
            <>
              {activeProposals.length > 0 && (
                <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
                  <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-3 py-1.5">
                    <span className="text-[10px] uppercase tracking-widest text-[#5dadec]">Active Votes</span>
                  </div>
                  {activeProposals.map((p) => (
                    <div key={p.proposalId} className="border-b border-[#1e2842] px-4 py-3 last:border-b-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px] font-bold text-[#5dadec] shrink-0">
                          [{PROPOSAL_ICONS[p.proposalType] ?? "?"}]
                        </span>
                        <span className="text-[11px] text-[#d6deff] flex-1">{p.description}</span>
                        <span className="text-[10px] text-[#5dadec] shrink-0">
                          {p.timeRemaining > 0 ? `${Math.floor(p.timeRemaining / 3600)}h ${Math.floor((p.timeRemaining % 3600) / 60)}m left` : "Expired"}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-[10px]">
                        <span className="text-[#7a84a8] capitalize">{p.proposalType.replace(/-/g, " ")}</span>
                        <span className="text-[#54f28b]">YES {p.yesVotes}</span>
                        <span className="text-[#ff6b6b]">NO {p.noVotes}</span>
                        {p.targetAmount > 0 && <span className="text-[#ffcc00]">{p.targetAmount}g</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {pastProposals.length > 0 && (
                <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
                  <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-3 py-1.5">
                    <span className="text-[10px] uppercase tracking-widest text-[#7a84a8]">Past Proposals</span>
                  </div>
                  {pastProposals.map((p) => (
                    <div key={p.proposalId} className="border-b border-[#1e2842] px-4 py-2.5 last:border-b-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[#9aa7cc] flex-1">{p.description}</span>
                        <span
                          className="text-[10px] uppercase tracking-wide border px-1.5 py-0.5 shrink-0"
                          style={{ color: PROPOSAL_STATUS_COLORS[p.status] ?? "#7a84a8", borderColor: (PROPOSAL_STATUS_COLORS[p.status] ?? "#7a84a8") + "44" }}
                        >
                          {p.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-[10px] mt-0.5">
                        <span className="text-[#7a84a8] capitalize">{p.proposalType.replace(/-/g, " ")}</span>
                        <span className="text-[#54f28b]">YES {p.yesVotes}</span>
                        <span className="text-[#ff6b6b]">NO {p.noVotes}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Reputation Tab ────────────────────────────────────────────────────────

interface RepScore {
  combat: number; economic: number; social: number; crafting: number; agent: number; overall: number; rank: string;
}

interface RepTimelinePoint {
  ts: number; combat: number; economic: number; social: number; crafting: number; agent: number; overall: number;
  category?: string; delta?: number; reason?: string;
}

interface AgentIdentitySurface {
  ownerWallet: string | null;
  endpoint: string | null;
  characterTokenId: string | null;
  registrationTxHash: string | null;
  chainId?: number | string | null;
  onChainRegistered: boolean;
}

interface AgentValidation {
  claimType?: string;
}

const REP_CATEGORIES = [
  { key: "combat" as const,   label: "Combat",   color: "#ff6b6b" },
  { key: "economic" as const, label: "Economic", color: "#ffcc00" },
  { key: "social" as const,   label: "Social",   color: "#5dadec" },
  { key: "crafting" as const, label: "Crafting", color: "#54f28b" },
  { key: "agent" as const,    label: "Agent",    color: "#b48efa" },
];

function ReputationGraph({ timeline, width, height }: { timeline: RepTimelinePoint[]; width: number; height: number }) {
  if (timeline.length < 2) {
    return (
      <div className="flex items-center justify-center border-2 border-[#2a3450] bg-[#060d12]" style={{ width, height }}>
        <p className="text-[10px] text-[#596a8a]">Not enough data for graph yet</p>
      </div>
    );
  }

  const pad = { top: 20, right: 12, bottom: 28, left: 36 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const minTs = timeline[0].ts;
  const maxTs = timeline[timeline.length - 1].ts;
  const tRange = maxTs - minTs || 1;

  // Y axis: 0..1000
  const yMin = 0;
  const yMax = 1000;

  const scaleX = (ts: number) => pad.left + ((ts - minTs) / tRange) * w;
  const scaleY = (v: number) => pad.top + h - ((v - yMin) / (yMax - yMin)) * h;

  const buildPath = (key: keyof RepTimelinePoint) => {
    return timeline
      .map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(p.ts).toFixed(1)},${scaleY(p[key] as number).toFixed(1)}`)
      .join(" ");
  };

  // Y gridlines
  const yTicks = [0, 250, 500, 750, 1000];

  // X labels — show a few time labels
  const xLabelCount = Math.min(5, timeline.length);
  const xLabels: { ts: number; x: number }[] = [];
  for (let i = 0; i < xLabelCount; i++) {
    const idx = Math.floor((i / (xLabelCount - 1)) * (timeline.length - 1));
    xLabels.push({ ts: timeline[idx].ts, x: scaleX(timeline[idx].ts) });
  }

  return (
    <svg width={width} height={height} className="border-2 border-[#2a3450] bg-[#060d12]">
      {/* Y gridlines */}
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={pad.left} y1={scaleY(v)} x2={width - pad.right} y2={scaleY(v)} stroke="#1e2842" strokeWidth={1} />
          <text x={pad.left - 4} y={scaleY(v) + 3} fill="#596a8a" fontSize={8} textAnchor="end" fontFamily="monospace">{v}</text>
        </g>
      ))}
      {/* X labels */}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={height - 4} fill="#596a8a" fontSize={7} textAnchor="middle" fontFamily="monospace">
          {new Date(l.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </text>
      ))}
      {/* Category lines */}
      {REP_CATEGORIES.map((cat) => (
        <path key={cat.key} d={buildPath(cat.key)} fill="none" stroke={cat.color} strokeWidth={1.5} opacity={0.7} />
      ))}
      {/* Overall line (bold) */}
      <path d={buildPath("overall")} fill="none" stroke="#d6deff" strokeWidth={2} />
    </svg>
  );
}

function ReputationTab({
  ownerWallet,
  selectedCharacter,
}: {
  ownerWallet: string;
  selectedCharacter: CharacterNft | null;
}) {
  const [rep, setRep] = React.useState<RepScore | null>(null);
  const [timeline, setTimeline] = React.useState<RepTimelinePoint[]>([]);
  const [history, setHistory] = React.useState<Array<{ category: string; delta: number; reason: string; timestamp: number }>>([]);
  const [identity, setIdentity] = React.useState<AgentIdentitySurface | null>(null);
  const [validations, setValidations] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [registering, setRegistering] = React.useState(false);
  const [registrationMessage, setRegistrationMessage] = React.useState<string | null>(null);
  const registrationProgress = getCharacterRegistrationProgress(selectedCharacter);
  const registrationTone = progressToneClasses(registrationProgress.tone);
  const characterRegistrationSettled = isCharacterRegistrationSettled(selectedCharacter);
  const effectiveAgentId = characterRegistrationSettled ? (selectedCharacter?.agentId ?? null) : null;

  React.useEffect(() => {
    if (!effectiveAgentId) {
      setRep(null);
      setTimeline([]);
      setHistory([]);
      setIdentity(null);
      setValidations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      fetch(`${API_URL}/api/agents/${effectiveAgentId}/reputation`).then(r => r.ok ? r.json() : null),
      fetch(`${API_URL}/api/agents/${effectiveAgentId}/reputation/timeline?limit=200`).then(r => r.ok ? r.json() : null),
      fetch(`${API_URL}/api/agents/${effectiveAgentId}/reputation/history?limit=50`).then(r => r.ok ? r.json() : null),
      fetch(`${API_URL}/api/agents/${effectiveAgentId}/identity`).then(r => r.ok ? r.json() : null),
      fetch(`${API_URL}/api/agents/${effectiveAgentId}/validations`).then(r => r.ok ? r.json() : null),
    ]).then(([repData, tlData, histData, identityData, validationsData]) => {
      if (repData?.reputation) setRep(repData.reputation);
      if (tlData?.timeline) setTimeline(tlData.timeline);
      if (histData?.history) setHistory(histData.history);
      setIdentity(identityData?.identity ?? null);
      setValidations(
        Array.isArray(validationsData?.validations)
          ? validationsData.validations
              .map((claim: AgentValidation) => claim.claimType ?? "")
              .filter(Boolean)
          : []
      );
    }).catch(() => {}).finally(() => setLoading(false));
  }, [effectiveAgentId]);

  const hasActiveBootstrap = ["queued", "pending_mint", "mint_confirmed", "identity_pending"].includes(selectedCharacter?.bootstrapStatus ?? "");
  const canManuallyRegister = Boolean(selectedCharacter && !characterRegistrationSettled && !hasActiveBootstrap);

  async function handleManualRegister() {
    if (!selectedCharacter || registering) return;
    setRegistering(true);
    setRegistrationMessage(null);
    try {
      const token = await getAuthToken(ownerWallet);
      if (!token) {
        setRegistrationMessage("Wallet auth required to queue registration.");
        return;
      }

      const res = await fetch(`${API_URL}/character/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          walletAddress: ownerWallet,
          characterName: selectedCharacter.name,
          characterTokenId: selectedCharacter.characterTokenId ?? selectedCharacter.tokenId,
          raceId: selectedCharacter.properties?.race,
          classId: selectedCharacter.properties?.class,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRegistrationMessage(data.error ?? "Failed to queue identity registration.");
        return;
      }
      setRegistrationMessage(
        data.alreadyRegistered
          ? "This character is already registered."
          : data.alreadyQueued
            ? "Registration is already in progress."
            : "Registration queued. Live status will update automatically."
      );
    } catch {
      setRegistrationMessage("Network error while queueing registration.");
    } finally {
      setRegistering(false);
    }
  }

  if (!effectiveAgentId) {
    return (
      <div className="py-8 text-center">
        <p className={`text-[12px] ${registrationTone.faint}`}>{registrationProgress.detail}</p>
        <div className="mx-auto mt-4 max-w-md border-2 border-[#2a3450] bg-[#0b1020] p-3 text-left">
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em]">
            <span className={registrationTone.text}>{registrationProgress.title}</span>
            <span className="text-[#9aa7cc]">{registrationProgress.percent}%</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden border border-[#2a3450] bg-[#050814]">
            <div
              className={`h-full transition-all duration-700 ${registrationTone.fill}`}
              style={{ width: `${registrationProgress.percent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wide">
            <span className="text-[#7a84a8]">Live shard status</span>
            <span className={registrationTone.text}>
              {((selectedCharacter?.bootstrapStatus ?? selectedCharacter?.chainRegistrationStatus ?? "unregistered")).replace(/_/g, " ")}
            </span>
          </div>
          {registrationProgress.active && (
            <p className="mt-2 text-[10px] text-[#7a84a8]">Auto-refreshing every 4 seconds while bootstrap is active.</p>
          )}
        </div>
        {selectedCharacter?.chainRegistrationStatus && (
          <p className={`mt-3 text-[10px] uppercase tracking-wide ${selectedCharacter.chainRegistrationStatus.startsWith("failed") ? "text-[#ff6b6b]" : "text-[#9aa7cc]"}`}>
            Chain: {selectedCharacter.chainRegistrationStatus.replace(/_/g, " ")}
          </p>
        )}
        {selectedCharacter?.chainRegistrationLastError && (
          <p className="mt-1 text-[10px] text-[#ff6b6b]">
            Error: {selectedCharacter.chainRegistrationLastError}
          </p>
        )}
        {selectedCharacter?.bootstrapStatus && (
          <p className={`mt-1 text-[10px] uppercase tracking-wide ${selectedCharacter.bootstrapStatus.startsWith("failed") ? "text-[#ff6b6b]" : "text-[#5dadec]"}`}>
            Worker: {selectedCharacter.bootstrapStatus.replace(/_/g, " ")}
          </p>
        )}
        {characterRegistrationSettled && selectedCharacter?.agentRegistrationTxHash && (
          <div className="mt-3 text-[10px] text-[#9aa7cc]">
            <span className="uppercase tracking-wide text-[#7a84a8]">Registration tx</span>
            <div className="mt-1 break-all text-[#d6deff]">
              {selectedCharacter.agentRegistrationTxHash}
            </div>
            {getSkaleExplorerTxUrl(selectedCharacter.agentRegistrationTxHash) && (
              <a
                href={getSkaleExplorerTxUrl(selectedCharacter.agentRegistrationTxHash) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[#5dadec] underline underline-offset-2"
              >
                View on explorer
              </a>
            )}
          </div>
        )}
        {canManuallyRegister && (
          <button
            type="button"
            onClick={() => void handleManualRegister()}
            disabled={registering}
            className="mt-4 border-2 border-black bg-[#54f28b] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[#060d12] shadow-[3px_3px_0_0_#000] disabled:opacity-50"
          >
            {registering ? "Queueing..." : "Register On-Chain"}
          </button>
        )}
        {registrationMessage && (
          <p className="mt-3 text-[10px] text-[#9aa7cc]">{registrationMessage}</p>
        )}
      </div>
    );
  }

  if (loading) {
    return <p className="text-[11px] text-[#7a84a8] animate-pulse py-8 text-center">Loading reputation...</p>;
  }

  if (!rep) {
    return <p className="text-[12px] text-[#7a84a8] py-8 text-center">No reputation data found.</p>;
  }

  const rankColor = RANK_COLORS[rep.rank] ?? "#95A5A6";
  const registrationTxHash = resolveRegistrationTxHash({
    character: selectedCharacter,
  });
  const registrationTxUrl = getSkaleExplorerTxUrl(registrationTxHash, identity?.chainId);
  const displayCharacterTokenId = selectedCharacter?.characterTokenId ?? selectedCharacter?.tokenId ?? null;
  const registrationStatusLabel = getRegistrationStatusLabel(selectedCharacter);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="border-2 border-[#2a3450] bg-[#0b1020] p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a84a8]">Identity</p>
          <p className="mt-1 text-[12px] font-bold text-[#d6deff]">
            {registrationStatusLabel}
          </p>
          {displayCharacterTokenId && (
            <p className="mt-1 text-[10px] text-[#9aa7cc]">Character Token #{displayCharacterTokenId}</p>
          )}
          {registrationTxHash && (
            <div className="mt-2 text-[9px] text-[#9aa7cc]">
              <p className="uppercase tracking-wide text-[#7a84a8]">Registration Tx</p>
              <p className="mt-1 break-all text-[#d6deff]">{registrationTxHash}</p>
              {registrationTxUrl && (
                <a
                  href={registrationTxUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-[#5dadec] underline underline-offset-2"
                >
                  View on explorer
                </a>
              )}
            </div>
          )}
          {identity?.endpoint && (
            <p className="mt-1 truncate text-[9px] text-[#5dadec]">{identity.endpoint}</p>
          )}
        </div>
        <div className="border-2 border-[#2a3450] bg-[#0b1020] p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a84a8]">Validations</p>
          {validations.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {validations.map((claimType) => (
                <span
                  key={claimType}
                  className="border px-2 py-1 text-[9px] font-bold uppercase tracking-wide"
                  style={{ borderColor: "#54f28b55", color: "#54f28b", backgroundColor: "#54f28b11" }}
                >
                  {claimType}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-[#9aa7cc]">No validation claims published yet.</p>
          )}
        </div>
      </div>

      {/* Header: Overall + Rank */}
      <div className="flex items-center justify-between border-b border-[#2a3450] pb-3">
        <div>
          <p className="text-[13px] text-[#d6deff] font-bold">ERC-8004 Agent Reputation</p>
          <p className="text-[10px] text-[#7a84a8]">On-chain reputation across 5 categories</p>
        </div>
        <div className="text-right">
          <p className="text-[22px] font-bold" style={{ color: rankColor, textShadow: "2px 2px 0 #000" }}>{rep.overall}</p>
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: rankColor }}>{rep.rank}</p>
        </div>
      </div>

      {/* Category bars */}
      <div className="grid gap-2">
        {REP_CATEGORIES.map((cat) => {
          const val = rep[cat.key];
          const pct = (val / 1000) * 100;
          return (
            <div key={cat.key} className="flex items-center gap-3">
              <span className="text-[10px] text-[#7a84a8] w-16 shrink-0 uppercase tracking-wide">{cat.label}</span>
              <div className="flex-1 h-4 bg-[#0b1020] border border-[#2a3450] relative overflow-hidden">
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: cat.color + "cc" }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[#d6deff]" style={{ textShadow: "1px 1px 0 #000" }}>
                  {val}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Timeline graph */}
      <div>
        <p className="text-[11px] text-[#7a84a8] mb-2 uppercase tracking-wide">Reputation Over Time</p>
        <div className="flex gap-3 mb-2 flex-wrap">
          {REP_CATEGORIES.map((cat) => (
            <span key={cat.key} className="flex items-center gap-1 text-[9px]">
              <span className="inline-block w-2 h-2" style={{ backgroundColor: cat.color }} />
              <span style={{ color: cat.color }}>{cat.label}</span>
            </span>
          ))}
          <span className="flex items-center gap-1 text-[9px]">
            <span className="inline-block w-2 h-2 bg-[#d6deff]" />
            <span className="text-[#d6deff]">Overall</span>
          </span>
        </div>
        <ReputationGraph timeline={timeline} width={580} height={220} />
      </div>

      {/* Recent feedback */}
      {history.length > 0 && (
        <div>
          <p className="text-[11px] text-[#7a84a8] mb-2 uppercase tracking-wide">Recent Changes</p>
          <div className="border-2 border-[#2a3450] bg-[#0b1020] max-h-48 overflow-y-auto">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-2 border-b border-[#1e2842] last:border-b-0 px-3 py-1.5">
                <span
                  className="text-[10px] font-bold shrink-0 w-8 text-right"
                  style={{ color: h.delta > 0 ? "#54f28b" : h.delta < 0 ? "#ff6b6b" : "#7a84a8" }}
                >
                  {h.delta > 0 ? "+" : ""}{h.delta}
                </span>
                <span className="text-[9px] text-[#7a84a8] uppercase tracking-wide shrink-0 w-14">{h.category}</span>
                <span className="text-[10px] text-[#9aa7cc] truncate flex-1">{h.reason}</span>
                <span className="text-[8px] text-[#596a8a] shrink-0">
                  {new Date(h.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Plan / Membership Tab ─────────────────────────────────────────────────

const PLANS = [
  {
    id: "free" as const,
    name: "Free",
    price: 0,
    color: "#9aa7cc",
    features: ["Scripted bot (no LLM)", "6-hour sessions", "3 starter zones", "50 gold bonus"],
  },
  {
    id: "starter" as const,
    name: "Starter",
    price: 4.99,
    color: "#54f28b",
    features: ["LLM supervisor AI", "12-hour sessions", "All zones unlocked", "Retreat + techniques", "Self-adaptation", "500 gold bonus"],
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: 9.99,
    color: "#ffcc00",
    features: ["Everything in Starter", "24/7 sessions", "Auction house trading", "2,500 gold bonus", "Legendary item"],
  },
];

function PlanTab({ wallet }: { wallet: string | null }) {
  const [currentTier, setCurrentTier] = React.useState<string>("free");
  const [loading, setLoading] = React.useState(true);
  const [upgrading, setUpgrading] = React.useState<string | null>(null);
  const [showPayment, setShowPayment] = React.useState<typeof PLANS[number] | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [promoCode, setPromoCode] = React.useState("");
  const [redeemingPromo, setRedeemingPromo] = React.useState(false);

  React.useEffect(() => {
    if (!wallet) return;
    setLoading(true);
    fetch(`${API_URL}/agent/tier/${wallet}`)
      .then(r => r.json())
      .then(d => setCurrentTier(d.tier ?? "free"))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [wallet]);

  const handleUpgrade = async (plan: typeof PLANS[number], paymentTx?: string, promo?: string) => {
    if (!wallet) return;
    setUpgrading(plan.id);
    setMessage(null);
    try {
      const token = await getAuthToken(wallet);
      const body: Record<string, string> = { tier: plan.id };
      if (paymentTx) body.paymentTx = paymentTx;
      if (promo) body.promoCode = promo;
      const res = await fetch(`${API_URL}/agent/upgrade-tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 402) {
        // Need payment
        setShowPayment(plan);
        setUpgrading(null);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Upgrade failed");
      setCurrentTier(plan.id);
      setMessage(data.message);
      setShowPayment(null);
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setUpgrading(null);
    }
  };

  if (loading) {
    return <p className="text-[11px] text-[#7a84a8] animate-pulse py-8 text-center">Loading plan info...</p>;
  }

  // Payment flow
  if (showPayment) {
    return (
      <div className="space-y-3">
        <div className="border-2 border-[#ffcc00]/30 bg-[#1a1800] px-4 py-3">
          <p className="text-[12px] font-bold" style={{ color: showPayment.color }}>Upgrade to {showPayment.name}</p>
          <p className="text-[10px] text-[#9aa7cc] mt-0.5">One-time payment of ${showPayment.price} USD</p>
        </div>
        <PaymentGate
          label={`${showPayment.name} Plan — $${showPayment.price}`}
          amount={showPayment.price.toString()}
          onSuccess={() => handleUpgrade(showPayment, "thirdweb-pay-confirmed")}
          onCancel={() => setShowPayment(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border-b border-[#2a3450] pb-2">
        <p className="text-[13px] text-[#d6deff] font-bold">Membership Plan</p>
        <p className="text-[10px] text-[#7a84a8]">Manage your champion&apos;s capabilities and AI tier.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentTier;
          return (
            <div
              key={plan.id}
              className="border-2 p-4 flex flex-col gap-2 transition"
              style={{
                borderColor: isCurrent ? plan.color + "88" : "#2a3450",
                backgroundColor: isCurrent ? plan.color + "08" : "#0b1020",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold" style={{ color: plan.color }}>{plan.name}</span>
                {isCurrent && (
                  <span className="text-[9px] uppercase tracking-wide border px-1.5 py-0.5" style={{ color: plan.color, borderColor: plan.color + "44" }}>
                    Current
                  </span>
                )}
              </div>
              <p className="text-[14px] text-[#d6deff] font-bold">
                {plan.price === 0 ? "Free" : `$${plan.price}`}
                {plan.price > 0 && <span className="text-[10px] text-[#7a84a8] font-normal ml-1">one-time</span>}
              </p>
              <ul className="flex-1 space-y-1">
                {plan.features.map((f) => (
                  <li key={f} className="text-[10px] text-[#9aa7cc] flex items-start gap-1.5">
                    <span className="text-[#54f28b] shrink-0 mt-px">+</span>
                    {f}
                  </li>
                ))}
              </ul>
              {!isCurrent && (
                <button
                  onClick={() => plan.price === 0 ? handleUpgrade(plan, "downgrade") : handleUpgrade(plan)}
                  disabled={upgrading === plan.id}
                  className="mt-2 border-2 px-3 py-2 text-[11px] uppercase tracking-wide font-bold transition hover:brightness-110 disabled:opacity-50"
                  style={{
                    borderColor: plan.color + "66",
                    color: plan.price === 0 ? "#9aa7cc" : plan.color,
                    backgroundColor: plan.price === 0 ? "#11182b" : plan.color + "11",
                  }}
                >
                  {upgrading === plan.id ? "Processing..." : plan.price === 0 ? "Downgrade" : `Upgrade — $${plan.price}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Promo code */}
      <div className="border-2 border-[#2a3450] bg-[#0b1020] p-4">
        <p className="text-[11px] text-[#d6deff] font-bold mb-2">Have a promo code?</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
            placeholder="Enter code"
            className="flex-1 border-2 border-[#2a3450] bg-[#060d12] px-3 py-2 text-[12px] text-[#d6deff] uppercase tracking-wide font-mono placeholder:text-[#596a8a] outline-none focus:border-[#ffcc00]/40"
          />
          <button
            onClick={async () => {
              if (!promoCode.trim() || !wallet) return;
              setRedeemingPromo(true);
              setMessage(null);
              try {
                const token = await getAuthToken(wallet);
                // First check what tier the promo grants by attempting upgrade
                // Try pro first, then starter
                for (const tryTier of ["pro", "starter"] as const) {
                  const res = await fetch(`${API_URL}/agent/upgrade-tier`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ tier: tryTier, promoCode: promoCode.trim() }),
                  });
                  const data = await res.json();
                  if (res.ok && data.ok) {
                    setCurrentTier(tryTier);
                    setMessage(data.message);
                    setPromoCode("");
                    break;
                  }
                  // If code is for a lower tier, try next
                  if (data.error?.includes("not " + tryTier)) continue;
                  // Other error — show it
                  if (!res.ok) {
                    setMessage(data.error || "Failed to redeem code.");
                    break;
                  }
                }
              } catch (err: any) {
                setMessage(err.message);
              } finally {
                setRedeemingPromo(false);
              }
            }}
            disabled={redeemingPromo || !promoCode.trim()}
            className="border-2 border-[#ffcc00]/40 bg-[#ffcc00]/10 px-4 py-2 text-[11px] uppercase tracking-wide font-bold text-[#ffcc00] transition hover:bg-[#ffcc00]/20 disabled:opacity-40"
          >
            {redeemingPromo ? "..." : "Redeem"}
          </button>
        </div>
      </div>

      {message && (
        <p className={`text-[11px] text-center ${message.includes("fail") || message.includes("error") || message.includes("Invalid") || message.includes("limit") || message.includes("already") ? "text-[#ff6b6b]" : "text-[#54f28b]"}`}>
          {message}
        </p>
      )}
    </div>
  );
}

// ── Gold Shop Tab ─────────────────────────────────────────────────────────

interface GoldPack {
  id: string;
  name: string;
  goldAmount: number;
  priceUsd: number;
}

const GOLD_PACKS: GoldPack[] = [
  { id: "pack-500",  name: "500 Gold",   goldAmount: 500,  priceUsd: 5  },
  { id: "pack-1500", name: "1,500 Gold", goldAmount: 1500, priceUsd: 12 },
  { id: "pack-5000", name: "5,000 Gold", goldAmount: 5000, priceUsd: 35 },
];

function GoldShopTab({ wallet, custodialWallet }: { wallet: string | null; custodialWallet: string | null }) {
  const [buying, setBuying] = React.useState<GoldPack | null>(null);
  const [pending, setPending] = React.useState<{ paymentId: string } | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<{ goldMinted: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const initiatePurchase = async (pack: GoldPack) => {
    if (!wallet) return;
    setError(null);
    setBuying(pack);
    try {
      const token = await getAuthToken(wallet);
      const res = await fetch(`${API_URL}/gold/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ packId: pack.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Purchase failed");
      setPending({ paymentId: data.paymentId });
    } catch (err: any) {
      setError(err.message);
      setBuying(null);
    }
  };

  const confirmPurchase = async (txHash: string) => {
    if (!wallet || !pending) return;
    setConfirming(true);
    setError(null);
    try {
      const token = await getAuthToken(wallet);
      const res = await fetch(`${API_URL}/gold/purchase/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paymentId: pending.paymentId, transactionHash: txHash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Confirm failed");
      setResult({ goldMinted: data.goldMinted });
      setBuying(null);
      setPending(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConfirming(false);
    }
  };

  // If user is in payment flow, show PaymentGate
  if (buying && pending) {
    return (
      <div className="space-y-3">
        <div className="border-2 border-[#ffcc00]/30 bg-[#1a1800] px-4 py-3">
          <p className="text-[12px] text-[#ffcc00] font-bold mb-1">Purchasing: {buying.name}</p>
          <p className="text-[10px] text-[#9aa7cc]">{buying.goldAmount.toLocaleString()} gold will be minted to your character</p>
        </div>
        <PaymentGate
          label={`${buying.name} — ${buying.goldAmount.toLocaleString()} gold`}
          amount={buying.priceUsd.toString()}
          onSuccess={() => {
            // PayEmbed confirmed — now confirm server-side
            confirmPurchase("thirdweb-pay-confirmed");
          }}
          onCancel={() => { setBuying(null); setPending(null); }}
        />
        {confirming && <p className="text-[11px] text-[#ffcc00] animate-pulse text-center">Minting gold...</p>}
        {error && <p className="text-[11px] text-[#ff6b6b] text-center">{error}</p>}
      </div>
    );
  }

  // Success state
  if (result) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <span className="text-[32px]">⟡</span>
        <p className="text-[14px] text-[#54f28b] font-bold">{result.goldMinted.toLocaleString()} Gold Minted!</p>
        <p className="text-[11px] text-[#9aa7cc]">Gold has been added to your character&apos;s wallet.</p>
        <button
          onClick={() => setResult(null)}
          className="mt-2 border-2 border-[#2a3450] bg-[#0b1020] px-4 py-2 text-[11px] text-[#d6deff] hover:bg-[#1a2240] transition"
        >
          Buy More
        </button>
      </div>
    );
  }

  if (!custodialWallet) {
    return (
      <div className="text-center py-8">
        <p className="text-[12px] text-[#7a84a8]">Deploy a champion first to purchase gold.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="border-b border-[#2a3450] pb-2 mb-1">
        <p className="text-[13px] text-[#d6deff] font-bold">Gold Exchange</p>
        <p className="text-[10px] text-[#7a84a8]">Purchase gold with crypto. Pay with any token on any chain.</p>
      </div>

      <div className="grid gap-3">
        {GOLD_PACKS.map((pack) => (
          <button
            key={pack.id}
            onClick={() => initiatePurchase(pack)}
            className="border-2 border-[#2a3450] bg-[#0b1020] hover:bg-[#1a2240] hover:border-[#ffcc00]/40 transition p-4 text-left group"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] text-[#ffcc00] font-bold group-hover:text-[#ffd633]">{pack.name}</p>
                <p className="text-[10px] text-[#7a84a8] mt-0.5">{pack.goldAmount.toLocaleString()} gold coins</p>
              </div>
              <div className="text-right">
                <p className="text-[14px] text-[#d6deff] font-bold">${pack.priceUsd}</p>
                <p className="text-[9px] text-[#596a8a] uppercase tracking-wide">USD</p>
              </div>
            </div>
            <div className="mt-2 h-[2px] bg-[#1e2842] group-hover:bg-[#ffcc00]/20 transition" />
            <p className="text-[9px] text-[#596a8a] mt-1">
              {(pack.goldAmount / pack.priceUsd).toFixed(0)} gold per dollar
            </p>
          </button>
        ))}
      </div>

      {error && <p className="text-[11px] text-[#ff6b6b] text-center">{error}</p>}
    </div>
  );
}

// ── Character Switcher ────────────────────────────────────────────────────

interface CharacterNft {
  tokenId: string;
  characterTokenId?: string | null;
  agentId?: string | null;
  agentRegistrationTxHash?: string | null;
  chainRegistrationStatus?:
    | "unregistered"
    | "pending_mint"
    | "mint_confirmed"
    | "identity_pending"
    | "registered"
    | "failed_retryable"
    | "failed_permanent";
  chainRegistrationLastError?: string | null;
  bootstrapStatus?:
    | "queued"
    | "pending_mint"
    | "mint_confirmed"
    | "identity_pending"
    | "completed"
    | "failed_retryable"
    | "failed_permanent"
    | null;
  name: string;
  description?: string;
  properties?: {
    level?: number;
    race?: string;
    class?: string;
    xp?: number;
  };
}

type CharacterProgressTone = "active" | "done" | "failed" | "idle";

function getCharacterRegistrationProgress(character: CharacterNft | null | undefined): {
  percent: number;
  title: string;
  detail: string;
  tone: CharacterProgressTone;
  active: boolean;
} {
  const bootstrapStatus = character?.bootstrapStatus ?? null;
  const chainStatus = character?.chainRegistrationStatus ?? null;
  const lastError = character?.chainRegistrationLastError?.trim();
  const hasActiveBootstrap = ["queued", "pending_mint", "mint_confirmed", "identity_pending", "failed_retryable"].includes(bootstrapStatus ?? "");

  if (bootstrapStatus === "failed_permanent" || chainStatus === "failed_permanent") {
    return {
      percent: 100,
      title: "Registration failed",
      detail: lastError || "The worker hit a permanent failure. Re-queue registration to retry.",
      tone: "failed",
      active: false,
    };
  }

  if (bootstrapStatus === "failed_retryable" || chainStatus === "failed_retryable") {
    return {
      percent: 92,
      title: "Retrying registration",
      detail: lastError || "The worker will retry this on-chain step automatically.",
      tone: "failed",
      active: true,
    };
  }

  if (bootstrapStatus === "identity_pending" || chainStatus === "identity_pending") {
    return {
      percent: 82,
      title: "Registering agent identity",
      detail: "Character mint is done. The worker is now registering the agent on-chain.",
      tone: "active",
      active: true,
    };
  }

  if (bootstrapStatus === "mint_confirmed" || chainStatus === "mint_confirmed") {
    return {
      percent: 64,
      title: "Character minted",
      detail: "The NFT exists on-chain. Identity registration is next.",
      tone: "active",
      active: true,
    };
  }

  if (bootstrapStatus === "pending_mint" || chainStatus === "pending_mint") {
    return {
      percent: 38,
      title: "Minting character NFT",
      detail: "The worker is sending the mint transaction now.",
      tone: "active",
      active: true,
    };
  }

  if (bootstrapStatus === "queued") {
    return {
      percent: 16,
      title: "Queued for bootstrap",
      detail: "Waiting for the background worker to pick up the on-chain job.",
      tone: "active",
      active: true,
    };
  }

  if (
    !hasActiveBootstrap
    && (chainStatus === "registered" || bootstrapStatus === "completed")
    && (Boolean(character?.agentRegistrationTxHash) || Boolean(character?.agentId))
  ) {
    return {
      percent: 100,
      title: "Registration complete",
      detail: "Your champion is registered on-chain and reputation is available.",
      tone: "done",
      active: false,
    };
  }

  if (chainStatus === "unregistered") {
    return {
      percent: 0,
      title: "Not registered on-chain",
      detail: "Queue registration to mint the character and register the agent identity.",
      tone: "idle",
      active: false,
    };
  }

  return {
    percent: 0,
    title: "Registration status unknown",
    detail: "Waiting for the latest character status from the shard.",
    tone: "idle",
    active: false,
  };
}

function isCharacterRegistrationSettled(character: CharacterNft | null | undefined): boolean {
  return isRegistrationSettled(character);
}

function isCharacterBootstrapActive(character: CharacterNft | null | undefined): boolean {
  return getCharacterRegistrationProgress(character).active;
}

function progressToneClasses(tone: CharacterProgressTone): { fill: string; text: string; faint: string } {
  switch (tone) {
    case "done":
      return { fill: "bg-[#54f28b]", text: "text-[#54f28b]", faint: "text-[#9de8b6]" };
    case "failed":
      return { fill: "bg-[#ff6b6b]", text: "text-[#ff6b6b]", faint: "text-[#ff9b9b]" };
    case "idle":
      return { fill: "bg-[#7a84a8]", text: "text-[#9aa7cc]", faint: "text-[#7a84a8]" };
    default:
      return { fill: "bg-[#5dadec]", text: "text-[#5dadec]", faint: "text-[#9aa7cc]" };
  }
}

function CharacterSwitcher({
  characters,
  selectedCharacterTokenId,
  liveCharacterTokenId,
  loading,
  onSelect,
}: {
  characters: CharacterNft[];
  selectedCharacterTokenId: string | null;
  liveCharacterTokenId: string | null;
  loading?: boolean;
  onSelect: (tokenId: string) => void;
}) {
  if (loading) {
    return (
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000] font-mono">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-3 py-1.5 flex items-center justify-between gap-3">
          <span className="text-[10px] uppercase tracking-widest text-[#7a84a8]">My Champions</span>
          <span className="text-[9px] uppercase tracking-wide text-[#5dadec] animate-pulse">Loading</span>
        </div>
        <div className="p-2 flex flex-col gap-1.5">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="border-2 border-[#2a3450] bg-[#10162a] px-3 py-2 animate-pulse"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="h-3 w-24 bg-[#2a3450]" />
                <div className="h-3 w-10 bg-[#2a3450]" />
              </div>
              <div className="mt-2 h-2 w-20 bg-[#1a2240]" />
              <div className="mt-3 h-1.5 overflow-hidden border border-[#2a3450] bg-[#0a0f1a]">
                <div className="h-full w-1/3 bg-[#24314f]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (characters.length <= 1) return null;
  return (
    <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000] font-mono">
      <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-widest text-[#7a84a8]">My Champions ({characters.length})</span>
      </div>
      <div className="p-2 flex flex-col gap-1.5">
        {characters.map((c) => {
          const baseName = c.name.includes(" the ") ? c.name.split(" the ")[0] : c.name;
          const displayTokenId = c.characterTokenId ?? c.tokenId;
          const lv = c.properties?.level ?? 1;
          const lc = levelColor(lv);
          const isActive = selectedCharacterTokenId === c.tokenId || (!selectedCharacterTokenId && characters[0]?.tokenId === c.tokenId);
          const isLive = Boolean(liveCharacterTokenId && displayTokenId === liveCharacterTokenId);
          const progress = getCharacterRegistrationProgress(c);
          const isPending = progress.active;
          const tone = progressToneClasses(progress.tone);
          return (
            <button
              key={c.tokenId}
              onClick={() => onSelect(c.tokenId)}
              disabled={false}
              className={`text-left px-3 py-2 border-2 transition ${
                isActive
                  ? "border-[#ffcc00]/60 bg-[#2a2210]"
                  : isPending
                    ? "border-[#2a3450] bg-[#10162a]"
                    : "border-[#2a3450] bg-[#0b1020] hover:bg-[#1a2240]/40 hover:border-[#3a4460]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-[#d6deff] truncate">{baseName}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {isLive && (
                    <span className="text-[9px] font-bold uppercase tracking-wide text-[#54f28b]">Live</span>
                  )}
                  <span className="text-[10px]" style={{ color: isPending ? "#7a84a8" : lc }}>
                    {isPending ? `${progress.percent}%` : `Lv ${lv}`}
                  </span>
                </div>
              </div>
              {c.properties?.race && (
                <span className="text-[9px] capitalize text-[#7a84a8]">
                  {c.properties.race} {c.properties.class}
                </span>
              )}
              <div className="mt-1 text-[9px] text-[#596a8a]">Token #{displayTokenId}</div>
              {isPending && (
                <div className="mt-2">
                  <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-wide">
                    <span className={tone.text}>{progress.title}</span>
                    <span className="text-[#7a84a8]">{progress.percent}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden border border-[#2a3450] bg-[#0a0f1a]">
                    <div className={`h-full transition-all duration-500 ${tone.fill}`} style={{ width: `${progress.percent}%` }} />
                  </div>
                  <div className="mt-1 text-[9px] text-[#7a84a8]">{progress.detail}</div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export function ChampionsPage(): React.ReactElement {
  const { address: connectedAddress } = useWalletContext();
  const [searchParams] = useSearchParams();
  const wallet = searchParams.get("wallet") ?? connectedAddress ?? null;

  const [custodialWallet, setCustodialWallet] = React.useState<string | null>(null);
  const [agentEntityId, setAgentEntityId]   = React.useState<string | null>(null);
  const [agentZoneId, setAgentZoneId]       = React.useState<string | null>(null);
  const [entity, setEntity]                 = React.useState<LiveEntity | null>(null);
  const [zoneId, setZoneId]                 = React.useState<string | null>(null);
  const [professions, setProfessions]       = React.useState<string[]>([]);
  const [profSkills, setProfSkills]         = React.useState<Record<string, { level: number; xp: number; actions: number; progress: number }>>({});
  const [diary, setDiary]                   = React.useState<DiaryEntry[]>([]);
  const [items, setItems]                   = React.useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = React.useState(false);
  const [loading, setLoading]               = React.useState(false);
  const [characterListLoading, setCharacterListLoading] = React.useState(false);
  const [characterListHydrated, setCharacterListHydrated] = React.useState(false);
  const [activeTab, setActiveTab]           = React.useState<Tab>("inventory");
  const [characters, setCharacters]         = React.useState<CharacterNft[]>([]);
  const [selectedCharacterTokenId, setSelectedCharacterTokenId] = React.useState<string | null>(null);
  const [liveCharacterTokenId, setLiveCharacterTokenId] = React.useState<string | null>(null);
  const selectedCharacter = React.useMemo(
    () => characters.find((character) => character.tokenId === selectedCharacterTokenId) ?? null,
    [characters, selectedCharacterTokenId],
  );
  const hasAnyActiveBootstrap = React.useMemo(
    () => characters.some((character) => isCharacterBootstrapActive(character)),
    [characters],
  );

  const refreshCharacters = React.useCallback(async (walletAddress: string, options?: { background?: boolean }) => {
    const isBackground = options?.background === true;
    if (!isBackground) {
      setCharacterListLoading(true);
    }
    try {
      const [agentData, charData] = await Promise.all([
        fetch(`${API_URL}/agent/wallet/${walletAddress}`).then((r) => r.json()).catch(() => ({})),
        fetch(`${API_URL}/character/${walletAddress}`).then((r) => r.json()).catch(() => ({ characters: [] })),
      ]);
      setCustodialWallet(agentData.custodialWallet ?? null);
      setAgentEntityId(agentData.entityId ?? null);
      setAgentZoneId(agentData.zoneId ?? null);
      const chars: CharacterNft[] = charData.characters ?? [];
      const liveToken = typeof charData.liveEntity?.characterTokenId === "string"
        ? charData.liveEntity.characterTokenId
        : typeof charData.liveEntity?.characterTokenId === "number"
          ? String(charData.liveEntity.characterTokenId)
          : null;
      setLiveCharacterTokenId(liveToken);
      setCharacters(chars);
      if (chars.length === 0) {
        setLiveCharacterTokenId(null);
        setSelectedCharacterTokenId(null);
        return;
      }

      setSelectedCharacterTokenId((current) => {
        if (current && chars.some((character) => character.tokenId === current)) return current;

        const liveCharacter = liveToken
          ? chars.find((character) => (character.characterTokenId ?? character.tokenId) === liveToken)
          : null;
        const deployed =
          liveCharacter
          ?? chars.find((character) => isCharacterBootstrapActive(character))
          ?? chars[0];

        return deployed?.tokenId ?? null;
      });
      setCharacterListHydrated(true);
    } finally {
      if (!isBackground) {
        setCharacterListLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    if (!liveCharacterTokenId) return;
    const liveCharacter = characters.find((character) => (character.characterTokenId ?? character.tokenId) === liveCharacterTokenId);
    if (!liveCharacter) return;
    setSelectedCharacterTokenId((current) => current ?? liveCharacter.tokenId);
  }, [characters, liveCharacterTokenId]);

  // Step 1 — resolve custodial wallet + fetch all owned characters
  React.useEffect(() => {
    if (!wallet) return;
    void refreshCharacters(wallet);
  }, [wallet, refreshCharacters]);

  React.useEffect(() => {
    if (!wallet) return;
    const intervalMs = hasAnyActiveBootstrap ? 4000 : 15000;
    const interval = setInterval(() => {
      void refreshCharacters(wallet, { background: true });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [wallet, hasAnyActiveBootstrap, refreshCharacters]);

  // Step 2 — poll live entity from world state
  React.useEffect(() => {
    const searchWallet = (custodialWallet ?? wallet)?.toLowerCase();
    if (!searchWallet) return;
    const selectedAgentId = selectedCharacter?.agentId ?? null;
    const selectedCharacterToken = selectedCharacter?.characterTokenId ?? selectedCharacter?.tokenId ?? null;

    async function fetchLiveEntity() {
      try {
        const res = await fetch(`${API_URL}/state`);
        const data = await res.json();
        for (const [zId, zone] of Object.entries(data.zones as Record<string, any>)) {
          for (const ent of Object.values(zone.entities as Record<string, any>)) {
            const e = ent as any;
            if (e.type !== "player") continue;
            if (e.walletAddress?.toLowerCase() !== searchWallet) continue;
            if (selectedAgentId && String(e.agentId ?? "") !== selectedAgentId) continue;
            if (!selectedAgentId && selectedCharacterToken && String(e.characterTokenId ?? "") !== selectedCharacterToken) continue;
            setAgentEntityId(e.id ?? null);
            setAgentZoneId(zId);
            setEntity({
              name: e.name,
              level: e.level ?? 1,
              xp: e.xp ?? 0,
              hp: e.hp ?? 0,
              maxHp: e.maxHp ?? 100,
              agentId: e.agentId != null ? String(e.agentId) : undefined,
              characterTokenId: e.characterTokenId != null ? String(e.characterTokenId) : undefined,
              raceId: e.raceId,
              classId: e.classId,
              kills: e.kills ?? 0,
              completedQuests: e.completedQuests ?? [],
              walletAddress: e.walletAddress,
              zoneId: zId,
            });
            setZoneId(zId);
            return;
          }
        }
        setEntity(null);
        setZoneId(null);
        setAgentEntityId(null);
        setAgentZoneId(null);
      } catch { /* non-fatal */ }
    }

    fetchLiveEntity();
    const interval = setInterval(fetchLiveEntity, 10_000);
    return () => clearInterval(interval);
  }, [custodialWallet, wallet, selectedCharacter]);

  // Step 3 — fetch professions, diary, inventory when custodial wallet is known
  React.useEffect(() => {
    if (!wallet) return;
    // Always prefer custodial wallet for professions/inventory; owner wallet for diary
    const profWallet = custodialWallet ?? wallet;
    setLoading(true);
    setInventoryLoading(true);

    async function fetchData() {
      try {
        const [profRes, diaryRes] = await Promise.all([
          fetch(`${API_URL}/professions/${profWallet}`),
          fetch(`${API_URL}/diary/${wallet}?limit=200`),
        ]);
        if (profRes.ok)  { const pd = await profRes.json();  setProfessions(pd.professions ?? []); setProfSkills(pd.skills ?? {}); }
        if (diaryRes.ok) { const dd = await diaryRes.json(); setDiary(dd.entries ?? []); }
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    }

    async function fetchInventory() {
      try {
        const res = await fetch(`${API_URL}/inventory/${profWallet}`);
        if (res.ok) { const d = await res.json(); setItems(d.items ?? []); }
      } catch { /* non-fatal */ }
      finally { setInventoryLoading(false); }
    }

    fetchData();
    fetchInventory();
  }, [custodialWallet, wallet]);

  const kills  = entity?.kills ?? diary.filter((e) => e.action === "kill").length;
  const deaths = diary.filter((e) => e.action === "death").length;
  const quests = diary.filter((e) => e.action === "quest_complete").length;

  if (!wallet) {
    return (
      <div className="relative flex min-h-full w-full flex-col items-center overflow-y-auto pt-24">
        <div className="pointer-events-none fixed inset-0 z-50" style={{ background: "repeating-linear-gradient(0deg,rgba(0,0,0,0.15) 0px,rgba(0,0,0,0.15) 1px,transparent 1px,transparent 3px)" }} />
        <div className="z-10 flex flex-col items-center gap-6 px-4 py-24 text-center font-mono">
          <p className="text-[12px] uppercase tracking-widest text-[#7a84a8]">{">>"} Champions</p>
          <h1 className="text-[26px] uppercase tracking-widest text-[#ffcc00]" style={{ textShadow: "3px 3px 0 #000" }}>My Champion</h1>
          <p className="text-[12px] text-[#596a8a]">Connect your wallet to summon your champion.</p>
          <button
            type="button"
            onClick={() => openOnboarding("sign-in")}
            className="border-4 border-black bg-[#54f28b] px-6 py-3 text-[13px] uppercase tracking-wide text-[#060d12] shadow-[4px_4px_0_0_#000] hover:bg-[#7bf5a8] font-bold"
          >
            {">>> Summon Champion <<<"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-full w-full flex-col items-center overflow-y-auto overflow-x-hidden pt-24">
      <div className="pointer-events-none fixed inset-0 z-50" style={{ background: "repeating-linear-gradient(0deg,rgba(0,0,0,0.15) 0px,rgba(0,0,0,0.15) 1px,transparent 1px,transparent 3px)" }} />

      <div className="z-10 w-full max-w-5xl px-4 py-10">
        {/* Page header */}
        <div className="mb-6">
          <p className="mb-1 text-[17px] uppercase tracking-widest text-[#7a84a8] font-mono">{"<< Champions >>"}</p>
          <h1 className="text-[26px] uppercase tracking-widest text-[#ffcc00] font-mono" style={{ textShadow: "3px 3px 0 #000" }}>
            {entity ? entity.name : "My Champion"}
          </h1>
          {loading && <p className="mt-1 text-[17px] text-[#596a8a] font-mono animate-pulse">Loading champion data...</p>}
        </div>

        {/* Two-column layout */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Sidebar */}
          <div className="w-full lg:w-72 lg:shrink-0 flex flex-col gap-3">
            <CharacterSwitcher
              characters={characters}
              selectedCharacterTokenId={selectedCharacterTokenId}
              liveCharacterTokenId={liveCharacterTokenId}
              loading={characterListLoading && !characterListHydrated}
              onSelect={setSelectedCharacterTokenId}
            />
            <ChampionSidebar entity={entity} wallet={wallet} zoneId={zoneId} kills={kills} deaths={deaths} />
          </div>

          {/* Main panel */}
          <div className="flex-1 min-w-0 border-4 border-black bg-[#0a0f1a] shadow-[4px_4px_0_0_#000]">
            <TabBar active={activeTab} onChange={setActiveTab} />
            <div className="p-4">
              {activeTab === "inventory"   && <InventoryTab items={items} loading={inventoryLoading} wallet={custodialWallet ?? wallet} ownerWallet={wallet} entityId={agentEntityId} zoneId={agentZoneId} onRefresh={() => {
                setInventoryLoading(true);
                const profWallet = custodialWallet ?? wallet;
                fetch(`${API_URL}/inventory/${profWallet}`).then(r => r.json()).then(d => setItems(d.items ?? [])).catch(() => {}).finally(() => setInventoryLoading(false));
              }} />}
              {activeTab === "overview"    && <OverviewTab entity={entity} diary={diary} kills={kills} deaths={deaths} quests={quests} itemCount={items.length} />}
              {activeTab === "guild"       && <GuildTab custodialWallet={custodialWallet} ownerWallet={wallet} />}
              {activeTab === "professions" && <ProfessionsTab learned={professions} skills={profSkills} custodialWallet={custodialWallet} />}
              {activeTab === "quests"      && <QuestsTab diary={diary} />}
              {activeTab === "activity"    && <ActivityTab diary={diary} />}
              {activeTab === "inbox"       && <InboxTab wallet={wallet!} />}
              {activeTab === "party"       && <PartyTab custodialWallet={custodialWallet} entityId={agentEntityId} entityZoneId={agentZoneId} ownerWallet={wallet} />}
              {activeTab === "friends"     && <FriendsTab ownerWallet={wallet} custodialWallet={custodialWallet} entityId={agentEntityId} entityZoneId={agentZoneId} />}
              {activeTab === "reputation"  && (
                <ReputationTab
                  ownerWallet={wallet}
                  selectedCharacter={selectedCharacter}
                />
              )}
              {activeTab === "gold-shop"   && <GoldShopTab wallet={wallet} custodialWallet={custodialWallet} />}
              {activeTab === "plan"        && <PlanTab wallet={wallet} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
