import { CANDIDATE_BASES, toUrl } from "../api.js";
import { playSoundEffect } from "../sfx.js";

interface NormalizedRecipe {
  recipeId: string;
  name: string;
  outputName: string;
  outputQuantity: number;
  materials: { name: string; quantity: number }[];
  requiredSkillLevel: number;
  timeMs?: number;
  copperCost?: number;
  hpRestoration?: number;
}

interface NormalizedGatherable {
  name: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  requiredSkillLevel: number;
  requiredToolTier?: number;
  toolName?: string;
  maxCharges?: number;
}

interface ShowOpts {
  profId: string;
  profName: string;
  profIcon: string;
  skillLevel: number;
  learned: boolean;
  onCraft?: (recipeId: string) => Promise<{ ok: boolean; message: string }>;
}

const RECIPE_ENDPOINT: Record<string, string | null> = {
  mining: null,
  herbalism: null,
  skinning: null,
  blacksmithing: "/crafting/recipes/blacksmithing",
  alchemy: "/alchemy/recipes",
  cooking: "/cooking/recipes",
  leatherworking: "/leatherworking/recipes",
  jewelcrafting: "/jewelcrafting/recipes",
};

const CATALOG_ENDPOINT: Record<string, string> = {
  mining: "/mining/catalog",
  herbalism: "/herbalism/catalog",
};

const GATHER_TOOL: Record<string, string> = {
  mining: "Pickaxe",
  herbalism: "Sickle",
  skinning: "Skinning knife",
};

