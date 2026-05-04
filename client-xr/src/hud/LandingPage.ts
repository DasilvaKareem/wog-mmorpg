interface LandingPageOptions {
  onEnterWorld: (detail: { walletAddress: string | null; mode: "guest" | "authenticated" }) => void;
}
type AuthMode = "signup" | "login";
type SocialStrategy = "google" | "discord";
const PUBLIC_BASE = import.meta.env.BASE_URL;
const HERO_LOGO_SRC = `${PUBLIC_BASE}assets/logo.png`;
const HERO_DUEL_SRC = `${PUBLIC_BASE}assets/hero-duel.png`;
const DISCORD_INVITE_URL = "https://discord.gg/AeCAeBZema";

function clientPageUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return `${window.location.protocol}//${window.location.hostname}:5173${normalizedPath}`;
  }
  return normalizedPath;
}

export class LandingPage {
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private zoneEl: HTMLSpanElement | null;
  private onlineEl: HTMLSpanElement | null;
  private continueBtn: HTMLButtonElement;
  private authChooserEl: HTMLDivElement;
  private authTitleEl: HTMLDivElement;
  private ready = false;
  private busy = false;
  private walletAddress: string | null = null;
  private authExpanded = false;
  private authMode: AuthMode = "signup";

  constructor(private options: LandingPageOptions) {
    this.injectStyles();

    this.root = document.createElement("div");
    this.root.id = "xr-landing";
    this.root.innerHTML = `
      <div class="xr-landing-scrim"></div>
      <header class="xr-landing-topbar">
        <div class="xr-landing-top-left">
          <img class="xr-landing-duel" src="${HERO_DUEL_SRC}" alt="Game icon" />
          <nav class="xr-landing-nav" aria-label="Primary">
            <a class="active" href="${clientPageUrl("/")}" aria-current="page">GAME<span class="caret">˅</span></a>
            <a href="${clientPageUrl("/marketplace")}">SHOP<span class="caret">˅</span></a>
            <a href="${clientPageUrl("/leaderboards")}">COMMUNITY<span class="caret">˅</span></a>
            <a href="${clientPageUrl("/champions")}">CHAMPIONS</a>
          </nav>
        </div>
      </header>
      <div class="xr-landing-legal" aria-label="Legal links">
        <a href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener noreferrer">Join Discord</a>
        <span aria-hidden="true">|</span>
        <a href="${clientPageUrl("/terms")}" target="_blank" rel="noopener noreferrer">Terms</a>
        <span aria-hidden="true">|</span>
        <a href="${clientPageUrl("/privacy")}" target="_blank" rel="noopener noreferrer">Privacy</a>
      </div>
    `;

    this.panel = document.createElement("div");
    this.panel.className = "xr-landing-panel";
    this.panel.innerHTML = `
      <div class="xr-landing-brand">
        <div class="xr-landing-logo" aria-label="World of Geneva">
          <img class="xr-landing-logo-image" src="${HERO_LOGO_SRC}" alt="World of Geneva" />
        </div>
      </div>

      <section class="xr-landing-view active">
        <div class="xr-landing-actions xr-landing-actions-stack">
          <button type="button" class="xr-landing-btn xr-landing-btn-primary xr-landing-btn-play" data-action="sign-up">Sign Up</button>
        </div>
        <div class="xr-landing-auth-chooser" data-auth-chooser hidden>
          <div class="xr-landing-auth-title" data-auth-title>Sign up options</div>
          <div class="xr-landing-auth-row">
            <button type="button" class="xr-landing-auth-btn" data-action="auth-google">Continue with Google</button>
            <button type="button" class="xr-landing-auth-btn" data-action="auth-discord">Continue with Discord</button>
            <button type="button" class="xr-landing-auth-btn" data-action="auth-wallet">Connect Wallet</button>
          </div>
          <div class="xr-landing-auth-switch">
            <button type="button" data-action="mode-signup" class="active">Sign Up</button>
            <span>|</span>
            <button type="button" data-action="mode-login">Log In</button>
          </div>
        </div>
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
    this.continueBtn = this.panel.querySelector("[data-action='sign-up']") as HTMLButtonElement;
    this.authChooserEl = this.panel.querySelector("[data-auth-chooser]") as HTMLDivElement;
    this.authTitleEl = this.panel.querySelector("[data-auth-title]") as HTMLDivElement;
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
      if (!this.ready) return;
      if (this.walletAddress) {
        this.enterWorld(this.walletAddress, "authenticated");
        return;
      }
      this.authExpanded = true;
      this.refreshActionState();
      this.refreshAuthChooserUI();
    });

    this.panel.querySelector("[data-action='auth-google']")?.addEventListener("click", () => {
      void this.connectSocial("google");
    });
    this.panel.querySelector("[data-action='auth-discord']")?.addEventListener("click", () => {
      void this.connectSocial("discord");
    });
    this.panel.querySelector("[data-action='auth-wallet']")?.addEventListener("click", () => {
      void this.connectWallet();
    });
    this.panel.querySelector("[data-action='mode-signup']")?.addEventListener("click", () => {
      this.authMode = "signup";
      this.refreshAuthChooserUI();
    });
    this.panel.querySelector("[data-action='mode-login']")?.addEventListener("click", () => {
      this.authMode = "login";
      this.refreshAuthChooserUI();
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

  private refreshActionState() {
    const signedIn = Boolean(this.walletAddress);
    this.continueBtn.disabled = !this.ready;
    this.continueBtn.textContent = signedIn ? "Enter World" : "Sign Up";
    this.authChooserEl.hidden = signedIn || !this.authExpanded;
  }

  private refreshAuthChooserUI() {
    const signupMode = this.authMode === "signup";
    this.authTitleEl.textContent = signupMode ? "Sign up options" : "Log in options";
    const signupBtn = this.panel.querySelector("[data-action='mode-signup']") as HTMLButtonElement | null;
    const loginBtn = this.panel.querySelector("[data-action='mode-login']") as HTMLButtonElement | null;
    signupBtn?.classList.toggle("active", signupMode);
    loginBtn?.classList.toggle("active", !signupMode);
  }

  private async connectSocial(strategy: SocialStrategy) {
    const label = this.authMode === "signup" ? "Creating account..." : "Logging in...";
    await this.runBusy(label, async () => {
      const { xrAuth } = await this.loadAuthModule();
      const address = await xrAuth.connectSocial(strategy);
      this.walletAddress = address;
      this.authExpanded = false;
      this.refreshActionState();
      const verb = this.authMode === "signup" ? "Signed up" : "Logged in";
      this.setStatus(`${verb} as ${this.truncateAddress(address)}.`);
    });
  }

  private async connectWallet() {
    const label = this.authMode === "signup" ? "Connecting wallet..." : "Logging in with wallet...";
    await this.runBusy(label, async () => {
      const { xrAuth } = await this.loadAuthModule();
      const address = await xrAuth.connectWallet();
      this.walletAddress = address;
      this.authExpanded = false;
      this.refreshActionState();
      const verb = this.authMode === "signup" ? "Wallet connected" : "Logged in";
      this.setStatus(`${verb} as ${this.truncateAddress(address)}.`);
    });
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

      .xr-landing-topbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 43;
        pointer-events: none;
        padding: 14px 20px 0;
      }

      .xr-landing-top-left {
        display: inline-flex;
        align-items: flex-start;
        gap: 12px;
        pointer-events: auto;
      }

      .xr-landing-duel {
        width: 48px;
        height: 48px;
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid rgba(140, 190, 255, 0.3);
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.4);
      }

      .xr-landing-nav {
        margin-top: 8px;
        display: inline-flex;
        align-items: center;
        gap: 30px;
        padding: 0;
      }

      .xr-landing-nav a {
        position: relative;
        color: #9ba9cc;
        text-decoration: none;
        font: 800 20px/1 "Courier New", monospace;
        letter-spacing: 0.02em;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
      }

      .xr-landing-nav .caret {
        margin-left: 5px;
        color: #8a96bb;
        font-size: 14px;
      }

      .xr-landing-nav a.active {
        color: #ffcc24;
      }

      .xr-landing-nav a.active .caret {
        color: #ffcc24;
      }

      .xr-landing-nav a.active::after {
        content: "";
        position: absolute;
        left: 0;
        right: 4px;
        bottom: -10px;
        height: 4px;
        background: #ffcc24;
      }

      .xr-landing-legal {
        position: fixed;
        right: 20px;
        bottom: 14px;
        z-index: 42;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        pointer-events: auto;
        font: 700 12px/1 "Courier New", monospace;
        letter-spacing: 0.06em;
        color: rgba(216, 232, 245, 0.82);
      }

      .xr-landing-legal a {
        color: rgba(216, 232, 245, 0.9);
        text-decoration: none;
      }

      .xr-landing-legal a:hover {
        color: #e8f5ff;
        text-decoration: underline;
      }

      .xr-landing-panel {
        position: relative;
        width: min(760px, calc(100vw - 32px));
        padding: 140px 24px 18px;
        border-radius: 20px;
        background: transparent;
        border: none;
        box-shadow: none;
        pointer-events: auto;
        overflow: hidden;
      }

      .xr-landing-panel::before,
      .xr-landing-panel::after {
        content: none;
      }

      .xr-landing-panel.is-busy button {
        pointer-events: none;
        opacity: 0.78;
      }

      .xr-landing-brand {
        position: relative;
        z-index: 1;
        text-align: center;
        padding: 8px 8px 2px;
      }

      .xr-landing-logo {
        display: grid;
        align-items: center;
        justify-content: center;
        margin-bottom: 0;
      }

      .xr-landing-logo-image {
        width: min(480px, 80vw);
        max-width: 100%;
        height: auto;
        display: block;
        filter: drop-shadow(0 14px 30px rgba(0, 0, 0, 0.45));
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
        margin: -6px auto 0;
        max-width: 320px;
      }

      .xr-landing-auth-chooser {
        margin: 10px auto 0;
        max-width: 560px;
        padding: 12px;
        border: 1px solid rgba(146, 185, 222, 0.26);
        background: rgba(7, 16, 36, 0.68);
      }

      .xr-landing-auth-title {
        color: #d7e6f6;
        font: 700 12px/1 "Courier New", monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        margin-bottom: 10px;
      }

      .xr-landing-auth-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .xr-landing-auth-btn {
        border: 1px solid rgba(146, 185, 222, 0.35);
        background: rgba(12, 24, 50, 0.85);
        color: #d7e6f6;
        min-height: 38px;
        font: 700 11px/1 "Courier New", monospace;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        cursor: pointer;
      }

      .xr-landing-auth-btn:hover {
        background: rgba(21, 38, 74, 0.92);
      }

      .xr-landing-auth-switch {
        margin-top: 10px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #9db2cd;
        font: 700 11px/1 "Courier New", monospace;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .xr-landing-auth-switch button {
        border: none;
        background: transparent;
        color: #9db2cd;
        font: inherit;
        cursor: pointer;
        padding: 0;
      }

      .xr-landing-auth-switch button.active {
        color: #ffcc24;
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
        padding: 16px 18px;
        background: linear-gradient(180deg, #cfe4f5, #8bb4d4);
        color: #13314f;
        border: none;
        box-shadow: 0 14px 30px rgba(69, 111, 146, 0.35);
        font: 700 13px/1 "Courier New", monospace;
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
        .xr-landing-topbar {
          padding: 8px 10px 0;
        }

        .xr-landing-top-left {
          gap: 8px;
        }

        .xr-landing-duel {
          width: 40px;
          height: 40px;
        }

        .xr-landing-nav {
          gap: 10px;
          padding: 0;
          margin-top: 0;
          overflow-x: auto;
          max-width: calc(100vw - 20px);
        }

        .xr-landing-nav a {
          font-size: 12px;
          white-space: nowrap;
        }

        .xr-landing-nav .caret {
          font-size: 11px;
        }

        .xr-landing-nav a.active::after {
          bottom: -10px;
          left: 24px;
          height: 3px;
        }

        .xr-landing-panel {
          width: calc(100vw - 20px);
          padding: 92px 10px 16px;
          border-radius: 24px;
        }

        .xr-landing-actions {
          grid-template-columns: 1fr;
        }

        .xr-landing-auth-row {
          grid-template-columns: 1fr;
        }

        .xr-landing-logo { justify-items: center; }

        .xr-landing-legal {
          right: 12px;
          bottom: 10px;
          font-size: 11px;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
