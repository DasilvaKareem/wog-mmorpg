import type {
  Entity, NpcDialogueMessage, ShopItem, TechniqueInfo,
  CraftingRecipe, GuildSummary, MyGuildResponse, GuildProposal,
  GuildProposalType, AuctionListing,
  ProfessionEntry, EnchantmentEntry, ArenaInfo, PvpLeaderboardEntry,
} from "../types.js";
import {
  fetchShopInventory, buyShopItem, sendNpcDialogue,
  fetchAvailableTechniques, learnTechnique,
  fetchRecipes, craftAtStation,
  fetchGuilds, createGuild, joinGuild,
  fetchMyGuild, leaveGuild, inviteToGuild, depositToGuild,
  proposeGuildAction, voteOnGuildProposal,
  fetchAuctions, bidAuction, buyoutAuction, fetchWalletBalance, cancelPvpBattle,
  fetchColiseumInfo, joinPvpQueue, joinPvpPartyQueue, fetchPvpLeaderboard,
  fetchActiveBattles, fetchQueueStatus, leavePvpQueue, fetchCurrentBattle, fetchBattleDetails,
  fetchProfessionCatalog, learnProfession,
  fetchEnchantingCatalog, applyEnchantment,
} from "../api.js";
import type { ActiveBattle, QueueStatusEntry, BattleDetails } from "../api.js";

const NPC_DIALOG_TYPES = new Set([
  "merchant", "quest-giver", "lore-npc", "guild-registrar",
  "auctioneer", "arena-master", "trainer", "profession-trainer",
  "forge", "alchemy-lab", "enchanting-altar", "campfire",
  "tanning-rack", "jewelers-bench",
]);

/** localStorage key for proposalIds the player has already voted on. */
const VOTED_PROPOSALS_KEY = "wog-voted-proposals";

function loadVotedProposals(): Set<number> {
  try {
    const raw = localStorage.getItem(VOTED_PROPOSALS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((n): n is number => Number.isFinite(n)));
  } catch {
    return new Set();
  }
}

function saveVotedProposals(s: Set<number>) {
  try {
    localStorage.setItem(VOTED_PROPOSALS_KEY, JSON.stringify([...s]));
  } catch { /* localStorage may be blocked */ }
}

const PROPOSAL_TYPE_LABELS: Record<string, string> = {
  "withdraw-gold": "Withdraw gold",
  "kick-member": "Kick member",
  "promote-officer": "Promote to officer",
  "demote-officer": "Demote officer",
  "disband-guild": "Disband guild",
};

const PROPOSAL_TYPE_ORDER: GuildProposalType[] = [
  "withdraw-gold",
  "kick-member",
  "promote-officer",
  "demote-officer",
  "disband-guild",
];

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

