/**
 * Global mobile responsive overrides for HUD panels.
 *
 * On narrow phones (≤ 600px) every HUD panel becomes a full-width
 * bottom-sheet — mirroring the WalletPanel pattern. This avoids the
 * fixed-width right-anchored panels overlapping with the action bar.
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
    /* Phone-sized viewport: every HUD panel becomes a bottom-sheet —
       full-width, anchored to the bottom of the viewport, with rounded
       top corners. Slides up over the action bar like WalletPanel. */
    @media (max-width: 600px) {
      ${panelSelector} {
        position: fixed !important;
        left: 0 !important;
        right: 0 !important;
        top: auto !important;
        bottom: 0 !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: none !important;
        max-height: 75vh !important;
        overflow-y: auto !important;
        border-radius: 20px 20px 0 0 !important;
        border-left: none !important;
        border-right: none !important;
        border-bottom: none !important;
        box-shadow: 0 -8px 40px rgba(0,0,0,0.7) !important;
        transform: none !important;
      }
    }
    @media (max-width: 400px) {
      ${panelSelector} {
        font-size: 11px;
      }
    }
  `;
  document.head.appendChild(style);
}
