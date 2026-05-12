/**
 * Global mobile responsive overrides for HUD panels.
 *
 * Each panel injects its own CSS at construction time with a fixed pixel
 * width (300–320px) and `right: 12px`. On narrow phones (≤ 600px) those
 * widths cause horizontal overflow because the panels plus the action-bar
 * column don't fit. This single stylesheet uses higher-specificity ID
 * selectors + `!important` to clamp all panel widths to the viewport.
 */

const PANEL_IDS = [
  "notifications-panel",
  "inbox-panel",
  "outgoing-trades-panel",
  "bets-panel",
  "bag-panel",
  "skills-panel",
  "quest-panel",
  "player-panel",
  "settings-panel",
  "world-map",
  "trade-offer-dialog",
  "char-select",
  "agent-chat",
];

export function installMobileResponsiveStyles(): void {
  if (document.getElementById("mobile-responsive-styles")) return;

  const panelSelector = PANEL_IDS.map((id) => `#${id}`).join(",\n        ");

  const style = document.createElement("style");
  style.id = "mobile-responsive-styles";
  style.textContent = `
    /* Phone-sized viewport: shrink panel widths so they don't bleed off
       the right edge. The action bar wraps to multiple rows automatically
       (see ActionBar.ts). Panels keep their right anchor but cap width to
       the viewport minus a small gutter. */
    @media (max-width: 600px) {
      ${panelSelector} {
        width: calc(100vw - 16px) !important;
        max-width: 380px !important;
        right: 8px !important;
        left: auto !important;
      }
      /* Single-row action bar (~38-44px tall + 12px bottom inset) — give
         the panels a little headroom so they don't sit on top of icons. */
      #notifications-panel,
      #inbox-panel,
      #outgoing-trades-panel,
      #bets-panel,
      #bag-panel,
      #skills-panel,
      #quest-panel,
      #player-panel,
      #settings-panel,
      #world-map {
        bottom: 60px !important;
        max-height: calc(100vh - 80px) !important;
      }
    }
    @media (max-width: 400px) {
      ${panelSelector} {
        right: 4px !important;
        font-size: 11px;
      }
    }
  `;
  document.head.appendChild(style);
}
