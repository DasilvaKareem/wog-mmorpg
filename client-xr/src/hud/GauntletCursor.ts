import * as THREE from "three";
import type { Entity } from "../types.js";
import { playSoundEffect } from "../sfx.js";

type CursorMode = "default" | "enemy" | "npc" | "player" | "interact";

const CURSOR_URLS: Record<CursorMode, string> = {
  default: "cursors/default.png",
  enemy: "cursors/enemy.png",
  npc: "cursors/npc.png",
  player: "cursors/player.png",
  interact: "cursors/interact.png",
};

// Hotspot at index finger tip — roughly top-center of the 32x32 gauntlet
const HOTSPOT_X = 6;
const HOTSPOT_Y = 2;

const ENEMY_TYPES = new Set(["mob", "boss"]);

const NPC_TYPES = new Set([
  "merchant", "quest-giver", "lore-npc", "guild-registrar",
  "auctioneer", "arena-master", "trainer", "profession-trainer",
  "crafting-master",
]);

const INTERACT_TYPES = new Set([
  "ore-node", "flower-node", "nectar-node", "crop-node",
  "forge", "alchemy-lab", "enchanting-altar", "campfire",
  "tanning-rack", "jewelers-bench", "essence-forge",
  "dungeon-gate", "corpse",
]);

function classifyEntity(entity: Entity): CursorMode {
  const t = entity.type;
  if (ENEMY_TYPES.has(t)) return "enemy";
  if (NPC_TYPES.has(t)) return "npc";
  if (t === "player") return "player";
  if (INTERACT_TYPES.has(t)) return "interact";
  return "default";
}

/**
 * Swaps the page cursor to a colour-coded gauntlet based on the entity
 * under the pointer. Raycasts on mousemove (throttled to ~15 fps)
 * so the cursor changes as you move across the 3D scene.
 */
export class GauntletCursor {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private currentMode: CursorMode = "default";
  private cssStrings = new Map<CursorMode, string>();
  private lastRayTime = 0;
  private enabled = true;
  private uiInteractiveHover = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.Camera,
    private getEntityGroup: () => THREE.Group,
    private getEntityAt: (hits: THREE.Intersection[]) => Entity | null,
  ) {
    // Pre-build CSS cursor strings
    for (const [mode, url] of Object.entries(CURSOR_URLS)) {
      this.cssStrings.set(
        mode as CursorMode,
        `url(${url}) ${HOTSPOT_X} ${HOTSPOT_Y}, auto`,
      );
    }

    // Set default gauntlet immediately
    this.applyMode("default");
    this.ensureClickableCursorOverrideStyle();

    window.addEventListener("mousemove", this.onMouseMove);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.applyMode("default");
  }

  dispose() {
    window.removeEventListener("mousemove", this.onMouseMove);
    document.body.style.cursor = "";
    this.canvas.style.cursor = "";
  }

  private onMouseMove = (e: MouseEvent) => {
    // UI hover swap works even when raycasting is disabled (e.g. landing page,
    // character select) so buttons always get the "interact" cursor on hover.
    const hoveringInteractive = this.isInteractiveTarget(e.target);
    if (hoveringInteractive) {
      this.uiInteractiveHover = true;
      this.applyMode("interact");
      return;
    }
    if (this.uiInteractiveHover) {
      this.uiInteractiveHover = false;
      this.applyMode("default");
    }

    if (!this.enabled) return;

    // Throttle raycasts to ~15 fps (67ms)
    const now = performance.now();
    if (now - this.lastRayTime < 67) return;
    this.lastRayTime = now;

    this.ndc.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );

    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.getEntityGroup().children, true);
    const entity = this.getEntityAt(hits);

    const mode = entity ? classifyEntity(entity) : "default";
    if (mode !== this.currentMode) {
      this.applyMode(mode);
    }
  };

  private applyMode(mode: CursorMode) {
    this.currentMode = mode;
    const css = this.cssStrings.get(mode) ?? "auto";
    document.documentElement.style.setProperty("--wog-gauntlet-cursor", css);
    document.body.style.cursor = css;
  }

  private isInteractiveTarget(target: EventTarget | null): boolean {
    const el = target instanceof HTMLElement ? target : null;
    if (!el) return false;
    const interactive = el.closest("a, button, [role='button'], summary, label, [data-action], [data-clickable]");
    if (!interactive) return false;
    const tag = interactive.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
    if ((interactive as HTMLElement).isContentEditable) return false;
    return true;
  }

  private ensureClickableCursorOverrideStyle() {
    if (document.getElementById("wog-gauntlet-cursor-style")) return;
    const style = document.createElement("style");
    style.id = "wog-gauntlet-cursor-style";
    style.textContent = `
      a, button, [role="button"], summary, [data-action], [data-clickable] {
        cursor: var(--wog-gauntlet-cursor, auto) !important;
      }
    `;
    document.head.appendChild(style);
  }
}
