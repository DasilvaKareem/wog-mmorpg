export type IntentVisibilityMode = "minimal" | "tactical" | "spectator";

export class ZoneNameBadge {
  private el: HTMLDivElement;
  private currentZoneId: string | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "zone-name-badge";
    this.el.style.cssText = `
      position: fixed;
      top: 12px;
      right: 12px;
      padding: 6px 10px;
      background: rgba(8, 14, 24, 0.78);
      border: 1px solid rgba(255, 204, 90, 0.28);
      border-radius: 999px;
      color: #ffd98a;
      font: 11px/1 monospace;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      z-index: 17;
      pointer-events: none;
      backdrop-filter: blur(5px);
    `;
    document.body.appendChild(this.el);
    this.setZoneId(null);
  }

  setZoneId(zoneId: string | null) {
    if (zoneId === this.currentZoneId) return;
    this.currentZoneId = zoneId;
    this.el.textContent = zoneId ? zoneId.replace(/-/g, " ") : "—";
  }
}
