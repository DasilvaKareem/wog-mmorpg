import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { API_URL } from "@/config";
import { useWalletContext } from "@/context/WalletContext";
import { HpBar } from "@/components/ui/hp-bar";
import { XpBar } from "@/components/ui/xp-bar";
import { formatCopperString } from "@/lib/currency";

// ── Types ─────────────────────────────────────────────────────────────────

interface LiveEntity {
  name: string;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
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
  description: string;
  category: "consumable" | "weapon" | "armor" | "material" | "tool";
  equipSlot: string | null;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  quantity: number;
  equipped: boolean;
  equippedSlot: string | null;
  durability: number | null;
  maxDurability: number | null;
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
  equip:            "#9aa7cc",
  spawn:            "#565f89",
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
          <span className="text-[13px] uppercase tracking-widest text-[#565f89]">{">> CHAMPION"}</span>
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
              <p className="text-[17px] text-[#565f89]">Champion offline</p>
              <p className="text-[17px] text-[#3a4260]">Deploy your agent to bring<br />your champion online.</p>
            </div>
          )}
        </div>
      </div>

      {/* Zone */}
      {zoneId && (
        <div className="border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[17px]">
          <span className="text-[#565f89]">ZONE  </span>
          <span className="text-[#5dadec]">{zoneLabel(zoneId)}</span>
          <span className="ml-1 text-[12px] animate-pulse text-[#54f28b]">● LIVE</span>
        </div>
      )}

      {/* Wallet */}
      <div className="border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[17px]">
        <span className="text-[#565f89]">WALLET  </span>
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
            <span className="mt-0.5 text-[13px] uppercase tracking-wide text-[#565f89]">{s.label}</span>
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

