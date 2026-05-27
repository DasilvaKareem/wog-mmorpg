/**
 * BridgePanel — UI for exporting characters to Coinbase Base and importing them back.
 *
 * Minimal first cut: a docked panel that lets a user pick a character (passed in via
 * `open()`), enter a destination wallet address, kick off the bridge, and watch
 * the status state machine to completion.
 *
 * Custodial flow: the server handles the burn + auto-redeems on the destination.
 * External-wallet flow: the user signs the burn and `mintFromClaim` themselves
 *   (rendered as copy-paste-able tx data — wallet integration to come).
 */
import {
  fetchBridgeClaim,
  fetchBridgeInfo,
  fetchBridgeStatus,
  postBridgeExport,
  postBridgeImport,
  type BridgeClaimPayload,
  type BridgeStatusPayload,
} from "../api.js";

interface BridgePanelOptions {
  getToken: () => Promise<string | null>;
  getWallet: () => string | null;
}

interface OpenInput {
  characterName: string;
  characterTokenId: string;
  /** "export" = SKALE → Base, "import" = Base → SKALE */
  direction: "export" | "import";
  /** Pre-fill the destination address (default: connected wallet). */
  defaultRecipient?: string;
}

const POLL_MS = 3000;
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export class BridgePanel {
  private container: HTMLDivElement;
  private body: HTMLDivElement;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private current: OpenInput | null = null;
  private bridgeId: string | null = null;
  private latest: BridgeStatusPayload | null = null;
  private claim: BridgeClaimPayload | null = null;
  private errorMessage: string | null = null;
  private bridgeInfoLoaded = false;
  private bridgeEnabled = false;

  constructor(private options: BridgePanelOptions) {
    this.container = document.createElement("div");
    this.container.id = "bridge-panel";
    this.container.style.cssText = `
      position: fixed; right: 12px; top: 12px;
      width: 360px; max-height: 88vh; overflow-y: auto;
      background: rgba(15, 18, 30, 0.95); color: #e8edf2;
      border: 1px solid #2a3346; border-radius: 6px;
      font-family: ui-monospace, "Cascadia Mono", "Roboto Mono", monospace;
      font-size: 12px; z-index: 9999; display: none;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 12px; border-bottom: 1px solid #2a3346;
      font-weight: 600; color: #9bb0c8;
    `;
    header.innerHTML = `<span>NFT Bridge</span><button class="bp-close" style="background:none;border:none;color:#9bb0c8;font-size:16px;cursor:pointer">×</button>`;
    (header.querySelector(".bp-close") as HTMLButtonElement)
      .addEventListener("click", () => this.hide());
    this.container.appendChild(header);

    this.body = document.createElement("div");
    this.body.style.padding = "12px";
    this.container.appendChild(this.body);
    document.body.appendChild(this.container);

    void this.loadBridgeInfo();
  }

  async open(input: OpenInput) {
    this.current = input;
    this.bridgeId = null;
    this.latest = null;
    this.claim = null;
    this.errorMessage = null;
    this.container.style.display = "block";
    if (!this.bridgeInfoLoaded) {
      await this.loadBridgeInfo();
    }
    this.render();
  }

  hide() {
    this.container.style.display = "none";
    this.stopPolling();
  }

  private async loadBridgeInfo() {
    try {
      const info = await fetchBridgeInfo();
      this.bridgeEnabled = Boolean(info?.enabled);
    } catch {
      this.bridgeEnabled = false;
    } finally {
      this.bridgeInfoLoaded = true;
      this.render();
    }
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  private async submit(recipient: string) {
    if (!this.current) return;
    if (!ADDRESS_REGEX.test(recipient)) {
      this.errorMessage = "Destination wallet must be a valid 0x address";
      this.render();
      return;
    }
    const wallet = this.options.getWallet();
    const token = await this.options.getToken();
    if (!wallet || !token) {
      this.errorMessage = "Connect your wallet first";
      this.render();
      return;
    }
    this.errorMessage = null;
    this.render();

    try {
      const res =
        this.current.direction === "export"
          ? await postBridgeExport(token, {
              walletAddress: wallet,
              characterName: this.current.characterName,
              baseRecipient: recipient,
            })
          : await postBridgeImport(token, {
              walletAddress: wallet,
              baseTokenId: this.current.characterTokenId,
              skaleRecipient: recipient,
              characterName: this.current.characterName,
            });
      if (!res.ok || !res.data) {
        this.errorMessage = res.error ?? "Bridge submission failed";
        this.render();
        return;
      }
      this.bridgeId = res.data.bridgeId;
      this.latest = res.data;
      this.render();
      this.startPolling();
    } catch (err) {
      this.errorMessage = (err as Error)?.message ?? "Network error";
      this.render();
    }
  }

  private startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, POLL_MS);
    void this.poll();
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll() {
    if (!this.bridgeId) return;
    const token = await this.options.getToken();
    if (!token) return;
    try {
      const status = await fetchBridgeStatus(this.bridgeId, token);
      if (status) {
        this.latest = status;
        if (status.status === "claim_signed" && !this.claim) {
          this.claim = await fetchBridgeClaim(this.bridgeId, token);
        }
        if (status.status === "redeemed" || status.status === "refunded" || status.status === "expired") {
          this.stopPolling();
        }
        this.render();
      }
    } catch {
      // non-fatal
    }
  }

  // ── render ───────────────────────────────────────────────────────────────

  private render() {
    if (!this.current) {
      this.body.innerHTML = `<div style="color:#9bb0c8">No character selected.</div>`;
      return;
    }
    if (!this.bridgeInfoLoaded) {
      this.body.innerHTML = `<div style="color:#9bb0c8">Loading bridge state…</div>`;
      return;
    }
    if (!this.bridgeEnabled) {
      this.body.innerHTML = `
        <div style="color:#e8b347; margin-bottom: 8px">Bridge is not active on this shard.</div>
        <div style="color:#9bb0c8; font-size: 11px">
          The server needs <code>BRIDGE_ENABLED=true</code> and deployed bridge contracts.
        </div>
      `;
      return;
    }

    if (!this.bridgeId) {
      this.renderForm();
    } else {
      this.renderStatus();
    }
  }

  private renderForm() {
    if (!this.current) return;
    const verb = this.current.direction === "export" ? "Export to Base" : "Import to SKALE";
    const explainer =
      this.current.direction === "export"
        ? `Burn your character on SKALE Base and mint it on Coinbase Base.
           The character becomes unplayable in-game until you bridge it back.`
        : `Burn your character on Coinbase Base and restore it on SKALE Base.
           Once redeemed, the character is playable again.`;

    const defaultRecipient = this.current.defaultRecipient ?? this.options.getWallet() ?? "";

    this.body.innerHTML = `
      <div style="margin-bottom: 10px;">
        <div style="color:#9bb0c8; font-size: 11px">Character</div>
        <div style="font-weight: 600">${escapeHtml(this.current.characterName)}</div>
        <div style="color:#6f8298; font-size: 10px">tokenId: ${escapeHtml(this.current.characterTokenId)}</div>
      </div>

      <div style="margin-bottom: 10px; color:#9bb0c8; font-size: 11px; line-height: 1.4">
        ${escapeHtml(explainer)}
      </div>

      <label style="color:#9bb0c8; font-size: 11px">Destination wallet (0x…)</label>
      <input class="bp-recipient" type="text" value="${escapeHtml(defaultRecipient)}"
        style="width:100%; box-sizing:border-box; padding:6px; margin: 4px 0 10px;
               background:#0c0f18; color:#e8edf2; border:1px solid #2a3346; border-radius:4px;
               font-family: inherit; font-size: 11px;" />

      ${this.errorMessage ? `<div style="color:#e8654e; margin-bottom: 8px">${escapeHtml(this.errorMessage)}</div>` : ""}

      <button class="bp-submit" style="
        width:100%; padding:8px 12px;
        background:#4a78d8; color:#fff; border:none; border-radius:4px;
        font-family: inherit; font-size: 12px; cursor:pointer;
      ">${verb}</button>
    `;

    (this.body.querySelector(".bp-submit") as HTMLButtonElement).addEventListener("click", () => {
      const input = this.body.querySelector(".bp-recipient") as HTMLInputElement;
      void this.submit(input.value.trim());
    });
  }

  private renderStatus() {
    if (!this.latest) {
      this.body.innerHTML = `<div style="color:#9bb0c8">Waiting for bridge…</div>`;
      return;
    }
    const r = this.latest;
    const statusColor: Record<BridgeStatusPayload["status"], string> = {
      pending_burn: "#e8b347",
      burn_confirmed: "#e8b347",
      claim_signed: "#4a78d8",
      redeemed: "#5fbd6b",
      expired: "#e8654e",
      refunded: "#9bb0c8",
    };
    const stepLabel: Record<BridgeStatusPayload["status"], string> = {
      pending_burn: "1/4 · Waiting for burn tx on source chain",
      burn_confirmed: "2/4 · Burn observed; signing claim",
      claim_signed: "3/4 · Claim ready — redeem on destination",
      redeemed: "4/4 · Done. Token is on the destination chain.",
      expired: "Claim expired before redemption — refund available",
      refunded: "Refunded — character restored",
    };

    let claimSection = "";
    if (this.claim) {
      claimSection = `
        <div style="margin-top: 12px; padding: 8px; background: #0c0f18; border-radius: 4px;
                    border: 1px solid #2a3346; font-size: 10px; word-break: break-all;">
          <div style="color:#9bb0c8; margin-bottom: 4px;">Claim payload (paste into wallet):</div>
          <div><strong>contract:</strong> ${escapeHtml(this.claim.verifyingContract)}</div>
          <div><strong>function:</strong> mintFromClaim(claim, signature)</div>
          <div style="margin-top:4px"><strong>signature:</strong> ${escapeHtml(this.claim.signature.slice(0, 22))}…</div>
          <button class="bp-copy" style="
            margin-top:8px; padding:4px 8px;
            background:#1f2a3d; color:#e8edf2; border:1px solid #2a3346; border-radius:3px;
            font-family: inherit; font-size: 11px; cursor:pointer;
          ">Copy full claim JSON</button>
        </div>
      `;
    }

    this.body.innerHTML = `
      <div style="margin-bottom: 10px;">
        <div style="color:#9bb0c8; font-size: 11px">Bridge ID</div>
        <div style="font-size: 10px; word-break: break-all">${escapeHtml(r.bridgeId)}</div>
      </div>

      <div style="margin-bottom: 10px;">
        <div style="color:${statusColor[r.status]}; font-weight: 600;">${escapeHtml(r.status)}</div>
        <div style="color:#9bb0c8; font-size: 11px">${escapeHtml(stepLabel[r.status])}</div>
      </div>

      ${r.burnTxHash ? `<div style="font-size: 11px; word-break: break-all; margin-bottom: 6px;"><strong>burn tx:</strong> ${escapeHtml(r.burnTxHash)}</div>` : ""}
      ${r.redeemTxHash ? `<div style="font-size: 11px; word-break: break-all; margin-bottom: 6px;"><strong>redeem tx:</strong> ${escapeHtml(r.redeemTxHash)}</div>` : ""}
      ${r.lastError ? `<div style="color:#e8654e; font-size: 11px; margin-bottom: 6px">error: ${escapeHtml(r.lastError)}</div>` : ""}

      ${claimSection}
    `;

    const copyBtn = this.body.querySelector(".bp-copy") as HTMLButtonElement | null;
    if (copyBtn && this.claim) {
      copyBtn.addEventListener("click", () => {
        navigator.clipboard
          .writeText(JSON.stringify(this.claim, null, 2))
          .then(() => {
            copyBtn.textContent = "Copied!";
            setTimeout(() => (copyBtn.textContent = "Copy full claim JSON"), 1500);
          })
          .catch(() => {});
      });
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