function fmtTimeRemaining(seconds: number): string {
  if (seconds <= 0) return "expired";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m`;
  return `${seconds}s`;
}

const TYPE_ACCENT: Record<string, string> = {
  merchant: "#ffcc00",
  "quest-giver": "#66bbff",
  "lore-npc": "#8888cc",
  "guild-registrar": "#44cc88",
  auctioneer: "#ff9944",
  "arena-master": "#ff4466",
  trainer: "#88aaff",
  "profession-trainer": "#88aaff",
  forge: "#ff6633",
  "alchemy-lab": "#aa44ff",
  "enchanting-altar": "#cc66ff",
  campfire: "#ff8844",
  "tanning-rack": "#aa8855",
  "jewelers-bench": "#44ddcc",
  npc: "#4488ff",
};

const CRAFT_CONFIG: Record<string, { recipePath: string; craftPath: string; stationField: string; verb: string; label: string }> = {
  forge:            { recipePath: "/crafting/recipes",        craftPath: "/crafting/forge",        stationField: "forgeId",      verb: "Forge", label: "Forge" },
  "alchemy-lab":    { recipePath: "/alchemy/recipes",         craftPath: "/alchemy/brew",          stationField: "alchemyLabId", verb: "Brew",  label: "Alchemy" },
  campfire:         { recipePath: "/cooking/recipes",          craftPath: "/cooking/cook",          stationField: "campfireId",   verb: "Cook",  label: "Cooking" },
  "tanning-rack":   { recipePath: "/leatherworking/recipes",   craftPath: "/leatherworking/craft",  stationField: "stationId",    verb: "Craft", label: "Leatherworking" },
  "jewelers-bench": { recipePath: "/jewelcrafting/recipes",    craftPath: "/jewelcrafting/craft",    stationField: "stationId",    verb: "Craft", label: "Jewelcrafting" },
};

interface NpcDialogCallbacks {
  getAuthToken: () => Promise<string | null>;
  getOwnEntityId: () => string | null;
  getOwnWalletAddress: () => string | null;
  /**
   * Returns the local player's current character info — used to build PvP
   * queue payloads that the backend requires (level, characterTokenId, agentId).
   * Returning null means the character isn't fully registered yet.
   */
  getOwnCharacterInfo?: () => { level: number; characterTokenId: string | null; agentId: string | null } | null;
  /**
   * Returns the local player's party (including self) sized for party-queue
   * decisions. `leaderId` is the entity id that the shard accepts as the
   * party leader payload — typically the owner's entity. Returns null when
   * the player is not in a party.
   */
  getOwnParty?: () => { leaderId: string; size: number } | null;
  onShowQuests: () => void;
  /** Optional channel for transient user feedback (toasts in the agent chat). */
  notify?: (text: string, kind?: "info" | "progress" | "success" | "error") => void;
}

const AUCTION_POLL_INTERVAL_MS = 5000;

export class NpcDialog {
  private overlay: HTMLDivElement;
  private container: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private contentEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private callbacks: NpcDialogCallbacks;

  private entity: Entity | null = null;
  private activeTab = "";
  private chatHistory: NpcDialogueMessage[] = [];
  // Shop
  private shopItems: ShopItem[] = [];
  private shopLoading = false;
  private dialogSending = false;
  private playerGold: number | null = null;
  // Skills (trainer)
  private techniques: TechniqueInfo[] = [];
  private techniquesLoading = false;
  // Crafting (generic)
  private recipes: CraftingRecipe[] = [];
  private recipesLoading = false;
  // Guild
  private guilds: GuildSummary[] = [];
  private guildsLoading = false;
  /** Cached "my guild" lookup. null until first load. */
  private myGuild: MyGuildResponse | null = null;
  private myGuildLoading = false;
  /** Whether the "compose proposal" form is expanded in the guild detail view. */
  private composeProposalOpen = false;
  /** Selected proposal type for the compose form. */
  private composeProposalType: GuildProposalType = "withdraw-gold";
  /** ProposalIds the player has already voted on (locally tracked). */
  private votedProposalIds: Set<number> = loadVotedProposals();
  // Auctions
  private auctions: AuctionListing[] = [];
  private auctionsLoading = false;
  private auctionPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Buttons disabled while a bid/buyout request is inflight. */
  private auctionPendingAction = new Set<string>();
  // Arena
  private arenaInfo: ArenaInfo | null = null;
  private arenaLoading = false;
  private leaderboard: PvpLeaderboardEntry[] = [];
  private activeBattles: ActiveBattle[] = [];
  private queueStatuses: QueueStatusEntry[] = [];
  private queuedFormats: string[] = [];
  private selectedFormat = "1v1";
  private inQueue = false;
  private arenaPollTimer: ReturnType<typeof setInterval> | null = null;
  private matchPollTimer: ReturnType<typeof setInterval> | null = null;
  private viewingBattle: BattleDetails | null = null;
  private viewingBattleId: string | null = null;
  /** Set when the player's own current-battle poll reports inBattle === true. */
  private currentBattleId: string | null = null;
  // Professions
  private professions: ProfessionEntry[] = [];
  private professionsLoading = false;
  // Enchanting
  private enchantments: EnchantmentEntry[] = [];
  private enchantmentsLoading = false;

  constructor(callbacks: NpcDialogCallbacks) {
    this.callbacks = callbacks;

    this.overlay = document.createElement("div");
    this.overlay.id = "npc-dialog";
    this.overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.5);
      z-index:50; display:none; align-items:center; justify-content:center;
    `;
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.container = document.createElement("div");
    this.container.className = "nd-container";
    this.container.addEventListener("click", (e) => e.stopPropagation());

    this.headerEl = document.createElement("div");
    this.headerEl.className = "nd-header";
    this.container.appendChild(this.headerEl);

    this.tabBar = document.createElement("div");
    this.tabBar.className = "nd-tabs";
    this.tabBar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".nd-tab") as HTMLElement;
      if (!btn?.dataset.tab) return;
      this.activeTab = btn.dataset.tab;
      this.tabBar.querySelectorAll(".nd-tab").forEach((b) =>
        b.classList.toggle("active", (b as HTMLElement).dataset.tab === this.activeTab));
      if (this.activeTab === "auctions") this.startAuctionPolling();
      else this.stopAuctionPolling();
      this.renderContent();
    });
    this.container.appendChild(this.tabBar);

    this.contentEl = document.createElement("div");
    this.contentEl.className = "nd-content";
    this.container.appendChild(this.contentEl);

    this.footerEl = document.createElement("div");
    this.footerEl.className = "nd-footer";
    this.container.appendChild(this.footerEl);

    this.overlay.appendChild(this.container);
    document.body.appendChild(this.overlay);
    this.injectStyles();

    // Delegated action clicks
    this.contentEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement;
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "buy" && btn.dataset.tokenId) void this.handleBuy(Number(btn.dataset.tokenId));
      if (action === "learn" && btn.dataset.techniqueId) void this.handleLearn(btn.dataset.techniqueId);
      if (action === "craft" && btn.dataset.recipeId) void this.handleCraft(btn.dataset.recipeId);
      if (action === "create-guild") void this.handleCreateGuild();
      if (action === "join-guild" && btn.dataset.guildId) void this.handleJoinGuild(Number(btn.dataset.guildId));
      if (action === "leave-guild" && btn.dataset.guildId) void this.handleLeaveGuild(Number(btn.dataset.guildId));
      if (action === "deposit-guild" && btn.dataset.guildId) void this.handleDepositGuild(Number(btn.dataset.guildId));
      if (action === "invite-guild" && btn.dataset.guildId) void this.handleInviteGuild(Number(btn.dataset.guildId));
      if (action === "open-propose") { this.composeProposalOpen = true; if (this.activeTab === "guild") this.renderGuild(); }
      if (action === "cancel-propose") { this.composeProposalOpen = false; if (this.activeTab === "guild") this.renderGuild(); }
      if (action === "submit-propose" && btn.dataset.guildId) void this.handleSubmitProposal(Number(btn.dataset.guildId));
      if ((action === "vote-yes" || action === "vote-no") && btn.dataset.proposalId && btn.dataset.guildId) {
        void this.handleVote(Number(btn.dataset.proposalId), Number(btn.dataset.guildId), action === "vote-yes");
      }
      if (action === "bid" && btn.dataset.auctionId) void this.handleBid(btn.dataset.auctionId);
      if (action === "buyout" && btn.dataset.auctionId) void this.handleBuyout(btn.dataset.auctionId);
      if (action === "queue-join") void this.handleQueueJoin();
      if (action === "queue-join-party") void this.handleQueuePartyJoin();
      if (action === "queue-leave") void this.handleQueueLeave();
      if (action === "select-format" && btn.dataset.format) { this.selectedFormat = btn.dataset.format; if (this.activeTab === "arena") this.renderArena(); }
      if (action === "view-battle" && btn.dataset.battleId) void this.handleViewBattle(btn.dataset.battleId);
      if (action === "forfeit" && btn.dataset.battleId) void this.handleForfeit(btn.dataset.battleId);
      if (action === "arena-back") this.handleArenaBack();
      if (action === "learn-prof" && btn.dataset.profId) void this.handleLearnProfession(btn.dataset.profId);
      if (action === "enchant" && btn.dataset.elixirId) void this.handleEnchant(btn.dataset.elixirId);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen()) {
        this.close();
        e.stopPropagation();
      }
    });
  }

  static isNpcType(type: string): boolean {
    return NPC_DIALOG_TYPES.has(type);
  }

  open(entity: Entity) {
    this.entity = entity;
    this.chatHistory = [];
    this.shopItems = [];
    this.playerGold = null;
    this.shopLoading = false;
    this.dialogSending = false;
    this.techniques = [];
    this.techniquesLoading = false;
    this.recipes = [];
    this.recipesLoading = false;
    this.guilds = [];
    this.guildsLoading = false;
    this.myGuild = null;
    this.myGuildLoading = false;
    this.composeProposalOpen = false;
    this.composeProposalType = "withdraw-gold";
    this.auctions = [];
    this.auctionsLoading = false;
    this.arenaInfo = null;
    this.arenaLoading = false;
    this.leaderboard = [];
    this.activeBattles = [];
    this.queueStatuses = [];
    this.queuedFormats = [];
    this.inQueue = false;
    this.viewingBattle = null;
    this.viewingBattleId = null;
    this.stopArenaPolling();
    this.professions = [];
    this.professionsLoading = false;
    this.enchantments = [];
    this.enchantmentsLoading = false;

    const accent = TYPE_ACCENT[entity.type] ?? "#aaa";
    this.container.style.borderColor = hexToRgba(accent, 0.4);

    const typeLabel = entity.type.replace(/-/g, " ");
    this.headerEl.innerHTML = `
      <div class="nd-header-left">
        <span class="nd-npc-name" style="color:${accent}">${esc(entity.name)}</span>
        <span class="nd-npc-type">${esc(typeLabel)}</span>
      </div>
      <button class="nd-close">&times;</button>
    `;
    this.headerEl.querySelector(".nd-close")!.addEventListener("click", () => this.close());

    const tabs = this.getTabs(entity.type);
    this.tabBar.innerHTML = tabs.map((t, i) =>
      `<button class="nd-tab${i === 0 ? " active" : ""}" data-tab="${t.id}" style="--accent:${accent}">${t.label}</button>`
    ).join("");
    this.activeTab = tabs[0].id;

    this.overlay.style.display = "flex";
    this.renderContent();
  }

  close() {
    this.overlay.style.display = "none";
    this.entity = null;
    this.chatHistory = [];
    this.stopArenaPolling();
    this.stopAuctionPolling();
  }

  isOpen(): boolean {
    return this.overlay.style.display !== "none";
  }

  // ── Tab logic ──────────────────────────────────────────────────

  private getTabs(type: string): { id: string; label: string }[] {
    switch (type) {
      case "merchant":
        return [{ id: "shop", label: "Shop" }, { id: "dialog", label: "Talk" }];
      case "quest-giver":
        return [{ id: "dialog", label: "Talk" }, { id: "quests", label: "Quests" }];
      case "trainer":
        return [{ id: "skills", label: "Skills" }, { id: "dialog", label: "Talk" }];
      case "guild-registrar":
        return [{ id: "guild", label: "Guild" }, { id: "dialog", label: "Talk" }];
      case "auctioneer":
        return [{ id: "auctions", label: "Auctions" }, { id: "dialog", label: "Talk" }];
      case "arena-master":
        return [{ id: "arena", label: "Arena" }, { id: "dialog", label: "Talk" }];
      case "profession-trainer":
        return [{ id: "professions", label: "Professions" }, { id: "dialog", label: "Talk" }];
      case "enchanting-altar":
        return [{ id: "enchanting", label: "Enchanting" }, { id: "dialog", label: "Talk" }];
      default:
        if (CRAFT_CONFIG[type]) {
          return [{ id: "craft", label: CRAFT_CONFIG[type].label }, { id: "dialog", label: "Talk" }];
        }
        return [{ id: "dialog", label: "Talk" }];
    }
  }

  // ── Content routing ───────────────────────────────────────────

  private renderContent() {
    this.footerEl.innerHTML = "";
    switch (this.activeTab) {
      case "shop": this.renderShop(); break;
      case "quests": this.renderQuests(); break;
      case "skills": this.renderSkills(); break;
      case "craft": this.renderCraft(); break;
      case "guild": this.renderGuild(); break;
      case "auctions": this.renderAuctions(); break;
      case "arena": this.renderArena(); break;
      case "professions": this.renderProfessions(); break;
      case "enchanting": this.renderEnchanting(); break;
      default: this.renderDialog(); break;
    }
  }

  // ── Dialog view ────────────────────────────────────────────────

  private renderDialog() {
    const accent = TYPE_ACCENT[this.entity?.type ?? ""] ?? "#aaa";

    let msgs = "";
    for (const m of this.chatHistory) {
      if (m.role === "npc") {
        msgs += `<div class="nd-msg nd-msg-npc" style="border-left-color:${accent}">
          <span class="nd-msg-name" style="color:${accent}">${esc(this.entity?.name ?? "NPC")}</span>
          <span class="nd-msg-text">${esc(m.content)}</span>
        </div>`;
      } else {
        msgs += `<div class="nd-msg nd-msg-player">
          <span class="nd-msg-name" style="color:#efc97f">You</span>
          <span class="nd-msg-text">${esc(m.content)}</span>
        </div>`;
      }
    }

    if (this.dialogSending) {
      msgs += `<div class="nd-msg nd-msg-npc" style="border-left-color:${accent}">
        <span class="nd-msg-text" style="color:#667">...</span>
      </div>`;
    }

    if (this.chatHistory.length === 0 && !this.dialogSending) {
      msgs = `<div class="nd-empty">Start a conversation...</div>`;
    }

    this.contentEl.innerHTML = `<div class="nd-chat-messages" id="nd-chat-scroll">${msgs}</div>`;

    const hasChar = !!this.callbacks.getOwnEntityId();
    if (hasChar) {
      this.footerEl.innerHTML = `
        <div class="nd-chat-input-row">
          <input class="nd-chat-input" type="text" placeholder="Say something..." maxlength="200" />
          <button class="nd-chat-send">Send</button>
        </div>
      `;
      const input = this.footerEl.querySelector(".nd-chat-input") as HTMLInputElement;
      const sendBtn = this.footerEl.querySelector(".nd-chat-send") as HTMLButtonElement;

      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && input.value.trim()) {
          void this.handleDialogSend(input.value.trim());
          input.value = "";
        }
      });
      input.addEventListener("keyup", (e) => e.stopPropagation());
      sendBtn.addEventListener("click", () => {
        if (input.value.trim()) {
          void this.handleDialogSend(input.value.trim());
          input.value = "";
        }
      });

      requestAnimationFrame(() => input.focus());
    } else {
      this.footerEl.innerHTML = `<div class="nd-footer-text">Deploy a character to interact</div>`;
    }

    if (this.chatHistory.length === 0 && !this.dialogSending && hasChar) {
      void this.handleDialogSend("Hello");
    }

    const scroll = this.contentEl.querySelector("#nd-chat-scroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  private async handleDialogSend(message: string) {
    if (!this.entity || this.dialogSending) return;
    const token = await this.callbacks.getAuthToken();
    const entityId = this.callbacks.getOwnEntityId();
    if (!token || !entityId) return;

    if (message) this.chatHistory.push({ role: "player", content: message });
    this.dialogSending = true;
    this.renderDialog();

    const result = await sendNpcDialogue(token, this.entity.id, entityId, message, this.chatHistory.slice(-10));
    this.dialogSending = false;
    if (result.ok && result.data) {
      const text = (result.data as any).reply ?? (result.data as any).response ?? "";
      this.chatHistory.push({ role: "npc", content: text || "(no response)" });
    } else {
      this.chatHistory.push({ role: "npc", content: result.error ?? "(no response)" });
    }
    this.renderDialog();
  }

  // ── Shop view ──────────────────────────────────────────────────

  private renderShop() {
    if (this.shopItems.length === 0 && !this.shopLoading) {
      this.shopLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading shop...</div>`;
      void this.loadShop();
      return;
    }
    if (this.shopLoading) { this.contentEl.innerHTML = `<div class="nd-empty">Loading shop...</div>`; return; }

    const hasChar = !!this.callbacks.getOwnEntityId();
    let html = "";
    for (const item of this.shopItems) {
      const stats = Object.entries(item.statBonuses || {}).map(([k, v]) => `+${v} ${k.toUpperCase()}`).join(", ");
      const stockText = item.stock != null ? `${item.stock} left` : "";
      const price = item.currentPrice ?? item.copperPrice;
      const slotText = item.equipSlot ? `[${item.equipSlot}]` : item.category || "";
      html += `<div class="nd-shop-item">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(item.name)}</span><span class="nd-shop-item-slot">${esc(slotText)}</span></div>`;
      if (item.description) html += `<div class="nd-shop-item-desc">${esc(item.description)}</div>`;
      if (stats) html += `<div class="nd-shop-item-stats">${stats}</div>`;
      html += `<div class="nd-shop-item-footer"><span class="nd-shop-item-price">${price}g</span>`;
      if (stockText) html += `<span class="nd-shop-item-stock">${stockText}</span>`;
      if (hasChar) html += `<button class="nd-btn" data-action="buy" data-token-id="${item.tokenId}">Buy</button>`;
      html += `</div></div>`;
    }
    if (!html) html = `<div class="nd-empty">This merchant has nothing for sale</div>`;
    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;
    const goldText = this.playerGold != null ? `Your gold: ${this.playerGold}` : "";
    this.footerEl.innerHTML = goldText ? `<div class="nd-footer-text">${goldText}</div>` : "";
  }

  private async loadShop() {
    if (!this.entity) return;
    const data = await fetchShopInventory(this.entity.id);
    this.shopLoading = false;
    if (data) this.shopItems = data.items;
    if (this.activeTab === "shop") this.renderShop();
  }

  private async handleBuy(tokenId: number) {
    if (!this.entity) return;
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;
    const btn = this.contentEl.querySelector(`[data-token-id="${tokenId}"]`) as HTMLButtonElement;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const result = await buyShopItem(token, addr, tokenId, 1, this.entity.id);
    if (result.ok && result.data) {
      this.playerGold = result.data.remainingGold;
      const item = this.shopItems.find((i) => i.tokenId === tokenId);
      if (item && item.stock != null) item.stock = Math.max(0, item.stock - 1);
      if (btn) { btn.textContent = "Bought!"; setTimeout(() => this.renderShop(), 1000); }
    } else {
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = "Buy"; }, 2000); }
    }
    if (this.playerGold != null) this.footerEl.innerHTML = `<div class="nd-footer-text">Your gold: ${this.playerGold}</div>`;
  }

  // ── Skills view (trainer) ─────────────────────────────────────

  private renderSkills() {
    if (this.techniques.length === 0 && !this.techniquesLoading) {
      this.techniquesLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading skills...</div>`;
      void this.loadTechniques();
      return;
    }
    if (this.techniquesLoading) { this.contentEl.innerHTML = `<div class="nd-empty">Loading skills...</div>`; return; }
    if (this.techniques.length === 0) { this.contentEl.innerHTML = `<div class="nd-empty">No skills available for your class</div>`; return; }

    const hasChar = !!this.callbacks.getOwnEntityId();
    let html = "";
    for (const tech of this.techniques) {
      const learned = tech.isLearned;
      const typeColor = tech.type === "attack" ? "#ff6644" : tech.type === "healing" ? "#44cc66" : tech.type === "buff" ? "#66bbff" : tech.type === "debuff" ? "#cc66ff" : "#aaa";
      html += `<div class="nd-shop-item" style="opacity:${learned ? "0.6" : "1"}">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(tech.name)}</span><span class="nd-shop-item-slot" style="color:${typeColor}">${esc(tech.type)} · R${tech.rank ?? 1}</span></div>`;
      if (tech.description) html += `<div class="nd-shop-item-desc">${esc(tech.description)}</div>`;
      html += `<div class="nd-shop-item-stats">Lvl ${tech.levelRequired} · ${tech.essenceCost} essence · ${tech.cooldown}s cd</div>`;
      html += `<div class="nd-shop-item-footer"><span class="nd-shop-item-price">${tech.copperCost}c</span>`;
      if (learned) html += `<span class="nd-shop-item-stock" style="color:#4c4">Learned</span>`;
      else if (hasChar) html += `<button class="nd-btn" data-action="learn" data-technique-id="${esc(tech.id)}">Learn</button>`;
      html += `</div></div>`;
    }
    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;
  }

  private async loadTechniques() {
    const entityId = this.callbacks.getOwnEntityId();
    if (!entityId) { this.techniquesLoading = false; return; }
    const data = await fetchAvailableTechniques(entityId);
    this.techniquesLoading = false;
    if (data) this.techniques = data;
    if (this.activeTab === "skills") this.renderSkills();
  }

  private async handleLearn(techniqueId: string) {
    if (!this.entity) return;
    const token = await this.callbacks.getAuthToken();
    const entityId = this.callbacks.getOwnEntityId();
    if (!token || !entityId) return;
    const btn = this.contentEl.querySelector(`[data-technique-id="${techniqueId}"]`) as HTMLButtonElement;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const result = await learnTechnique(token, { entityId, techniqueId, trainerEntityId: this.entity.id, zoneId: "" });
    if (result.ok) {
      const tech = this.techniques.find(t => t.id === techniqueId);
      if (tech) tech.isLearned = true;
      if (btn) btn.textContent = "Learned!";
      setTimeout(() => this.renderSkills(), 1000);
    } else {
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = "Learn"; }, 2000); }
    }
  }

  // ── Crafting view (forge, alchemy, cooking, leather, jewel) ───

  private renderCraft() {
    const cfg = this.entity ? CRAFT_CONFIG[this.entity.type] : null;
    if (!cfg) { this.contentEl.innerHTML = `<div class="nd-empty">Unknown station</div>`; return; }

    if (this.recipes.length === 0 && !this.recipesLoading) {
      this.recipesLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading recipes...</div>`;
      void this.loadRecipes(cfg.recipePath);
      return;
    }
    if (this.recipesLoading) { this.contentEl.innerHTML = `<div class="nd-empty">Loading recipes...</div>`; return; }
    if (this.recipes.length === 0) { this.contentEl.innerHTML = `<div class="nd-empty">No recipes available</div>`; return; }

    const hasChar = !!this.callbacks.getOwnEntityId();
    let html = "";
    for (const r of this.recipes) {
      const outName = r.output?.name ?? r.name ?? "Item";
      const outQty = r.output?.quantity ?? r.outputQuantity ?? 1;
      const mats = r.materials ?? r.requiredMaterials ?? [];
      const matsText = mats.map((m: any) => `${m.quantity}x ${m.name || m.itemName}`).join(", ");
      const skillReq = r.requiredSkillLevel > 0 ? `Skill ${r.requiredSkillLevel}` : "";

      html += `<div class="nd-shop-item">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(outName)}${outQty > 1 ? ` x${outQty}` : ""}</span>`;
      if (skillReq) html += `<span class="nd-shop-item-slot">${skillReq}</span>`;
      html += `</div>`;
      if (matsText) html += `<div class="nd-shop-item-desc">${esc(matsText)}</div>`;
      if (r.hpRestoration) html += `<div class="nd-shop-item-stats">Restores ${r.hpRestoration} HP</div>`;
      html += `<div class="nd-shop-item-footer">`;
      if (r.copperCost > 0) html += `<span class="nd-shop-item-price">${r.copperCost}c</span>`;
      if (hasChar) html += `<button class="nd-btn" data-action="craft" data-recipe-id="${esc(r.recipeId)}">${cfg.verb}</button>`;
      html += `</div></div>`;
    }
    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;
  }

  private async loadRecipes(path: string) {
    const data = await fetchRecipes(path);
    this.recipesLoading = false;
    if (data) this.recipes = data;
    if (this.activeTab === "craft") this.renderCraft();
  }

  private async handleCraft(recipeId: string) {
    if (!this.entity) return;
    const cfg = CRAFT_CONFIG[this.entity.type];
    if (!cfg) return;
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    const entityId = this.callbacks.getOwnEntityId();
    if (!token || !addr || !entityId) return;

    const btn = this.contentEl.querySelector(`[data-recipe-id="${recipeId}"]`) as HTMLButtonElement;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }

    const body: Record<string, unknown> = { walletAddress: addr, zoneId: this.entity.zoneId ?? "", entityId, recipeId };
    body[cfg.stationField] = this.entity.id;

    const result = await craftAtStation(token, cfg.craftPath, body);
    if (result.ok) {
      const name = result.data?.crafted?.name ?? "item";
      if (btn) { btn.textContent = `${cfg.verb}d!`; setTimeout(() => this.renderCraft(), 1500); }
    } else {
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = cfg.verb; }, 2000); }
    }
  }

  // ── Guild view ────────────────────────────────────────────────

  private renderGuild() {
    // First decide: am I in a guild? Kick off the "my guild" lookup if we
    // haven't tried yet — that one-call response also gives us the full
    // detail view's data (members + proposals).
    const addr = this.callbacks.getOwnWalletAddress();
    if (addr && this.myGuild === null && !this.myGuildLoading) {
      this.myGuildLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading guild...</div>`;
      void this.loadMyGuild();
      return;
    }
    if (this.myGuildLoading) {
      this.contentEl.innerHTML = `<div class="nd-empty">Loading guild...</div>`;
      return;
    }
    if (this.myGuild?.inGuild) {
      this.renderMyGuildDetail();
      return;
    }
    // Not in a guild — fall through to the create + browse list.
    this.renderGuildBrowse();
  }

  private async loadMyGuild() {
    const addr = this.callbacks.getOwnWalletAddress();
    if (!addr) { this.myGuildLoading = false; this.myGuild = null; return; }
    try {
      const data = await fetchMyGuild(addr);
      this.myGuild = data ?? { inGuild: false, guild: null, member: null, members: [], proposals: [] };
    } catch (err) {
      console.warn("[guild] my-guild lookup failed", err);
      this.myGuild = { inGuild: false, guild: null, member: null, members: [], proposals: [] };
    } finally {
      this.myGuildLoading = false;
      if (this.activeTab === "guild") this.renderGuild();
    }
  }

  private renderGuildBrowse() {
    if (this.guilds.length === 0 && !this.guildsLoading) {
      this.guildsLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading guilds...</div>`;
      void this.loadGuilds();
      return;
    }
    if (this.guildsLoading) { this.contentEl.innerHTML = `<div class="nd-empty">Loading guilds...</div>`; return; }

    const hasChar = !!this.callbacks.getOwnEntityId();
    let html = "";

    if (hasChar) {
      html += `<div class="nd-shop-item" style="border-bottom:1px solid rgba(68,204,136,0.2)">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#44cc88">Create a Guild</span><span class="nd-shop-item-slot">150g total</span></div>`;
      html += `<div class="nd-shop-item-desc">50g fee + 100g deposit to the guild treasury</div>`;
      html += `<div class="nd-shop-item-footer">`;
      html += `<input class="nd-chat-input" type="text" placeholder="Guild name..." maxlength="30" id="nd-guild-name" style="flex:1" />`;
      html += `<button class="nd-btn" data-action="create-guild" style="color:#44cc88;border-color:rgba(68,204,136,0.3);background:rgba(68,204,136,0.1)">Create</button>`;
      html += `</div></div>`;
    }

    if (this.guilds.length === 0) {
      html += `<div class="nd-empty">No guilds registered yet</div>`;
    } else {
      for (const g of this.guilds) {
        const isActive = g.status === "Active" || g.status === "active";
        const canJoin = hasChar && isActive;
        html += `<div class="nd-shop-item">`;
        html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(g.name)}</span><span class="nd-shop-item-slot">Lvl ${g.level}</span></div>`;
        html += `<div class="nd-shop-item-stats">${g.memberCount} members · ${g.treasury}g treasury</div>`;
        html += `<div class="nd-shop-item-footer">`;
        html += `<span class="nd-shop-item-stock">${esc(String(g.status))}</span>`;
        if (canJoin) {
          html += `<button class="nd-btn" data-action="join-guild" data-guild-id="${esc(String(g.guildId))}" style="color:#44cc88;border-color:rgba(68,204,136,0.3);background:rgba(68,204,136,0.1)">Join</button>`;
        }
        html += `</div>`;
        html += `</div>`;
      }
    }
    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;
    // Re-attach stop propagation on input
    const input = this.contentEl.querySelector("#nd-guild-name") as HTMLInputElement;
    if (input) {
      input.addEventListener("keydown", (e) => e.stopPropagation());
      input.addEventListener("keyup", (e) => e.stopPropagation());
    }
  }

  private async loadGuilds() {
    const data = await fetchGuilds();
    this.guildsLoading = false;
    this.guilds = data;
    if (this.activeTab === "guild") this.renderGuild();
  }

  private async handleCreateGuild() {
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;
    const input = this.contentEl.querySelector("#nd-guild-name") as HTMLInputElement;
    const name = input?.value.trim();
    if (!name) return;
    const btn = this.contentEl.querySelector("[data-action='create-guild']") as HTMLButtonElement;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const result = await createGuild(token, { founderAddress: addr, name, description: "", initialDeposit: 100 });
    if (result.ok) {
      if (btn) btn.textContent = "Created!";
      this.guildsLoading = false;
      this.guilds = [];
      this.myGuild = null; // force re-detect into the my-guild view
      setTimeout(() => this.renderGuild(), 1500);
    } else {
      if (btn) { btn.textContent = (result.error ?? "Failed").slice(0, 28); btn.disabled = false; setTimeout(() => { btn.textContent = "Create"; }, 2500); }
    }
  }

  private async handleJoinGuild(guildId: number) {
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;
    const btn = this.contentEl.querySelector(`[data-action='join-guild'][data-guild-id='${guildId}']`) as HTMLButtonElement | null;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const result = await joinGuild(token, guildId, addr);
    if (result.ok) {
      if (btn) btn.textContent = "Joined!";
      this.guildsLoading = false;
      this.guilds = [];
      this.myGuild = null; // route into my-guild view on next render
      setTimeout(() => this.renderGuild(), 1500);
    } else {
      if (btn) { btn.textContent = (result.error ?? "Failed").slice(0, 28); btn.disabled = false; setTimeout(() => { btn.textContent = "Join"; }, 2500); }
    }
  }

  // ── My Guild detail view ──────────────────────────────────────

  private renderMyGuildDetail() {
    const my = this.myGuild;
    if (!my || !my.inGuild || !my.guild || !my.member) {
      this.renderGuildBrowse();
      return;
    }
    const g = my.guild;
    const me = my.member;
    const isOfficer = me.rank === "Founder" || me.rank === "Officer";
    const gid = Number(g.guildId);

    let html = "";

    // 1. Header card
    html += `<div class="nd-shop-item" style="border-left:3px solid #44cc88">`;
    html += `<div class="nd-shop-item-header">`;
    html += `<span class="nd-shop-item-name" style="color:#44cc88">${esc(g.name)}</span>`;
    html += `<span class="nd-shop-item-slot">Lvl ${g.level} · ${esc(String(g.status))}</span>`;
    html += `</div>`;
    html += `<div class="nd-shop-item-stats">${esc(me.rank)} · ${my.members.length} member${my.members.length === 1 ? "" : "s"} · ${g.treasury}g treasury</div>`;
    if (g.description) html += `<div class="nd-shop-item-desc">${esc(g.description)}</div>`;
    html += `<div class="nd-shop-item-footer">`;
    html += `<button class="nd-btn" data-action="leave-guild" data-guild-id="${gid}" style="color:#ff6677;border-color:rgba(255,102,119,0.35);background:rgba(255,102,119,0.08)">Leave</button>`;
    html += `</div></div>`;

    // 2. Deposit
    html += `<div class="nd-shop-item">`;
    html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#ffc24f">Deposit to Treasury</span></div>`;
    html += `<div class="nd-shop-item-footer">`;
    html += `<input class="nd-chat-input" type="number" min="1" placeholder="amount" id="nd-guild-deposit" style="flex:1" />`;
    html += `<button class="nd-btn" data-action="deposit-guild" data-guild-id="${gid}">Deposit</button>`;
    html += `</div></div>`;

    // 3. Members
    html += `<div class="nd-shop-item">`;
    html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">Members</span><span class="nd-shop-item-slot">${my.members.length}</span></div>`;
    for (const m of my.members) {
      const isMe = m.address.toLowerCase() === me.address.toLowerCase();
      html += `<div class="nd-shop-item-stats" style="display:flex;justify-content:space-between;align-items:center;padding:3px 0">`;
      html += `<span>${shortAddr(m.address)}${isMe ? " <span style='color:#44cc88'>(you)</span>" : ""}</span>`;
      html += `<span style="color:#9ab">${esc(m.rank)} · ${m.contributedGold}g</span>`;
      html += `</div>`;
    }
    html += `</div>`;

    // 4. Invite (officer+ only)
    if (isOfficer) {
      html += `<div class="nd-shop-item">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#88aaff">Invite Member</span><span class="nd-shop-item-slot">Officer+</span></div>`;
      html += `<div class="nd-shop-item-footer">`;
      html += `<input class="nd-chat-input" type="text" placeholder="0x..." id="nd-guild-invite" maxlength="42" style="flex:1" />`;
      html += `<button class="nd-btn" data-action="invite-guild" data-guild-id="${gid}">Invite</button>`;
      html += `</div></div>`;
    }

    // 5 + 6. Proposals
    const active = my.proposals.filter((p) => p.status === "active");
    const past = my.proposals.filter((p) => p.status !== "active");

    html += `<div class="nd-shop-item">`;
    html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#cc66ff">Active Proposals</span><span class="nd-shop-item-slot">${active.length}</span></div>`;
    if (active.length === 0) {
      html += `<div class="nd-shop-item-desc" style="color:#778">None right now</div>`;
    } else {
      for (const p of active) {
        const voted = this.votedProposalIds.has(p.proposalId);
        const expired = p.timeRemaining <= 0;
        const typeLabel = PROPOSAL_TYPE_LABELS[p.proposalType] ?? p.proposalType;
        html += `<div style="border-top:1px solid rgba(204,102,255,0.18);padding-top:6px;margin-top:6px">`;
        html += `<div style="display:flex;justify-content:space-between"><span style="color:#cc66ff">${esc(typeLabel)}</span><span style="color:#9ab;font-size:11px">${fmtTimeRemaining(p.timeRemaining)}</span></div>`;
        html += `<div class="nd-shop-item-desc">${esc(p.description)}</div>`;
        if (p.targetAddress && p.targetAddress !== "0x0000000000000000000000000000000000000000") {
          html += `<div class="nd-shop-item-desc" style="font-size:11px">→ ${shortAddr(p.targetAddress)}${p.targetAmount ? ` · ${p.targetAmount}g` : ""}</div>`;
        }
        html += `<div style="display:flex;gap:6px;align-items:center;margin-top:4px">`;
        html += `<span style="color:#7fd6be;font-size:11px">yes ${p.yesVotes}</span>`;
        html += `<span style="color:#ff6677;font-size:11px">no ${p.noVotes}</span>`;
        html += `<span style="flex:1"></span>`;
        const dis = (voted || expired) ? " disabled" : "";
        html += `<button class="nd-btn" data-action="vote-yes" data-proposal-id="${p.proposalId}" data-guild-id="${gid}"${dis} style="color:#7fd6be">${voted ? "Voted" : "Vote Yes"}</button>`;
        html += `<button class="nd-btn" data-action="vote-no" data-proposal-id="${p.proposalId}" data-guild-id="${gid}"${dis} style="color:#ff6677">${voted ? "" : "Vote No"}</button>`;
        html += `</div></div>`;
      }
    }
    html += `</div>`;

    // 7. Create proposal (officer+ only)
    if (isOfficer) {
      if (this.composeProposalOpen) {
        html += `<div class="nd-shop-item" style="border-left:3px solid #cc66ff">`;
        html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#cc66ff">New Proposal</span></div>`;
        html += `<select id="nd-prop-type" class="nd-chat-input" style="width:100%;margin-bottom:6px">`;
        for (const t of PROPOSAL_TYPE_ORDER) {
          const sel = t === this.composeProposalType ? " selected" : "";
          html += `<option value="${t}"${sel}>${PROPOSAL_TYPE_LABELS[t]}</option>`;
        }
        html += `</select>`;
        html += `<input class="nd-chat-input" type="text" id="nd-prop-desc" placeholder="Description" maxlength="200" style="width:100%;margin-bottom:6px" />`;
        html += `<input class="nd-chat-input" type="text" id="nd-prop-target" placeholder="Target 0x... (optional)" maxlength="42" style="width:100%;margin-bottom:6px" />`;
        html += `<input class="nd-chat-input" type="number" id="nd-prop-amount" placeholder="Amount (optional)" style="width:100%;margin-bottom:6px" />`;
        html += `<div class="nd-shop-item-footer">`;
        html += `<button class="nd-btn" data-action="cancel-propose">Cancel</button>`;
        html += `<button class="nd-btn" data-action="submit-propose" data-guild-id="${gid}" style="color:#cc66ff">Submit</button>`;
        html += `</div></div>`;
      } else {
        html += `<div class="nd-shop-item-footer" style="margin-top:6px">`;
        html += `<button class="nd-btn" data-action="open-propose" style="color:#cc66ff;border-color:rgba(204,102,255,0.35);background:rgba(204,102,255,0.08)">+ New Proposal</button>`;
        html += `</div>`;
      }
    }

    // Past proposals (collapsed-style — just a summary line for each)
    if (past.length > 0) {
      html += `<div class="nd-shop-item">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#778">Past</span><span class="nd-shop-item-slot">${past.length}</span></div>`;
      for (const p of past) {
        const typeLabel = PROPOSAL_TYPE_LABELS[p.proposalType] ?? p.proposalType;
        html += `<div class="nd-shop-item-stats" style="display:flex;justify-content:space-between;padding:2px 0">`;
        html += `<span>${esc(typeLabel)}</span>`;
        html += `<span style="color:#9ab">${esc(p.status)} · ${p.yesVotes}/${p.noVotes}</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;

    // Stop key events from bleeding through to the world keybindings
    for (const id of ["nd-guild-deposit", "nd-guild-invite", "nd-prop-desc", "nd-prop-target", "nd-prop-amount"]) {
      const el = this.contentEl.querySelector(`#${id}`) as HTMLInputElement | null;
      if (el) {
        el.addEventListener("keydown", (e) => e.stopPropagation());
        el.addEventListener("keyup", (e) => e.stopPropagation());
      }
    }
    const sel = this.contentEl.querySelector("#nd-prop-type") as HTMLSelectElement | null;
    if (sel) {
      sel.addEventListener("change", () => { this.composeProposalType = sel.value as GuildProposalType; });
    }
  }

  private async handleLeaveGuild(guildId: number) {
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;
    const btn = this.contentEl.querySelector(`[data-action='leave-guild'][data-guild-id='${guildId}']`) as HTMLButtonElement | null;
    if (btn && btn.dataset.confirming !== "1") {
      // First click: arm confirmation
      btn.dataset.confirming = "1";
      btn.textContent = "Confirm Leave?";
      setTimeout(() => {
        if (btn.dataset.confirming === "1") { btn.dataset.confirming = ""; btn.textContent = "Leave"; }
      }, 3000);
      return;
    }
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const result = await leaveGuild(token, guildId, addr);
    if (result.ok) {
      if (btn) btn.textContent = "Left";
      this.myGuild = null;
      this.guilds = [];
      this.guildsLoading = false;
      setTimeout(() => this.renderGuild(), 1500);
    } else {
      if (btn) { btn.textContent = (result.error ?? "Failed").slice(0, 28); btn.disabled = false; btn.dataset.confirming = ""; setTimeout(() => { btn.textContent = "Leave"; }, 2500); }
    }
  }

  private async handleDepositGuild(guildId: number) {
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;
    const input = this.contentEl.querySelector("#nd-guild-deposit") as HTMLInputElement | null;
    const amount = Math.floor(Number(input?.value ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const btn = this.contentEl.querySelector(`[data-action='deposit-guild'][data-guild-id='${guildId}']`) as HTMLButtonElement | null;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const result = await depositToGuild(token, guildId, addr, amount);
    if (result.ok) {
      if (btn) btn.textContent = "Deposited!";
      this.myGuild = null;
      setTimeout(() => this.renderGuild(), 1500);
    } else {
      if (btn) { btn.textContent = (result.error ?? "Failed").slice(0, 28); btn.disabled = false; setTimeout(() => { btn.textContent = "Deposit"; }, 2500); }
    }
  }

  private async handleInviteGuild(guildId: number) {
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;
    const input = this.contentEl.querySelector("#nd-guild-invite") as HTMLInputElement | null;
    const target = (input?.value ?? "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(target)) {
      if (input) { input.style.borderColor = "#ff6677"; setTimeout(() => { input.style.borderColor = ""; }, 1500); }
      return;
    }
    const btn = this.contentEl.querySelector(`[data-action='invite-guild'][data-guild-id='${guildId}']`) as HTMLButtonElement | null;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const result = await inviteToGuild(token, guildId, target);
    if (result.ok) {
      if (btn) btn.textContent = "Invited!";
      if (input) input.value = "";
      setTimeout(() => { if (btn) { btn.textContent = "Invite"; btn.disabled = false; } }, 1500);
    } else {
      if (btn) { btn.textContent = (result.error ?? "Failed").slice(0, 28); btn.disabled = false; setTimeout(() => { btn.textContent = "Invite"; }, 2500); }
    }
  }

  private async handleVote(proposalId: number, guildId: number, vote: boolean) {
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;
    const action = vote ? "vote-yes" : "vote-no";
    const btn = this.contentEl.querySelector(`[data-action='${action}'][data-proposal-id='${proposalId}']`) as HTMLButtonElement | null;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const result = await voteOnGuildProposal(token, guildId, { proposalId, voterAddress: addr, vote });
    if (result.ok) {
      this.votedProposalIds.add(proposalId);
      saveVotedProposals(this.votedProposalIds);
      this.myGuild = null;
      setTimeout(() => this.renderGuild(), 1200);
    } else {
      if (btn) { btn.textContent = (result.error ?? "Failed").slice(0, 28); btn.disabled = false; setTimeout(() => { btn.textContent = vote ? "Vote Yes" : "Vote No"; }, 2500); }
    }
  }

  private async handleSubmitProposal(guildId: number) {
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;
    const descEl = this.contentEl.querySelector("#nd-prop-desc") as HTMLInputElement | null;
    const targetEl = this.contentEl.querySelector("#nd-prop-target") as HTMLInputElement | null;
    const amountEl = this.contentEl.querySelector("#nd-prop-amount") as HTMLInputElement | null;
    const description = (descEl?.value ?? "").trim();
    if (!description) {
      if (descEl) { descEl.style.borderColor = "#ff6677"; setTimeout(() => { descEl.style.borderColor = ""; }, 1500); }
      return;
    }
    const targetAddress = (targetEl?.value ?? "").trim();
    const targetAmount = Math.floor(Number(amountEl?.value ?? 0)) || undefined;
    const btn = this.contentEl.querySelector(`[data-action='submit-propose'][data-guild-id='${guildId}']`) as HTMLButtonElement | null;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const result = await proposeGuildAction(token, guildId, {
      proposerAddress: addr,
      proposalType: this.composeProposalType,
      description,
      targetAddress: targetAddress || undefined,
      targetAmount,
    });
    if (result.ok) {
      if (btn) btn.textContent = "Submitted!";
      this.composeProposalOpen = false;
      this.myGuild = null;
      setTimeout(() => this.renderGuild(), 1500);
    } else {
      if (btn) { btn.textContent = (result.error ?? "Failed").slice(0, 28); btn.disabled = false; setTimeout(() => { btn.textContent = "Submit"; }, 2500); }
    }
  }

  // ── Auctions view ─────────────────────────────────────────────

  private renderAuctions() {
    if (this.auctions.length === 0 && !this.auctionsLoading) {
      this.auctionsLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading auctions...</div>`;
      void this.loadAuctions();
      return;
    }
    if (this.auctionsLoading && this.auctions.length === 0) {
      this.contentEl.innerHTML = `<div class="nd-empty">Loading auctions...</div>`;
      return;
    }
    if (this.auctions.length === 0) { this.contentEl.innerHTML = `<div class="nd-empty">No active auctions</div>`; return; }

    let html = "";
    const hasChar = !!this.callbacks.getOwnEntityId();
    for (const a of this.auctions) {
      const timeLeft = formatAuctionTime(a.timeRemaining);
      const pending = this.auctionPendingAction.has(a.auctionId);
      const nextBid = (a.highBid || a.startPrice) + 1;
      html += `<div class="nd-shop-item">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(a.itemName)}</span><span class="nd-shop-item-slot">x${a.quantity}</span></div>`;
      html += `<div class="nd-shop-item-stats">`;
      html += `Bid: ${a.highBid || a.startPrice}g`;
      if (a.buyoutPrice) html += ` · Buyout: ${a.buyoutPrice}g`;
      html += ` · ${esc(timeLeft)} left`;
      html += `</div>`;
      if (hasChar) {
        html += `<div class="nd-shop-item-footer">`;
        html += `<button class="nd-btn" data-action="bid" data-auction-id="${esc(a.auctionId)}"${pending ? " disabled" : ""}>${pending ? "..." : `Bid ${nextBid}g`}</button>`;
        if (a.buyoutPrice) html += `<button class="nd-btn" data-action="buyout" data-auction-id="${esc(a.auctionId)}"${pending ? " disabled" : ""}>Buyout</button>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;
  }

  private async loadAuctions() {
    const zoneId = this.entity?.zoneId ?? "village-square";
    try {
      const data = await fetchAuctions(zoneId);
      this.auctions = data;
    } catch (err) {
      console.warn("[npc-dialog] auction refresh failed", err);
    } finally {
      this.auctionsLoading = false;
      if (this.activeTab === "auctions") this.renderAuctions();
    }
  }

  private startAuctionPolling() {
    if (this.auctionPollTimer) return;
    this.auctionPollTimer = setInterval(() => {
      if (this.activeTab !== "auctions" || !this.isOpen()) {
        this.stopAuctionPolling();
        return;
      }
      void this.loadAuctions();
    }, AUCTION_POLL_INTERVAL_MS);
  }

  private stopAuctionPolling() {
    if (!this.auctionPollTimer) return;
    clearInterval(this.auctionPollTimer);
    this.auctionPollTimer = null;
  }

  private async handleBid(auctionId: string) {
    if (this.auctionPendingAction.has(auctionId)) return;
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) {
      this.callbacks.notify?.("Bid failed: deploy your agent first.", "error");
      return;
    }
    const auction = this.auctions.find(a => a.auctionId === auctionId);
    if (!auction) return;
    const bidAmount = (auction.highBid || auction.startPrice) + 1;

    // Gold guard so we don't roundtrip a known-bad bid.
    const balance = await fetchWalletBalance(addr);
    if (balance && balance.copper < bidAmount) {
      this.callbacks.notify?.(
        `Bid failed: need ${bidAmount}g but have ${balance.copper}g.`,
        "error",
      );
      return;
    }

    this.auctionPendingAction.add(auctionId);
    this.renderAuctions();
    this.callbacks.notify?.(`Bidding ${bidAmount}g on ${auction.itemName}...`, "progress");

    const zoneId = this.entity?.zoneId ?? "village-square";
    const result = await bidAuction(token, zoneId, { auctionId, bidderAddress: addr, bidAmount });
    this.auctionPendingAction.delete(auctionId);

    if (result.ok) {
      auction.highBid = bidAmount;
      this.callbacks.notify?.(`Bid placed: ${bidAmount}g on ${auction.itemName}.`, "success");
      void this.loadAuctions();
    } else {
      this.callbacks.notify?.(`Bid failed: ${result.error ?? "unknown error"}`, "error");
      this.renderAuctions();
    }
  }

  private async handleBuyout(auctionId: string) {
    if (this.auctionPendingAction.has(auctionId)) return;
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) {
      this.callbacks.notify?.("Buyout failed: deploy your agent first.", "error");
      return;
    }
    const auction = this.auctions.find(a => a.auctionId === auctionId);
    if (!auction || !auction.buyoutPrice) return;

    const balance = await fetchWalletBalance(addr);
    if (balance && balance.copper < auction.buyoutPrice) {
      this.callbacks.notify?.(
        `Buyout failed: need ${auction.buyoutPrice}g but have ${balance.copper}g.`,
        "error",
      );
      return;
    }

    this.auctionPendingAction.add(auctionId);
    this.renderAuctions();
    this.callbacks.notify?.(
      `Buying out ${auction.itemName} for ${auction.buyoutPrice}g...`,
      "progress",
    );

    const zoneId = this.entity?.zoneId ?? "village-square";
    const result = await buyoutAuction(token, zoneId, { auctionId, buyerAddress: addr });
    this.auctionPendingAction.delete(auctionId);

    if (result.ok) {
      this.auctions = this.auctions.filter(a => a.auctionId !== auctionId);
      this.callbacks.notify?.(`Bought ${auction.itemName} for ${auction.buyoutPrice}g!`, "success");
      this.renderAuctions();
    } else {
      this.callbacks.notify?.(`Buyout failed: ${result.error ?? "unknown error"}`, "error");
      this.renderAuctions();
    }
  }

  // ── Arena view ────────────────────────────────────────────────

  private renderArena() {
    // Battle viewer mode takes priority over arena bootstrap so the standalone
    // viewer (opened from inbox match-found) can render without an NPC anchor.
    if (this.viewingBattle) {
      this.renderBattleViewer();
      return;
    }
    if (this.viewingBattleId && !this.viewingBattle) {
      this.contentEl.innerHTML = `<div class="nd-empty">Loading battle...</div>`;
      return;
    }
    if (this.arenaLoading) { this.contentEl.innerHTML = `<div class="nd-empty">Loading arena...</div>`; return; }
    if (!this.arenaInfo && !this.arenaLoading) {
      this.arenaLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading arena...</div>`;
      void this.loadArena();
      return;
    }

    const hasChar = !!this.callbacks.getOwnEntityId();
    let html = "";

    // ── Already in battle ──
    // If the player is currently fighting, hide queue controls and surface a
    // return/forfeit card so they aren't confused by "Join queue" while in a match.
    if (this.currentBattleId) {
      html += `<div class="nd-shop-item" style="border-left:2px solid #54f28b">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#54f28b">You're in battle</span>`;
      html += `<span class="nd-shop-item-slot">${esc(this.currentBattleId)}</span></div>`;
      html += `<div class="nd-shop-item-desc" style="opacity:0.8">The arena master will teleport you to your match. Use Return to spectate or Forfeit to give up.</div>`;
      html += `<div class="nd-shop-item-footer" style="display:flex;gap:6px">`;
      html += `<button class="nd-btn" data-action="view-battle" data-battle-id="${esc(this.currentBattleId)}" style="flex:1;color:#54f28b;background:rgba(84,242,139,0.12);border-color:rgba(84,242,139,0.4)">Return to battle</button>`;
      html += `<button class="nd-btn" data-action="forfeit" data-battle-id="${esc(this.currentBattleId)}" style="flex:1;color:#ff8866;background:rgba(255,136,102,0.12);border-color:rgba(255,136,102,0.4)">Forfeit</button>`;
      html += `</div></div>`;
      this.contentEl.innerHTML = html;
      return;
    }

    // ── Active Battles ──
    html += `<div class="nd-shop-item" style="border-bottom:1px solid rgba(255,68,102,0.2)">`;
    html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#ff4466">Active Battles</span>`;
    html += `<span class="nd-shop-item-slot">${this.activeBattles.length} live</span></div></div>`;

    if (this.activeBattles.length === 0) {
      html += `<div class="nd-shop-item"><div class="nd-shop-item-desc" style="text-align:center;opacity:0.6">No active battles — join the queue to start one</div></div>`;
    } else {
      for (const b of this.activeBattles) {
        if (!b.config) continue;
        const red = b.config.teamRed?.map((c) => c.name).join(", ") ?? "?";
        const blue = b.config.teamBlue?.map((c) => c.name).join(", ") ?? "?";
        const statusLabel = b.status === "in_progress" ? "LIVE" : b.status.toUpperCase().replace("_", " ");
        html += `<div class="nd-shop-item" style="cursor:pointer" data-action="view-battle" data-battle-id="${esc(b.battleId)}">`;
        html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(b.config.format?.toUpperCase() ?? "PVP")} — ${esc(b.config.arena?.name ?? "Arena")}</span>`;
        html += `<span class="nd-shop-item-slot" style="color:${b.status === "in_progress" ? "#54f28b" : "#ff9944"}">${statusLabel}</span></div>`;
        html += `<div class="nd-shop-item-stats"><span style="color:#cc3333">RED: ${esc(red)}</span> vs <span style="color:#3355cc">BLUE: ${esc(blue)}</span></div>`;
        html += `<div class="nd-shop-item-desc">Turn ${b.turnCount}${b.winner ? ` — Winner: ${b.winner.toUpperCase()}` : ""}</div>`;
        html += `</div>`;
      }
    }

    // ── Matchmaking Queue ──
    html += `<div class="nd-shop-item" style="border-top:1px solid rgba(255,68,102,0.2);border-bottom:1px solid rgba(255,68,102,0.2)">`;
    html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#ff4466">Matchmaking</span></div></div>`;

    // Queue status cards
    for (const q of this.queueStatuses) {
      const pct = q.playersInQueue + q.playersNeeded > 0
        ? Math.min(100, (q.playersInQueue / (q.playersInQueue + q.playersNeeded)) * 100)
        : 0;
      const isSelected = this.selectedFormat === q.format;
      html += `<div class="nd-shop-item" style="${isSelected ? "border-left:2px solid #ff4466" : ""}">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(q.format.toUpperCase())}</span>`;
      html += `<span class="nd-shop-item-slot">${q.playersInQueue} in queue, need ${Math.max(0, q.playersNeeded)}</span></div>`;
      html += `<div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;margin-top:4px"><div style="height:100%;width:${pct}%;background:#ffcc00;border-radius:2px"></div></div>`;
      html += `</div>`;
    }

    // Format selector + join/leave
    if (hasChar) {
      const formats = ["1v1", "2v2", "5v5", "ffa"];
      html += `<div class="nd-shop-item"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">`;
      for (const fmt of formats) {
        const sel = this.selectedFormat === fmt;
        html += `<button class="nd-btn" data-action="select-format" data-format="${esc(fmt)}" style="color:${sel ? "#000" : "#ff4466"};background:${sel ? "#ffcc00" : "rgba(255,68,102,0.1)"};border-color:${sel ? "#ffcc00" : "rgba(255,68,102,0.3)"};font-size:10px;padding:6px">${esc(fmt.toUpperCase())}</button>`;
      }
      html += `</div></div>`;

      if (!this.inQueue) {
        const fmt = this.selectedFormat;
        const isTeamFmt = fmt === "2v2" || fmt === "5v5";
        const teamSize = fmt === "2v2" ? 2 : fmt === "5v5" ? 5 : 1;
        const party = this.callbacks.getOwnParty?.() ?? null;
        if (isTeamFmt) {
          const partySize = party?.size ?? 0;
          const partyReady = partySize >= teamSize;
          const partyLabel = partyReady
            ? `Join ${esc(fmt.toUpperCase())} as Party`
            : party
              ? `Party ${partySize}/${teamSize} — need more`
              : `No Party — invite first`;
          html += `<div class="nd-shop-item" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">`;
          html += `<button class="nd-btn" data-action="queue-join" style="color:#fff;background:rgba(255,68,102,0.25);border-color:rgba(255,68,102,0.4);padding:10px">Join Solo</button>`;
          html += `<button class="nd-btn" data-action="queue-join-party" ${partyReady ? "" : "disabled"} style="color:${partyReady ? "#fff" : "#776"};background:${partyReady ? "rgba(102,196,255,0.25)" : "rgba(120,120,120,0.12)"};border-color:${partyReady ? "rgba(102,196,255,0.4)" : "rgba(120,120,120,0.3)"};padding:10px${partyReady ? "" : ";cursor:not-allowed"}" title="${esc(partyLabel)}">${esc(partyLabel)}</button>`;
          html += `</div>`;
        } else {
          html += `<div class="nd-shop-item"><button class="nd-btn" data-action="queue-join" style="width:100%;color:#fff;background:rgba(255,68,102,0.25);border-color:rgba(255,68,102,0.4);padding:10px">Join ${esc(fmt.toUpperCase())} Queue</button></div>`;
        }
      } else {
        html += `<div class="nd-shop-item" style="text-align:center">`;
        html += `<div style="color:#54f28b;font-size:11px;margin-bottom:6px">Searching for match...</div>`;
        html += `<button class="nd-btn" data-action="queue-leave" style="width:100%;color:#ffccbf;background:rgba(255,68,102,0.12);border-color:rgba(255,68,102,0.3);padding:8px;font-size:10px">Leave Queue</button>`;
        html += `</div>`;
      }
    }

    // ── Leaderboard ──
    if (this.leaderboard.length > 0) {
      html += `<div class="nd-shop-item" style="border-top:1px solid rgba(255,68,102,0.2)">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#ff4466">Top Fighters</span></div></div>`;
      for (let i = 0; i < Math.min(5, this.leaderboard.length); i++) {
        const e = this.leaderboard[i];
        const medal = i === 0 ? "#ffcc00" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#9aa7cc";
        html += `<div class="nd-shop-item">`;
        html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:${medal}">#${i + 1} ${esc(e.name ?? e.agentId)}</span><span class="nd-shop-item-slot">${e.elo} ELO</span></div>`;
        html += `<div class="nd-shop-item-stats" style="color:#54f28b">${e.wins}W <span style="color:#ff4d6d">${e.losses}L</span></div>`;
        html += `</div>`;
      }
    }

    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;
    this.footerEl.innerHTML = "";
  }

  private renderBattleViewer() {
    const b = this.viewingBattle!;
    let html = `<div class="nd-shop-item"><div class="nd-shop-item-header">`;
    html += `<button class="nd-btn" data-action="arena-back" style="font-size:10px;padding:4px 10px;color:#ff4466;border-color:rgba(255,68,102,0.3);background:rgba(255,68,102,0.1)">Back</button>`;
    html += `<span class="nd-shop-item-name" style="color:#ff4466">${esc(b.config?.format?.toUpperCase() ?? "PVP")} — ${esc(b.config?.arena?.name ?? "Arena")}</span>`;
    const statusLabel = b.status === "in_progress" ? "LIVE" : b.status?.toUpperCase().replace("_", " ") ?? "";
    html += `<span class="nd-shop-item-slot" style="color:${b.status === "in_progress" ? "#54f28b" : "#ff9944"}">${statusLabel} · Turn ${b.turnCount}</span>`;
    html += `</div></div>`;

    if (b.winner) {
      html += `<div class="nd-shop-item" style="text-align:center"><span style="color:#ffcc00;font-size:13px;font-weight:700">Winner: ${b.winner.toUpperCase()} Team</span></div>`;
    }
    if (b.mvp) {
      const mvpText = typeof b.mvp === "string"
        ? (b.mvp.length > 14 ? `${b.mvp.slice(0, 12)}…` : b.mvp)
        : `${b.mvp.name} (${b.mvp.damage} dmg)`;
      html += `<div class="nd-shop-item" style="text-align:center"><span style="color:#ffcc00;font-size:10px">MVP: ${esc(mvpText)}</span></div>`;
    }

    // Teams
    for (const [team, color, label] of [["teamRed", "#cc3333", "RED"], ["teamBlue", "#3355cc", "BLUE"]] as const) {
      const members = (b.config as any)?.[team] as Array<{ name: string; hp?: number; maxHp?: number; level?: number }> | undefined;
      if (!members) continue;
      html += `<div class="nd-shop-item" style="border-left:2px solid ${color}">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:${color}">${label} Team</span></div>`;
      for (const m of members) {
        const hpPct = m.maxHp ? Math.round((m.hp ?? 0) / m.maxHp * 100) : 0;
        const hpBar = m.maxHp ? ` <div style="height:3px;background:rgba(255,255,255,0.08);border-radius:2px;margin-top:2px"><div style="height:100%;width:${hpPct}%;background:${(m.hp ?? 0) > 0 ? "#54f28b" : "#ff4d6d"};border-radius:2px"></div></div>` : "";
        html += `<div class="nd-shop-item-stats">${esc(m.name)}${m.level ? ` Lv${m.level}` : ""}${m.maxHp ? ` — ${m.hp ?? 0}/${m.maxHp} HP` : ""}${hpBar}</div>`;
      }
      html += `</div>`;
    }

    // Combat log (last 15 entries)
    if (b.combatLog && b.combatLog.length > 0) {
      html += `<div class="nd-shop-item" style="border-top:1px solid rgba(255,68,102,0.2)">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name" style="color:#ff4466">Combat Log</span></div>`;
      const recent = b.combatLog.slice(-15);
      for (const entry of recent) {
        html += `<div class="nd-shop-item-desc" style="font-size:9px;opacity:0.8">[T${entry.turn}] ${esc(entry.description)}</div>`;
      }
      html += `</div>`;
    }

    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;
    this.footerEl.innerHTML = "";
  }

  private async loadArena() {
    if (!this.entity) return;
    const [info, lb, battles, queueData] = await Promise.all([
      fetchColiseumInfo(this.entity.id),
      fetchPvpLeaderboard(),
      fetchActiveBattles(),
      fetchQueueStatus(this.callbacks.getOwnEntityId() ?? undefined),
    ]);
    this.arenaLoading = false;
    this.arenaInfo = info;
    this.leaderboard = lb;
    this.activeBattles = battles;
    this.queueStatuses = queueData.queues;
    if (queueData.queuedFormats.length > 0) {
      this.inQueue = true;
      this.queuedFormats = queueData.queuedFormats;
      this.selectedFormat = queueData.queuedFormats[0];
      this.startMatchPolling();
    }
    this.startArenaPolling();
    if (this.activeTab === "arena") this.renderArena();
  }

  private startArenaPolling() {
    this.stopArenaPolling();
    this.arenaPollTimer = setInterval(async () => {
      if (this.activeTab !== "arena" || !this.isOpen()) { this.stopArenaPolling(); return; }
      const [battles, lb, queueData] = await Promise.all([
        fetchActiveBattles(),
        fetchPvpLeaderboard(),
        fetchQueueStatus(this.callbacks.getOwnEntityId() ?? undefined),
      ]);
      this.activeBattles = battles;
      this.leaderboard = lb;
      this.queueStatuses = queueData.queues;
      if (queueData.queuedFormats.length > 0 && !this.inQueue) {
        this.inQueue = true;
        this.queuedFormats = queueData.queuedFormats;
        this.startMatchPolling();
      } else if (queueData.queuedFormats.length === 0 && this.inQueue) {
        this.inQueue = false;
        this.queuedFormats = [];
      }
      // Refresh battle viewer if watching
      if (this.viewingBattleId) {
        const details = await fetchBattleDetails(this.viewingBattleId);
        if (details) this.viewingBattle = details;
      }
      if (this.activeTab === "arena") this.renderArena();
    }, 3000);
  }

  private startMatchPolling() {
    if (this.matchPollTimer) return;
    this.matchPollTimer = setInterval(async () => {
      const entityId = this.callbacks.getOwnEntityId();
      if (!entityId || !this.inQueue) { this.stopMatchPolling(); return; }
      const result = await fetchCurrentBattle(entityId);
      if (result?.inBattle && result.battleId) {
        this.inQueue = false;
        this.queuedFormats = [];
        this.currentBattleId = result.battleId;
        this.stopMatchPolling();
        // Auto-open battle viewer
        const details = await fetchBattleDetails(result.battleId);
        if (details) {
          this.viewingBattleId = result.battleId;
          this.viewingBattle = details;
        }
        if (this.activeTab === "arena") this.renderArena();
      }
    }, 2000);
  }

  /** Public hook so external pollers (main.ts) can drive the in-battle state. */
  setCurrentBattleId(battleId: string | null) {
    this.currentBattleId = battleId;
    if (battleId) {
      this.inQueue = false;
      this.queuedFormats = [];
    }
    if (this.activeTab === "arena" && this.isOpen()) this.renderArena();
  }

  /**
   * Open the arena tab pre-loaded onto a specific battle, without requiring
   * the player to be standing next to an Arena Master. Used by the inbox
   * match-found flow and the global PvP HUD's "view" action.
   */
  async openBattleViewer(battleId: string) {
    const synthetic: Entity = {
      id: "__battle-viewer__",
      type: "arena-master",
      name: "Arena Battle Viewer",
      x: 0,
      y: 0,
      hp: 0,
      maxHp: 0,
    };
    this.open(synthetic);
    this.activeTab = "arena";
    this.viewingBattleId = battleId;
    this.viewingBattle = null;
    this.renderContent();
    const details = await fetchBattleDetails(battleId);
    if (details && this.viewingBattleId === battleId) {
      this.viewingBattle = details;
      if (this.activeTab === "arena" && this.isOpen()) this.renderArena();
    }
  }

  private async handleForfeit(battleId: string) {
    const token = await this.callbacks.getAuthToken();
    if (!token) {
      this.callbacks.notify?.("Forfeit failed: deploy your agent first.", "error");
      return;
    }
    this.callbacks.notify?.("Forfeiting battle...", "progress");
    const result = await cancelPvpBattle(token, battleId);
    if (result.ok) {
      this.callbacks.notify?.("Battle forfeit.", "info");
      this.currentBattleId = null;
      this.viewingBattle = null;
      this.viewingBattleId = null;
      if (this.activeTab === "arena") this.renderArena();
    } else {
      this.callbacks.notify?.(`Forfeit failed: ${result.error ?? "unknown error"}`, "error");
    }
  }

  private stopMatchPolling() {
    if (this.matchPollTimer) { clearInterval(this.matchPollTimer); this.matchPollTimer = null; }
  }

  private stopArenaPolling() {
    if (this.arenaPollTimer) { clearInterval(this.arenaPollTimer); this.arenaPollTimer = null; }
    this.stopMatchPolling();
  }

  private async handleQueueJoin() {
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    const entityId = this.callbacks.getOwnEntityId();
    if (!token || !addr || !entityId) {
      this.callbacks.notify?.("Queue failed: deploy your agent first.", "error");
      return;
    }
    const info = this.callbacks.getOwnCharacterInfo?.();
    if (!info?.characterTokenId) {
      this.callbacks.notify?.(
        "Queue failed: your character isn't fully registered on-chain yet. Wait a moment and try again.",
        "error",
      );
      return;
    }
    const btn = this.contentEl.querySelector("[data-action='queue-join']") as HTMLButtonElement;
    if (btn) { btn.textContent = "Joining..."; btn.disabled = true; }
    this.callbacks.notify?.(`Joining ${this.selectedFormat.toUpperCase()} queue...`, "progress");
    const result = await joinPvpQueue(token, {
      agentId: info.agentId ?? entityId,
      walletAddress: addr,
      characterTokenId: info.characterTokenId,
      level: info.level,
      format: this.selectedFormat,
    });
    if (result.ok) {
      this.inQueue = true;
      this.queuedFormats = [this.selectedFormat];
      this.startMatchPolling();
      this.callbacks.notify?.(`Queued for ${this.selectedFormat.toUpperCase()}. Waiting for opponents…`, "success");
    } else {
      this.callbacks.notify?.(`Queue failed: ${result.error ?? "unknown error"}`, "error");
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = `Join ${this.selectedFormat.toUpperCase()} Queue`; }, 2000); return; }
    }
    if (this.activeTab === "arena") this.renderArena();
  }

  private async handleQueuePartyJoin() {
    const token = await this.callbacks.getAuthToken();
    const party = this.callbacks.getOwnParty?.() ?? null;
    if (!token) {
      this.callbacks.notify?.("Party queue failed: deploy your agent first.", "error");
      return;
    }
    if (!party) {
      this.callbacks.notify?.("Party queue failed: form a party first (/party invite <name>).", "error");
      return;
    }
    const teamSize = this.selectedFormat === "2v2" ? 2 : this.selectedFormat === "5v5" ? 5 : 0;
    if (teamSize === 0) {
      this.callbacks.notify?.(`Party queue is only available for 2v2 or 5v5.`, "error");
      return;
    }
    if (party.size < teamSize) {
      this.callbacks.notify?.(`Party queue failed: party is ${party.size}/${teamSize}.`, "error");
      return;
    }
    const btn = this.contentEl.querySelector("[data-action='queue-join-party']") as HTMLButtonElement | null;
    if (btn) { btn.textContent = "Joining…"; btn.disabled = true; }
    this.callbacks.notify?.(`Queueing party for ${this.selectedFormat.toUpperCase()}…`, "progress");
    const result = await joinPvpPartyQueue(token, { leaderId: party.leaderId, format: this.selectedFormat });
    if (result.ok) {
      this.inQueue = true;
      this.queuedFormats = [this.selectedFormat];
      this.startMatchPolling();
      this.callbacks.notify?.(`Party queued for ${this.selectedFormat.toUpperCase()}. Waiting for opponents…`, "success");
    } else {
      this.callbacks.notify?.(`Party queue failed: ${result.error ?? "unknown error"}`, "error");
    }
    if (this.activeTab === "arena") this.renderArena();
  }

  private async handleQueueLeave() {
    const token = await this.callbacks.getAuthToken();
    const entityId = this.callbacks.getOwnEntityId();
    if (!token || !entityId) return;
    const btn = this.contentEl.querySelector("[data-action='queue-leave']") as HTMLButtonElement;
    if (btn) { btn.textContent = "Leaving..."; btn.disabled = true; }
    await leavePvpQueue(token, { agentId: entityId, format: this.selectedFormat });
    this.inQueue = false;
    this.queuedFormats = [];
    this.stopMatchPolling();
    if (this.activeTab === "arena") this.renderArena();
  }

  private async handleViewBattle(battleId: string) {
    this.viewingBattleId = battleId;
    this.contentEl.innerHTML = `<div class="nd-empty">Loading battle...</div>`;
    const details = await fetchBattleDetails(battleId);
    this.viewingBattle = details;
    if (this.activeTab === "arena") this.renderArena();
  }

  private handleArenaBack() {
    this.viewingBattle = null;
    this.viewingBattleId = null;
    if (this.activeTab === "arena") this.renderArena();
  }

  // ── Professions view ──────────────────────────────────────────

  private renderProfessions() {
    if (this.professions.length === 0 && !this.professionsLoading) {
      this.professionsLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading professions...</div>`;
      void this.loadProfessions();
      return;
    }
    if (this.professionsLoading) { this.contentEl.innerHTML = `<div class="nd-empty">Loading professions...</div>`; return; }
    if (this.professions.length === 0) { this.contentEl.innerHTML = `<div class="nd-empty">No professions available</div>`; return; }

    const hasChar = !!this.callbacks.getOwnEntityId();
    let html = "";
    for (const p of this.professions) {
      html += `<div class="nd-shop-item">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(p.name)}</span></div>`;
      if (p.description) html += `<div class="nd-shop-item-desc">${esc(p.description)}</div>`;
      html += `<div class="nd-shop-item-footer">`;
      if (p.cost > 0) html += `<span class="nd-shop-item-price">${p.cost}c</span>`;
      if (hasChar) html += `<button class="nd-btn" data-action="learn-prof" data-prof-id="${esc(p.professionId)}">Learn</button>`;
      html += `</div></div>`;
    }
    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;
  }

  private async loadProfessions() {
    const data = await fetchProfessionCatalog();
    this.professionsLoading = false;
    this.professions = data;
    if (this.activeTab === "professions") this.renderProfessions();
  }

  private async handleLearnProfession(profId: string) {
    if (!this.entity) return;
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    const entityId = this.callbacks.getOwnEntityId();
    if (!token || !addr || !entityId) return;
    const btn = this.contentEl.querySelector(`[data-prof-id="${profId}"]`) as HTMLButtonElement;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const result = await learnProfession(token, { walletAddress: addr, zoneId: this.entity.zoneId ?? "", entityId, trainerId: this.entity.id, professionId: profId });
    if (result.ok) {
      if (btn) btn.textContent = "Learned!";
    } else {
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = "Learn"; }, 2000); }
    }
  }

  // ── Enchanting view ───────────────────────────────────────────

  private renderEnchanting() {
    if (this.enchantments.length === 0 && !this.enchantmentsLoading) {
      this.enchantmentsLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading enchantments...</div>`;
      void this.loadEnchantments();
      return;
    }
    if (this.enchantmentsLoading) { this.contentEl.innerHTML = `<div class="nd-empty">Loading enchantments...</div>`; return; }
    if (this.enchantments.length === 0) { this.contentEl.innerHTML = `<div class="nd-empty">No enchantments available</div>`; return; }

    const hasChar = !!this.callbacks.getOwnEntityId();
    let html = "";
    for (const e of this.enchantments) {
      const stats = Object.entries(e.statBonus || {}).map(([k, v]) => `+${v} ${k.toUpperCase()}`).join(", ");
      html += `<div class="nd-shop-item">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(e.enchantmentName)}</span><span class="nd-shop-item-slot">${esc(e.elixirName)}</span></div>`;
      if (e.description) html += `<div class="nd-shop-item-desc">${esc(e.description)}</div>`;
      if (stats) html += `<div class="nd-shop-item-stats">${stats}</div>`;
      if (e.specialEffect) html += `<div class="nd-shop-item-stats" style="color:#cc66ff">${esc(e.specialEffect)}</div>`;
      if (hasChar) {
        html += `<div class="nd-shop-item-footer"><button class="nd-btn" data-action="enchant" data-elixir-id="${esc(e.tokenId)}" style="color:#cc66ff;border-color:rgba(204,102,255,0.3);background:rgba(204,102,255,0.1)">Apply</button></div>`;
      }
      html += `</div>`;
    }
    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;
  }

  private async loadEnchantments() {
    const data = await fetchEnchantingCatalog();
    this.enchantmentsLoading = false;
    this.enchantments = data;
    if (this.activeTab === "enchanting") this.renderEnchanting();
  }

  private async handleEnchant(elixirId: string) {
    if (!this.entity) return;
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    const entityId = this.callbacks.getOwnEntityId();
    if (!token || !addr || !entityId) return;
    const btn = this.contentEl.querySelector(`[data-elixir-id="${elixirId}"]`) as HTMLButtonElement;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    // Default to weapon slot — TODO: let user pick slot
    const result = await applyEnchantment(token, { walletAddress: addr, zoneId: this.entity.zoneId ?? "", entityId, altarId: this.entity.id, enchantmentElixirTokenId: elixirId, equipmentSlot: "weapon" });
    if (result.ok) {
      if (btn) btn.textContent = "Enchanted!";
    } else {
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = "Apply"; }, 2000); }
    }
  }

  /** Open the dialog with pre-seeded quest dialogue (for talk/complete quests). */
  openWithQuestDialogue(entity: Entity, questTitle: string, questDesc: string, objectiveType?: string) {
    this.open(entity);
    this.activeTab = "dialog";
    this.tabBar.querySelectorAll(".nd-tab").forEach((b) =>
      b.classList.toggle("active", (b as HTMLElement).dataset.tab === "dialog"));

    const npcName = entity.name;
    if (objectiveType === "talk") {
      // Talk quest — player greets, NPC delivers the quest narrative
      this.chatHistory = [
        { role: "player", content: `Hey ${npcName}, you wanted to talk to me?` },
        { role: "npc", content: questDesc },
        { role: "player", content: `Got it. I'll keep that in mind.` },
        { role: "npc", content: `Thank you for hearing me out, adventurer. Your help means everything.` },
      ];
    } else {
      // Kill/gather/craft quest turn-in — player reports back
      const verbMap: Record<string, string> = {
        kill: "took care of",
        gather: "gathered everything for",
        craft: "finished crafting what you needed for",
      };
      const verb = verbMap[objectiveType ?? ""] ?? "finished";
      this.chatHistory = [
        { role: "player", content: `Hey ${npcName}, I ${verb} "${questTitle}".` },
        { role: "npc", content: `Impressive work, adventurer! "${questTitle}" was no easy task.` },
        { role: "player", content: `It was nothing. What's my reward?` },
        { role: "npc", content: `Here — you've more than earned it. The realm thanks you.` },
      ];
    }

    this.renderContent();
  }

  // ── Quests view ────────────────────────────────────────────────

  private renderQuests() {
    this.contentEl.innerHTML = `<div class="nd-empty">Quest log opened in side panel.</div>`;
    this.callbacks.onShowQuests();
  }

  // ── Styles ─────────────────────────────────────────────────────

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .nd-container {
        width: 440px;
        max-height: 70vh;
        background: rgba(10, 16, 28, 0.95);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 10px;
        backdrop-filter: blur(8px);
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        pointer-events: auto;
        overflow: hidden;
      }

      .nd-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .nd-header-left { display: flex; flex-direction: column; gap: 2px; }
      .nd-npc-name { font-size: 15px; font-weight: bold; }
      .nd-npc-type { font-size: 11px; color: #667; text-transform: capitalize; }
      .nd-close {
        background: none; border: none; color: #667; font-size: 22px;
        cursor: pointer; padding: 0 4px; line-height: 1;
      }
      .nd-close:hover { color: #ccc; }

      .nd-tabs {
        display: flex;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .nd-tab {
        flex: 1;
        padding: 7px 0;
        background: none;
        border: none;
        color: #556;
        font: bold 12px monospace;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: color 0.15s;
      }
      .nd-tab:hover { color: #99a; }
      .nd-tab.active { color: var(--accent, #66bbff); border-bottom-color: var(--accent, #66bbff); }

      .nd-content {
        flex: 1;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.1) transparent;
        min-height: 200px;
        max-height: calc(70vh - 160px);
      }

      .nd-footer {
        border-top: 1px solid rgba(255,255,255,0.08);
        min-height: 0;
      }
      .nd-footer:empty { display: none; }
      .nd-footer-text { padding: 8px 16px; font-size: 11px; color: #667; text-align: center; }

      .nd-empty { padding: 30px; text-align: center; color: #556; }

      /* ── Dialog view ── */
      .nd-chat-messages {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 16px;
        overflow-y: auto;
        max-height: calc(70vh - 200px);
      }
      .nd-msg { padding: 6px 0; }
      .nd-msg-npc {
        border-left: 2px solid #66bbff;
        padding-left: 10px;
      }
      .nd-msg-player {
        border-left: 2px solid #efc97f;
        padding-left: 10px;
      }
      .nd-msg-name { display: block; font-size: 10px; font-weight: bold; margin-bottom: 2px; }
      .nd-msg-text { display: block; font-size: 12px; color: #dde; line-height: 1.5; }

      .nd-chat-input-row {
        display: flex;
        gap: 6px;
        padding: 8px 12px;
      }
      .nd-chat-input {
        flex: 1;
        padding: 6px 10px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 4px;
        color: #dde;
        font: 12px monospace;
        outline: none;
      }
      .nd-chat-input:focus { border-color: rgba(255,255,255,0.25); }
      .nd-chat-send {
        padding: 6px 14px;
        background: rgba(102,187,255,0.12);
        border: 1px solid rgba(102,187,255,0.3);
        border-radius: 4px;
        color: #66bbff;
        font: bold 11px monospace;
        cursor: pointer;
      }
      .nd-chat-send:hover { background: rgba(102,187,255,0.25); }

      /* ── Shop / list views ── */
      .nd-shop-grid {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .nd-shop-item {
        padding: 10px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .nd-shop-item:last-child { border-bottom: none; }
      .nd-shop-item-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 2px;
      }
      .nd-shop-item-name { color: #dde; font-weight: bold; }
      .nd-shop-item-slot { color: #667; font-size: 10px; }
      .nd-shop-item-desc { color: #778; font-size: 11px; margin-bottom: 3px; }
      .nd-shop-item-stats { color: #4c4; font-size: 11px; margin-bottom: 4px; }
      .nd-shop-item-footer {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .nd-shop-item-price { color: #ffcc00; font-weight: bold; font-size: 12px; }
      .nd-shop-item-stock { color: #667; font-size: 10px; }

      .nd-btn {
        margin-left: auto;
        padding: 3px 10px;
        background: rgba(255,204,0,0.1);
        border: 1px solid rgba(255,204,0,0.3);
        border-radius: 4px;
        color: #ffcc00;
        font: bold 11px monospace;
        cursor: pointer;
      }
      .nd-btn:hover { background: rgba(255,204,0,0.2); }
      .nd-btn:disabled { opacity: 0.5; cursor: inherit; }

      @media (max-width: 640px) {
        .nd-container {
          width: calc(100vw - 16px);
          max-width: 100%;
          max-height: calc(100vh - 16px);
        }
      }
    `;
    document.head.appendChild(style);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function formatAuctionTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s <= 0) return "ended";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r > 0 ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
}
