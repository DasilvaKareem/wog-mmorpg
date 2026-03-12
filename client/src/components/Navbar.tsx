import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { useWalletContext } from "@/context/WalletContext";
import { useWogNames } from "@/hooks/useWogNames";
import { openOnboarding } from "@/lib/onboarding";

interface DropdownItem {
  label: string;
  to?: string;
  href?: string;
  action?: "download-pwa";
  icon: string;
}

interface DropdownMenu {
  label: string;
  icon: string;
  to?: string; // If set, acts as a direct link instead of dropdown
  items: DropdownItem[];
}

const MENUS: DropdownMenu[] = [
  {
    label: "Game",
    icon: ">>",
    items: [
      { label: "Overview", to: "/", icon: "//" },
      { label: "Races & Classes", to: "/races", icon: "**" },
      { label: "Story & Lore", to: "/story", icon: "<<" },
      { label: "Media", to: "/media", icon: "[]" },
      { label: "x402 Agent Deploy", to: "/x402", icon: "$>" },
      { label: "Pricing", to: "/pricing", icon: "&&" },
      { label: "Download", action: "download-pwa", icon: "DL" },
    ],
  },
  {
    label: "Shop",
    icon: "$$",
    items: [
      { label: "NFT Marketplace", to: "/marketplace", icon: "$$" },
      { label: "Agent Pricing", to: "/pricing", icon: "&&" },
    ],
  },
  {
    label: "Community",
    icon: "##",
    items: [
      { label: "Leaderboards", to: "/leaderboards", icon: "##" },
      { label: "Discord", href: "https://discord.gg/worldofgeneva", icon: ">>" },
      { label: "News & Roadmap", to: "/news", icon: "!!" },
    ],
  },
  {
    label: "Champions",
    icon: "@>",
    to: "/champions",
    items: [],
  },
];

function DropdownLink({
  item,
  onClick,
  isActive,
  onAction,
}: {
  item: DropdownItem;
  onClick: () => void;
  isActive: boolean;
  onAction: (action: NonNullable<DropdownItem["action"]>) => void;
}) {
  const baseClass = `flex items-center gap-2 px-4 py-2.5 text-[9px] uppercase tracking-wide transition ${
    isActive
      ? "bg-[#1e2842] text-[#ffcc00]"
      : "text-[#d6deff] hover:bg-[#1e2842] hover:text-[#ffcc00]"
  }`;

  if (item.action) {
    return (
      <button
        type="button"
        className={`${baseClass} w-full text-left`}
        onClick={() => {
          onAction(item.action!);
          onClick();
        }}
      >
        <span className="text-[8px] text-[#565f89]">{item.icon}</span>
        {item.label}
      </button>
    );
  }

  if (item.href) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={baseClass}
        onClick={onClick}
      >
        <span className="text-[8px] text-[#565f89]">{item.icon}</span>
        {item.label}
        <span className="ml-auto text-[7px] text-[#3a4260]">[ext]</span>
      </a>
    );
  }
  return (
    <Link to={item.to!} className={baseClass} onClick={onClick}>
      <span className={`text-[8px] ${isActive ? "text-[#ffcc00]" : "text-[#565f89]"}`}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

function detectIsIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function detectIsAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

function detectIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if ((window.navigator as any).standalone === true) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}

