type SocialStrategy = "google" | "discord" | "x" | "telegram" | "farcaster";

interface LandingPageOptions {
  onEnterWorld: (detail: { walletAddress: string | null; mode: "guest" | "authenticated" }) => void;
}

const SOCIALS: Array<{ strategy: SocialStrategy; label: string; accent: string }> = [
  { strategy: "google", label: "Continue With Google", accent: "#ea4335" },
  { strategy: "discord", label: "Continue With Discord", accent: "#5865f2" },
];

export class LandingPage {
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private zoneEl: HTMLSpanElement | null;
  private onlineEl: HTMLSpanElement | null;
  private continueBtn: HTMLButtonElement;
  private signOutBtn: HTMLButtonElement;
  private authPill: HTMLDivElement;
  private ready = false;
  private busy = false;
  private walletAddress: string | null = null;

  constructor(private options: LandingPageOptions) {
    this.injectStyles();

    this.root = document.createElement("div");
    this.root.id = "xr-landing";
    this.root.innerHTML = `
      <div class="xr-landing-scrim"></div>
    `;

    this.panel = document.createElement("div");
    this.panel.className = "xr-landing-panel";
    this.panel.innerHTML = `
      <div class="xr-landing-brand">
        <div class="xr-landing-logo" aria-label="World of Geneva">
          <div class="xr-landing-logo-mark">W</div>
          <div class="xr-landing-logo-copy">
            <span class="xr-landing-kicker">World of Geneva</span>
            <h1 data-brand-title>Sign In</h1>
          </div>
        </div>
        <p data-brand-subtitle>Choose a sign-in method, then enter the world and continue into character selection.</p>
      </div>

      <div class="xr-landing-auth-pill" hidden>Signed in</div>

      <section class="xr-landing-view active">
        <div class="xr-landing-copy" data-signin-only>
          <h2>One account flow</h2>
          <p>Sign in once, then use Enter World to open the character flow.</p>
        </div>
        <div class="xr-landing-socials" data-socials="sign-in" data-signin-only></div>
        <button type="button" class="xr-landing-social xr-landing-wallet-btn" data-action="connect-wallet" data-signin-only>
          Connect Wallet (MetaMask)
        </button>
        <div class="xr-landing-divider" data-signin-only><span>or with email</span></div>
        <div class="xr-landing-form" data-email-flow data-signin-only>
          <label class="xr-landing-field">
            <span>Email</span>
            <input name="email" type="email" autocomplete="email" placeholder="you@example.com" />
          </label>
          <label class="xr-landing-field xr-landing-otp" hidden>
            <span>Verification Code</span>
            <input name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />
          </label>
          <div class="xr-landing-actions">
            <button type="button" class="xr-landing-btn xr-landing-btn-primary" data-action="send-code">Send Code</button>
            <button type="button" class="xr-landing-btn xr-landing-btn-ghost" data-action="verify-code" hidden>Verify Code</button>
          </div>
        </div>
        <div class="xr-landing-actions xr-landing-actions-stack">
          <button type="button" class="xr-landing-btn xr-landing-btn-primary xr-landing-btn-play" data-action="continue-world" disabled>Enter World</button>
        </div>
        <button type="button" class="xr-landing-quiet xr-landing-signout" data-action="sign-out" hidden>Sign Out</button>
      </section>
    `;

    this.statusEl = document.createElement("div");
    this.statusEl.className = "xr-landing-status";
    this.statusEl.textContent = "Loading world...";
    this.panel.appendChild(this.statusEl);

    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);

    this.zoneEl = this.panel.querySelector("[data-zone]");
    this.onlineEl = this.panel.querySelector("[data-online]");
    this.continueBtn = this.panel.querySelector("[data-action='continue-world']") as HTMLButtonElement;
    this.signOutBtn = this.panel.querySelector("[data-action='sign-out']") as HTMLButtonElement;
    this.authPill = this.panel.querySelector(".xr-landing-auth-pill") as HTMLDivElement;

