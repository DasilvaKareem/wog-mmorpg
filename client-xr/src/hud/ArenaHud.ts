import type { BattleDetails } from "../api.js";

interface ArenaHudCallbacks {
  onForfeit: (battleId: string) => void | Promise<void>;
  onOpenViewer: (battleId: string) => void;
}

interface BattleHudState {
  battleId: string;
  team: "red" | "blue" | null;
  details: BattleDetails;
}

export class ArenaHud {
  private readonly root: HTMLDivElement;
  private readonly callbacks: ArenaHudCallbacks;
  private state: BattleHudState | null = null;
  private busy = false;

  constructor(callbacks: ArenaHudCallbacks) {
    this.callbacks = callbacks;
    this.root = document.createElement("div");
    this.root.id = "arena-hud";
    this.root.style.display = "none";
    this.root.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-arena-action]");
      if (!btn || !this.state) return;
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.arenaAction;
      if (action === "view") this.callbacks.onOpenViewer(this.state.battleId);
      else if (action === "forfeit") void this.handleForfeit();
    });
    document.body.appendChild(this.root);
    this.injectStyles();
  }

  /** Set or refresh the active battle the local player is participating in. */
  setBattle(battleId: string, details: BattleDetails, ownEntityId: string | null) {
    const team = this.resolveOwnTeam(details, ownEntityId);
    this.state = { battleId, team, details };
    this.busy = false;
    this.render();
  }

  /** Update details without changing battleId. */
  updateDetails(details: BattleDetails, ownEntityId: string | null) {
    if (!this.state) return;
    if (details.battleId !== this.state.battleId) return;
    const team = this.resolveOwnTeam(details, ownEntityId) ?? this.state.team;
    this.state = { ...this.state, details, team };
    this.render();
  }

  clear() {
    if (!this.state) return;
    this.state = null;
    this.busy = false;
    this.root.style.display = "none";
    this.root.innerHTML = "";
  }

  hasBattle(): boolean {
    return this.state !== null;
  }

  currentBattleId(): string | null {
    return this.state?.battleId ?? null;
  }

  private async handleForfeit() {
    if (!this.state || this.busy) return;
    if (!window.confirm("Forfeit this match? This currently cancels the match for both sides.")) return;
    this.busy = true;
    this.render();
    try {
      await this.callbacks.onForfeit(this.state.battleId);
    } finally {
      this.busy = false;
      if (this.state) this.render();
    }
  }

  /**
   * Best-effort team resolution. The shard battle payload doesn't expose
   * entity ids on combatants, so we fall back to wallet/name matching when
   * available. If we can't infer team, the HUD just hides the colored badge.
   */
  private resolveOwnTeam(details: BattleDetails, ownEntityId: string | null): "red" | "blue" | null {
    if (!ownEntityId) return null;
    const red = (details.config as any)?.teamRed as Array<{ id?: string; entityId?: string; agentId?: string }> | undefined;
    const blue = (details.config as any)?.teamBlue as Array<{ id?: string; entityId?: string; agentId?: string }> | undefined;
    const matches = (arr: Array<{ id?: string; entityId?: string; agentId?: string }> | undefined) =>
      !!arr?.some((m) => m.id === ownEntityId || m.entityId === ownEntityId || m.agentId === ownEntityId);
    if (matches(red)) return "red";
    if (matches(blue)) return "blue";
    return null;
  }

  private render() {
    if (!this.state) return;
    const { battleId, team, details } = this.state;
    const teamColor = team === "red" ? "#cc3333" : team === "blue" ? "#3355cc" : "#888";
    const teamLabel = team ? team.toUpperCase() : "—";
    const arenaName = details.config?.arena?.name ?? "Arena";
    const fmt = details.config?.format?.toUpperCase() ?? "PVP";
    const status = details.status === "in_progress"
      ? "LIVE"
      : details.status?.toUpperCase().replace("_", " ") ?? "";
    const statusColor = details.status === "in_progress" ? "#54f28b" : details.status === "betting" ? "#ffcc00" : "#ff9944";

    const allies = details.config?.[team === "blue" ? "teamBlue" : "teamRed"] as Array<{ name: string; hp: number; maxHp: number }> | undefined;
    const enemies = details.config?.[team === "blue" ? "teamRed" : "teamBlue"] as Array<{ name: string; hp: number; maxHp: number }> | undefined;
    const aliveCount = (arr: Array<{ hp: number }> | undefined) => arr?.filter((m) => (m.hp ?? 0) > 0).length ?? 0;

    let html = "";
    html += `<div class="ah-header">`;
    html += `<span class="ah-title">${esc(fmt)} · ${esc(arenaName)}</span>`;
    html += `<span class="ah-status" style="color:${statusColor}">${esc(status)} · T${details.turnCount ?? 0}</span>`;
    html += `</div>`;

    if (team) {
      html += `<div class="ah-team-row"><span class="ah-team-chip" style="background:${teamColor}">${esc(teamLabel)}</span>`;
      html += `<span class="ah-team-count">Allies ${aliveCount(allies)}/${allies?.length ?? 0}</span>`;
      html += `<span class="ah-team-count">vs Foes ${aliveCount(enemies)}/${enemies?.length ?? 0}</span></div>`;
    }

    if (details.winner) {
      html += `<div class="ah-winner">Winner: ${details.winner.toUpperCase()}</div>`;
    }

    html += `<div class="ah-actions">`;
    html += `<button class="ah-btn" data-arena-action="view">View battle</button>`;
    html += `<button class="ah-btn ah-btn-warn" data-arena-action="forfeit" ${this.busy ? "disabled" : ""}>${this.busy ? "…" : "Forfeit"}</button>`;
    html += `</div>`;
    html += `<div class="ah-footnote">Match id ${this.short(battleId)}</div>`;

    this.root.innerHTML = html;
    this.root.style.display = "";
  }

  private short(id: string): string {
    if (id.length <= 14) return id;
    return `${id.slice(0, 6)}…${id.slice(-4)}`;
  }

  private injectStyles() {
    const existing = document.getElementById("arena-hud-styles");
    if (existing) return;
    const s = document.createElement("style");
    s.id = "arena-hud-styles";
    s.textContent = `
      #arena-hud {
        position: fixed;
        top: 12px;
        right: 12px;
        width: 240px;
        z-index: 19;
        font: 11px monospace;
        color: #ffd6cc;
        background: rgba(28, 8, 16, 0.92);
        border: 1px solid rgba(255, 68, 102, 0.4);
        border-radius: 8px;
        padding: 8px 10px;
        backdrop-filter: blur(6px);
      }
      #arena-hud .ah-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 6px;
      }
      #arena-hud .ah-title {
        font-weight: bold;
        color: #ff8aa0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 150px;
      }
      #arena-hud .ah-status {
        font-size: 10px;
        letter-spacing: 0.05em;
      }
      #arena-hud .ah-team-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
      }
      #arena-hud .ah-team-chip {
        font-size: 10px;
        font-weight: bold;
        color: #fff;
        padding: 2px 6px;
        border-radius: 999px;
        letter-spacing: 0.08em;
      }
      #arena-hud .ah-team-count {
        font-size: 10px;
        color: rgba(255, 214, 204, 0.75);
      }
      #arena-hud .ah-winner {
        font-size: 10px;
        color: #ffcc00;
        text-align: center;
        margin-bottom: 4px;
      }
      #arena-hud .ah-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-top: 4px;
      }
      #arena-hud .ah-btn {
        font: 10px monospace;
        color: #fff;
        background: rgba(255, 68, 102, 0.2);
        border: 1px solid rgba(255, 68, 102, 0.4);
        border-radius: 4px;
        padding: 5px 6px;
        cursor: pointer;
      }
      #arena-hud .ah-btn:hover {
        background: rgba(255, 68, 102, 0.35);
      }
      #arena-hud .ah-btn:disabled {
        cursor: wait;
        opacity: 0.6;
      }
      #arena-hud .ah-btn-warn {
        color: #ffdcd0;
        background: rgba(255, 136, 102, 0.15);
        border-color: rgba(255, 136, 102, 0.4);
      }
      #arena-hud .ah-btn-warn:hover {
        background: rgba(255, 136, 102, 0.3);
      }
      #arena-hud .ah-footnote {
        margin-top: 6px;
        font-size: 9px;
        color: rgba(255, 214, 204, 0.55);
        text-align: center;
      }
    `;
    document.head.appendChild(s);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