function DownloadPwaModal({
  open,
  onClose,
  canPromptInstall,
  isInstalled,
  isIos,
  isAndroid,
  onPromptInstall,
}: {
  open: boolean;
  onClose: () => void;
  canPromptInstall: boolean;
  isInstalled: boolean;
  isIos: boolean;
  isAndroid: boolean;
  onPromptInstall: () => Promise<void>;
}): React.ReactElement | null {
  if (!open) return null;

  const platformLabel = isIos ? "iPhone / iPad" : isAndroid ? "Android" : "Desktop";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl border-4 border-[#54f28b] bg-[#060d12] font-mono shadow-[8px_8px_0_0_#000]">
        <div className="flex items-center justify-between border-b-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2">
          <div>
            <p className="text-[12px] uppercase tracking-widest text-[#54f28b]">{">>> Download World of Geneva"}</p>
            <p className="text-[10px] text-[#6d77a3]">Install the PWA on {platformLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[14px] text-[#54f28b] transition-colors hover:text-[#ffcc00]"
          >
            [X]
          </button>
        </div>

        <div className="space-y-4 p-5 text-[12px] text-[#d6deff]">
          <div className="border-2 border-[#2a3450] bg-[#0e1628] p-4">
            {isInstalled ? (
              <>
                <p className="text-[13px] uppercase tracking-wide text-[#54f28b]">Already installed</p>
                <p className="mt-2 text-[#9aa7cc]">
                  This device is already running the installed app experience.
                </p>
              </>
            ) : canPromptInstall ? (
              <>
                <p className="text-[13px] uppercase tracking-wide text-[#ffcc00]">Install directly from this browser</p>
                <p className="mt-2 text-[#9aa7cc]">
                  Your browser supports the install prompt. Use the button below for the fastest path.
                </p>
                <button
                  type="button"
                  onClick={() => void onPromptInstall()}
                  className="mt-3 border-2 border-black bg-[#54f28b] px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-[#060d12] shadow-[3px_3px_0_0_#000] transition hover:bg-[#7bf5a8]"
                >
                  Install App
                </button>
              </>
            ) : (
              <>
                <p className="text-[13px] uppercase tracking-wide text-[#ffcc00]">Manual install</p>
                <p className="mt-2 text-[#9aa7cc]">
                  This browser is not exposing the one-click prompt right now, but you can still install the app from the browser menu.
                </p>
              </>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="border-2 border-[#2a3450] bg-[#0b1020] p-3">
              <p className="text-[11px] uppercase tracking-widest text-[#54f28b]">Desktop</p>
              <p className="mt-2 text-[11px] text-[#9aa7cc]">
                Chrome or Edge: open the site menu, then choose <span className="text-[#e8eeff]">Install app</span> or click the install icon in the address bar.
              </p>
            </div>
            <div className="border-2 border-[#2a3450] bg-[#0b1020] p-3">
              <p className="text-[11px] uppercase tracking-widest text-[#54f28b]">iPhone / iPad</p>
              <p className="mt-2 text-[11px] text-[#9aa7cc]">
                Safari: tap <span className="text-[#e8eeff]">Share</span>, then <span className="text-[#e8eeff]">Add to Home Screen</span>.
              </p>
            </div>
            <div className="border-2 border-[#2a3450] bg-[#0b1020] p-3">
              <p className="text-[11px] uppercase tracking-widest text-[#54f28b]">Android</p>
              <p className="mt-2 text-[11px] text-[#9aa7cc]">
                Chrome: tap the browser menu, then <span className="text-[#e8eeff]">Install app</span> or <span className="text-[#e8eeff]">Add to Home screen</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Navbar(): React.ReactElement {
  const location = useLocation();
  const { isConnected, disconnect, address, balance } = useWalletContext();
  const { dn } = useWogNames(address ? [address] : []);
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [downloadOpen, setDownloadOpen] = React.useState(false);
  const [installPrompt, setInstallPrompt] = React.useState<any>(null);
  const [isInstalled, setIsInstalled] = React.useState(detectIsStandalone);
  const navRef = React.useRef<HTMLElement>(null);
  const isIos = detectIsIos();
  const isAndroid = detectIsAndroid();

  const isGameRoute = location.pathname === "/world" || location.pathname === "/spectate";

  // Close dropdown on outside click
  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close on route change
  React.useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [location.pathname]);

  React.useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleDisplayModeChange = () => setIsInstalled(detectIsStandalone());

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    mediaQuery.addEventListener("change", handleDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      mediaQuery.removeEventListener("change", handleDisplayModeChange);
    };
  }, []);

  const closeAll = () => {
    setOpenMenu(null);
    setMobileOpen(false);
  };

  const handleDropdownAction = React.useCallback((action: NonNullable<DropdownItem["action"]>) => {
    if (action === "download-pwa") {
      setDownloadOpen(true);
    }
  }, []);

  const handlePromptInstall = React.useCallback(async () => {
    if (!installPrompt || typeof installPrompt.prompt !== "function") return;
    await installPrompt.prompt();
    if (typeof installPrompt.userChoice?.then === "function") {
      await installPrompt.userChoice.catch(() => {});
    }
    setInstallPrompt(null);
    setIsInstalled(detectIsStandalone());
  }, [installPrompt]);

  // Check if any item in a menu group is active
  const isMenuActive = (menu: DropdownMenu) =>
    menu.items.some((item) => item.to && item.to === location.pathname);

  // On /world and /spectate, show logo + sign-in button when not connected
  if (isGameRoute) {
    return (
      <nav className="pointer-events-none fixed top-0 left-0 right-0 z-[60]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-0">
          <Link
            to="/"
            title="Go to homepage"
            className="pointer-events-auto flex items-center rounded-sm bg-[#0d1526]/90 px-2 py-1 transition-transform hover:scale-[1.03]"
          >
            <img
              src="/assets/logo.png"
              alt="World of Geneva"
              className="h-10 w-auto object-contain"
            />
          </Link>
          {!isConnected && (
            <button
              onClick={() => {
                openOnboarding("sign-in");
              }}
              className="pointer-events-auto border-2 border-[#ffcc00] bg-[#2a2210] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#ffcc00] shadow-[2px_2px_0_0_#000] transition hover:bg-[#3d3218]"
            >
              Summon Champion
            </button>
          )}
        </div>
      </nav>
    );
  }

  return (
    <nav
      ref={navRef}
      className="fixed top-0 left-0 right-0 z-[60] border-b-2 border-[#2a3450] bg-[#0d1526]"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-0">
        {/* Logo */}
        <Link to="/" className="flex items-center py-1">
          <img
            src="/assets/logo.png"
            alt="World of Geneva"
            className="h-20 w-auto object-contain transition-opacity hover:opacity-80"
            style={{ filter: "drop-shadow(0 0 6px rgba(0,0,0,0.8))" }}
          />
        </Link>

        {/* Desktop menu */}
        <div className="hidden items-center gap-0 md:flex">
          {MENUS.map((menu) => {
            const active = menu.to
              ? location.pathname === menu.to
              : isMenuActive(menu);
            // Direct link (no dropdown)
            if (menu.to) {
              return (
                <div key={menu.label} className="relative">
                  <Link
                    to={menu.to}
                    className={`flex items-center gap-1 px-3 py-3 text-[10px] uppercase tracking-wide transition ${
                      active ? "text-[#ffcc00]" : "text-[#9aa7cc] hover:text-[#d6deff]"
                    }`}
                  >
                    <span className="text-[8px]">{menu.icon}</span>
                    {menu.label}
                  </Link>
                  {active && (
                    <div className="absolute bottom-0 left-1/2 h-[2px] w-4 -translate-x-1/2 bg-[#ffcc00]" />
                  )}
                </div>
              );
            }
            return (
              <div key={menu.label} className="relative">
                <button
                  className={`flex items-center gap-1 px-3 py-3 text-[10px] uppercase tracking-wide transition ${
                    openMenu === menu.label
                      ? "text-[#ffcc00]"
                      : active
                        ? "text-[#ffcc00]/80"
                        : "text-[#9aa7cc] hover:text-[#d6deff]"
                  }`}
                  onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
                >
                  <span className="text-[8px]">{menu.icon}</span>
                  {menu.label}
                  <span className="text-[8px]">
                    {openMenu === menu.label ? "^" : "v"}
                  </span>
                </button>

                {/* Active indicator dot */}
                {active && !openMenu && (
                  <div className="absolute bottom-0 left-1/2 h-[2px] w-4 -translate-x-1/2 bg-[#ffcc00]" />
                )}

                {openMenu === menu.label && (
                  <div className="absolute left-0 top-full min-w-[180px] border-2 border-[#2a3450] bg-[#0d1526] shadow-[4px_4px_0_0_#000]">
                    <div className="border-b border-[#1e2842] px-4 py-1.5">
                      <span className="text-[7px] uppercase tracking-widest text-[#3a4260]">
                        {menu.label}
                      </span>
                    </div>
                    {menu.items.map((item) => (
                      <DropdownLink
                        key={item.label}
                        item={item}
                        onClick={closeAll}
                        isActive={item.to === location.pathname}
                        onAction={handleDropdownAction}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Docs link */}
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-3 py-3 text-[10px] uppercase tracking-wide text-[#9aa7cc] transition hover:text-[#d6deff]"
          >
            <span className="text-[8px]">{">>>"}</span>
            Docs
          </a>

          {/* Divider */}
          <div className="mx-1 h-4 w-px bg-[#2a3450]" />

          {/* Spectate link */}
          <Link
            to="/world"
            className="flex items-center gap-1.5 border-l border-[#2a3450] px-3 py-2 text-[10px] uppercase tracking-wide transition text-[#54f28b]/70 hover:text-[#54f28b]"
          >
            <span className="inline-block animate-pulse text-[8px]">{">>>"}</span>
            Spectate
          </Link>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Wallet */}
          {!isConnected ? (
            <button
              onClick={() => {
                openOnboarding("sign-in");
              }}
              className="border-2 border-[#ffcc00] bg-[#2a2210] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[#ffcc00] shadow-[2px_2px_0_0_#000] transition hover:bg-[#3d3218] disabled:opacity-50"
            >
              Summon Champion
            </button>
          ) : (
            <div className="flex items-center gap-0">
              {/* Gold balance */}
              {balance && (
                <div className="border-2 border-[#ffcc00]/40 border-r-0 bg-[#1a1800] px-2.5 py-1.5 text-[8px] text-[#ffcc00]">
                  <span className="mr-1 text-[7px] text-[#ffcc00]/60">GOLD</span>
                  {Number(balance.gold).toLocaleString()}
                </div>
              )}
              {/* Address */}
              <div className="border-2 border-[#54f28b]/40 bg-[#112a1b] px-2.5 py-1.5 text-[8px] text-[#54f28b]">
                {address ? dn(address) : ""}
              </div>
              {/* Logout */}
              <button
                onClick={disconnect}
                title="Disconnect wallet"
                className="border-2 border-[#54f28b]/40 border-l-0 bg-[#112a1b] px-2 py-1.5 text-[8px] text-[#54f28b]/60 transition hover:bg-[#1a3d28] hover:text-[#ff4d6d]"
              >
                [x]
              </button>
            </div>
          )}

          {/* Mobile hamburger */}
          <button
            className="flex flex-col gap-[3px] p-2 md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <span
              className={`block h-[2px] w-4 bg-[#9aa7cc] transition-all duration-200 ${
                mobileOpen ? "translate-y-[5px] rotate-45" : ""
              }`}
            />
            <span
              className={`block h-[2px] w-4 bg-[#9aa7cc] transition-all duration-200 ${
                mobileOpen ? "opacity-0" : ""
              }`}
            />
            <span
              className={`block h-[2px] w-4 bg-[#9aa7cc] transition-all duration-200 ${
                mobileOpen ? "-translate-y-[5px] -rotate-45" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="pointer-events-auto border-t-2 border-[#2a3450] bg-[#0d1526] pb-4 md:hidden">
          {MENUS.map((menu) => (
            <div key={menu.label} className="border-b border-[#1e2842]">
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-[10px] uppercase tracking-wide text-[#9aa7cc]"
                onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
              >
                <span className="flex items-center gap-2">
                  <span className="text-[8px] text-[#565f89]">{menu.icon}</span>
                  {menu.label}
                </span>
                <span className="text-[8px]">{openMenu === menu.label ? "[-]" : "[+]"}</span>
              </button>
              {openMenu === menu.label && (
                <div className="border-t border-[#1e2842]/50 bg-[#0a0f1a] pb-2">
                  {menu.items.map((item) => (
                    <DropdownLink
                      key={item.label}
                      item={item}
                      onClick={closeAll}
                      isActive={item.to === location.pathname}
                      onAction={handleDropdownAction}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 px-4 pt-3">
            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[#9aa7cc] transition hover:text-[#d6deff]"
              onClick={closeAll}
            >
              <span className="text-[8px]">{">>>"}</span> Docs
            </a>
            <span className="text-[#2a3450]">|</span>
            <Link
              to="/world"
              className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[#54f28b]"
              onClick={closeAll}
            >
              <span className="animate-pulse text-[8px]">{">>>"}</span> Spectate World
            </Link>
          </div>
        </div>
      )}
      <DownloadPwaModal
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        canPromptInstall={!isInstalled && !isIos && !!installPrompt}
        isInstalled={isInstalled}
        isIos={isIos}
        isAndroid={isAndroid}
        onPromptInstall={handlePromptInstall}
      />
    </nav>
  );
}
