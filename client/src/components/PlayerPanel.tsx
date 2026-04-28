import * as React from "react";
import { API_URL } from "@/config";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWalletContext } from "@/context/WalletContext";
import { useZonePlayers, type ZoneLobby, type PlayerInfo } from "@/hooks/useZonePlayers";
import { useLeaderboard, type LeaderboardEntry, type SortBy } from "@/hooks/useLeaderboard";
import { getAuthToken } from "@/lib/agentAuth";
import { cn } from "@/lib/utils";
import { gameBus } from "@/lib/eventBus";
import { WalletManager } from "@/lib/walletManager";

interface PlayerPanelProps {
  className?: string;
}

type Tab = "lobby" | "leaderboard" | "friends" | "party";

const SORT_TABS: { key: SortBy; label: string }[] = [
  { key: "power", label: "Power" },
  { key: "level", label: "Level" },
  { key: "kills", label: "Kills" },
];

/* ── shared helpers ── */

function getLevelBadgeVariant(level: number): "default" | "secondary" | "success" | "danger" {
  if (level >= 30) return "success";
  if (level >= 15) return "default";
  return "secondary";
}

function getRankColor(rank: number): string {
  if (rank === 1) return "text-[#ffdd57]";
  if (rank === 2) return "text-[#a6b2d4]";
  if (rank === 3) return "text-[#ff9e64]";
  return "text-[#9aa7cc]";
}

function getHealthBarColor(hp: number, maxHp: number): string {
  const percent = maxHp > 0 ? (hp / maxHp) * 100 : 0;
  if (percent > 66) return "bg-[#54f28b]";
  if (percent > 33) return "bg-[#ffcc00]";
  return "bg-[#ff4d6d]";
}

const CLASS_COLORS: Record<string, string> = {
  warrior: "#c83232",
  paladin: "#e6c83c",
  rogue:   "#8232b4",
  ranger:  "#32a03c",
  mage:    "#3264dc",
  cleric:  "#dcdcf0",
  warlock: "#3cb464",
  monk:    "#e69628",
};

/* ── Lobby sub-components ── */

function PlayerRow({ player, zoneId }: { player: PlayerInfo; zoneId: string }): React.ReactElement {
  const healthPercent = player.maxHp > 0 ? (player.hp / player.maxHp) * 100 : 0;
  const classColor = player.classId ? CLASS_COLORS[player.classId] : undefined;
  const clickable = Boolean(player.walletAddress);

  function handleClick() {
    if (!player.walletAddress) return;
    gameBus.emit("followPlayer", { zoneId, walletAddress: player.walletAddress });
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b-2 border-[#1a2338] px-1 py-1.5 transition-colors",
        clickable ? "cursor-pointer hover:bg-[#1a2338] hover:border-[#54f28b]" : "hover:bg-[#1a2338]"
      )}
      onClick={handleClick}
      title={clickable ? `Click to follow ${player.name}` : undefined}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0 border border-black"
        style={{ backgroundColor: classColor ?? "#9aa7cc" }}
      />
      <Badge variant={getLevelBadgeVariant(player.level)} className="w-10 justify-center">
        {player.level}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="text-[9px] text-[#edf2ff] truncate">{player.name}</div>
        {player.raceId && player.classId && (
          <div className="text-[8px] text-[#9aa7cc] truncate">
            {player.raceId} • {player.classId}
          </div>
        )}
      </div>
      <div className="w-16">
        <div className="h-2 border-2 border-black bg-[#0f1830] shadow-[1px_1px_0_0_#000] overflow-hidden">
          <div
            className={cn("h-full transition-all", getHealthBarColor(player.hp, player.maxHp))}
            style={{ width: `${Math.max(0, Math.min(100, healthPercent))}%` }}
          />
        </div>
        <div className="text-[7px] text-[#9aa7cc] text-center mt-0.5">
          {player.hp}/{player.maxHp}
        </div>
      </div>
    </div>
  );
}