    this.mountSocialButtons();
    this.bindEvents();
    void this.hydrateExistingSession();
  }

  isActive(): boolean {
    return this.root.style.display !== "none";
  }

  setReady(ready: boolean) {
    this.ready = ready;
    this.refreshActionState();
    if (ready) {
      this.setStatus(this.walletAddress ? `Signed in as ${this.truncateAddress(this.walletAddress)}.` : "World ready. Sign in to enter.");
    } else {
      this.setStatus("Loading world...");
    }
  }

  setOnlineCount(count: number) {
    if (this.onlineEl) this.onlineEl.textContent = String(count);
  }

  setFeaturedZone(zoneId: string) {
    if (this.zoneEl) this.zoneEl.textContent = zoneId.replace(/-/g, " ");
  }

  hide() {
    this.root.style.display = "none";
  }

  show() {
    this.root.style.display = "";
  }

  private bindEvents() {
    this.continueBtn.addEventListener("click", () => {
      if (!this.ready || !this.walletAddress) return;
      this.enterWorld(this.walletAddress, "authenticated");
    });

    this.signOutBtn.addEventListener("click", async () => {
      await this.runBusy("Signing out...", async () => {
        const { xrAuth } = await this.loadAuthModule();
        await xrAuth.disconnect();
        this.walletAddress = null;
        this.refreshActionState();
        this.setStatus(this.ready ? "Signed out. Sign in to enter." : "Loading world...");
      });
    });

    this.panel.querySelector("[data-action='send-code']")?.addEventListener("click", () => {
      void this.sendEmailCode();
    });
    this.panel.querySelector("[data-action='verify-code']")?.addEventListener("click", () => {
      void this.verifyEmailCode();
    });
    this.panel.querySelector("[data-action='connect-wallet']")?.addEventListener("click", () => {
      void this.connectWallet();
    });
  }

  private async hydrateExistingSession() {
    await this.runBusy("Restoring session...", async () => {
      const { xrAuth } = await this.loadAuthModule();
      const address = await xrAuth.autoConnect();
      this.walletAddress = address;
      this.refreshActionState();
      if (address) {
        this.setStatus(this.ready ? `Signed in as ${this.truncateAddress(address)}.` : "Loading world...");
      } else {
        this.setStatus(this.ready ? "World ready. Sign in to enter." : "Loading world...");
      }
    });
  }

  private mountSocialButtons() {
    const container = this.panel.querySelector("[data-socials='sign-in']");
    if (!container) return;

    for (const social of SOCIALS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "xr-landing-social";
      button.textContent = social.label;
      button.style.setProperty("--social-accent", social.accent);
      button.addEventListener("click", () => {
        void this.connectSocial(social.strategy);
      });
      container.appendChild(button);
    }
  }

  private getFlowElements() {
    const flow = this.panel.querySelector("[data-email-flow]") as HTMLDivElement;
    return {
      emailInput: flow.querySelector<HTMLInputElement>("input[name='email']")!,
      otpWrap: flow.querySelector<HTMLElement>(".xr-landing-otp")!,
      otpInput: flow.querySelector<HTMLInputElement>("input[name='otp']")!,
      sendBtn: flow.querySelector<HTMLElement>("[data-action='send-code']")!,
      verifyBtn: flow.querySelector<HTMLElement>("[data-action='verify-code']")!,
    };
  }

  private async connectSocial(strategy: SocialStrategy) {
    await this.runBusy(
      `Signing in with ${strategy}...`,
      async () => {
        const { xrAuth } = await this.loadAuthModule();
        const address = await xrAuth.connectSocial(strategy);
        this.walletAddress = address;
        this.refreshActionState();
        this.setStatus(`Signed in as ${this.truncateAddress(address)}. Enter world when ready.`);
      }
    );
  }

  private async sendEmailCode() {
    const els = this.getFlowElements();
    const email = els.emailInput.value.trim();
    if (!email) {
      this.setStatus("Enter your email first.");
      return;
    }

    await this.runBusy("Sending verification code...", async () => {
      const { xrAuth } = await this.loadAuthModule();
      await xrAuth.sendEmailCode(email);
      els.otpWrap.hidden = false;
      els.verifyBtn.hidden = false;
      this.setStatus("Code sent. Enter it to continue.");
      els.otpInput.focus();
    });
  }

  private async verifyEmailCode() {
    const els = this.getFlowElements();
    const email = els.emailInput.value.trim();
    const otp = els.otpInput.value.trim();
    if (!email || !otp) {
      this.setStatus("Enter your email and verification code.");
      return;
    }

    await this.runBusy("Verifying sign-in...", async () => {
      const { xrAuth } = await this.loadAuthModule();
      const address = await xrAuth.verifyEmailCode(email, otp);
      this.walletAddress = address;
      this.refreshActionState();
      this.setStatus(`Signed in as ${this.truncateAddress(address)}. Enter world when ready.`);
    });
  }

  private async connectWallet() {
    await this.runBusy("Connecting wallet...", async () => {
      const { xrAuth } = await this.loadAuthModule();
      const address = await xrAuth.connectWallet();
      this.walletAddress = address;
      this.refreshActionState();
      this.setStatus(`Wallet connected as ${this.truncateAddress(address)}. Enter world when ready.`);
    });
  }

  private refreshActionState() {
    const signedIn = Boolean(this.walletAddress);
    this.continueBtn.disabled = !this.ready || !signedIn;
    this.continueBtn.textContent = signedIn ? "Play Now" : "Enter World";
    this.authPill.hidden = !signedIn;
    this.authPill.textContent = signedIn ? `Signed in · ${this.truncateAddress(this.walletAddress!)}` : "Signed in";
    this.signOutBtn.hidden = !signedIn;

    this.panel.querySelectorAll<HTMLElement>("[data-signin-only]").forEach((el) => {
      el.style.display = signedIn ? "none" : "";
    });

    const title = this.panel.querySelector<HTMLElement>("[data-brand-title]");
    const subtitle = this.panel.querySelector<HTMLElement>("[data-brand-subtitle]");
    if (title) title.textContent = signedIn ? "Welcome Back" : "Sign In";
    if (subtitle) {
      subtitle.textContent = signedIn
        ? "You're signed in. Jump back into the world and continue your adventure."
        : "Choose a sign-in method, then enter the world and continue into character selection.";
    }
  }

  private async runBusy(label: string, fn: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.panel.classList.add("is-busy");
    this.setStatus(label);
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(message || "Something went wrong.");
    } finally {
      this.busy = false;
      this.panel.classList.remove("is-busy");
    }
  }

  private enterWorld(walletAddress: string | null, mode: "guest" | "authenticated") {
    if (!this.ready) return;
    this.hide();
    this.options.onEnterWorld({ walletAddress, mode });
  }

  private setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  private truncateAddress(address: string) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  private async loadAuthModule() {
    return await import("../auth.js");
  }

  private injectStyles() {
    if (document.getElementById("xr-landing-styles")) return;

    const style = document.createElement("style");
    style.id = "xr-landing-styles";
    style.textContent = `
      :root {
        --xr-landing-ink: #f4ead0;
        --xr-landing-copy: #d0c0a1;
        --xr-landing-muted: #8f8067;
        --xr-landing-gold: #efc97f;
        --xr-landing-emerald: #7fd6be;
        --xr-landing-border: rgba(239, 201, 127, 0.42);
      }

      #xr-landing {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        font-family: Georgia, "Times New Roman", serif;
      }

      .xr-landing-scrim {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 30%, rgba(255, 221, 164, 0.14), transparent 26%),
          radial-gradient(circle at 18% 18%, rgba(97, 164, 145, 0.1), transparent 28%),
          linear-gradient(180deg, rgba(5, 6, 10, 0.12), rgba(5, 6, 10, 0.74));
        backdrop-filter: blur(4px);
      }

      .xr-landing-panel {
        position: relative;
        width: min(470px, calc(100vw - 32px));
        padding: 30px 28px 22px;
        border-radius: 30px;
        background:
          linear-gradient(180deg, rgba(42, 31, 21, 0.94) 0%, rgba(16, 13, 11, 0.97) 100%);
        border: 1px solid var(--xr-landing-border);
        box-shadow:
          0 28px 90px rgba(0, 0, 0, 0.58),
          inset 0 1px 0 rgba(255, 244, 215, 0.08),
          inset 0 0 0 1px rgba(239, 201, 127, 0.08);
        pointer-events: auto;
        overflow: hidden;
      }

      .xr-landing-panel::before,
      .xr-landing-panel::after {
        content: "";
        position: absolute;
        left: 28px;
        right: 28px;
        height: 10px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(92, 56, 30, 0.92), rgba(239, 201, 127, 0.98), rgba(92, 56, 30, 0.92));
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.26);
      }

      .xr-landing-panel::before { top: 18px; }
      .xr-landing-panel::after { bottom: 18px; }

      .xr-landing-panel.is-busy button {
        pointer-events: none;
        opacity: 0.78;
      }

      .xr-landing-brand {
        position: relative;
        z-index: 1;
        text-align: center;
        padding: 18px 18px 14px;
      }

      .xr-landing-logo {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 16px;
        text-align: left;
      }

      .xr-landing-logo-mark {
        display: grid;
        place-items: center;
        width: 72px;
        height: 72px;
        border-radius: 22px;
        background:
          radial-gradient(circle at 35% 35%, rgba(255, 242, 205, 0.32), transparent 42%),
          linear-gradient(135deg, rgba(239, 201, 127, 0.96), rgba(110, 65, 34, 0.96));
        color: #24160d;
        box-shadow:
          inset 0 1px 0 rgba(255, 247, 226, 0.48),
          0 12px 28px rgba(0, 0, 0, 0.26);
        font-size: 42px;
        font-weight: 700;
        line-height: 1;
      }

      .xr-landing-logo-copy {
        min-width: 0;
      }

      .xr-landing-kicker {
        display: inline-flex;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid rgba(239, 201, 127, 0.18);
        background: rgba(255, 248, 227, 0.05);
        color: var(--xr-landing-gold);
        font: 600 11px/1 "Courier New", monospace;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      .xr-landing-brand h1 {
        margin: 14px 0 0;
        color: var(--xr-landing-ink);
        font-size: clamp(36px, 5vw, 50px);
        line-height: 0.94;
        text-transform: uppercase;
      }

      .xr-landing-brand p,
      .xr-landing-copy p {
        color: var(--xr-landing-copy);
        font-size: 14px;
        line-height: 1.65;
      }

      .xr-landing-auth-pill {
        position: relative;
        z-index: 1;
        margin-top: 14px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(127, 214, 190, 0.12);
        border: 1px solid rgba(127, 214, 190, 0.22);
        color: #d5fff1;
        font: 600 11px/1 "Courier New", monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        text-align: center;
      }

      .xr-landing-view {
        position: relative;
        z-index: 1;
      }

      .xr-landing-copy h2 {
        margin: 0 0 8px;
        color: var(--xr-landing-ink);
        font-size: 24px;
      }

      .xr-landing-socials {
        display: grid;
        gap: 10px;
        margin-top: 18px;
      }

      .xr-landing-social {
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid color-mix(in srgb, var(--social-accent) 48%, transparent);
        background: linear-gradient(135deg, color-mix(in srgb, var(--social-accent) 22%, rgba(16, 14, 11, 0.9)), rgba(16, 14, 11, 0.82));
        color: var(--xr-landing-ink);
        cursor: pointer;
        font: 700 12px/1 "Courier New", monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        transition: transform 160ms ease, box-shadow 160ms ease;
      }

      .xr-landing-social:hover {
        transform: translateY(-2px);
        box-shadow: 0 14px 28px rgba(0, 0, 0, 0.22);
      }

      .xr-landing-divider {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 18px 0 10px;
        color: var(--xr-landing-muted);
        font: 600 11px/1 "Courier New", monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .xr-landing-divider::before,
      .xr-landing-divider::after {
        content: "";
        flex: 1;
        height: 1px;
        background: rgba(239, 201, 127, 0.12);
      }

      .xr-landing-form {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .xr-landing-field {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .xr-landing-field span {
        color: var(--xr-landing-gold);
        font: 600 11px/1 "Courier New", monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .xr-landing-field input {
        width: 100%;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid rgba(239, 201, 127, 0.14);
        background: rgba(14, 11, 10, 0.62);
        color: var(--xr-landing-ink);
        font: 500 15px/1.2 Georgia, "Times New Roman", serif;
        outline: none;
      }

      .xr-landing-field input:focus {
        border-color: rgba(127, 214, 190, 0.4);
        box-shadow: 0 0 0 4px rgba(127, 214, 190, 0.08);
      }

      .xr-landing-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 4px;
      }

      .xr-landing-actions-stack {
        grid-template-columns: 1fr;
        margin-top: 20px;
      }

      .xr-landing-btn,
      .xr-landing-quiet {
        border: none;
        border-radius: 18px;
        cursor: pointer;
        transition: transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
      }

      .xr-landing-btn:hover,
      .xr-landing-quiet:hover {
        transform: translateY(-2px);
      }

      .xr-landing-btn-primary {
        padding: 15px 18px;
        background: linear-gradient(135deg, #f0cc87, #b57743);
        color: #23170f;
        box-shadow: 0 16px 30px rgba(181, 119, 67, 0.25);
        font: 700 12px/1 "Courier New", monospace;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .xr-landing-btn-secondary {
        padding: 15px 18px;
        background: linear-gradient(135deg, rgba(127, 214, 190, 0.18), rgba(70, 104, 103, 0.44));
        color: #e6fff7;
        font: 700 12px/1 "Courier New", monospace;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .xr-landing-btn-ghost {
        padding: 15px 18px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(239, 201, 127, 0.12);
        color: var(--xr-landing-copy);
        font: 700 12px/1 "Courier New", monospace;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .xr-landing-btn:disabled {
        opacity: 0.52;
        cursor: not-allowed;
        transform: none;
      }

      .xr-landing-quiet {
        width: 100%;
        margin-top: 14px;
        padding: 13px 16px;
        background: rgba(8, 10, 12, 0.44);
        color: var(--xr-landing-ink);
        border: 1px solid rgba(239, 201, 127, 0.12);
        font: 700 12px/1 "Courier New", monospace;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .xr-landing-signout {
        margin-top: 10px;
        color: #ffccbf;
      }

      .xr-landing-status {
        position: relative;
        z-index: 1;
        margin-top: 18px;
        padding: 11px 14px;
        border-radius: 14px;
        background: rgba(8, 9, 12, 0.4);
        border: 1px solid rgba(239, 201, 127, 0.12);
        color: var(--xr-landing-muted);
        font: 600 11px/1.35 "Courier New", monospace;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      @media (max-width: 640px) {
        .xr-landing-panel {
          width: calc(100vw - 20px);
          padding: 24px 18px 18px;
          border-radius: 24px;
        }

        .xr-landing-logo,
        .xr-landing-actions {
          grid-template-columns: 1fr;
        }

        .xr-landing-logo {
          text-align: center;
        }

        .xr-landing-logo-copy {
          display: grid;
          justify-items: center;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
