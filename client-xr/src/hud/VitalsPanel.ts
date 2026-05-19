import type { Entity } from "../types.js";

interface PartyMember {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  essence: number;
  maxEssence: number;
  level: number;
}

export class VitalsPanel {
  private readonly root: HTMLDivElement;
  private lastHtml = "";
  private onLeaveParty?: () => void;

  constructor(callbacks?: { onLeaveParty?: () => void }) {
    this.onLeaveParty = callbacks?.onLeaveParty;
    this.root = document.createElement("div");
    this.root.id = "vitals-panel";
    document.body.appendChild(this.root);
    this.root.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).dataset.action === "leave-party") {
        this.onLeaveParty?.();
      }
    });
    this.injectStyles();
  }

  private partyMembers: PartyMember[] = [];

  /** Called from the party-status poll (cross-zone, authoritative). */
  setPartyMembers(members: PartyMember[]) {
    this.partyMembers = members;
  }

  /** Call every poll tick with the player entity + all zone entities. */
  update(own: Entity | null | undefined, allEntities: Record<string, Entity>) {
    if (!own) {
      if (this.root.style.display !== "none") this.root.style.display = "none";
      return;
    }
    if (this.root.style.display === "none") this.root.style.display = "";

    // Prefer cross-zone party data; fall back to zone-entity scan
    let party: PartyMember[] = this.partyMembers.filter((m) => m.id !== own.id);
    if (party.length === 0 && own.partyId) {
      for (const ent of Object.values(allEntities)) {
        if (ent.id !== own.id && ent.partyId === own.partyId && ent.type === "player") {
          party.push({
            id: ent.id,
            name: ent.name,
            hp: ent.hp,
            maxHp: ent.maxHp,
            essence: ent.essence ?? 0,
            maxEssence: ent.maxEssence ?? 0,
            level: ent.level ?? 1,
          });
        }
      }
    }

    const html = this.buildHtml(own, party);
    if (html !== this.lastHtml) {
      this.root.innerHTML = html;
      this.lastHtml = html;
    }
  }

  private buildHtml(own: Entity, party: PartyMember[]): string {
    const level = own.level ?? 1;
    const totalXp = own.xp ?? 0;
    const floor = this.xpForLevel(level);
    const ceiling = this.xpForLevel(level + 1);
    const xpInLevel = Math.max(0, totalXp - floor);
    const xpSpan = Math.max(0, ceiling - floor);
    let out = this.buildFrame(
      own.name,
      level,
      own.hp, own.maxHp,
      own.essence ?? 0, own.maxEssence ?? 0,
      xpInLevel, xpSpan,
      true,
    );

    if (own.partyId) {
      out += `<div class="vp-party-label">Party <button class="vp-leave-btn" data-action="leave-party">Leave</button></div>`;
      for (const m of party) {
        out += this.buildFrame(m.name, m.level, m.hp, m.maxHp, m.essence, m.maxEssence, -1, -1, false);
      }
      if (party.length === 0) {
        out += `<div class="vp-party-solo">Waiting for members…</div>`;
      }
    }
    return out;
  }

  private buildFrame(
    name: string, level: number,
    hp: number, maxHp: number,
    ep: number, maxEp: number,
    xp: number, xpToNext: number,
    showXp: boolean,
  ): string {
    const hpPct = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;
    const epPct = maxEp > 0 ? Math.round((ep / maxEp) * 100) : 0;
    const hpColor = hpPct > 50 ? "#44cc44" : hpPct > 25 ? "#cccc44" : "#cc4444";
    const isPartyMember = !showXp;

    let html = `<div class="vp-frame${isPartyMember ? " vp-party" : ""}">`;
    html += `<div class="vp-header"><span class="vp-name">${name}</span><span class="vp-lvl">Lv ${level}</span></div>`;

    // HP bar
    html += `<div class="vp-bar-row">`;
    html += `<span class="vp-bar-label">HP</span>`;
    html += `<div class="vp-bar"><div class="vp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>`;
    html += `<span class="vp-bar-val">${hp}/${maxHp}</span>`;
    html += `</div>`;

    // EP bar
    if (maxEp > 0) {
      html += `<div class="vp-bar-row">`;
      html += `<span class="vp-bar-label">EP</span>`;
      html += `<div class="vp-bar"><div class="vp-fill vp-ep" style="width:${epPct}%"></div></div>`;
      html += `<span class="vp-bar-val">${ep}/${maxEp}</span>`;
      html += `</div>`;
    }

    // XP bar (player only)
    if (showXp && xpToNext > 0) {
      const xpPct = Math.min(100, Math.round((xp / xpToNext) * 100));
      html += `<div class="vp-bar-row">`;
      html += `<span class="vp-bar-label">XP</span>`;
      html += `<div class="vp-bar"><div class="vp-fill vp-xp" style="width:${xpPct}%"></div></div>`;
      html += `<span class="vp-bar-val">${xp}/${xpToNext}</span>`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  /** Cumulative XP required to reach a given level. Mirrors shard/leveling.ts. */
  private xpForLevel(level: number): number {
    if (level <= 1) return 0;
    return 100 * level * level;
  }

  private injectStyles() {
    const s = document.createElement("style");
    s.textContent = `
      #vitals-panel {
        position: fixed;
        top: 12px;
        left: 12px;
        width: 220px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        z-index: 18;
        pointer-events: none;
        font: 11px monospace;
        color: #f3dfb3;
      }
      .vp-frame {
        background: rgba(20, 14, 8, 0.88);
        border: 1px solid rgba(255, 214, 102, 0.32);
        border-radius: 8px;
        padding: 8px 10px 6px;
        backdrop-filter: blur(6px);
      }
      .vp-frame.vp-party {
        padding: 5px 10px 4px;
      }
      .vp-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 5px;
      }
      .vp-name {
        font-weight: bold;
        font-size: 12px;
        color: #ffe8a8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 140px;
      }
      .vp-lvl {
        font-size: 10px;
        color: rgba(255, 240, 207, 0.7);
        letter-spacing: 0.05em;
      }
      .vp-bar-row {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-bottom: 3px;
      }
      .vp-bar-label {
        width: 18px;
        font-size: 9px;
        color: rgba(255, 240, 207, 0.6);
        text-align: right;
        flex-shrink: 0;
      }
      .vp-bar {
        flex: 1;
        height: 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
      }
      .vp-frame.vp-party .vp-bar { height: 6px; }
      .vp-fill {
        height: 100%;
        border-radius: inherit;
        transition: width 0.15s linear;
        min-width: 0;
      }
      .vp-ep {
        background: linear-gradient(90deg, #5ca8ff 0%, #a47cff 100%);
      }
      .vp-xp {
        background: linear-gradient(90deg, #ffe16b 0%, #ff9f4a 100%);
      }
      .vp-bar-val {
        font-size: 9px;
        color: rgba(255, 240, 207, 0.65);
        min-width: 50px;
        text-align: right;
        flex-shrink: 0;
      }
      .vp-party-label {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: rgba(92, 168, 255, 0.7);
        margin-top: 2px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        pointer-events: auto;
      }
      .vp-leave-btn {
        pointer-events: auto;
        background: rgba(200,60,60,0.25);
        border: 1px solid rgba(200,60,60,0.6);
        color: #ff8888;
        font: 8px monospace;
        padding: 1px 5px;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .vp-leave-btn:hover { background: rgba(200,60,60,0.45); }
      .vp-party-solo {
        font-size: 9px;
        color: rgba(180,180,180,0.5);
        font-style: italic;
      }
      @media (max-width: 480px) {
        #vitals-panel {
          width: 180px;
        }
      }
    `;
    document.head.appendChild(s);
  }
}