function ZoneLobbySection({ lobby }: { lobby: ZoneLobby }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(true);

  return (
    <div className="space-y-1">
      <div className="flex w-full items-center border-2 border-black bg-[#283454] shadow-[2px_2px_0_0_#000] transition hover:bg-[#324165]">
        {/* Expand/collapse arrow */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-2 py-1 text-[9px] text-[#9aa7cc] hover:text-[#edf2ff] shrink-0"
          type="button"
        >
          {expanded ? "▼" : "▶"}
        </button>
        {/* Zone name — click to navigate */}
        <button
          onClick={() => gameBus.emit("switchZone", { zoneId: lobby.zoneId })}
          className="flex flex-1 items-center justify-between py-1 pr-2 text-left text-[9px] uppercase tracking-wide text-[#edf2ff]"
          type="button"
          title={`Go to ${lobby.zoneId}`}
        >
          <span className="truncate">{lobby.zoneId}</span>
          <div className="inline-flex items-center gap-2 shrink-0">
            <Badge variant="default">{lobby.players.length}</Badge>
            <span className="text-[8px] text-[#9aa7cc]">{lobby.totalEntities} ents</span>
          </div>
        </button>
      </div>

      {expanded && lobby.players.length > 0 && (
        <div className="border-2 border-black bg-[#0f1830] shadow-[2px_2px_0_0_#000]">
          {lobby.players.map((player) => (
            <PlayerRow key={player.id} player={player} zoneId={lobby.zoneId} />
          ))}
        </div>
      )}

      {expanded && lobby.players.length === 0 && (
        <div className="border-2 border-black bg-[#0f1830] px-2 py-2 text-center text-[8px] text-[#9aa7cc] shadow-[2px_2px_0_0_#000]">
          No players in zone
        </div>
      )}
    </div>
  );
}

/* ── Leaderboard sub-components ── */

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 border-b-2 border-[#1a2338] px-1 py-1.5 hover:bg-[#1a2338] transition-colors">
      <span className={cn("w-5 text-right text-[9px] font-bold", getRankColor(entry.rank))}>
        {entry.rank <= 3 ? ["", "I", "II", "III"][entry.rank] : `${entry.rank}`}
      </span>
      <Badge variant={getLevelBadgeVariant(entry.level)} className="w-10 justify-center">
        {entry.level}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className={cn("text-[9px] truncate", entry.rank <= 3 ? getRankColor(entry.rank) : "text-[#edf2ff]")}>
          {entry.name}
        </div>
        <div className="text-[8px] text-[#9aa7cc] truncate">
          {entry.raceId && entry.classId
            ? `${entry.raceId} • ${entry.classId} • ${entry.zoneId}`
            : entry.zoneId}
        </div>
      </div>
      <div className="text-[8px] text-[#9aa7cc] w-10 text-right">
        {entry.kills}k
      </div>
      <div className="text-[9px] text-[#7aa2f7] w-12 text-right font-bold">
        {entry.powerScore}
      </div>
    </div>
  );
}

/* ── Social sub-components ── */

interface SocialIdentity {
  ownerWallet: string | null;
  custodialWallet: string | null;
  entityId: string | null;
  zoneId: string | null;
}

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
  reputationRank: string;
}

interface FriendRequestInfo {
  id: string;
  fromWallet: string;
  fromName: string;
  createdAt: number;
}

interface PartyMemberInfo {
  entityId: string;
  zoneId?: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  classId?: string;
  raceId?: string;
  walletAddress?: string | null;
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

function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function zoneLabel(zoneId: string): string {
  return zoneId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function SocialNotice({ text, tone }: { text: string; tone: "ok" | "error" }): React.ReactElement {
  return (
    <div
      className={cn(
        "border-2 px-2 py-1.5 text-[8px]",
        tone === "error"
          ? "border-[#ff4d6d]/50 bg-[#2a1018] text-[#ff8f8f]"
          : "border-[#54f28b]/50 bg-[#0f1e10] text-[#54f28b]"
      )}
    >
      {text}
    </div>
  );
}

function SocialActionButton({
  children,
  disabled,
  tone = "blue",
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  tone?: "blue" | "green" | "red" | "muted";
  onClick: () => void;
}): React.ReactElement {
  const toneClass = {
    blue: "border-[#5dadec] bg-[#0a1020] text-[#5dadec] hover:bg-[#0e1830]",
    green: "border-[#54f28b] bg-[#0a1a0e] text-[#54f28b] hover:bg-[#112a1b]",
    red: "border-[#ff4d6d] bg-[#2a1018] text-[#ff8f8f] hover:bg-[#381520]",
    muted: "border-[#2a3450] bg-[#0b1020] text-[#9aa7cc] hover:text-[#edf2ff]",
  }[tone];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "border-2 px-2 py-1 text-[8px] uppercase shadow-[1px_1px_0_0_#000] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        toneClass
      )}
    >
      {children}
    </button>
  );
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json() as T;
}

