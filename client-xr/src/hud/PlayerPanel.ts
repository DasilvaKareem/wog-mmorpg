import type { Entity } from "../types.js";

type SortBy = "level" | "name" | "hp";

interface PanelCallbacks {
  onPlayerClick: (entityId: string) => void;
  onZoneClick: (zoneId: string) => void;
}

/**
 * Side panel listing players/entities grouped by zone.
 * Click a player to lock camera on them. Click a zone to navigate there.
 */
export class PlayerPanel {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private activeTab: "lobby" | "ranks" = "lobby";
  private sortBy: SortBy = "level";
  private entities: Record<string, Entity> = {};
  private zoneEntities: Map<string, Entity[]> = new Map();
  private callbacks: PanelCallbacks;
  private visible = true;
  private toggleBtn: HTMLButtonElement;

  constructor(callbacks: PanelCallbacks) {
    this.callbacks = callbacks;

    // Toggle button
    this.toggleBtn = document.createElement("button");
    this.toggleBtn.id = "panel-toggle";
    this.toggleBtn.textContent = "Hide Players";
    this.toggleBtn.addEventListener("click", () => this.toggle());
    document.body.appendChild(this.toggleBtn);

    // Main container
    this.container = document.createElement("div");
    this.container.id = "player-panel";

    // Tab bar
    this.tabBar = document.createElement("div");
    this.tabBar.className = "pp-tabs";
    this.tabBar.innerHTML = `
      <button class="pp-tab active" data-tab="lobby">Lobby</button>
      <button class="pp-tab" data-tab="ranks">Ranks</button>
    `;
    this.tabBar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".pp-tab") as HTMLButtonElement;
      if (!btn) return;
      const tab = btn.dataset.tab as "lobby" | "ranks";
      this.activeTab = tab;
      this.tabBar.querySelectorAll(".pp-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
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

    document.body.appendChild(this.container);
    this.injectStyles();
  }

  toggle() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? "flex" : "none";
    this.toggleBtn.textContent = this.visible ? "Hide Players" : "Show Players";
    this.toggleBtn.classList.toggle("collapsed", !this.visible);
  }

  /** Call every poll with merged entity data */
  update(allEntities: Record<string, Entity>) {
    this.entities = allEntities;

    // Group by zone
    this.zoneEntities.clear();
    for (const ent of Object.values(allEntities)) {
      const zone = ent.zoneId ?? "unknown";
      if (!this.zoneEntities.has(zone)) this.zoneEntities.set(zone, []);
      this.zoneEntities.get(zone)!.push(ent);
    }

    this.render();
  }

  private render() {
    const sortBar = this.container.querySelector("#pp-sort-bar") as HTMLElement;
    sortBar.style.display = this.activeTab === "ranks" ? "flex" : "none";

    if (this.activeTab === "lobby") {
      this.renderLobby();
    } else {
      this.renderRanks();
    }
  }

  private renderLobby() {
    let html = "";

    // Sort zones by player count desc
    const zones = Array.from(this.zoneEntities.entries())
      .sort((a, b) => {
        const aPlayers = a[1].filter((e) => e.type === "player").length;
        const bPlayers = b[1].filter((e) => e.type === "player").length;
        return bPlayers - aPlayers;
      });

    for (const [zoneId, ents] of zones) {
      const players = ents.filter((e) => e.type === "player" || e.type === "npc")
        .sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
      const mobs = ents.filter((e) => e.type === "mob" || e.type === "boss");
      const label = zoneId.replace(/-/g, " ");

      html += `<div class="pp-zone">`;
      html += `<div class="pp-zone-header" data-zone="${zoneId}">`;
      html += `<span class="pp-zone-name">${label}</span>`;
      html += `<span class="pp-zone-count">${players.length}P / ${mobs.length}M</span>`;
      html += `</div>`;

      for (const ent of players) {
        const lvl = ent.level ?? 1;
        const hpPct = ent.maxHp > 0 ? Math.round((ent.hp / ent.maxHp) * 100) : 100;
        const typeIcon = ent.type === "player" ? "&#9679;" : "&#9670;";
        const typeColor = ent.type === "player" ? "#44ddff" : "#ffcc44";
        const cls = ent.classId ? ` [${ent.classId}]` : "";
        html += `<div class="pp-row" data-eid="${ent.id}">`;
        html += `<span class="pp-icon" style="color:${typeColor}">${typeIcon}</span>`;
        html += `<span class="pp-name">${ent.name}${cls}</span>`;
        html += `<span class="pp-lvl">Lv${lvl}</span>`;
        html += `<span class="pp-hp" style="color:${hpPct > 50 ? "#4c4" : hpPct > 25 ? "#cc4" : "#c44"}">${hpPct}%</span>`;
        html += `</div>`;
      }

      html += `</div>`;
    }

    if (!html) html = `<div class="pp-empty">No entities nearby</div>`;
    this.listEl.innerHTML = html;
  }

  private renderRanks() {
    // Collect all players/NPCs
    let ranked = Object.values(this.entities)
      .filter((e) => e.type === "player" || e.type === "npc");

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

    if (!html) html = `<div class="pp-empty">No players nearby</div>`;
    this.listEl.innerHTML = html;
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #panel-toggle {
        position: fixed;
        top: 12px;
        left: 180px;
        z-index: 20;
        padding: 6px 14px;
        background: rgba(20, 30, 50, 0.85);
        border: 1px solid #4f8;
        border-radius: 6px;
        color: #4f8;
        font: bold 12px monospace;
        cursor: pointer;
      }
      #panel-toggle:hover { background: rgba(30, 50, 70, 0.95); }
      #panel-toggle.collapsed { opacity: 0.6; }

      #player-panel {
        position: fixed;
        top: 44px;
        left: 12px;
        width: 260px;
        max-height: calc(100vh - 60px);
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
        justify-content: space-between;
        padding: 6px 10px;
        background: rgba(30, 50, 70, 0.5);
        cursor: pointer;
        user-select: none;
      }
      .pp-zone-header:hover { background: rgba(40, 70, 90, 0.7); }
      .pp-zone-name { color: #8bf; font-weight: bold; text-transform: capitalize; }
      .pp-zone-count { color: #667; font-size: 11px; }

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

      .pp-empty { padding: 20px; text-align: center; color: #556; }
    `;
    document.head.appendChild(style);

    // Delegate click events
    this.listEl.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest(".pp-row") as HTMLElement;
      if (row?.dataset.eid) {
        this.callbacks.onPlayerClick(row.dataset.eid);
        return;
      }
      const zone = (e.target as HTMLElement).closest(".pp-zone-header") as HTMLElement;
      if (zone?.dataset.zone) {
        this.callbacks.onZoneClick(zone.dataset.zone);
      }
    });
  }
}
