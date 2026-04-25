import {
  acceptFriendRequest,
  declineFriendRequest,
  fetchFriendRequests,
  fetchFriends,
  removeFriend,
} from "../api.js";
import type { ActivePlayer, FriendInfo, FriendRequestInfo } from "../types.js";

type SortBy = "level" | "name" | "hp";
type PlayerPanelTab = "lobby" | "ranks" | "friends";

interface PanelCallbacks {
  onPlayerClick: (player: ActivePlayer) => void;
  onZoneClick: (zoneId: string) => void;
  getAuthToken?: () => Promise<string | null>;
  onFriendRequestCountChange?: (count: number) => void;
  onFriendLocate?: (friend: FriendInfo) => void;
}

/**
 * Side panel listing players/entities grouped by zone.
 * Click a player to lock camera on them. Click a zone to navigate there.
 */
export class PlayerPanel {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private activeTab: PlayerPanelTab = "lobby";
  private sortBy: SortBy = "level";
  private players: ActivePlayer[] = [];
  private playersById = new Map<string, ActivePlayer>();
  private zonePlayers: Map<string, ActivePlayer[]> = new Map();
  private expandedZones = new Set<string>();
  private ownerWallet: string | null = null;
  private socialWallet: string | null = null;
  private friends: FriendInfo[] = [];
  private friendRequests: FriendRequestInfo[] = [];
  private friendsStatus = "";
  private callbacks: PanelCallbacks;
  private visible = false;