const GATHER_HINTS: Record<string, string> = {
  mining: "Find ore nodes in the world and right-click them to mine.",
  herbalism: "Find flower nodes in the world and gather them.",
  skinning: "Skin defeated mob corpses to harvest hides and pelts.",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatTime(ms?: number): string {
  if (!ms || ms <= 0) return "instant";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.round(s / 60)}m`;
}

function formatGold(copper?: number): string | null {
  if (!copper || copper <= 0) return null;
  const gold = copper / 100;
  return gold >= 1 ? `${gold.toFixed(gold < 10 ? 1 : 0)}g` : `${copper}c`;
}

/**
 * Normalize the various recipe endpoint response shapes into a single shape.
 * - Cooking returns `{ recipes: [{ name, outputTokenId, outputQuantity, requiredMaterials: [{itemName, quantity}], requiredSkillLevel, cookingTime, hpRestoration }] }`
 * - Alchemy/crafting/jewel/leather return a plain array of `{ output: {name, quantity}, materials: [{name, quantity}], requiredSkillLevel, copperCost?, craftingTime|brewingTime }`
 */
function normalize(profId: string, payload: any): NormalizedRecipe[] {
  const arr: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.recipes)
      ? payload.recipes
      : [];
  return arr
    .map((r): NormalizedRecipe | null => {
      if (!r) return null;
      // Cooking shape
      if (r.outputTokenId && r.requiredMaterials) {
        return {
          recipeId: String(r.recipeId ?? ""),
          name: String(r.name ?? "Recipe"),
          outputName: String(r.name ?? "Output"),
          outputQuantity: Number(r.outputQuantity ?? 1) || 1,
          materials: (r.requiredMaterials ?? []).map((m: any) => ({
            name: String(m.itemName ?? m.name ?? "?"),
            quantity: Number(m.quantity ?? 1) || 1,
          })),
          requiredSkillLevel: Number(r.requiredSkillLevel ?? 1) || 1,
          timeMs: Number(r.cookingTime ?? r.craftingTime ?? r.brewingTime ?? 0) || 0,
          copperCost: r.copperCost ? Number(r.copperCost) : undefined,
          hpRestoration: r.hpRestoration ? Number(r.hpRestoration) : undefined,
        };
      }
      // Alchemy / crafting / jewel / leather shape
      if (r.output && r.materials) {
        return {
          recipeId: String(r.recipeId ?? ""),
          name: String(r.output?.name ?? "Recipe"),
          outputName: String(r.output?.name ?? "Output"),
          outputQuantity: Number(r.output?.quantity ?? 1) || 1,
          materials: (r.materials ?? []).map((m: any) => ({
            name: String(m.name ?? "?"),
            quantity: Number(m.quantity ?? 1) || 1,
          })),
          requiredSkillLevel: Number(r.requiredSkillLevel ?? 1) || 1,
          timeMs: Number(r.craftingTime ?? r.brewingTime ?? r.cookingTime ?? 0) || 0,
          copperCost: r.copperCost ? Number(r.copperCost) : undefined,
        };
      }
      return null;
    })
    .filter((r): r is NormalizedRecipe => r !== null)
    .sort((a, b) => a.requiredSkillLevel - b.requiredSkillLevel);
}

function normalizeCatalog(profId: string, payload: any): NormalizedGatherable[] {
  const arr: any[] = Array.isArray(payload) ? payload : [];
  const toolName = GATHER_TOOL[profId];
  const tierKey = profId === "mining" ? "requiredPickaxeTier" : "requiredSickleTier";
  return arr
    .map((e): NormalizedGatherable | null => {
      if (!e) return null;
      const rawRarity = String(e.rarity ?? "common").toLowerCase();
      const rarity = ["common", "uncommon", "rare", "epic", "legendary"].includes(rawRarity)
        ? (rawRarity as NormalizedGatherable["rarity"])
        : "common";
      return {
        name: String(e.label ?? e.oreType ?? e.flowerType ?? "?"),
        rarity,
        requiredSkillLevel: Number(e.requiredSkillLevel ?? 1) || 1,
        requiredToolTier: Number(e[tierKey] ?? 0) || undefined,
        toolName,
        maxCharges: Number(e.maxCharges ?? 0) || undefined,
      };
    })
    .filter((e): e is NormalizedGatherable => e !== null)
    .sort((a, b) => a.requiredSkillLevel - b.requiredSkillLevel);
}

export class RecipesPanel {
  private container: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private current: ShowOpts | null = null;
  private fetchSeq = 0;
  private craftInflight = false;
  private craftStatusMsg = "";

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "recipes-panel";
    this.container.style.display = "none";

    this.headerEl = document.createElement("div");
    this.headerEl.className = "rp-header";

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "rp-body";

    this.statusEl = document.createElement("div");
    this.statusEl.className = "rp-status";
    this.statusEl.style.display = "none";

    this.container.appendChild(this.headerEl);
    this.container.appendChild(this.bodyEl);
    this.container.appendChild(this.statusEl);

    this.bodyEl.addEventListener("click", this.onBodyClick);

    document.body.appendChild(this.container);

    this.injectStyles();
  }

  async show(opts: ShowOpts) {
    this.current = opts;
    this.craftInflight = false;
    this.craftStatusMsg = "";
    this.statusEl.style.display = "none";
    this.container.style.display = "flex";
    playSoundEffect("ui_dialog_open");
    this.renderHeader();
    await this.loadRecipes();
  }

  private onBodyClick = async (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest(".rp-craft-btn") as HTMLButtonElement | null;
    if (!btn || this.craftInflight || !this.current?.onCraft) return;
    const recipeId = btn.dataset.recipeId ?? "";
    if (!recipeId) return;

    this.craftInflight = true;
    btn.disabled = true;
    btn.textContent = "…";
    this.showStatus("Crafting…", "");

    const result = await this.current.onCraft(recipeId);
    this.craftInflight = false;
    btn.disabled = false;
    btn.textContent = "Craft";
    this.showStatus(result.message, result.ok ? "ok" : "err");

    setTimeout(() => {
      if (this.craftStatusMsg === result.message) this.clearStatus();
    }, 4000);
  };

  private showStatus(msg: string, kind: "ok" | "err" | "") {
    this.craftStatusMsg = msg;
    this.statusEl.textContent = msg;
    this.statusEl.className = `rp-status${kind === "ok" ? " rp-status-ok" : kind === "err" ? " rp-status-err" : ""}`;
    this.statusEl.style.display = msg ? "block" : "none";
  }

  private clearStatus() {
    this.craftStatusMsg = "";
    this.statusEl.style.display = "none";
  }

  hide() {
    if (this.container.style.display === "none") return;
    this.container.style.display = "none";
    this.current = null;
    playSoundEffect("ui_dialog_close");
  }

  isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  private renderHeader() {
    if (!this.current) return;
    const { profIcon, profName, skillLevel, learned } = this.current;
    const levelLabel = learned ? `Level ${skillLevel} / 300` : `Not learned`;
    this.headerEl.innerHTML = `
      <div class="rp-title-row">
        <span class="rp-drag-handle" data-drag-handle="recipes" title="Drag panel">:::</span>
        <span class="rp-icon">${profIcon}</span>
        <span class="rp-title">${esc(profName)}</span>
        <button class="rp-close" type="button" title="Close">×</button>
      </div>
      <div class="rp-subtitle">${esc(levelLabel)}</div>
    `;
    this.headerEl.querySelector(".rp-close")?.addEventListener("click", () => this.hide());
  }

  private async loadRecipes() {
    if (!this.current) return;
    const { profId } = this.current;
    const endpoint = RECIPE_ENDPOINT[profId];
    const catalogEndpoint = CATALOG_ENDPOINT[profId];
    const seq = ++this.fetchSeq;

    if (!endpoint && !catalogEndpoint) {
      const hint = GATHER_HINTS[profId] ?? "This is a gathering profession.";
      this.bodyEl.innerHTML = `
        <div class="rp-empty">
          <div class="rp-empty-title">Gathering Profession</div>
          <div class="rp-empty-hint">${esc(hint)}</div>
        </div>
      `;
      return;
    }

    const isCatalog = !endpoint && !!catalogEndpoint;
    const targetEndpoint = endpoint ?? catalogEndpoint!;
    this.bodyEl.innerHTML = `<div class="rp-loading">Loading ${isCatalog ? "gatherables" : "recipes"}…</div>`;

    let payload: any = null;
    let lastErr = "";
    for (const base of CANDIDATE_BASES) {
      try {
        const res = await fetch(toUrl(base, targetEndpoint));
        if (res.ok) {
          payload = await res.json();
          lastErr = "";
          break;
        }
        lastErr = `HTTP ${res.status}`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }

    if (seq !== this.fetchSeq) return; // stale fetch
    if (!payload) {
      this.bodyEl.innerHTML = `<div class="rp-error">Failed to load ${isCatalog ? "gatherables" : "recipes"}${lastErr ? ` — ${esc(lastErr)}` : ""}</div>`;
      return;
    }

    if (isCatalog) {
      const entries = normalizeCatalog(profId, payload);
      if (entries.length === 0) {
        this.bodyEl.innerHTML = `<div class="rp-empty"><div class="rp-empty-title">No gatherables found</div></div>`;
        return;
      }
      this.renderGatherables(entries);
      return;
    }

    const recipes = normalize(profId, payload);
    if (recipes.length === 0) {
      this.bodyEl.innerHTML = `<div class="rp-empty"><div class="rp-empty-title">No recipes found</div></div>`;
      return;
    }
    this.renderRecipes(recipes);
  }

  private renderGatherables(entries: NormalizedGatherable[]) {
    if (!this.current) return;
    const { skillLevel, profId } = this.current;
    const hint = GATHER_HINTS[profId] ?? "";

    let html = "";
    for (const e of entries) {
      const canHarvest = skillLevel >= e.requiredSkillLevel;
      const rowClass = canHarvest ? "rp-row rp-row-ok" : "rp-row rp-row-locked";
      const lvlClass = canHarvest ? "rp-lvl-ok" : "rp-lvl-locked";
      const rarityClass = `rp-rarity rp-rarity-${e.rarity}`;
      const meta: string[] = [];
      if (e.toolName && e.requiredToolTier && e.requiredToolTier > 0) {
        meta.push(`⛏ ${esc(e.toolName)} T${e.requiredToolTier}+`);
      }
      if (e.maxCharges) meta.push(`◆ ${e.maxCharges} per node`);

      html += `
        <div class="${rowClass}">
          <div class="rp-row-head">
            <span class="rp-output">${esc(e.name)}</span>
            <span class="${rarityClass}">${esc(e.rarity)}</span>
            <span class="${lvlClass}">Lv ${e.requiredSkillLevel}</span>
          </div>
          ${meta.length > 0 ? `<div class="rp-meta">${meta.join("  ·  ")}</div>` : ""}
        </div>
      `;
    }

    const unlocked = entries.filter((e) => skillLevel >= e.requiredSkillLevel).length;
    const summary = `${unlocked} / ${entries.length} unlocked`;
    const hintHtml = hint ? `<div class="rp-empty-hint" style="padding:4px 4px 8px;text-align:left;">${esc(hint)}</div>` : "";
    this.bodyEl.innerHTML = `<div class="rp-summary">${summary}</div>${hintHtml}${html}`;
  }

  private renderRecipes(recipes: NormalizedRecipe[]) {
    if (!this.current) return;
    const { skillLevel, onCraft } = this.current;

    let html = "";
    for (const r of recipes) {
      const canCraft = skillLevel >= r.requiredSkillLevel;
      const lvlClass = canCraft ? "rp-lvl-ok" : "rp-lvl-locked";
      const rowClass = canCraft ? "rp-row rp-row-ok" : "rp-row rp-row-locked";

      const matsHtml = r.materials
        .map((m) => `<li><span class="rp-mat-qty">${m.quantity}×</span> ${esc(m.name)}</li>`)
        .join("");

      const goldLabel = formatGold(r.copperCost);
      const metaParts: string[] = [];
      if (r.timeMs) metaParts.push(`⏱ ${formatTime(r.timeMs)}`);
      if (goldLabel) metaParts.push(`💰 ${goldLabel}`);
      if (r.hpRestoration) metaParts.push(`❤ ${r.hpRestoration} HP`);

      const craftBtn = canCraft && onCraft && r.recipeId
        ? `<button class="rp-craft-btn" data-recipe-id="${esc(r.recipeId)}">Craft</button>`
        : "";

      html += `
        <div class="${rowClass}">
          <div class="rp-row-head">
            <span class="rp-output">${r.outputQuantity > 1 ? `${r.outputQuantity}× ` : ""}${esc(r.outputName)}</span>
            <span class="${lvlClass}">Lv ${r.requiredSkillLevel}</span>
            ${craftBtn}
          </div>
          ${metaParts.length > 0 ? `<div class="rp-meta">${metaParts.join("  ·  ")}</div>` : ""}
          <ul class="rp-mats">${matsHtml}</ul>
        </div>
      `;
    }

    const learnedCount = recipes.filter((r) => skillLevel >= r.requiredSkillLevel).length;
    const summary = `${learnedCount} / ${recipes.length} craftable`;
    this.bodyEl.innerHTML = `<div class="rp-summary">${summary}</div>${html}`;
  }

  private injectStyles() {
    if (document.getElementById("rp-panel-styles")) return;
    const style = document.createElement("style");
    style.id = "rp-panel-styles";
    style.textContent = `
      #recipes-panel {
        position: fixed;
        bottom: 64px;
        right: 304px;
        width: 320px;
        max-height: calc(100vh - 120px);
        background: rgba(10, 16, 28, 0.94);
        border: 1px solid rgba(255, 204, 68, 0.25);
        border-radius: 8px;
        z-index: 17;
        display: flex;
        flex-direction: column;
        font: 12px monospace;
        color: #ccc;
        backdrop-filter: blur(6px);
        pointer-events: auto;
      }
      .rp-header {
        flex-shrink: 0;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(255, 204, 68, 0.18);
      }
      .rp-title-row { display: flex; align-items: center; gap: 8px; }
      .rp-drag-handle {
        color: #667; cursor: grab; user-select: none;
        font: bold 14px monospace; letter-spacing: 1px;
        padding: 0 4px;
      }
      .rp-drag-handle:hover { color: #ffcc44; }
      .rp-drag-handle:active { cursor: grabbing; }
      .rp-icon { font-size: 20px; }
      .rp-title { flex: 1; font: bold 14px monospace; color: #ffcc44; }
      .rp-close {
        background: rgba(255, 100, 100, 0.12);
        border: 1px solid rgba(255, 100, 100, 0.3);
        color: #f88; cursor: pointer;
        font: bold 16px monospace; line-height: 1;
        padding: 2px 8px; border-radius: 3px;
      }
      .rp-close:hover { background: rgba(255, 100, 100, 0.28); color: #fff; }
      .rp-subtitle { color: #998; font-size: 10px; margin-top: 2px; }
      .rp-body {
        flex: 1; min-height: 0; overflow-y: auto; padding: 6px;
        scrollbar-width: thin; scrollbar-color: rgba(255, 204, 68, 0.2) transparent;
      }
      .rp-summary {
        color: #998; font-size: 10px; text-transform: uppercase;
        letter-spacing: 0.5px; padding: 4px 4px 8px;
      }
      .rp-loading, .rp-error, .rp-empty {
        padding: 20px 12px; text-align: center; color: #889;
      }
      .rp-error { color: #ff8866; }
      .rp-empty-title { color: #ffcc44; font: bold 13px monospace; margin-bottom: 4px; }
      .rp-empty-hint { color: #889; font-size: 11px; font-style: italic; }
      .rp-row {
        background: rgba(30, 40, 55, 0.6);
        border-radius: 5px;
        padding: 7px 9px;
        margin-bottom: 4px;
        border-left: 3px solid #4f8;
      }
      .rp-row-locked { opacity: 0.55; border-left-color: #555; }
      .rp-row-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; margin-bottom: 3px;
      }
      .rp-output { color: #bbc; font: bold 12px monospace; }
      .rp-lvl-ok {
        color: #4f8; font: bold 11px monospace;
        background: rgba(68, 255, 136, 0.12); padding: 1px 6px; border-radius: 3px;
      }
      .rp-lvl-locked {
        color: #f88; font: bold 11px monospace;
        background: rgba(255, 100, 100, 0.12); padding: 1px 6px; border-radius: 3px;
      }
      .rp-meta { color: #998; font-size: 10px; margin-bottom: 3px; }
      .rp-mats {
        margin: 0; padding: 0; list-style: none;
        display: flex; flex-wrap: wrap; gap: 4px 10px;
      }
      .rp-mats li { color: #998; font-size: 11px; }
      .rp-mat-qty { color: #aab; font-weight: bold; }
      .rp-craft-btn {
        margin-left: auto;
        background: rgba(68, 255, 136, 0.15);
        border: 1px solid rgba(68, 255, 136, 0.4);
        color: #4f8; border-radius: 3px; padding: 2px 10px;
        font: bold 11px monospace; cursor: pointer; white-space: nowrap;
        flex-shrink: 0;
      }
      .rp-craft-btn:hover { background: rgba(68, 255, 136, 0.28); }
      .rp-craft-btn:disabled { opacity: 0.5; cursor: default; }
      .rp-status {
        flex-shrink: 0; padding: 6px 10px; font: 11px monospace;
        border-top: 1px solid rgba(255, 204, 68, 0.15); color: #aaa;
        text-align: center;
      }
      .rp-status-ok { color: #4f8; }
      .rp-status-err { color: #f86; }
      .rp-rarity {
        font: bold 10px monospace;
        padding: 1px 6px; border-radius: 3px;
        text-transform: uppercase; letter-spacing: 0.4px;
      }
      .rp-rarity-common    { color: #bbb; background: rgba(170,170,170,0.12); }
      .rp-rarity-uncommon  { color: #6f6; background: rgba(100,255,100,0.13); }
      .rp-rarity-rare      { color: #6cf; background: rgba(100,200,255,0.14); }
      .rp-rarity-epic      { color: #c8f; background: rgba(200,140,255,0.16); }
      .rp-rarity-legendary { color: #fc6; background: rgba(255,200,100,0.16); }
    `;
    document.head.appendChild(style);
  }
}