async function authHeaders(ownerWallet: string | null): Promise<Record<string, string> | null> {
  if (!ownerWallet) return null;
  const token = await getAuthToken(ownerWallet);
  if (!token) return null;
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function postJson<T>(
  url: string,
  ownerWallet: string | null,
  body: Record<string, unknown>
): Promise<{ ok: boolean; data: T | { error?: string } }> {
  const headers = await authHeaders(ownerWallet);
  if (!headers) return { ok: false, data: { error: "Connect or re-authenticate your wallet." } };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function FriendsTab({ identity }: { identity: SocialIdentity }): React.ReactElement {
  const { ownerWallet, custodialWallet, entityId, zoneId } = identity;
  const [friends, setFriends] = React.useState<FriendInfo[]>([]);
  const [requests, setRequests] = React.useState<FriendRequestInfo[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [message, setMessage] = React.useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [loading, setLoading] = React.useState(false);

  const friendWallets = React.useMemo(
    () => new Set(friends.map((friend) => friend.wallet.toLowerCase())),
    [friends]
  );

  const flash = React.useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setMessage({ text, tone });
    window.setTimeout(() => setMessage(null), 3500);
  }, []);

  const refresh = React.useCallback(async () => {
    if (!custodialWallet) {
      setFriends([]);
      setRequests([]);
      return;
    }
    const [friendsData, requestsData] = await Promise.all([
      getJson<{ friends: FriendInfo[] }>(`${API_URL}/friends/${custodialWallet}`),
      getJson<{ requests: FriendRequestInfo[] }>(`${API_URL}/friends/requests/${custodialWallet}`),
    ]);
    setFriends(friendsData?.friends ?? []);
    setRequests(requestsData?.requests ?? []);
  }, [custodialWallet]);

  React.useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 7000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function search() {
    if (!custodialWallet || !searchQuery.trim()) return;
    setLoading(true);
    try {
      const data = await getJson<{ results: SearchResult[] }>(
        `${API_URL}/party/search?q=${encodeURIComponent(searchQuery.trim())}`
      );
      setSearchResults(
        (data?.results ?? []).filter(
          (result) => result.walletAddress?.toLowerCase() !== custodialWallet.toLowerCase()
        )
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendFriendRequest(target: SearchResult) {
    if (!custodialWallet || !target.walletAddress) return;
    const result = await postJson<{ success?: boolean }>(`${API_URL}/friends/request`, ownerWallet, {
      fromWallet: custodialWallet,
      toWallet: target.walletAddress,
    });
    if (result.ok) flash(`Friend request sent to ${target.name}.`);
    else flash((result.data as { error?: string }).error ?? "Friend request failed.", "error");
  }

  async function acceptRequest(request: FriendRequestInfo) {
    if (!custodialWallet) return;
    const result = await postJson<{ success?: boolean }>(`${API_URL}/friends/accept`, ownerWallet, {
      wallet: custodialWallet,
      requestId: request.id,
    });
    if (!result.ok) {
      flash((result.data as { error?: string }).error ?? "Accept failed.", "error");
      return;
    }
    setRequests((current) => current.filter((item) => item.id !== request.id));
    flash(`Added ${request.fromName}.`);
    void refresh();
  }

  async function declineRequest(request: FriendRequestInfo) {
    if (!custodialWallet) return;
    const result = await postJson<{ success?: boolean }>(`${API_URL}/friends/decline`, ownerWallet, {
      wallet: custodialWallet,
      requestId: request.id,
    });
    if (!result.ok) {
      flash((result.data as { error?: string }).error ?? "Decline failed.", "error");
      return;
    }
    setRequests((current) => current.filter((item) => item.id !== request.id));
  }

  async function inviteFriend(friend: FriendInfo) {
    if (!entityId || !zoneId) {
      flash("Your champion must be online to invite friends.", "error");
      return;
    }
    const result = await postJson<{ success?: boolean }>(`${API_URL}/party/invite-champion`, ownerWallet, {
      fromEntityId: entityId,
      fromZoneId: zoneId,
      toCustodialWallet: friend.wallet,
    });
    if (result.ok) flash(`Party invite sent to ${friend.name ?? friend.wogName ?? shortWallet(friend.wallet)}.`);
    else flash((result.data as { error?: string }).error ?? "Party invite failed.", "error");
  }

  if (!custodialWallet) {
    return <p className="py-4 text-center text-[8px] text-[#9aa7cc]">Connect a wallet to view friends.</p>;
  }

  return (
    <div className="space-y-2">
      {message && <SocialNotice text={message.text} tone={message.tone} />}

      {requests.length > 0 && (
        <div className="border-2 border-black bg-[#0f1830] shadow-[2px_2px_0_0_#000]">
          <div className="border-b-2 border-[#283454] px-2 py-1 text-[8px] uppercase text-[#ffcc00]">
            Requests ({requests.length})
          </div>
          {requests.map((request) => (
            <div key={request.id} className="flex items-center justify-between gap-2 border-b border-[#1a2338] px-2 py-1.5 last:border-b-0">
              <div className="min-w-0">
                <div className="truncate text-[9px] text-[#edf2ff]">{request.fromName}</div>
                <div className="text-[7px] text-[#9aa7cc]">{timeAgo(request.createdAt)} ago</div>
              </div>
              <div className="flex gap-1">
                <SocialActionButton tone="green" onClick={() => void acceptRequest(request)}>Accept</SocialActionButton>
                <SocialActionButton tone="muted" onClick={() => void declineRequest(request)}>No</SocialActionButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-2 border-black bg-[#0f1830] shadow-[2px_2px_0_0_#000]">
        <div className="flex items-center justify-between border-b-2 border-[#283454] px-2 py-1">
          <span className="text-[8px] uppercase text-[#edf2ff]">Friends</span>
          <Badge variant="secondary">{friends.length}/50</Badge>
        </div>
        {friends.length === 0 ? (
          <p className="px-2 py-3 text-center text-[8px] text-[#9aa7cc]">No friends yet.</p>
        ) : (
          friends.map((friend) => (
            <div key={friend.wallet} className="flex items-center justify-between gap-2 border-b border-[#1a2338] px-2 py-1.5 last:border-b-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className={cn("text-[8px]", friend.online ? "text-[#54f28b]" : "text-[#565f89]")}>●</span>
                  <span className="truncate text-[9px] text-[#edf2ff]">
                    {friend.name ?? friend.wogName ?? shortWallet(friend.wallet)}
                  </span>
                </div>
                <div className="truncate text-[7px] text-[#9aa7cc]">
                  {friend.online && friend.zoneId ? zoneLabel(friend.zoneId) : "Offline"}
                  {friend.level != null ? ` · Lv ${friend.level}` : ""}
                  {friend.reputationRank ? ` · ${friend.reputationRank}` : ""}
                </div>
              </div>
              <SocialActionButton
                disabled={!friend.online || !entityId}
                onClick={() => void inviteFriend(friend)}
              >
                Invite
              </SocialActionButton>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-1">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void search(); }}
          placeholder="Search champions..."
          className="min-w-0 flex-1 border-2 border-[#2a3450] bg-[#0b1020] px-2 py-1 text-[8px] text-[#edf2ff] outline-none focus:border-[#54f28b]"
        />
        <SocialActionButton disabled={loading || !searchQuery.trim()} tone="green" onClick={() => void search()}>
          Search
        </SocialActionButton>
      </div>
      {searchResults.map((result) => {
        const alreadyFriend = result.walletAddress ? friendWallets.has(result.walletAddress.toLowerCase()) : false;
        return (
          <div key={result.entityId} className="flex items-center justify-between gap-2 border-2 border-black bg-[#0f1830] px-2 py-1.5 shadow-[1px_1px_0_0_#000]">
            <div className="min-w-0">
              <div className="truncate text-[9px] text-[#edf2ff]">{result.name}</div>
              <div className="truncate text-[7px] text-[#9aa7cc]">Lv {result.level} · {zoneLabel(result.zoneId)}</div>
            </div>
            <SocialActionButton
              disabled={alreadyFriend || !result.walletAddress}
              tone={alreadyFriend ? "muted" : "green"}
              onClick={() => void sendFriendRequest(result)}
            >
              {alreadyFriend ? "Added" : "Add"}
            </SocialActionButton>
          </div>
        );
      })}
    </div>
  );
}

function PartyTab({ identity }: { identity: SocialIdentity }): React.ReactElement {
  const { ownerWallet, custodialWallet, entityId, zoneId } = identity;
  const [partyStatus, setPartyStatus] = React.useState<{ inParty: boolean; partyId?: string; members: PartyMemberInfo[] }>({
    inParty: false,
    members: [],
  });
  const [invites, setInvites] = React.useState<PartyInviteInfo[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [message, setMessage] = React.useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [loading, setLoading] = React.useState(false);

  const flash = React.useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setMessage({ text, tone });
    window.setTimeout(() => setMessage(null), 3500);
  }, []);

  const refresh = React.useCallback(async () => {
    if (!custodialWallet) {
      setPartyStatus({ inParty: false, members: [] });
      setInvites([]);
      return;
    }
    const [statusData, invitesData] = await Promise.all([
      getJson<{ inParty: boolean; partyId?: string; members: PartyMemberInfo[] }>(`${API_URL}/party/status/${custodialWallet}`),
      getJson<{ invites: PartyInviteInfo[] }>(`${API_URL}/party/invites/${custodialWallet}`),
    ]);
    setPartyStatus({
      inParty: Boolean(statusData?.inParty),
      partyId: statusData?.partyId,
      members: statusData?.members ?? [],
    });
    setInvites(invitesData?.invites ?? []);
  }, [custodialWallet]);

  React.useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function search() {
    if (!custodialWallet || !searchQuery.trim()) return;
    setLoading(true);
    try {
      const data = await getJson<{ results: SearchResult[] }>(
        `${API_URL}/party/search?q=${encodeURIComponent(searchQuery.trim())}`
      );
      setSearchResults(
        (data?.results ?? []).filter(
          (result) => result.walletAddress?.toLowerCase() !== custodialWallet.toLowerCase()
        )
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendInvite(target: SearchResult) {
    if (!entityId || !zoneId) {
      flash("Your champion must be online to invite players.", "error");
      return;
    }
    if (!target.walletAddress) {
      flash("Target has no wallet.", "error");
      return;
    }
    const result = await postJson<{ success?: boolean }>(`${API_URL}/party/invite-champion`, ownerWallet, {
      fromEntityId: entityId,
      fromZoneId: zoneId,
      toCustodialWallet: target.walletAddress,
    });
    if (result.ok) {
      flash(`Invite sent to ${target.name}.`);
      void refresh();
    } else {
      flash((result.data as { error?: string }).error ?? "Invite failed.", "error");
    }
  }

  async function acceptInvite(invite: PartyInviteInfo) {
    if (!custodialWallet) return;
    const result = await postJson<{ success?: boolean }>(`${API_URL}/party/accept-invite`, ownerWallet, {
      custodialWallet,
      inviteId: invite.id,
    });
    if (!result.ok) {
      flash((result.data as { error?: string }).error ?? "Accept failed.", "error");
      return;
    }
    flash("Joined party.");
    void refresh();
  }

  async function declineInvite(invite: PartyInviteInfo) {
    if (!custodialWallet) return;
    const result = await postJson<{ success?: boolean }>(`${API_URL}/party/decline-invite`, ownerWallet, {
      custodialWallet,
      inviteId: invite.id,
    });
    if (!result.ok) {
      flash((result.data as { error?: string }).error ?? "Decline failed.", "error");
      return;
    }
    setInvites((current) => current.filter((item) => item.id !== invite.id));
  }

  async function leaveParty() {
    if (!custodialWallet) return;
    const result = await postJson<{ success?: boolean }>(`${API_URL}/party/leave-wallet`, ownerWallet, {
      custodialWallet,
    });
    if (!result.ok) {
      flash((result.data as { error?: string }).error ?? "Leave failed.", "error");
      return;
    }
    flash("Left party.");
    void refresh();
  }

  if (!custodialWallet) {
    return <p className="py-4 text-center text-[8px] text-[#9aa7cc]">Connect a wallet to view parties.</p>;
  }

  return (
    <div className="space-y-2">
      {message && <SocialNotice text={message.text} tone={message.tone} />}
      {!entityId && (
        <SocialNotice text="Your champion must be online to send or accept party invites." tone="error" />
      )}

      {invites.length > 0 && (
        <div className="border-2 border-black bg-[#0f1830] shadow-[2px_2px_0_0_#000]">
          <div className="border-b-2 border-[#283454] px-2 py-1 text-[8px] uppercase text-[#ffcc00]">
            Invites ({invites.length})
          </div>
          {invites.map((invite) => (
            <div key={invite.id} className="flex items-center justify-between gap-2 border-b border-[#1a2338] px-2 py-1.5 last:border-b-0">
              <div className="min-w-0">
                <div className="truncate text-[9px] text-[#edf2ff]">{invite.fromName}</div>
                <div className="text-[7px] text-[#9aa7cc]">{timeAgo(invite.createdAt)} ago</div>
              </div>
              <div className="flex gap-1">
                <SocialActionButton tone="green" disabled={!entityId} onClick={() => void acceptInvite(invite)}>Join</SocialActionButton>
                <SocialActionButton tone="muted" onClick={() => void declineInvite(invite)}>No</SocialActionButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-2 border-black bg-[#0f1830] shadow-[2px_2px_0_0_#000]">
        <div className="flex items-center justify-between border-b-2 border-[#283454] px-2 py-1">
          <span className="text-[8px] uppercase text-[#edf2ff]">Current Party</span>
          {partyStatus.inParty && (
            <SocialActionButton tone="red" onClick={() => void leaveParty()}>Leave</SocialActionButton>
          )}
        </div>
        {!partyStatus.inParty ? (
          <p className="px-2 py-3 text-center text-[8px] text-[#9aa7cc]">Not in a party.</p>
        ) : (
          partyStatus.members.map((member) => {
            const hpPct = member.maxHp > 0 ? Math.max(0, Math.min(100, (member.hp / member.maxHp) * 100)) : 0;
            return (
              <div key={member.entityId} className="border-b border-[#1a2338] px-2 py-1.5 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-[9px] text-[#edf2ff]">{member.name}</span>
                      {member.isLeader && <span className="text-[7px] text-[#ffcc00]">LEAD</span>}
                    </div>
                    <div className="truncate text-[7px] text-[#9aa7cc]">
                      Lv {member.level}
                      {member.zoneId ? ` · ${zoneLabel(member.zoneId)}` : ""}
                    </div>
                  </div>
                  <span className="text-[7px] text-[#9aa7cc]">{member.hp}/{member.maxHp}</span>
                </div>
                <div className="mt-1 h-1.5 border border-black bg-[#0b1020]">
                  <div className={cn("h-full", getHealthBarColor(member.hp, member.maxHp))} style={{ width: `${hpPct}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-1">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void search(); }}
          placeholder="Invite champion..."
          className="min-w-0 flex-1 border-2 border-[#2a3450] bg-[#0b1020] px-2 py-1 text-[8px] text-[#edf2ff] outline-none focus:border-[#5dadec]"
        />
        <SocialActionButton disabled={loading || !searchQuery.trim()} onClick={() => void search()}>
          Search
        </SocialActionButton>
      </div>
      {searchResults.map((result) => (
        <div key={result.entityId} className="flex items-center justify-between gap-2 border-2 border-black bg-[#0f1830] px-2 py-1.5 shadow-[1px_1px_0_0_#000]">
          <div className="min-w-0">
            <div className="truncate text-[9px] text-[#edf2ff]">{result.name}</div>
            <div className="truncate text-[7px] text-[#9aa7cc]">Lv {result.level} · {zoneLabel(result.zoneId)}</div>
          </div>
          <SocialActionButton
            disabled={!entityId || result.inParty || !result.walletAddress}
            onClick={() => void sendInvite(result)}
          >
            {result.inParty ? "In Party" : "Invite"}
          </SocialActionButton>
        </div>
      ))}
    </div>
  );
}

/* ── Combined panel ── */

export function PlayerPanel({ className }: PlayerPanelProps): React.ReactElement {
  const { address, connect, isConnected } = useWalletContext();
  const [tab, setTab] = React.useState<Tab>("lobby");
  const [collapsed, setCollapsed] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<SortBy>("power");
  const [custodialWallet, setCustodialWallet] = React.useState<string | null>(null);

  const { lobbies, gameTime, loading: lobbyLoading, error: lobbyError } = useZonePlayers({ pollInterval: 3000 });
  const { entries, loading: lbLoading, error: leaderboardError } = useLeaderboard({ limit: 10, sortBy, pollInterval: 5000 });

  const totalPlayers = lobbies.reduce((sum, lobby) => sum + lobby.players.length, 0);
  const socialEntity = React.useMemo(() => {
    const candidates = new Set(
      [custodialWallet, address]
        .filter((wallet): wallet is string => Boolean(wallet))
        .map((wallet) => wallet.toLowerCase())
    );
    if (candidates.size === 0) return null;
    for (const lobby of lobbies) {
      const player = lobby.players.find((candidate) => (
        candidate.walletAddress ? candidates.has(candidate.walletAddress.toLowerCase()) : false
      ));
      if (player) return { entityId: player.id, zoneId: lobby.zoneId };
    }
    return null;
  }, [address, custodialWallet, lobbies]);
  const socialIdentity = React.useMemo<SocialIdentity>(() => ({
    ownerWallet: address,
    custodialWallet: custodialWallet ?? address,
    entityId: socialEntity?.entityId ?? null,
    zoneId: socialEntity?.zoneId ?? null,
  }), [address, custodialWallet, socialEntity]);

  React.useEffect(() => {
    let cancelled = false;
    async function resolveTrackedWallet() {
      if (!address) {
        setCustodialWallet(null);
        return;
      }
      const trackedWallet = await WalletManager.getInstance().getTrackedWalletAddress();
      if (!cancelled) setCustodialWallet(trackedWallet ?? address);
    }
    void resolveTrackedWallet();
    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <Card
      className={cn("pointer-events-auto", className, collapsed ? "h-auto" : "h-full")}
      data-tutorial-id="ranks-panel"
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-[10px] text-[#9aa7cc] hover:text-[#edf2ff] transition-colors"
              type="button"
            >
              {collapsed ? "+" : "−"}
            </button>

            {/* Tab switcher */}
            <div className="flex gap-1">
              <button
                onClick={() => setTab("lobby")}
                className={cn(
                  "border-2 border-black px-1.5 py-0.5 text-[8px] uppercase shadow-[1px_1px_0_0_#000] transition-colors",
                  tab === "lobby"
                    ? "bg-[#2a2210] text-[#ffcc00]"
                    : "bg-[#283454] text-[#9aa7cc] hover:bg-[#324165]"
                )}
                type="button"
              >
                Lobby
              </button>
              <button
                onClick={() => setTab("leaderboard")}
                className={cn(
                  "border-2 border-black px-1.5 py-0.5 text-[8px] uppercase shadow-[1px_1px_0_0_#000] transition-colors",
                  tab === "leaderboard"
                    ? "bg-[#2a2210] text-[#ffcc00]"
                    : "bg-[#283454] text-[#9aa7cc] hover:bg-[#324165]"
                )}
                type="button"
              >
                Ranks
              </button>
              <button
                onClick={() => setTab("friends")}
                className={cn(
                  "border-2 border-black px-1.5 py-0.5 text-[8px] uppercase shadow-[1px_1px_0_0_#000] transition-colors",
                  tab === "friends"
                    ? "bg-[#2a2210] text-[#ffcc00]"
                    : "bg-[#283454] text-[#9aa7cc] hover:bg-[#324165]"
                )}
                type="button"
              >
                Friends
              </button>
              <button
                onClick={() => setTab("party")}
                className={cn(
                  "border-2 border-black px-1.5 py-0.5 text-[8px] uppercase shadow-[1px_1px_0_0_#000] transition-colors",
                  tab === "party"
                    ? "bg-[#2a2210] text-[#ffcc00]"
                    : "bg-[#283454] text-[#9aa7cc] hover:bg-[#324165]"
                )}
                type="button"
              >
                Party
              </button>
            </div>
          </div>

          {/* Right side: context-dependent info */}
          {tab === "lobby" ? (
            <div className="flex items-center gap-2">
              {gameTime && (
                <span className="text-[8px] text-[#9aa7cc] font-mono">
                  {gameTime.phase === "night" ? "\u263D" : gameTime.phase === "dawn" || gameTime.phase === "dusk" ? "\u263C" : "\u2600"}{" "}
                  {String(gameTime.hour).padStart(2, "0")}:{String(gameTime.minute).padStart(2, "0")}
                </span>
              )}
              <Badge variant={lobbyError ? "danger" : "success"}>
                {lobbyError ? "offline" : `${totalPlayers} online`}
              </Badge>
            </div>
          ) : tab === "leaderboard" ? (
            <div className="flex gap-1">
              {SORT_TABS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSortBy(s.key)}
                  className={cn(
                    "border-2 border-black px-1.5 py-0.5 text-[8px] uppercase shadow-[1px_1px_0_0_#000] transition-colors",
                    sortBy === s.key
                      ? "bg-[#2a2210] text-[#ffcc00]"
                      : "bg-[#283454] text-[#9aa7cc] hover:bg-[#324165]"
                  )}
                  type="button"
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : isConnected ? (
            <Badge variant={socialEntity ? "success" : "secondary"}>
              {socialEntity ? "online" : "wallet"}
            </Badge>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              className="border-2 border-black bg-[#283454] px-1.5 py-0.5 text-[8px] uppercase text-[#9aa7cc] shadow-[1px_1px_0_0_#000] hover:bg-[#324165]"
            >
              Connect
            </button>
          )}
        </CardTitle>
      </CardHeader>

      {!collapsed && tab === "lobby" && (
        <CardContent className="max-h-[320px] space-y-2 overflow-auto pt-0 text-[9px]">
          {lobbyLoading && lobbies.length === 0 && (
            <p className="text-[8px] text-[#9aa7cc]">Loading lobbies...</p>
          )}
          {!lobbyLoading && lobbyError && (
            <p className="text-[8px] text-[#ff8f8f]">Shard unavailable. Live lobby data is offline.</p>
          )}
          {!lobbyLoading && !lobbyError && lobbies.length === 0 && (
            <p className="text-[8px] text-[#9aa7cc]">No zones found.</p>
          )}
          {lobbies.map((lobby) => (
            <ZoneLobbySection key={lobby.zoneId} lobby={lobby} />
          ))}
        </CardContent>
      )}

      {!collapsed && tab === "leaderboard" && (
        <CardContent className="pt-0 text-[9px]" style={{ maxHeight: "320px", overflowY: "auto" }}>
          <div className="flex items-center gap-2 border-b-2 border-[#283454] px-1 py-1 text-[8px] text-[#565f89] uppercase">
            <span className="w-5 text-right">#</span>
            <span className="w-10 text-center">Lv</span>
            <span className="flex-1">Name</span>
            <span className="w-10 text-right">Kills</span>
            <span className="w-12 text-right">Score</span>
          </div>

          {lbLoading && entries.length === 0 && (
            <p className="text-[8px] text-[#9aa7cc] py-4 text-center">Loading...</p>
          )}
          {!lbLoading && leaderboardError && entries.length === 0 && (
            <p className="text-[8px] text-[#ff8f8f] py-4 text-center">Shard unavailable.</p>
          )}
          {!lbLoading && !leaderboardError && entries.length === 0 && (
            <p className="text-[8px] text-[#9aa7cc] py-4 text-center">No players yet.</p>
          )}
          {entries.map((entry) => (
            <LeaderboardRow key={entry.entityId} entry={entry} />
          ))}
        </CardContent>
      )}

      {!collapsed && tab === "friends" && (
        <CardContent className="max-h-[320px] overflow-auto pt-0 text-[9px]">
          <FriendsTab identity={socialIdentity} />
        </CardContent>
      )}

      {!collapsed && tab === "party" && (
        <CardContent className="max-h-[320px] overflow-auto pt-0 text-[9px]">
          <PartyTab identity={socialIdentity} />
        </CardContent>
      )}

      {!collapsed && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => gameBus.emit("mapOpen", undefined as never)}
            className="flex w-full items-center justify-center gap-1 border-2 border-[#54f28b]/40 bg-[#0f1e10] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#54f28b] transition hover:bg-[#1a2e18]"
          >
            Map
          </button>
        </div>
      )}
    </Card>
  );
}
