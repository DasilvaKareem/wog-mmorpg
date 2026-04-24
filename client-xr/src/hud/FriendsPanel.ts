import {
  acceptFriendRequest,
  declineFriendRequest,
  fetchFriendRequests,
  fetchFriends,
  removeFriend,
} from "../api.js";
import type { FriendInfo, FriendRequestInfo } from "../types.js";

interface FriendsPanelCallbacks {
  getAuthToken: () => Promise<string | null>;
  onRequestCountChange?: (count: number) => void;
  onLocateFriend?: (friend: FriendInfo) => void;
}

export class FriendsPanel {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private ownerWallet: string | null = null;
  private socialWallet: string | null = null;
  private friends: FriendInfo[] = [];
  private requests: FriendRequestInfo[] = [];
  private status = "";
  private callbacks: FriendsPanelCallbacks;

  constructor(callbacks: FriendsPanelCallbacks) {
    this.callbacks = callbacks;

    this.container = document.createElement("div");
    this.container.id = "friends-panel";
    this.container.style.display = "none";

    const header = document.createElement("div");
    header.className = "fr-header";
    header.innerHTML = `<span class="fr-title">Friends</span><span class="fr-sub">Online Status</span>`;
    this.container.appendChild(header);

    this.listEl = document.createElement("div");
    this.listEl.className = "fr-list";
    this.container.appendChild(this.listEl);

    this.footerEl = document.createElement("div");
    this.footerEl.className = "fr-footer";
    this.container.appendChild(this.footerEl);

    document.body.appendChild(this.container);
    this.injectStyles();
    this.render();
  }

  setIdentity(ownerWallet: string | null, socialWallet: string | null) {
    const normalizedOwner = ownerWallet ? ownerWallet.toLowerCase() : null;
    const normalizedSocial = socialWallet ? socialWallet.toLowerCase() : null;
    if (this.ownerWallet === normalizedOwner && this.socialWallet === normalizedSocial) return;
    this.ownerWallet = normalizedOwner;
    this.socialWallet = normalizedSocial;
    this.friends = [];
    this.requests = [];
    this.status = "";
    this.callbacks.onRequestCountChange?.(0);
    this.render();
  }

