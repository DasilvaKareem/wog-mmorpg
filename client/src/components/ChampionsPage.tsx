import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { API_URL } from "@/config";
import { useWalletContext } from "@/context/WalletContext";
import { HpBar } from "@/components/ui/hp-bar";
import { XpBar } from "@/components/ui/xp-bar";

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
  const levelColor =
    (entity?.level ?? 0) >= 50
      ? "#aa44ff"
      : (entity?.level ?? 0) >= 30
      ? "#5dadec"
      : (entity?.level ?? 0) >= 15
      ? "#54f28b"
      : "#9aa7cc";

  return (
    <div className="flex flex-col gap-3 font-mono">
      {/* Identity card */}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-3 py-2">
          <span className="text-[7px] uppercase tracking-widest text-[#565f89]">
            {">> CHAMPION"}
          </span>
        </div>
        <div className="px-4 py-4 flex flex-col gap-2">
          {entity ? (
            <>
              <p
                className="text-[18px] font-bold leading-none"
                style={{ color: "#ffcc00", textShadow: "2px 2px 0 #000" }}
              >
                {entity.name}
              </p>
              <div className="flex items-center gap-2">
                <span
                  className="border-2 border-black px-2 py-0.5 text-[10px] font-bold shadow-[2px_2px_0_0_#000]"
                  style={{ backgroundColor: levelColor + "22", color: levelColor, borderColor: levelColor + "66" }}
                >
                  LV {entity.level}
                </span>
                <span className="text-[9px] capitalize text-[#9aa7cc]">
                  {entity.raceId} {entity.classId}
                </span>
              </div>
              <div className="mt-1 flex flex-col gap-1.5">
                <HpBar hp={entity.hp} maxHp={entity.maxHp} />
                <XpBar level={entity.level} xp={entity.xp} />
              </div>
            </>
          ) : (
            <p className="text-[9px] text-[#565f89]">Champion offline</p>
          )}
        </div>
      </div>

      {/* Zone */}
      {zoneId && (
        <div className="border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[8px]">
          <span className="text-[#565f89]">LOCATION  </span>
          <span className="text-[#5dadec]">{zoneLabel(zoneId)}</span>
          <span className="ml-1 text-[6px] animate-pulse text-[#54f28b]">● LIVE</span>
        </div>
      )}

      {/* Wallet */}
      <div className="border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[8px]">
        <span className="text-[#565f89]">WALLET  </span>
        <span className="text-[#9aa7cc]">
          {wallet.slice(0, 8)}...{wallet.slice(-6)}
        </span>
      </div>

      {/* Combat stats */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Kills", value: kills, color: "#ff6b6b" },
          { label: "Deaths", value: deaths, color: "#9aa7cc" },
        ].map((s) => (
          <div
            key={s.label}
            className="flex flex-col items-center border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] py-3 shadow-[3px_3px_0_0_#000]"
          >
            <span
              className="text-[16px] font-bold"
              style={{ color: s.color, textShadow: "2px 2px 0 #000" }}
            >
              {s.value}
            </span>
            <span className="mt-0.5 text-[7px] uppercase tracking-wide text-[#565f89]">
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Watch button */}
      <button
        onClick={() => navigate("/world")}
        className="w-full border-4 border-black bg-[#54f28b] px-4 py-2.5 text-[10px] uppercase tracking-wide text-[#060d12] shadow-[4px_4px_0_0_#000] transition hover:bg-[#7bf5a8] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[2px_2px_0_0_#000] font-bold"
      >
        {">>> Watch in World <<<"}
      </button>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

type Tab = "overview" | "professions" | "quests" | "activity" | "party";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview",    label: "Overview",    icon: "//" },
    { id: "professions", label: "Professions", icon: "⚒" },
    { id: "quests",      label: "Quests",      icon: "!!" },
    { id: "activity",    label: "Activity Log", icon: ">>" },
    { id: "party",       label: "Party",        icon: "##" },
  ];
  return (
    <div className="flex gap-0 border-b-2 border-[#2a3450]">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-[9px] uppercase tracking-wide transition ${
            active === t.id
              ? "border-b-2 border-[#ffcc00] text-[#ffcc00] bg-[#1a2240]"
              : "text-[#565f89] hover:text-[#9aa7cc]"
          }`}
          style={{ marginBottom: active === t.id ? "-2px" : "0" }}
        >
          <span className="text-[7px]">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Overview tab
function OverviewTab({
  entity,
  diary,
  kills,
  deaths,
  quests,
}: {
  entity: LiveEntity | null;
  diary: DiaryEntry[];
  kills: number;
  deaths: number;
  quests: number;
}) {
  const kd = deaths === 0 ? kills.toFixed(0) : (kills / deaths).toFixed(2);
  const recent = diary.slice(0, 8);

  const stats = [
    { label: "Level",    value: entity ? String(entity.level) : "--", color: "#ffcc00" },
    { label: "Kills",    value: String(kills),                        color: "#ff6b6b" },
    { label: "Deaths",   value: String(deaths),                       color: "#9aa7cc" },
    { label: "K / D",    value: kd,                                   color: "#5dadec" },
    { label: "Quests",   value: String(quests),                       color: "#54f28b" },
    { label: "HP",       value: entity ? `${entity.hp}/${entity.maxHp}` : "--", color: "#ff8c00" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Stat grid */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex flex-col items-center border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] py-3 shadow-[3px_3px_0_0_#000]"
          >
            <span
              className="text-[14px] font-bold font-mono"
              style={{ color: s.color, textShadow: "2px 2px 0 #000" }}
            >
              {s.value}
            </span>
            <span className="mt-0.5 text-[6px] uppercase tracking-wide text-[#565f89]">
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Recent activity */}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2">
          <span className="text-[7px] uppercase tracking-widest text-[#565f89]">
            Recent Activity
          </span>
        </div>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-[8px] text-[#3a4260]">No activity yet</p>
        ) : (
          <div>
            {recent.map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-3 border-b border-[#1e2842] px-4 py-2.5 last:border-b-0 font-mono"
              >
                <span
                  className="mt-0.5 shrink-0 text-[7px] uppercase tracking-wide"
                  style={{ color: ACTION_COLORS[e.action] ?? "#565f89" }}
                >
                  {e.action.replace("_", " ")}
                </span>
                <span className="flex-1 text-[8px] text-[#d6deff]">{e.headline}</span>
                <span className="shrink-0 text-[7px] text-[#3a4260]">{timeAgo(e.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Professions tab
function ProfessionsTab({ learned }: { learned: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ALL_PROFESSIONS.map((p) => {
        const isLearned = learned.includes(p.id);
        return (
          <div
            key={p.id}
            className={`flex flex-col items-center border-4 border-black py-5 shadow-[3px_3px_0_0_#000] transition ${
              isLearned
                ? "bg-[linear-gradient(180deg,#0d1f0f,#0b1020)]"
                : "bg-[#0a0f1a] opacity-50"
            }`}
          >
            <span className="text-[22px]">{p.icon}</span>
            <span
              className={`mt-2 text-[8px] uppercase tracking-wide font-mono ${
                isLearned ? "text-[#54f28b]" : "text-[#3a4260]"
              }`}
            >
              {p.name}
            </span>
            <span className="mt-1 text-[7px] font-mono">
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

// Quests tab
function QuestsTab({ diary }: { diary: DiaryEntry[] }) {
  const quests = diary.filter((e) => e.action === "quest_complete");
  return (
    <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
      <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2 flex items-center justify-between">
        <span className="text-[7px] uppercase tracking-widest text-[#565f89]">Completed Quests</span>
        <span className="text-[8px] font-bold text-[#54f28b] font-mono">{quests.length}</span>
      </div>
      {quests.length === 0 ? (
        <p className="px-4 py-10 text-center text-[8px] text-[#3a4260]">
          No quests completed yet
        </p>
      ) : (
        <div>
          {quests.map((e) => {
            const xp = (e.details.xpReward as number) ?? 0;
            const gold = (e.details.goldReward as number) ?? 0;
            return (
              <div
                key={e.id}
                className="flex items-start justify-between border-b border-[#1e2842] px-4 py-3 last:border-b-0 font-mono hover:bg-[#1a2240]/30 transition"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-[#54f28b] font-bold">{e.headline}</p>
                  <p className="text-[7px] text-[#565f89] mt-0.5">{zoneLabel(e.zoneId)}</p>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0 ml-3">
                  {xp > 0 && <span className="text-[7px] text-[#ffcc00]">+{xp} XP</span>}
                  {gold > 0 && <span className="text-[7px] text-[#ffcc00]">+{gold} G</span>}
                  <span className="text-[6px] text-[#3a4260]">{timeAgo(e.timestamp)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Activity log tab
function ActivityTab({ diary }: { diary: DiaryEntry[] }) {
  return (
    <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
      <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2 flex items-center justify-between">
        <span className="text-[7px] uppercase tracking-widest text-[#565f89]">Activity Log</span>
        <span className="text-[8px] text-[#3a4260] font-mono">{diary.length} entries</span>
      </div>
      {diary.length === 0 ? (
        <p className="px-4 py-10 text-center text-[8px] text-[#3a4260]">No activity recorded</p>
      ) : (
        <div className="max-h-[520px] overflow-y-auto">
          {diary.map((e) => (
            <div
              key={e.id}
              className="border-b border-[#1a2030] px-4 py-2.5 last:border-b-0 font-mono hover:bg-[#1a2240]/20 transition"
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className="text-[7px] uppercase tracking-wide shrink-0"
                  style={{ color: ACTION_COLORS[e.action] ?? "#565f89" }}
                >
                  [{e.action.replace("_", " ")}]
                </span>
                <span className="text-[8px] text-[#d6deff] flex-1">{e.headline}</span>
                <span className="text-[6px] text-[#3a4260] shrink-0">{timeAgo(e.timestamp)}</span>
              </div>
              <p className="text-[7px] text-[#3a4260] leading-relaxed">{e.narrative}</p>
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
  const [partyStatus, setPartyStatus] = React.useState<{
    inParty: boolean;
    partyId?: string;
    members: PartyMember[];
  }>({ inParty: false, members: [] });
  const [invites, setInvites] = React.useState<PartyInviteInfo[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [actionMsg, setActionMsg] = React.useState<string | null>(null);

  const isOnline = Boolean(entityId);

  // Poll party status + invites every 5s
  React.useEffect(() => {
    if (!custodialWallet) return;

    async function poll() {
      try {
        const [statusRes, invitesRes] = await Promise.all([
          fetch(`${API_URL}/party/status/${custodialWallet}`),
          fetch(`${API_URL}/party/invites/${custodialWallet}`),
        ]);
        if (statusRes.ok) {
          const d = await statusRes.json();
          setPartyStatus({ inParty: d.inParty, partyId: d.partyId, members: d.members ?? [] });
        }
        if (invitesRes.ok) {
          const d = await invitesRes.json();
          setInvites(d.invites ?? []);
        }
      } catch { /* non-fatal */ }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [custodialWallet]);

  // Search
  async function doSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_URL}/party/search?q=${encodeURIComponent(searchQuery.trim())}`);
      if (res.ok) {
        const d = await res.json();
        // Hide own champion from results
        setSearchResults(
          (d.results ?? []).filter((r: SearchResult) =>
            r.walletAddress?.toLowerCase() !== custodialWallet?.toLowerCase()
          )
        );
      }
    } catch { /* non-fatal */ }
    finally { setSearching(false); }
  }

  async function sendInvite(target: SearchResult) {
    if (!entityId || !entityZoneId) return;
    if (!target.walletAddress) { setActionMsg("Champion has no wallet — cannot invite"); return; }
    try {
      const res = await fetch(`${API_URL}/party/invite-champion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromEntityId: entityId,
          fromZoneId: entityZoneId,
          toCustodialWallet: target.walletAddress,
        }),
      });
      const d = await res.json();
      if (res.ok) setActionMsg(`Invite sent to ${target.name}!`);
      else setActionMsg(`Error: ${d.error}`);
    } catch { setActionMsg("Failed to send invite"); }
    setTimeout(() => setActionMsg(null), 4000);
  }

  async function acceptInvite(invite: PartyInviteInfo) {
    if (!custodialWallet) return;
    try {
      const res = await fetch(`${API_URL}/party/accept-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custodialWallet, inviteId: invite.id }),
      });
      const d = await res.json();
      if (!res.ok) setActionMsg(`Error: ${d.error}`);
      else setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch { setActionMsg("Failed to accept invite"); }
    setTimeout(() => setActionMsg(null), 4000);
  }

  async function declineInvite(invite: PartyInviteInfo) {
    if (!custodialWallet) return;
    await fetch(`${API_URL}/party/decline-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custodialWallet, inviteId: invite.id }),
    });
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
  }

  async function leaveParty() {
    if (!custodialWallet) return;
    const res = await fetch(`${API_URL}/party/leave-wallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custodialWallet }),
    });
    if (res.ok) setPartyStatus({ inParty: false, members: [] });
  }

  return (
    <div className="flex flex-col gap-4 font-mono">

      {/* Offline warning */}
      {!isOnline && (
        <div className="border-2 border-[#ffcc00]/40 bg-[#2a2210] px-4 py-3 text-[8px] text-[#ffcc00]">
          [!] Your champion must be online (deployed) to send party invites.
        </div>
      )}

      {/* Action feedback */}
      {actionMsg && (
        <div className="border-2 border-[#54f28b]/40 bg-[#0a1a0e] px-3 py-2 text-[8px] text-[#54f28b]">
          {actionMsg}
        </div>
      )}

      {/* ── Pending invites ── */}
      {invites.length > 0 && (
        <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
          <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2 flex items-center justify-between">
            <span className="text-[7px] uppercase tracking-widest text-[#ffcc00]">
              Pending Invites ({invites.length})
            </span>
          </div>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 border-b border-[#1e2842] px-4 py-3 last:border-b-0">
              <div>
                <p className="text-[9px] text-[#d6deff]">
                  <span className="text-[#ffcc00]">{inv.fromName}</span> invited your champion to a party
                </p>
                <p className="text-[7px] text-[#3a4260] mt-0.5">{timeAgo(inv.createdAt)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => void acceptInvite(inv)}
                  className="border-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-1 text-[8px] text-[#54f28b] hover:bg-[#112a1b] transition shadow-[2px_2px_0_0_#000]"
                >
                  [✓] Accept
                </button>
                <button
                  onClick={() => void declineInvite(inv)}
                  className="border-2 border-[#2a3450] px-3 py-1 text-[8px] text-[#565f89] hover:text-[#9aa7cc] transition"
                >
                  [✗] Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Current party ── */}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2 flex items-center justify-between">
          <span className="text-[7px] uppercase tracking-widest text-[#565f89]">Current Party</span>
          {partyStatus.inParty && (
            <button
              onClick={() => void leaveParty()}
              className="text-[7px] text-[#ff6b6b] hover:text-[#ff9999] transition"
            >
              [Leave Party]
            </button>
          )}
        </div>
        {!partyStatus.inParty ? (
          <p className="px-4 py-6 text-center text-[8px] text-[#3a4260]">
            Not in a party — invite a champion below
          </p>
        ) : (
          <div>
            {partyStatus.members.map((m) => {
              const levelColor =
                m.level >= 50 ? "#aa44ff" : m.level >= 30 ? "#5dadec" : m.level >= 15 ? "#54f28b" : "#9aa7cc";
              const hpPct = m.maxHp > 0 ? (m.hp / m.maxHp) * 100 : 0;
              const hpColor = hpPct > 66 ? "#54f28b" : hpPct > 33 ? "#ffcc00" : "#ff6b6b";
              return (
                <div
                  key={m.entityId}
                  className="flex items-center gap-3 border-b border-[#1e2842] px-4 py-3 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-[#d6deff]">{m.name}</span>
                      {m.isLeader && (
                        <span className="text-[6px] border border-[#ffcc00]/40 bg-[#2a2210] px-1 text-[#ffcc00]">
                          LEADER
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[8px] capitalize" style={{ color: levelColor }}>
                        Lv {m.level}
                      </span>
                      <span className="text-[7px] capitalize text-[#565f89]">
                        {m.raceId} {m.classId}
                      </span>
                      {m.zoneId && (
                        <span className="text-[7px] text-[#3a4260]">• {zoneLabel(m.zoneId)}</span>
                      )}
                    </div>
                    {/* HP bar */}
                    <div className="mt-1 h-1.5 w-32 border border-black bg-[#0f1528]">
                      <div
                        className="h-full transition-all"
                        style={{ width: `${hpPct}%`, backgroundColor: hpColor }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Find champions ── */}
      <div className="border-4 border-black bg-[linear-gradient(180deg,#121a2c,#0b1020)] shadow-[4px_4px_0_0_#000]">
        <div className="border-b-2 border-[#2a3450] bg-[#1a2240] px-4 py-2">
          <span className="text-[7px] uppercase tracking-widest text-[#565f89]">Find Champions</span>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search by champion name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }}
              className="flex-1 border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[9px] text-[#d6deff] placeholder-[#3a4260] outline-none focus:border-[#54f28b]"
            />
            <button
              onClick={() => void doSearch()}
              disabled={searching || !searchQuery.trim()}
              className="border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2 text-[9px] text-[#54f28b] shadow-[2px_2px_0_0_#000] hover:bg-[#112a1b] disabled:opacity-40 transition"
            >
              {searching ? "..." : "[Search]"}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="flex flex-col gap-1">
              {searchResults.map((r) => {
                const levelColor =
                  r.level >= 50 ? "#aa44ff" : r.level >= 30 ? "#5dadec" : r.level >= 15 ? "#54f28b" : "#9aa7cc";
                return (
                  <div
                    key={r.entityId}
                    className="flex items-center justify-between border border-[#1e2842] bg-[#0b1020] px-3 py-2.5 hover:bg-[#1a2240]/30 transition"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold text-[#d6deff]">{r.name}</span>
                        <span className="text-[8px]" style={{ color: levelColor }}>Lv {r.level}</span>
                        <span className="text-[7px] capitalize text-[#565f89]">{r.raceId} {r.classId}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[7px] text-[#3a4260]">{zoneLabel(r.zoneId)}</span>
                        {r.inParty && (
                          <span className="text-[6px] border border-[#565f89]/40 px-1 text-[#565f89]">IN PARTY</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => void sendInvite(r)}
                      disabled={!isOnline || r.inParty}
                      className="border-2 border-[#26a5e4] bg-[#0a1020] px-3 py-1 text-[8px] text-[#26a5e4] shadow-[2px_2px_0_0_#000] hover:bg-[#0e1830] disabled:opacity-30 disabled:cursor-not-allowed transition"
                    >
                      {r.inParty ? "In Party" : "[Invite]"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {searchResults.length === 0 && searchQuery && !searching && (
            <p className="text-center text-[8px] text-[#3a4260]">No champions found online</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export function ChampionsPage(): React.ReactElement {
  const { address: connectedAddress } = useWalletContext();
  const [searchParams] = useSearchParams();

  // Resolve which wallet to show: ?wallet= param > connected wallet
  const wallet = searchParams.get("wallet") ?? connectedAddress ?? null;

  const [custodialWallet, setCustodialWallet] = React.useState<string | null>(null);
  const [agentEntityId, setAgentEntityId] = React.useState<string | null>(null);
  const [agentZoneId, setAgentZoneId] = React.useState<string | null>(null);
  const [entity, setEntity] = React.useState<LiveEntity | null>(null);
  const [zoneId, setZoneId] = React.useState<string | null>(null);
  const [professions, setProfessions] = React.useState<string[]>([]);
  const [diary, setDiary] = React.useState<DiaryEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<Tab>("overview");

  // Step 1 — resolve custodial wallet + entityRef for the owner wallet
  React.useEffect(() => {
    if (!wallet) return;
    fetch(`${API_URL}/agent/wallet/${wallet}`)
      .then((r) => r.json())
      .then((d) => {
        setCustodialWallet(d.custodialWallet ?? null);
        setAgentEntityId(d.entityId ?? null);
        setAgentZoneId(d.zoneId ?? null);
      })
      .catch(() => {});
  }, [wallet]);

  // Step 2 — find live entity in world state using custodial wallet
  React.useEffect(() => {
    // Champion entity uses custodialWallet; fall back to ownerWallet for manual spawns
    const searchWallet = (custodialWallet ?? wallet)?.toLowerCase();
    if (!searchWallet) return;

    async function fetchLiveEntity() {
      try {
        const res = await fetch(`${API_URL}/state`);
        const data = await res.json();
        for (const [zId, zone] of Object.entries(data.zones as Record<string, any>)) {
          for (const ent of Object.values(zone.entities as Record<string, any>)) {
            const e = ent as any;
            if (e.walletAddress?.toLowerCase() === searchWallet && e.type === "player") {
              setEntity({
                name: e.name,
                level: e.level ?? 1,
                xp: e.xp ?? 0,
                hp: e.hp ?? 0,
                maxHp: e.maxHp ?? 100,
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
        }
        setEntity(null);
        setZoneId(null);
      } catch {
        // non-fatal
      }
    }

    fetchLiveEntity();
    const interval = setInterval(fetchLiveEntity, 10_000);
    return () => clearInterval(interval);
  }, [custodialWallet, wallet]);

  // Step 3 — fetch professions (using custodial wallet) + diary (using owner wallet)
  React.useEffect(() => {
    if (!wallet) return;
    // Wait for custodial wallet resolution — but don't block diary fetch
    const profWallet = custodialWallet ?? wallet;
    setLoading(true);

    async function fetchData() {
      try {
        const [profRes, diaryRes] = await Promise.all([
          fetch(`${API_URL}/professions/${profWallet}`),
          // Diary uses owner wallet — readMergedDiary on shard handles custodial merge
          fetch(`${API_URL}/diary/${wallet}?limit=200`),
        ]);
        if (profRes.ok) {
          const pd = await profRes.json();
          setProfessions(pd.professions ?? []);
        }
        if (diaryRes.ok) {
          const dd = await diaryRes.json();
          setDiary(dd.entries ?? []);
        }
      } catch {
        // non-fatal
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [custodialWallet, wallet]);

  // Derived stats from diary
  const kills   = diary.filter((e) => e.action === "kill").length;
  const deaths  = diary.filter((e) => e.action === "death").length;
  const quests  = diary.filter((e) => e.action === "quest_complete").length;

  // ── No wallet state ──────────────────────────────────────────────────────
  if (!wallet) {
    return (
      <div className="relative flex min-h-full w-full flex-col items-center overflow-y-auto pt-16">
        <div
          className="pointer-events-none fixed inset-0 z-50"
          style={{
            background:
              "repeating-linear-gradient(0deg,rgba(0,0,0,0.15) 0px,rgba(0,0,0,0.15) 1px,transparent 1px,transparent 3px)",
          }}
        />
        <div className="z-10 flex flex-col items-center gap-6 px-4 py-24 text-center font-mono">
          <p className="text-[9px] uppercase tracking-widest text-[#565f89]">{">>"} Champions</p>
          <h1 className="text-[22px] uppercase tracking-widest text-[#ffcc00]" style={{ textShadow: "3px 3px 0 #000" }}>
            My Champion
          </h1>
          <p className="text-[9px] text-[#3a4260]">Connect your wallet to view your champion's stats.</p>
          <Link
            to="/"
            className="border-4 border-black bg-[#54f28b] px-6 py-3 text-[10px] uppercase tracking-wide text-[#060d12] shadow-[4px_4px_0_0_#000] hover:bg-[#7bf5a8] font-bold"
          >
            {">>> Connect Wallet <<<"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-full w-full flex-col items-center overflow-y-auto overflow-x-hidden pt-16">
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{
          background:
            "repeating-linear-gradient(0deg,rgba(0,0,0,0.15) 0px,rgba(0,0,0,0.15) 1px,transparent 1px,transparent 3px)",
        }}
      />

      <div className="z-10 w-full max-w-5xl px-4 py-10">
        {/* Page header */}
        <div className="mb-8">
          <p className="mb-1 text-[8px] uppercase tracking-widest text-[#565f89] font-mono">
            {"<<"} Champions {">>"}
          </p>
          <h1
            className="text-[22px] uppercase tracking-widest text-[#ffcc00] font-mono"
            style={{ textShadow: "3px 3px 0 #000" }}
          >
            {entity ? entity.name : "My Champion"}
          </h1>
          {loading && (
            <p className="mt-1 text-[8px] text-[#3a4260] font-mono animate-pulse">
              Loading champion data...
            </p>
          )}
        </div>

        {/* Two-column layout */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Sidebar */}
          <div className="w-full lg:w-64 lg:shrink-0">
            <ChampionSidebar
              entity={entity}
              wallet={wallet}
              zoneId={zoneId}
              kills={kills}
              deaths={deaths}
            />
          </div>

          {/* Main panel */}
          <div className="flex-1 min-w-0 border-4 border-black bg-[#0a0f1a] shadow-[4px_4px_0_0_#000]">
            <TabBar active={activeTab} onChange={setActiveTab} />
            <div className="p-4">
              {activeTab === "overview" && (
                <OverviewTab
                  entity={entity}
                  diary={diary}
                  kills={kills}
                  deaths={deaths}
                  quests={quests}
                />
              )}
              {activeTab === "professions" && <ProfessionsTab learned={professions} />}
              {activeTab === "quests"      && <QuestsTab diary={diary} />}
              {activeTab === "activity"    && <ActivityTab diary={diary} />}
              {activeTab === "party" && (
                <PartyTab
                  custodialWallet={custodialWallet}
                  entityId={agentEntityId}
                  entityZoneId={agentZoneId}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