  constructor(callbacks: PanelCallbacks) {
    this.callbacks = callbacks;

    // Main container
    this.container = document.createElement("div");
    this.container.id = "player-panel";
    this.container.style.display = "none";

    // Tab bar
    this.tabBar = document.createElement("div");
    this.tabBar.className = "pp-tabs";
    this.tabBar.innerHTML = `
      <button class="pp-tab active" data-tab="lobby">Lobby</button>
      <button class="pp-tab" data-tab="ranks">Ranks</button>
      <button class="pp-tab" data-tab="friends">Friends</button>
    `;
    this.tabBar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".pp-tab") as HTMLButtonElement;
      if (!btn) return;
      const tab = btn.dataset.tab as PlayerPanelTab;
      this.activeTab = tab;
      this.tabBar.querySelectorAll(".pp-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (tab === "friends") void this.refreshFriends(true);
      this.render();
    });
    this.container.appendChild(this.tabBar);

    // Sort bar (for ranks tab)
    const sortBar = document.createElement("div");
    sortBar.className = "pp-sort";
    sortBar.id = "pp-sort-bar";
    for (const key of ["level", "name", "hp"] as SortBy[]) {
      const btn = document.createElement("button");
      btn.className = `pp-sort-btn${key === this.sortBy ? " active" : ""}`;
      btn.textContent = key.charAt(0).toUpperCase() + key.slice(1);
      btn.dataset.sort = key;
      btn.addEventListener("click", () => {
        this.sortBy = key;
        sortBar.querySelectorAll(".pp-sort-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.render();
      });
      sortBar.appendChild(btn);
    }
    this.container.appendChild(sortBar);

    // Entity list
    this.listEl = document.createElement("div");
    this.listEl.className = "pp-list";
    this.container.appendChild(this.listEl);

    this.footerEl = document.createElement("div");
    this.footerEl.className = "pp-footer";
    this.container.appendChild(this.footerEl);

    document.body.appendChild(this.container);
    this.injectStyles();
  }

  toggle() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? "flex" : "none";
    if (this.visible && this.activeTab === "friends") void this.refreshFriends(true);
  }

  showFriends() {
    this.activeTab = "friends";
    this.visible = true;
    this.container.style.display = "flex";
    this.tabBar.querySelectorAll(".pp-tab").forEach((b) => {
      b.classList.toggle("active", (b as HTMLElement).dataset.tab === "friends");
    });
    this.render();
    void this.refreshFriends(true);
  }

  /** Call every poll with the global active player list */
  update(players: ActivePlayer[]) {
    this.players = players;
    this.playersById.clear();
    this.zonePlayers.clear();

    for (const player of players) {
      this.playersById.set(player.id, player);
      const zoneId = player.zoneId || "unknown";
      if (!this.zonePlayers.has(zoneId)) this.zonePlayers.set(zoneId, []);
      this.zonePlayers.get(zoneId)!.push(player);
    }

    // Auto-expand the most populated zone if nothing is expanded yet
    if (this.expandedZones.size === 0 && this.zonePlayers.size > 0) {
      let best = "";
      let bestCount = 0;
      for (const [zoneId, zp] of this.zonePlayers) {
        if (zp.length > bestCount) { bestCount = zp.length; best = zoneId; }
      }
      if (best) this.expandedZones.add(best);
    }

    this.render();
  }

  setFriendIdentity(ownerWallet: string | null, socialWallet: string | null) {
    const owner = ownerWallet ? ownerWallet.toLowerCase() : null;
    const social = socialWallet ? socialWallet.toLowerCase() : null;
    if (this.ownerWallet === owner && this.socialWallet === social) return;
    this.ownerWallet = owner;
    this.socialWallet = social;
    this.friends = [];
    this.friendRequests = [];
    this.friendsStatus = "";
    this.callbacks.onFriendRequestCountChange?.(0);
    this.render();
  }

  async refreshFriends(forceRender = false): Promise<void> {
    if (!this.socialWallet) {
      if (forceRender) this.render();
      return;
    }
    const [friendsData, requestsData] = await Promise.all([
      fetchFriends(this.socialWallet),
      fetchFriendRequests(this.socialWallet),
    ]);
    if (friendsData) {
      this.friends = [...(friendsData.friends ?? [])].sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return friendDisplayName(a).localeCompare(friendDisplayName(b));
      });
    }
    if (requestsData) {
      this.friendRequests = requestsData.requests ?? [];
      this.callbacks.onFriendRequestCountChange?.(this.friendRequests.length);
    }
    this.render();
  }

  private render() {
    const sortBar = this.container.querySelector("#pp-sort-bar") as HTMLElement;
    sortBar.style.display = this.activeTab === "ranks" ? "flex" : "none";
    this.footerEl.style.display = this.activeTab === "friends" ? "block" : "none";

    if (this.activeTab === "lobby") {
      this.renderLobby();
    } else if (this.activeTab === "ranks") {
      this.renderRanks();
    } else {
      this.renderFriends();
    }
  }

  private renderLobby() {
    let html = "";

    const zones = Array.from(this.zonePlayers.entries())
      .sort((a, b) => b[1].length - a[1].length);

    for (const [zoneId, players] of zones) {
      players.sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
      const label = zoneId.replace(/-/g, " ");
      const expanded = this.expandedZones.has(zoneId);
      const arrow = expanded ? "\u25BC" : "\u25B6";

      html += `<div class="pp-zone">`;
      html += `<div class="pp-zone-header" data-zone-toggle="${zoneId}">`;
      html += `<span class="pp-zone-arrow">${arrow}</span>`;
      html += `<span class="pp-zone-name">${label}</span>`;
      html += `<span class="pp-zone-count">${players.length}</span>`;
      html += `</div>`;

      if (expanded) {
        for (const player of players) {
          const lvl = player.level ?? 1;
          const hpPct = player.maxHp > 0 ? Math.round((player.hp / player.maxHp) * 100) : 100;
          const cls = player.classId ? ` [${player.classId}]` : "";
          html += `<div class="pp-row" data-eid="${player.id}">`;
          html += `<span class="pp-icon" style="color:#44ddff">&#9679;</span>`;
          html += `<span class="pp-name">${player.name}${cls}</span>`;
          html += `<span class="pp-lvl">Lv${lvl}</span>`;
          html += `<span class="pp-hp" style="color:${hpPct > 50 ? "#4c4" : hpPct > 25 ? "#cc4" : "#c44"}">${hpPct}%</span>`;
          html += `</div>`;
        }
      }

      html += `</div>`;
    }

    if (!html) html = `<div class="pp-empty">No players online</div>`;
    this.listEl.innerHTML = html;
  }

  private renderFriends() {
    if (!this.socialWallet) {
      this.listEl.innerHTML = `<div class="pp-empty">Deploy an agent to view friends.</div>`;
      this.footerEl.textContent = "";
      return;
    }

    let html = "";
    if (this.friendRequests.length > 0) {
      html += `<div class="pp-friend-section">Requests (${this.friendRequests.length})</div>`;
      for (const req of this.friendRequests) {
        html += `<div class="pp-friend-request" data-request-id="${esc(req.id)}">`;
        html += `<div class="pp-friend-main"><span class="pp-friend-name">${esc(req.fromName || shortWallet(req.fromWallet))}</span><span class="pp-friend-meta">${esc(timeAgo(req.createdAt))}</span></div>`;
        html += `<div class="pp-friend-actions"><button class="pp-friend-btn pp-friend-accept" data-friend-action="accept">Accept</button><button class="pp-friend-btn" data-friend-action="decline">Decline</button></div>`;
        html += `</div>`;
      }
    }

    html += `<div class="pp-friend-section">Friends (${this.friends.length}/50)</div>`;
    if (this.friends.length === 0) {
      html += `<div class="pp-empty">No friends yet. Inspect a player and use Add Friend.</div>`;
    } else {
      for (const friend of this.friends) {
        const name = friendDisplayName(friend);
        const zone = friend.zoneId ? friend.zoneId.replace(/-/g, " ") : "Offline";
        const detail = friend.online
          ? `${zone}${friend.level != null ? ` / Lv${friend.level}` : ""}`
          : "Offline";
        html += `<div class="pp-friend" data-wallet="${esc(friend.wallet)}">`;
        html += `<span class="pp-friend-dot ${friend.online ? "online" : "offline"}"></span>`;
        html += `<div class="pp-friend-main"><div class="pp-friend-name">${esc(name)}</div><div class="pp-friend-meta">${esc(detail)}${friend.reputationRank ? ` / ${esc(friend.reputationRank)}` : ""}</div></div>`;
        html += `<div class="pp-friend-actions">`;
        html += `<button class="pp-friend-icon-btn" data-friend-action="locate" title="Locate" ${friend.online ? "" : "disabled"}>@</button>`;
        html += `<button class="pp-friend-icon-btn" data-friend-action="remove" title="Remove">x</button>`;
        html += `</div></div>`;
      }
    }

    this.listEl.innerHTML = html;
    const online = this.friends.filter((f) => f.online).length;
    this.footerEl.textContent = this.friendsStatus || `${online} online of ${this.friends.length}`;
  }

  private async acceptFriendRequest(requestId: string): Promise<void> {
    if (!this.socialWallet) return;
    const token = await this.callbacks.getAuthToken?.();
    if (!token) {
      this.friendsStatus = "Sign in to accept requests.";
      this.render();
      return;
    }
    const result = await acceptFriendRequest(token, this.socialWallet, requestId);
    this.friendsStatus = result.ok ? "Friend request accepted." : result.error ?? "Accept failed.";
    await this.refreshFriends(true);
  }

  private async declineFriendRequest(requestId: string): Promise<void> {
    if (!this.socialWallet) return;
    const token = await this.callbacks.getAuthToken?.();
    if (!token) {
      this.friendsStatus = "Sign in to decline requests.";
      this.render();
      return;
    }
    const result = await declineFriendRequest(token, this.socialWallet, requestId);
    this.friendsStatus = result.ok ? "Friend request declined." : result.error ?? "Decline failed.";
    await this.refreshFriends(true);
  }

  private async removeFriend(targetWallet: string): Promise<void> {
    if (!this.socialWallet) return;
    const token = await this.callbacks.getAuthToken?.();
    if (!token) {
      this.friendsStatus = "Sign in to remove friends.";
      this.render();
      return;
    }
    const result = await removeFriend(token, this.socialWallet, targetWallet);
    this.friendsStatus = result.ok ? "Friend removed." : result.error ?? "Remove failed.";
    await this.refreshFriends(true);
  }

  private renderRanks() {
    const ranked = [...this.players];

    // Sort
    if (this.sortBy === "level") {
      ranked.sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
    } else if (this.sortBy === "name") {
      ranked.sort((a, b) => a.name.localeCompare(b.name));
    } else if (this.sortBy === "hp") {
      ranked.sort((a, b) => b.hp - a.hp);
    }

    let html = "";
    for (let i = 0; i < ranked.length; i++) {
      const ent = ranked[i];
      const rank = i + 1;
      const lvl = ent.level ?? 1;
      const hpPct = ent.maxHp > 0 ? Math.round((ent.hp / ent.maxHp) * 100) : 100;
      const cls = ent.classId ? ` [${ent.classId}]` : "";
      const rankColor = rank === 1 ? "#ffd700" : rank === 2 ? "#c0c0c0" : rank === 3 ? "#cd7f32" : "#888";

      html += `<div class="pp-row" data-eid="${ent.id}">`;
      html += `<span class="pp-rank" style="color:${rankColor}">#${rank}</span>`;
      html += `<span class="pp-name">${ent.name}${cls}</span>`;
      html += `<span class="pp-lvl">Lv${lvl}</span>`;
      html += `<span class="pp-hp" style="color:${hpPct > 50 ? "#4c4" : hpPct > 25 ? "#cc4" : "#c44"}">${hpPct}%</span>`;
      html += `</div>`;
    }

    if (!html) html = `<div class="pp-empty">No players online</div>`;
    this.listEl.innerHTML = html;
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #player-panel {
        position: fixed;
        top: 200px;
        left: 12px;
        width: 260px;
        max-height: min(420px, calc(100vh - 360px));
        background: rgba(10, 16, 28, 0.92);
        border: 1px solid rgba(68, 255, 136, 0.25);
        border-radius: 8px;
        z-index: 15;
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        backdrop-filter: blur(6px);
      }

      .pp-tabs {
        display: flex;
        border-bottom: 1px solid rgba(68, 255, 136, 0.15);
      }
      .pp-tab {
        flex: 1;
        padding: 8px 0;
        background: none;
        border: none;
        color: #667;
        font: bold 12px monospace;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s;
        border-bottom: 2px solid transparent;
      }
      .pp-tab:hover { color: #aab; }
      .pp-tab.active { color: #4f8; border-bottom-color: #4f8; }

      .pp-sort {
        display: flex;
        gap: 4px;
        padding: 6px 8px;
        border-bottom: 1px solid rgba(68, 255, 136, 0.1);
      }
      .pp-sort-btn {
        padding: 3px 8px;
        background: rgba(40, 60, 80, 0.5);
        border: 1px solid rgba(68, 255, 136, 0.15);
        border-radius: 4px;
        color: #778;
        font: 11px monospace;
        cursor: pointer;
      }
      .pp-sort-btn:hover { color: #aab; border-color: rgba(68, 255, 136, 0.3); }
      .pp-sort-btn.active { color: #4f8; border-color: #4f8; background: rgba(68, 255, 136, 0.1); }

      .pp-list {
        overflow-y: auto;
        flex: 1;
        padding: 4px 0;
        scrollbar-width: thin;
        scrollbar-color: rgba(68, 255, 136, 0.2) transparent;
      }

      .pp-zone { margin-bottom: 2px; }
      .pp-zone-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: rgba(30, 50, 70, 0.5);
        cursor: pointer;
        user-select: none;
      }
      .pp-zone-header:hover { background: rgba(40, 70, 90, 0.7); }
      .pp-zone-arrow { color: #667; font-size: 9px; width: 12px; flex-shrink: 0; }
      .pp-zone-name { color: #8bf; font-weight: bold; text-transform: capitalize; flex: 1; }
      .pp-zone-count { color: #667; font-size: 11px; flex-shrink: 0; }

      .pp-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px 4px 16px;
        cursor: pointer;
        transition: background 0.1s;
      }
      .pp-row:hover { background: rgba(68, 255, 136, 0.08); }

      .pp-icon { font-size: 10px; width: 14px; text-align: center; flex-shrink: 0; }
      .pp-rank { width: 28px; font-weight: bold; flex-shrink: 0; }
      .pp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #dde; }
      .pp-lvl { color: #aaa; font-size: 11px; flex-shrink: 0; }
      .pp-hp { font-size: 11px; width: 34px; text-align: right; flex-shrink: 0; }

      .pp-friend-section {
        padding: 7px 12px 5px;
        color: #7a84a8;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid rgba(68, 255, 136, 0.07);
      }
      .pp-friend,
      .pp-friend-request {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(68, 255, 136, 0.07);
      }
      .pp-friend-request { align-items: flex-start; background: rgba(68, 255, 136, 0.05); }
      .pp-friend-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .pp-friend-dot.online { background: #54f28b; box-shadow: 0 0 8px rgba(84, 242, 139, 0.65); }
      .pp-friend-dot.offline { background: #56617a; }
      .pp-friend-main { flex: 1; min-width: 0; }
      .pp-friend-name { color: #edf2ff; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pp-friend-meta { color: #7a84a8; font-size: 10px; margin-top: 2px; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pp-friend-actions { display: flex; gap: 5px; flex-shrink: 0; }
      .pp-friend-btn,
      .pp-friend-icon-btn {
        background: rgba(32, 45, 64, 0.75);
        border: 1px solid rgba(68, 255, 136, 0.18);
        border-radius: 4px;
        color: #bcd;
        cursor: pointer;
        font: 11px monospace;
      }
      .pp-friend-btn { padding: 4px 7px; }
      .pp-friend-accept { color: #54f28b; border-color: rgba(84, 242, 139, 0.3); }
      .pp-friend-icon-btn { width: 24px; height: 24px; padding: 0; line-height: 22px; }
      .pp-friend-btn:hover,
      .pp-friend-icon-btn:hover { border-color: rgba(68, 255, 136, 0.45); color: #fff; }
      .pp-friend-icon-btn:disabled { opacity: 0.35; cursor: default; }
      .pp-footer {
        padding: 7px 12px;
        border-top: 1px solid rgba(68, 255, 136, 0.14);
        color: #7a84a8;
        font-size: 10px;
        min-height: 27px;
      }
      .pp-empty { padding: 20px; text-align: center; color: #556; }
    `;
    document.head.appendChild(style);

    // Delegate click events
    this.listEl.addEventListener("click", (e) => {
      const friendAction = (e.target as HTMLElement).dataset.friendAction;
      if (friendAction) {
        const requestRow = (e.target as HTMLElement).closest(".pp-friend-request") as HTMLElement | null;
        if (requestRow?.dataset.requestId) {
          if (friendAction === "accept") void this.acceptFriendRequest(requestRow.dataset.requestId);
          if (friendAction === "decline") void this.declineFriendRequest(requestRow.dataset.requestId);
          return;
        }

        const friendRow = (e.target as HTMLElement).closest(".pp-friend") as HTMLElement | null;
        const wallet = friendRow?.dataset.wallet;
        if (!wallet) return;
        const friend = this.friends.find((f) => f.wallet === wallet);
        if (!friend) return;
        if (friendAction === "locate") this.callbacks.onFriendLocate?.(friend);
        if (friendAction === "remove") void this.removeFriend(wallet);
        return;
      }

      const row = (e.target as HTMLElement).closest(".pp-row") as HTMLElement;
      if (row?.dataset.eid) {
        const player = this.playersById.get(row.dataset.eid);
        if (player) this.callbacks.onPlayerClick(player);
        return;
      }
      // Zone header: toggle expand/collapse; double-click navigates
      const zone = (e.target as HTMLElement).closest(".pp-zone-header") as HTMLElement;
      if (zone?.dataset.zoneToggle) {
        const zoneId = zone.dataset.zoneToggle;
        if (this.expandedZones.has(zoneId)) {
          this.expandedZones.delete(zoneId);
        } else {
          this.expandedZones.add(zoneId);
        }
        this.render();
        return;
      }
    });
    this.listEl.addEventListener("dblclick", (e) => {
      const zone = (e.target as HTMLElement).closest(".pp-zone-header") as HTMLElement;
      if (zone?.dataset.zoneToggle) {
        this.callbacks.onZoneClick(zone.dataset.zoneToggle);
      }
    });
  }
}

function friendDisplayName(friend: FriendInfo): string {
  return friend.name ?? friend.wogName ?? shortWallet(friend.wallet);
}

function shortWallet(wallet: string): string {
  return wallet.length > 10 ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : wallet;
}

function timeAgo(ts: number): string {
  const delta = Math.max(0, Date.now() - ts);
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[c]!));
}