  async refresh(): Promise<void> {
    if (!this.socialWallet) return;
    const [friendsData, requestsData] = await Promise.all([
      fetchFriends(this.socialWallet),
      fetchFriendRequests(this.socialWallet),
    ]);
    if (friendsData) {
      this.friends = [...(friendsData.friends ?? [])].sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return displayName(a).localeCompare(displayName(b));
      });
    }
    if (requestsData) {
      this.requests = requestsData.requests ?? [];
      this.callbacks.onRequestCountChange?.(this.requests.length);
    }
    this.render();
  }

  toggle() {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  show() {
    this.container.style.display = "flex";
    void this.refresh();
  }

  hide() {
    this.container.style.display = "none";
  }

  isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  private async acceptRequest(requestId: string): Promise<void> {
    if (!this.socialWallet || !this.ownerWallet) return;
    const token = await this.callbacks.getAuthToken();
    if (!token) {
      this.status = "Sign in to accept requests.";
      this.render();
      return;
    }
    const result = await acceptFriendRequest(token, this.socialWallet, requestId);
    this.status = result.ok ? "Friend request accepted." : result.error ?? "Accept failed.";
    await this.refresh();
  }

  private async declineRequest(requestId: string): Promise<void> {
    if (!this.socialWallet || !this.ownerWallet) return;
    const token = await this.callbacks.getAuthToken();
    if (!token) {
      this.status = "Sign in to decline requests.";
      this.render();
      return;
    }
    const result = await declineFriendRequest(token, this.socialWallet, requestId);
    this.status = result.ok ? "Friend request declined." : result.error ?? "Decline failed.";
    await this.refresh();
  }

  private async removeFriend(targetWallet: string): Promise<void> {
    if (!this.socialWallet || !this.ownerWallet) return;
    const token = await this.callbacks.getAuthToken();
    if (!token) {
      this.status = "Sign in to remove friends.";
      this.render();
      return;
    }
    const result = await removeFriend(token, this.socialWallet, targetWallet);
    this.status = result.ok ? "Friend removed." : result.error ?? "Remove failed.";
    await this.refresh();
  }

  private render() {
    if (!this.socialWallet) {
      this.listEl.innerHTML = `<div class="fr-empty">Deploy an agent to view friends.</div>`;
      this.footerEl.textContent = "";
      return;
    }

    let html = "";
    if (this.requests.length > 0) {
      html += `<div class="fr-section">Requests (${this.requests.length})</div>`;
      for (const req of this.requests) {
        html += `<div class="fr-request" data-request-id="${esc(req.id)}">`;
        html += `<div class="fr-main"><span class="fr-name">${esc(req.fromName || shortWallet(req.fromWallet))}</span><span class="fr-meta">${esc(timeAgo(req.createdAt))}</span></div>`;
        html += `<div class="fr-actions"><button class="fr-btn fr-accept" data-action="accept">Accept</button><button class="fr-btn" data-action="decline">Decline</button></div>`;
        html += `</div>`;
      }
    }

    html += `<div class="fr-section">Friends (${this.friends.length}/50)</div>`;
    if (this.friends.length === 0) {
      html += `<div class="fr-empty">No friends yet. Inspect a player and use Add Friend.</div>`;
    } else {
      for (const friend of this.friends) {
        const name = displayName(friend);
        const zone = friend.zoneId ? friend.zoneId.replace(/-/g, " ") : "Offline";
        const detail = friend.online
          ? `${zone}${friend.level != null ? ` / Lv${friend.level}` : ""}`
          : "Offline";
        html += `<div class="fr-friend" data-wallet="${esc(friend.wallet)}">`;
        html += `<span class="fr-dot ${friend.online ? "online" : "offline"}"></span>`;
        html += `<div class="fr-info"><div class="fr-name">${esc(name)}</div><div class="fr-meta">${esc(detail)}${friend.reputationRank ? ` / ${esc(friend.reputationRank)}` : ""}</div></div>`;
        html += `<div class="fr-actions">`;
        html += `<button class="fr-icon-btn" data-action="locate" title="Locate" ${friend.online ? "" : "disabled"}>@</button>`;
        html += `<button class="fr-icon-btn" data-action="remove" title="Remove">x</button>`;
        html += `</div></div>`;
      }
    }

    this.listEl.innerHTML = html;
    const online = this.friends.filter((f) => f.online).length;
    this.footerEl.textContent = this.status || `${online} online of ${this.friends.length}`;
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #friends-panel {
        position: fixed;
        bottom: 64px;
        right: 12px;
        width: 312px;
        max-height: calc(100vh - 200px);
        background: rgba(10, 16, 28, 0.94);
        border: 1px solid rgba(92, 200, 255, 0.25);
        border-radius: 8px;
        z-index: 16;
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        backdrop-filter: blur(6px);
        pointer-events: auto;
      }

      .fr-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(92, 200, 255, 0.18);
      }
      .fr-title { color: #7fd6ff; font-weight: bold; font-size: 13px; letter-spacing: 0.5px; }
      .fr-sub { color: #667; font-size: 10px; }

      .fr-list {
        overflow-y: auto;
        flex: 1;
        scrollbar-width: thin;
        scrollbar-color: rgba(92, 200, 255, 0.2) transparent;
      }

      .fr-section {
        padding: 7px 12px 5px;
        color: #7a84a8;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid rgba(92, 200, 255, 0.07);
      }

      .fr-request,
      .fr-friend {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(92, 200, 255, 0.07);
      }
      .fr-request { align-items: flex-start; background: rgba(92, 200, 255, 0.05); }
      .fr-friend:last-child,
      .fr-request:last-child { border-bottom: none; }

      .fr-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .fr-dot.online { background: #54f28b; box-shadow: 0 0 8px rgba(84, 242, 139, 0.65); }
      .fr-dot.offline { background: #56617a; }

      .fr-info,
      .fr-main { flex: 1; min-width: 0; }
      .fr-name { color: #edf2ff; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fr-meta { color: #7a84a8; font-size: 10px; margin-top: 2px; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fr-actions { display: flex; gap: 5px; flex-shrink: 0; }

      .fr-btn,
      .fr-icon-btn {
        background: rgba(32, 45, 64, 0.75);
        border: 1px solid rgba(92, 200, 255, 0.18);
        border-radius: 4px;
        color: #bcd;
        cursor: pointer;
        font: 11px monospace;
      }
      .fr-btn { padding: 4px 7px; }
      .fr-accept { color: #54f28b; border-color: rgba(84, 242, 139, 0.3); }
      .fr-icon-btn { width: 24px; height: 24px; padding: 0; line-height: 22px; }
      .fr-btn:hover,
      .fr-icon-btn:hover { border-color: rgba(92, 200, 255, 0.45); color: #fff; }
      .fr-icon-btn:disabled { opacity: 0.35; cursor: default; }

      .fr-empty {
        padding: 18px 14px;
        text-align: center;
        color: #596a8a;
        line-height: 1.35;
      }

      .fr-footer {
        padding: 7px 12px;
        border-top: 1px solid rgba(92, 200, 255, 0.14);
        color: #7a84a8;
        font-size: 10px;
        min-height: 27px;
      }
    `;
    document.head.appendChild(style);

    this.listEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action;
      if (!action) return;

      const requestRow = target.closest(".fr-request") as HTMLElement | null;
      if (requestRow?.dataset.requestId) {
        if (action === "accept") void this.acceptRequest(requestRow.dataset.requestId);
        if (action === "decline") void this.declineRequest(requestRow.dataset.requestId);
        return;
      }

      const friendRow = target.closest(".fr-friend") as HTMLElement | null;
      const wallet = friendRow?.dataset.wallet;
      if (!wallet) return;
      const friend = this.friends.find((f) => f.wallet === wallet);
      if (!friend) return;
      if (action === "locate") this.callbacks.onLocateFriend?.(friend);
      if (action === "remove") void this.removeFriend(wallet);
    });
  }
}

function displayName(friend: FriendInfo): string {
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