type Tab = "inventory" | "overview" | "professions" | "quests" | "activity" | "party";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "inventory",   label: "Inventory"  },
    { id: "overview",    label: "Overview"   },
    { id: "professions", label: "Professions"},
    { id: "quests",      label: "Quests"     },
    { id: "activity",    label: "Activity"   },
    { id: "party",       label: "Party"      },
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
              : "text-[#565f89] hover:text-[#9aa7cc]"
          }`}
          style={{ marginBottom: active === t.id ? "-2px" : "0" }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Inventory tab ─────────────────────────────────────────────────────────

function InventoryTab({
  items,
  loading,
}: {
  items: InventoryItem[];
  loading: boolean;
}) {
  const [filter, setFilter] = React.useState<string>("all");

  const categories = ["all", "weapon", "armor", "consumable", "material"] as const;

  const filtered = filter === "all" ? items : items.filter((i) => i.category === filter);

  // Group equipped items first
  const sorted = [...filtered].sort((a, b) => {
    if (a.equipped && !b.equipped) return -1;
    if (!a.equipped && b.equipped) return 1;
    return a.name.localeCompare(b.name);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[17px] text-[#3a4260] font-mono animate-pulse">Loading inventory...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 font-mono">
      {/* Filter bar */}
      <div className="flex gap-1 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1 text-[17px] uppercase tracking-wide border-2 transition ${
              filter === cat
                ? "border-[#ffcc00] bg-[#2a2210] text-[#ffcc00]"
                : "border-[#2a3450] bg-[#0b1020] text-[#565f89] hover:text-[#9aa7cc] hover:border-[#3a4460]"
            }`}
          >
            {cat === "all" ? `All (${items.length})` : `${CATEGORY_ICONS[cat] ?? ""} ${cat}`}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000] px-4 py-12 text-center">
          <p className="text-[17px] text-[#3a4260]">
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
                    className="absolute top-2 right-2 text-[12px] uppercase tracking-wide border px-1 py-0.5"
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
                      <span className="text-[13px] font-bold text-[#d6deff]">{item.name}</span>
                      <span
                        className="text-[13px] uppercase tracking-wide border px-1"
                        style={{ color: rc, borderColor: rc + "44", backgroundColor: rc + "11" }}
                      >
                        {item.rarity}
                      </span>
                    </div>
                    <p className="text-[13px] text-[#565f89] mt-0.5 leading-relaxed line-clamp-2">
                      {item.description}
                    </p>

                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {/* Quantity */}
                      <span className="text-[17px] text-[#9aa7cc]">
                        <span className="text-[#3a4260]">QTY</span>{"  "}
                        <span className="font-bold text-[#ffcc00]">{item.quantity}</span>
                      </span>

                      {/* Equipped slot */}
                      {item.equippedSlot && (
                        <span className="text-[13px] uppercase text-[#565f89]">
                          [{item.equippedSlot}]
                        </span>
                      )}

                      {/* Durability */}
                      {durPct !== null && (
                        <div className="flex items-center gap-1">
                          <span className="text-[13px] text-[#3a4260]">DUR</span>
                          <div className="h-1 w-12 border border-black bg-[#0f1528]">
                            <div
                              className="h-full transition-all"
                              style={{ width: `${durPct}%`, backgroundColor: durColor ?? "#54f28b" }}
                            />
                          </div>
                          <span className="text-[13px]" style={{ color: durColor ?? "#54f28b" }}>
                            {durPct}%
                          </span>
                        </div>
                      )}
                    </div>
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
            <span className="mt-0.5 text-[12px] uppercase tracking-wide text-[#565f89]">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2">
          <span className="text-[13px] uppercase tracking-widest text-[#565f89]">Recent Activity</span>
        </div>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-[17px] text-[#3a4260]">No activity yet</p>
        ) : (
          <div>
            {recent.map((e) => (
              <div key={e.id} className="flex items-start gap-3 border-b border-[#1e2842] px-4 py-2.5 last:border-b-0 font-mono">
                <span className="mt-0.5 shrink-0 text-[13px] uppercase tracking-wide" style={{ color: ACTION_COLORS[e.action] ?? "#565f89" }}>
                  {e.action.replace(/_/g, " ")}
                </span>
                <span className="flex-1 text-[17px] text-[#d6deff]">{e.headline}</span>
                <span className="shrink-0 text-[13px] text-[#3a4260]">{timeAgo(e.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Professions tab ───────────────────────────────────────────────────────

function ProfessionsTab({ learned }: { learned: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ALL_PROFESSIONS.map((p) => {
        const isLearned = learned.includes(p.id);
        return (
          <div
            key={p.id}
            className={`flex flex-col items-center border-4 border-black py-5 shadow-[3px_3px_0_0_#000] transition ${
              isLearned ? "bg-[linear-gradient(180deg,#0d1f0f,#0b1020)]" : "bg-[#0a0f1a] opacity-50"
            }`}
          >
            <span className="text-[26px]">{p.icon}</span>
            <span className={`mt-2 text-[17px] uppercase tracking-wide font-mono ${isLearned ? "text-[#54f28b]" : "text-[#3a4260]"}`}>
              {p.name}
            </span>
            <span className="mt-1 text-[13px] font-mono">
              {isLearned ? (
                <span className="text-[#54f28b]">[✓ Learned]</span>
              ) : (
                <span className="text-[#3a4260]">[Locked]</span>
              )}
            </span>
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
        <span className="text-[13px] uppercase tracking-widest text-[#565f89]">Completed Quests</span>
        <span className="text-[17px] font-bold text-[#54f28b] font-mono">{quests.length}</span>
      </div>
      {quests.length === 0 ? (
        <p className="px-4 py-10 text-center text-[17px] text-[#3a4260]">No quests completed yet</p>
      ) : (
        <div>
          {quests.map((e) => {
            const xp = (e.details.xpReward as number) ?? 0;
            const copperReward = ((e.details.copperReward as number) ?? (e.details.goldReward as number) ?? 0);
            return (
              <div key={e.id} className="flex items-start justify-between border-b border-[#1e2842] px-4 py-3 last:border-b-0 font-mono hover:bg-[#1a2240]/30 transition">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-[#54f28b] font-bold">{e.headline}</p>
                  <p className="text-[13px] text-[#565f89] mt-0.5">{zoneLabel(e.zoneId)}</p>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0 ml-3">
                  {xp > 0 && <span className="text-[13px] text-[#ffcc00]">+{xp} XP</span>}
                  {copperReward > 0 && (
                    <span className="text-[13px] text-[#ffcc00]">+{formatCopperString(copperReward)}</span>
                  )}
                  <span className="text-[12px] text-[#3a4260]">{timeAgo(e.timestamp)}</span>
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
        <span className="text-[13px] uppercase tracking-widest text-[#565f89]">Activity Log</span>
        <span className="text-[17px] text-[#3a4260] font-mono">{diary.length} entries</span>
      </div>
      {diary.length === 0 ? (
        <p className="px-4 py-10 text-center text-[17px] text-[#3a4260]">No activity recorded</p>
      ) : (
        <div className="max-h-[520px] overflow-y-auto">
          {diary.map((e) => (
            <div key={e.id} className="border-b border-[#1a2030] px-4 py-2.5 last:border-b-0 font-mono hover:bg-[#1a2240]/20 transition">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[13px] uppercase tracking-wide shrink-0" style={{ color: ACTION_COLORS[e.action] ?? "#565f89" }}>
                  [{e.action.replace(/_/g, " ")}]
                </span>
                <span className="text-[17px] text-[#d6deff] flex-1">{e.headline}</span>
                <span className="text-[12px] text-[#3a4260] shrink-0">{timeAgo(e.timestamp)}</span>
              </div>
              <p className="text-[13px] text-[#3a4260] leading-relaxed">{e.narrative}</p>
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
}: {
  custodialWallet: string | null;
  entityId: string | null;
  entityZoneId: string | null;
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
    if (!entityId || !entityZoneId) return;
    if (!target.walletAddress) { setActionMsg("Champion has no wallet — cannot invite"); return; }
    try {
      const res = await fetch(`${API_URL}/party/invite-champion`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromEntityId: entityId, fromZoneId: entityZoneId, toCustodialWallet: target.walletAddress }),
      });
      const d = await res.json();
      if (res.ok) setActionMsg(`Invite sent to ${target.name}!`);
      else setActionMsg(`Error: ${d.error}`);
    } catch { setActionMsg("Failed to send invite"); }
    setTimeout(() => setActionMsg(null), 4000);
  }

  async function acceptInvite(invite: PartyInviteInfo) {
    if (!custodialWallet) return;
    const res = await fetch(`${API_URL}/party/accept-invite`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custodialWallet, inviteId: invite.id }),
    });
    const d = await res.json();
    if (!res.ok) setActionMsg(`Error: ${d.error}`);
    else setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    setTimeout(() => setActionMsg(null), 4000);
  }

  async function declineInvite(invite: PartyInviteInfo) {
    if (!custodialWallet) return;
    await fetch(`${API_URL}/party/decline-invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ custodialWallet, inviteId: invite.id }) });
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
  }

  async function leaveParty() {
    if (!custodialWallet) return;
    const res = await fetch(`${API_URL}/party/leave-wallet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ custodialWallet }) });
    if (res.ok) setPartyStatus({ inParty: false, members: [] });
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
                <p className="text-[13px] text-[#3a4260] mt-0.5">{timeAgo(inv.createdAt)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => void acceptInvite(inv)} className="border-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-1 text-[17px] text-[#54f28b] hover:bg-[#112a1b] shadow-[2px_2px_0_0_#000]">[✓]</button>
                <button onClick={() => void declineInvite(inv)} className="border-2 border-[#2a3450] px-3 py-1 text-[17px] text-[#565f89] hover:text-[#9aa7cc]">[✗]</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2 flex items-center justify-between">
          <span className="text-[13px] uppercase tracking-widest text-[#565f89]">Current Party</span>
          {partyStatus.inParty && (
            <button onClick={() => void leaveParty()} className="text-[13px] text-[#ff6b6b] hover:text-[#ff9999]">[Leave]</button>
          )}
        </div>
        {!partyStatus.inParty ? (
          <p className="px-4 py-6 text-center text-[17px] text-[#3a4260]">Not in a party</p>
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
                      <span className="text-[13px] capitalize text-[#565f89]">{m.raceId} {m.classId}</span>
                      {m.zoneId && <span className="text-[13px] text-[#3a4260]">• {zoneLabel(m.zoneId)}</span>}
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
          <span className="text-[13px] uppercase tracking-widest text-[#565f89]">Find Champions</span>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search by champion name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }}
              className="flex-1 border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[12px] text-[#d6deff] placeholder-[#3a4260] outline-none focus:border-[#54f28b]"
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
                        <span className="text-[13px] capitalize text-[#565f89]">{r.raceId} {r.classId}</span>
                      </div>
                      <span className="text-[13px] text-[#3a4260]">{zoneLabel(r.zoneId)}</span>
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
            <p className="text-center text-[17px] text-[#3a4260]">No champions found online</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Character Switcher ────────────────────────────────────────────────────

interface CharacterNft {
  tokenId: string;
  name: string;
  description?: string;
  properties?: {
    level?: number;
    race?: string;
    class?: string;
    xp?: number;
  };
}

function CharacterSwitcher({
  characters,
  selectedName,
  onSelect,
}: {
  characters: CharacterNft[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  if (characters.length <= 1) return null;
  return (
    <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000] font-mono">
      <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-widest text-[#565f89]">My Champions ({characters.length})</span>
      </div>
      <div className="p-2 flex flex-col gap-1.5">
        {characters.map((c) => {
          const baseName = c.name.includes(" the ") ? c.name.split(" the ")[0] : c.name;
          const lv = c.properties?.level ?? 1;
          const lc = levelColor(lv);
          const isActive = selectedName === baseName || (!selectedName && characters[0]?.name.includes(baseName));
          return (
            <button
              key={c.tokenId}
              onClick={() => onSelect(baseName)}
              className={`text-left px-3 py-2 border-2 transition ${
                isActive
                  ? "border-[#ffcc00]/60 bg-[#2a2210]"
                  : "border-[#2a3450] bg-[#0b1020] hover:bg-[#1a2240]/40 hover:border-[#3a4460]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-[#d6deff] truncate">{baseName}</span>
                <span className="text-[10px] shrink-0" style={{ color: lc }}>Lv {lv}</span>
              </div>
              {c.properties?.race && (
                <span className="text-[9px] capitalize text-[#565f89]">
                  {c.properties.race} {c.properties.class}
                </span>
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
  const [diary, setDiary]                   = React.useState<DiaryEntry[]>([]);
  const [items, setItems]                   = React.useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = React.useState(false);
  const [loading, setLoading]               = React.useState(false);
  const [activeTab, setActiveTab]           = React.useState<Tab>("inventory");
  const [characters, setCharacters]         = React.useState<CharacterNft[]>([]);
  const [selectedCharName, setSelectedCharName] = React.useState<string | null>(null);

  // Step 1 — resolve custodial wallet + fetch all owned characters
  React.useEffect(() => {
    if (!wallet) return;
    Promise.all([
      fetch(`${API_URL}/agent/wallet/${wallet}`).then((r) => r.json()).catch(() => ({})),
      fetch(`${API_URL}/character/${wallet}`).then((r) => r.json()).catch(() => ({ characters: [] })),
    ]).then(([agentData, charData]) => {
      setCustodialWallet(agentData.custodialWallet ?? null);
      setAgentEntityId(agentData.entityId ?? null);
      setAgentZoneId(agentData.zoneId ?? null);
      const chars: CharacterNft[] = charData.characters ?? [];
      setCharacters(chars);
      // Auto-select first character if none selected
      if (chars.length > 0 && !selectedCharName) {
        const first = chars[0];
        const baseName = first.name.includes(" the ") ? first.name.split(" the ")[0] : first.name;
        setSelectedCharName(baseName);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  // Step 2 — poll live entity from world state
  React.useEffect(() => {
    const searchWallet = (custodialWallet ?? wallet)?.toLowerCase();
    if (!searchWallet) return;

    async function fetchLiveEntity() {
      try {
        const res = await fetch(`${API_URL}/state`);
        const data = await res.json();
        for (const [zId, zone] of Object.entries(data.zones as Record<string, any>)) {
          for (const ent of Object.values(zone.entities as Record<string, any>)) {
            const e = ent as any;
            if (e.type !== "player") continue;
            if (e.walletAddress?.toLowerCase() !== searchWallet) continue;
            // If a specific character is selected, filter by name
            if (selectedCharName && !e.name?.toLowerCase().startsWith(selectedCharName.toLowerCase())) continue;
            setEntity({ name: e.name, level: e.level ?? 1, xp: e.xp ?? 0, hp: e.hp ?? 0, maxHp: e.maxHp ?? 100, raceId: e.raceId, classId: e.classId, kills: e.kills ?? 0, completedQuests: e.completedQuests ?? [], walletAddress: e.walletAddress, zoneId: zId });
            setZoneId(zId);
            return;
          }
        }
        setEntity(null);
        setZoneId(null);
      } catch { /* non-fatal */ }
    }

    fetchLiveEntity();
    const interval = setInterval(fetchLiveEntity, 10_000);
    return () => clearInterval(interval);
  }, [custodialWallet, wallet, selectedCharName]);

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
        if (profRes.ok)  { const pd = await profRes.json();  setProfessions(pd.professions ?? []); }
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
      <div className="relative flex min-h-full w-full flex-col items-center overflow-y-auto pt-16">
        <div className="pointer-events-none fixed inset-0 z-50" style={{ background: "repeating-linear-gradient(0deg,rgba(0,0,0,0.15) 0px,rgba(0,0,0,0.15) 1px,transparent 1px,transparent 3px)" }} />
        <div className="z-10 flex flex-col items-center gap-6 px-4 py-24 text-center font-mono">
          <p className="text-[12px] uppercase tracking-widest text-[#565f89]">{">>"} Champions</p>
          <h1 className="text-[26px] uppercase tracking-widest text-[#ffcc00]" style={{ textShadow: "3px 3px 0 #000" }}>My Champion</h1>
          <p className="text-[12px] text-[#3a4260]">Connect your wallet to view your champion's stats.</p>
          <Link to="/" className="border-4 border-black bg-[#54f28b] px-6 py-3 text-[13px] uppercase tracking-wide text-[#060d12] shadow-[4px_4px_0_0_#000] hover:bg-[#7bf5a8] font-bold">
            {">>> Connect Wallet <<<"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-full w-full flex-col items-center overflow-y-auto overflow-x-hidden pt-16">
      <div className="pointer-events-none fixed inset-0 z-50" style={{ background: "repeating-linear-gradient(0deg,rgba(0,0,0,0.15) 0px,rgba(0,0,0,0.15) 1px,transparent 1px,transparent 3px)" }} />

      <div className="z-10 w-full max-w-5xl px-4 py-10">
        {/* Page header */}
        <div className="mb-6">
          <p className="mb-1 text-[17px] uppercase tracking-widest text-[#565f89] font-mono">{"<< Champions >>"}</p>
          <h1 className="text-[26px] uppercase tracking-widest text-[#ffcc00] font-mono" style={{ textShadow: "3px 3px 0 #000" }}>
            {entity ? entity.name : "My Champion"}
          </h1>
          {loading && <p className="mt-1 text-[17px] text-[#3a4260] font-mono animate-pulse">Loading champion data...</p>}
        </div>

        {/* Two-column layout */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Sidebar */}
          <div className="w-full lg:w-72 lg:shrink-0 flex flex-col gap-3">
            <CharacterSwitcher characters={characters} selectedName={selectedCharName} onSelect={setSelectedCharName} />
            <ChampionSidebar entity={entity} wallet={wallet} zoneId={zoneId} kills={kills} deaths={deaths} />
          </div>

          {/* Main panel */}
          <div className="flex-1 min-w-0 border-4 border-black bg-[#0a0f1a] shadow-[4px_4px_0_0_#000]">
            <TabBar active={activeTab} onChange={setActiveTab} />
            <div className="p-4">
              {activeTab === "inventory"   && <InventoryTab items={items} loading={inventoryLoading} />}
              {activeTab === "overview"    && <OverviewTab entity={entity} diary={diary} kills={kills} deaths={deaths} quests={quests} itemCount={items.length} />}
              {activeTab === "professions" && <ProfessionsTab learned={professions} />}
              {activeTab === "quests"      && <QuestsTab diary={diary} />}
              {activeTab === "activity"    && <ActivityTab diary={diary} />}
              {activeTab === "party"       && <PartyTab custodialWallet={custodialWallet} entityId={agentEntityId} entityZoneId={agentZoneId} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
