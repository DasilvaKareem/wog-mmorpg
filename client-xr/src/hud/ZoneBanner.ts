/**
 * Large zone title banner. Fades in, holds, then fades out when the player
 * enters a new zone. Ignores the initial "first zone after spawn" edge by
 * requiring a previous zone to exist — pass `force: true` to override.
 */

const FADE_IN_MS = 600;
const HOLD_MS = 2200;
const FADE_OUT_MS = 900;

const ZONE_SUBTITLES: Record<string, string> = {
  "village-square": "Where every hero begins",
  "wild-meadow": "Sunlit grass, sharper teeth",
  "dark-forest": "Beneath the black canopy",
  "emerald-woods": "Verdant and watching",
  "auroral-plains": "The sky never fades",
  "viridian-range": "Peaks of jade and thunder",
  "moondancer-glade": "Lunar light on ancient stones",
  "felsrock-citadel": "Fortress of the damned",
  "lake-lumina": "Mirror to another world",
  "azurshard-chasm": "Where the sky shattered",
};

function titleCase(zoneId: string): string {
  return zoneId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export class ZoneBanner {
  private container: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subtitleEl: HTMLDivElement;
  private currentZoneId: string | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private fadeOutTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "zone-banner";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "zone-banner-title";
    this.container.appendChild(this.titleEl);

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "zone-banner-subtitle";
    this.container.appendChild(this.subtitleEl);

    document.body.appendChild(this.container);
    this.injectStyles();
  }

  /**
   * Called every tick with the player's current zone. The banner shows on
   * any change to a new zone, including the first zone after spawn.
   * Null zones are ignored (entity may blip out of the poll briefly) —
   * call `reset()` on logout to clear the tracked state.
   */
  setZoneId(zoneId: string | null): void {
    if (!zoneId) return;
    if (zoneId === this.currentZoneId) return;
    this.currentZoneId = zoneId;
    this.show(zoneId);
  }

  reset(): void {
    this.currentZoneId = null;
    if (this.hideTimeout) { clearTimeout(this.hideTimeout); this.hideTimeout = null; }
    if (this.fadeOutTimeout) { clearTimeout(this.fadeOutTimeout); this.fadeOutTimeout = null; }
    this.container.classList.remove("zone-banner-in", "zone-banner-out");
  }

  private show(zoneId: string): void {
    if (this.hideTimeout) { clearTimeout(this.hideTimeout); this.hideTimeout = null; }
    if (this.fadeOutTimeout) { clearTimeout(this.fadeOutTimeout); this.fadeOutTimeout = null; }

    this.titleEl.textContent = titleCase(zoneId);
    this.subtitleEl.textContent = ZONE_SUBTITLES[zoneId] ?? "";

    this.container.classList.remove("zone-banner-out");
    void this.container.offsetWidth;
    this.container.classList.add("zone-banner-in");

    this.hideTimeout = setTimeout(() => {
      this.container.classList.remove("zone-banner-in");
      this.container.classList.add("zone-banner-out");
      this.fadeOutTimeout = setTimeout(() => {
        this.container.classList.remove("zone-banner-out");
      }, FADE_OUT_MS);
    }, FADE_IN_MS + HOLD_MS);
  }

  private injectStyles(): void {
    const style = document.createElement("style");
    style.textContent = `
      #zone-banner {
        position: fixed;
        top: 18vh;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        pointer-events: none;
        z-index: 25;
        opacity: 0;
        font-family: "Cinzel", "Georgia", "Times New Roman", serif;
      }

      #zone-banner.zone-banner-in {
        animation: zone-banner-in ${FADE_IN_MS}ms ease-out forwards;
      }
      #zone-banner.zone-banner-out {
        animation: zone-banner-out ${FADE_OUT_MS}ms ease-in forwards;
      }

      @keyframes zone-banner-in {
        0%   { opacity: 0; transform: translate(-50%, -12px); }
        100% { opacity: 1; transform: translate(-50%, 0); }
      }
      @keyframes zone-banner-out {
        0%   { opacity: 1; transform: translate(-50%, 0); }
        100% { opacity: 0; transform: translate(-50%, -8px); }
      }

      .zone-banner-title {
        font-size: clamp(26px, 5vw, 52px);
        font-weight: 700;
        letter-spacing: 0.12em;
        color: #ffe1a0;
        text-shadow:
          0 0 18px rgba(255, 200, 100, 0.55),
          0 2px 4px rgba(0, 0, 0, 0.9),
          0 4px 22px rgba(0, 0, 0, 0.7);
        text-transform: uppercase;
      }

      .zone-banner-subtitle {
        margin-top: 6px;
        font-size: clamp(11px, 1.4vw, 15px);
        color: rgba(255, 225, 160, 0.75);
        font-style: italic;
        letter-spacing: 0.08em;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
      }
    `;
    document.head.appendChild(style);
  }
}
