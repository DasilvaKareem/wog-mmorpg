import type {
  Entity, NpcDialogueMessage, ShopItem, TechniqueInfo,
  CraftingRecipe, GuildSummary, AuctionListing,
  ProfessionEntry, EnchantmentEntry, ArenaInfo, PvpLeaderboardEntry,
} from "../types.js";
import {
  fetchShopInventory, buyShopItem, sendNpcDialogue,
  fetchAvailableTechniques, learnTechnique,
  fetchRecipes, craftAtStation,
  fetchGuilds, createGuild,
  fetchAuctions, bidAuction, buyoutAuction,
  fetchColiseumInfo, joinPvpQueue, fetchPvpLeaderboard,
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
  onShowQuests: () => void;
}

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
  // Auctions
  private auctions: AuctionListing[] = [];
  private auctionsLoading = false;
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
      if (action === "bid" && btn.dataset.auctionId) void this.handleBid(btn.dataset.auctionId);
      if (action === "buyout" && btn.dataset.auctionId) void this.handleBuyout(btn.dataset.auctionId);
      if (action === "queue-join") void this.handleQueueJoin();
      if (action === "queue-leave") void this.handleQueueLeave();
      if (action === "select-format" && btn.dataset.format) { this.selectedFormat = btn.dataset.format; if (this.activeTab === "arena") this.renderArena(); }
      if (action === "view-battle" && btn.dataset.battleId) void this.handleViewBattle(btn.dataset.battleId);
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
        html += `<div class="nd-shop-item">`;
        html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(g.name)}</span><span class="nd-shop-item-slot">Lvl ${g.level}</span></div>`;
        html += `<div class="nd-shop-item-stats">${g.memberCount} members · ${g.treasury}g treasury</div>`;
        html += `<div class="nd-shop-item-footer"><span class="nd-shop-item-stock">${g.status}</span></div>`;
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
      setTimeout(() => this.renderGuild(), 1500);
    } else {
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = "Create"; }, 2000); }
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
    if (this.auctionsLoading) { this.contentEl.innerHTML = `<div class="nd-empty">Loading auctions...</div>`; return; }
    if (this.auctions.length === 0) { this.contentEl.innerHTML = `<div class="nd-empty">No active auctions</div>`; return; }

    let html = "";
    const hasChar = !!this.callbacks.getOwnEntityId();
    for (const a of this.auctions) {
      const timeLeft = Math.max(0, Math.floor(a.timeRemaining / 60));
      html += `<div class="nd-shop-item">`;
      html += `<div class="nd-shop-item-header"><span class="nd-shop-item-name">${esc(a.itemName)}</span><span class="nd-shop-item-slot">x${a.quantity}</span></div>`;
      html += `<div class="nd-shop-item-stats">`;
      html += `Bid: ${a.highBid || a.startPrice}g`;
      if (a.buyoutPrice) html += ` · Buyout: ${a.buyoutPrice}g`;
      html += ` · ${timeLeft}m left`;
      html += `</div>`;
      if (hasChar) {
        html += `<div class="nd-shop-item-footer">`;
        html += `<button class="nd-btn" data-action="bid" data-auction-id="${esc(a.auctionId)}">Bid</button>`;
        if (a.buyoutPrice) html += `<button class="nd-btn" data-action="buyout" data-auction-id="${esc(a.auctionId)}">Buyout</button>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
    this.contentEl.innerHTML = `<div class="nd-shop-grid">${html}</div>`;
  }

  private async loadAuctions() {
    const zoneId = this.entity?.zoneId ?? "village-square";
    const data = await fetchAuctions(zoneId);
    this.auctionsLoading = false;
    this.auctions = data;
    if (this.activeTab === "auctions") this.renderAuctions();
  }

  private async handleBid(auctionId: string) {
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;
    const auction = this.auctions.find(a => a.auctionId === auctionId);
    if (!auction) return;
    const bidAmount = (auction.highBid || auction.startPrice) + 1;
    const btn = this.contentEl.querySelector(`[data-action="bid"][data-auction-id="${auctionId}"]`) as HTMLButtonElement;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const zoneId = this.entity?.zoneId ?? "village-square";
    const result = await bidAuction(token, zoneId, { auctionId, bidderAddress: addr, bidAmount });
    if (result.ok) {
      auction.highBid = bidAmount;
      if (btn) btn.textContent = `Bid ${bidAmount}g!`;
      setTimeout(() => this.renderAuctions(), 1500);
    } else {
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = "Bid"; }, 2000); }
    }
  }

  private async handleBuyout(auctionId: string) {
    const token = await this.callbacks.getAuthToken();
    const addr = this.callbacks.getOwnWalletAddress();
    if (!token || !addr) return;
    const btn = this.contentEl.querySelector(`[data-action="buyout"][data-auction-id="${auctionId}"]`) as HTMLButtonElement;
    if (btn) { btn.textContent = "..."; btn.disabled = true; }
    const zoneId = this.entity?.zoneId ?? "village-square";
    const result = await buyoutAuction(token, zoneId, { auctionId, buyerAddress: addr });
    if (result.ok) {
      this.auctions = this.auctions.filter(a => a.auctionId !== auctionId);
      setTimeout(() => this.renderAuctions(), 500);
    } else {
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = "Buyout"; }, 2000); }
    }
  }

  // ── Arena view ────────────────────────────────────────────────

  private renderArena() {
    if (this.arenaLoading) { this.contentEl.innerHTML = `<div class="nd-empty">Loading arena...</div>`; return; }
    if (!this.arenaInfo && !this.arenaLoading) {
      this.arenaLoading = true;
      this.contentEl.innerHTML = `<div class="nd-empty">Loading arena...</div>`;
      void this.loadArena();
      return;
    }

    // Battle viewer mode
    if (this.viewingBattle) {
      this.renderBattleViewer();
      return;
    }

    const hasChar = !!this.callbacks.getOwnEntityId();
    let html = "";

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
        html += `<div class="nd-shop-item"><button class="nd-btn" data-action="queue-join" style="width:100%;color:#fff;background:rgba(255,68,102,0.25);border-color:rgba(255,68,102,0.4);padding:10px">Join ${esc(this.selectedFormat.toUpperCase())} Queue</button></div>`;
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
      html += `<div class="nd-shop-item" style="text-align:center"><span style="color:#ffcc00;font-size:10px">MVP: ${esc(b.mvp.name)} (${b.mvp.damage} dmg)</span></div>`;
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
    if (!token || !addr || !entityId) return;
    const btn = this.contentEl.querySelector("[data-action='queue-join']") as HTMLButtonElement;
    if (btn) { btn.textContent = "Joining..."; btn.disabled = true; }
    const result = await joinPvpQueue(token, { agentId: entityId, walletAddress: addr, level: 1, format: this.selectedFormat });
    if (result.ok) {
      this.inQueue = true;
      this.queuedFormats = [this.selectedFormat];
      this.startMatchPolling();
    } else {
      if (btn) { btn.textContent = result.error ?? "Failed"; btn.disabled = false; setTimeout(() => { btn.textContent = `Join ${this.selectedFormat.toUpperCase()} Queue`; }, 2000); return; }
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
