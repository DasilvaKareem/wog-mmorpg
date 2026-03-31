import * as React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";

import { Navbar } from "@/components/Navbar";
import { ToastProvider } from "@/components/ui/toast";
import { GameProvider } from "@/context/GameContext";
import { WalletProvider, useWalletContext } from "@/context/WalletContext";
import { PushNotificationBanner } from "@/components/PushNotificationBanner";
import { gameBus } from "@/lib/eventBus";
import { OPEN_ONBOARDING_EVENT, type OnboardingStartMode } from "@/lib/onboarding";
import { playSoundEffect } from "@/lib/soundEffects";


import { WalletManager } from "@/lib/walletManager";
import { useBackgroundMusic } from "@/hooks/useBackgroundMusic";
import { trackOpenGame } from "@/lib/analytics";

const AuctionHouseDialog = React.lazy(() =>
  import("@/components/AuctionHouseDialog").then((mod) => ({ default: mod.AuctionHouseDialog }))
);
const CharacterDialog = React.lazy(() =>
  import("@/components/CharacterDialog").then((mod) => ({ default: mod.CharacterDialog }))
);
const ColiseumDialog = React.lazy(() =>
  import("@/components/ColiseumDialog").then((mod) => ({ default: mod.ColiseumDialog }))
);
const InspectDialog = React.lazy(() =>
  import("@/components/InspectDialog").then((mod) => ({ default: mod.InspectDialog }))
);
const NpcInfoDialog = React.lazy(() =>
  import("@/components/NpcInfoDialog").then((mod) => ({ default: mod.NpcInfoDialog }))
);
const QuestLogDialog = React.lazy(() =>
  import("@/components/QuestLogDialog").then((mod) => ({ default: mod.QuestLogDialog }))
);
const GameCanvas = React.lazy(() =>
  import("@/components/GameCanvas").then((mod) => ({ default: mod.GameCanvas }))
);
const GuildDialog = React.lazy(() =>
  import("@/components/GuildDialog").then((mod) => ({ default: mod.GuildDialog }))
);
const WalletPanel = React.lazy(() =>
  import("@/components/WalletPanel").then((mod) => ({ default: mod.WalletPanel }))
);
const ChatLog = React.lazy(() =>
  import("@/components/ChatLog").then((mod) => ({ default: mod.ChatLog }))
);
const AgentChatPanel = React.lazy(() =>
  import("@/components/AgentChatPanel").then((mod) => ({ default: mod.AgentChatPanel }))
);
const DeferredWorldDialogs = React.lazy(() =>
  import("@/components/DeferredWorldDialogs").then((mod) => ({ default: mod.DeferredWorldDialogs }))
);
const HotkeyBar = React.lazy(() =>
  import("@/components/HotkeyBar").then((mod) => ({ default: mod.HotkeyBar }))
);
const OnboardingFlow = React.lazy(() =>
  import("@/components/OnboardingFlow").then((mod) => ({ default: mod.OnboardingFlow }))
);
const SettingsDialog = React.lazy(() =>
  import("@/components/SettingsDialog").then((mod) => ({ default: mod.SettingsDialog }))
);
const InboxDialog = React.lazy(() =>
  import("@/components/InboxDialog").then((mod) => ({ default: mod.InboxDialog }))
);
const PlayerPanel = React.lazy(() =>
  import("@/components/PlayerPanel").then((mod) => ({ default: mod.PlayerPanel }))
);
const ProfessionsPanel = React.lazy(() =>
  import("@/components/ProfessionsPanel").then((mod) => ({ default: mod.ProfessionsPanel }))
);
const WorldMap = React.lazy(() =>
  import("@/components/WorldMap").then((mod) => ({ default: mod.WorldMap }))
);
const LandingPage = React.lazy(() =>
  import("@/components/LandingPage").then((mod) => ({ default: mod.LandingPage }))
);
const MobileLoginPage = React.lazy(() =>
  import("@/components/MobileLoginPage").then((mod) => ({ default: mod.MobileLoginPage }))
);
const LeaderboardPage = React.lazy(() =>
  import("@/components/LeaderboardPage").then((mod) => ({ default: mod.LeaderboardPage }))
);
const MarketplacePage = React.lazy(() =>
  import("@/components/MarketplacePage").then((mod) => ({ default: mod.MarketplacePage }))
);
const RealMoneyMarketPage = React.lazy(() =>
  import("@/components/RealMoneyMarketPage").then((mod) => ({ default: mod.RealMoneyMarketPage }))
);
const MediaPage = React.lazy(() =>
  import("@/components/MediaPage").then((mod) => ({ default: mod.MediaPage }))
);
const NewsPage = React.lazy(() =>
  import("@/components/NewsPage").then((mod) => ({ default: mod.NewsPage }))
);
const RacesClassesPage = React.lazy(() =>
  import("@/components/RacesClassesPage").then((mod) => ({ default: mod.RacesClassesPage }))
);
const StoryPage = React.lazy(() =>
  import("@/components/StoryPage").then((mod) => ({ default: mod.StoryPage }))
);
const X402AgentPage = React.lazy(() =>
  import("@/components/X402AgentPage").then((mod) => ({ default: mod.X402AgentPage }))
);
const ChampionsPage = React.lazy(() =>
  import("@/components/ChampionsPage").then((mod) => ({ default: mod.ChampionsPage }))
);
const PricingPage = React.lazy(() =>
  import("@/components/PricingPage").then((mod) => ({ default: mod.PricingPage }))
);
const AdminDashboardPage = React.lazy(() =>
  import("@/components/AdminDashboardPage").then((mod) => ({ default: mod.AdminDashboardPage }))
);
const PrivacyPolicyPage = React.lazy(() =>
  import("@/components/PrivacyPolicyPage").then((mod) => ({ default: mod.PrivacyPolicyPage }))
);
const TermsOfUsePage = React.lazy(() =>
  import("@/components/TermsOfUsePage").then((mod) => ({ default: mod.TermsOfUsePage }))
);
const FarcasterMiniApp = React.lazy(() =>
  import("@/pages/FarcasterMiniApp").then((mod) => ({ default: mod.FarcasterMiniApp }))
);

function RouteFallback(): React.ReactElement {
  return (
    <div className="min-h-screen bg-[#060d12] flex items-center justify-center px-6">
      <div className="text-center text-[#9aa7cc]">
        <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-[#24314d] border-t-[#ffcc00]" />
        <p className="text-[11px] uppercase tracking-[0.2em]">Loading World of Geneva</p>
      </div>
    </div>
  );
}

function WorldConnectPrompt({
  title,
  shortcut,
  description,
}: {
  title: string;
  shortcut?: string;
  description: string;
}): React.ReactElement {
  return (
    <div className="pointer-events-auto flex h-full w-full flex-col overflow-hidden border-2 border-[#24314d] bg-[#0a0f1a]/92 shadow-[4px_4px_0_0_#000] backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-[#24314d] px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#ffcc00]">
          {title}
        </span>
        {shortcut ? (
          <span className="ml-auto text-[9px] font-bold text-[#556b8a]">{shortcut}</span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="max-w-[20rem] text-[11px] leading-relaxed text-[#8b9abc]">
          {description}
        </p>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent(OPEN_ONBOARDING_EVENT, {
                detail: { mode: "sign-in" satisfies OnboardingStartMode },
              }),
            );
          }}
          className="border-2 border-[#ffcc00] bg-[#2a2210] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#ffcc00] shadow-[2px_2px_0_0_#000] transition hover:bg-[#3d3218]"
        >
          Connect Wallet
        </button>
      </div>
    </div>
  );
}

/* ── Zone-aware PWA theming ────────────────────────────────────────────── */
const ZONE_THEMES: Record<string, { color: string; label: string }> = {
  "village-square":   { color: "#1a1408", label: "Village Square" },
  "wild-meadow":      { color: "#0d1a0a", label: "Wild Meadow" },
  "dark-forest":      { color: "#070f07", label: "Dark Forest" },
  "emerald-woods":    { color: "#082010", label: "Emerald Woods" },
  "auroral-plains":   { color: "#0f0a1a", label: "Auroral Plains" },
  "viridian-range":   { color: "#0a1210", label: "Viridian Range" },
  "moondancer-glade": { color: "#100a18", label: "Moondancer Glade" },
  "felsrock-citadel": { color: "#14100a", label: "Felsrock Citadel" },
  "lake-lumina":      { color: "#081018", label: "Lake Lumina" },
  "azurshard-chasm":  { color: "#060a14", label: "Azurshard Chasm" },
};
const DEFAULT_THEME = { color: "#060d12", label: "World of Geneva" };
const DOCK_STORAGE_PREFIX = "wog:world-dock:v4";
const MIN_DOCK_WIDTH = 240;
const MAX_DOCK_WIDTH = 560;
const MIN_DOCK_PANEL_HEIGHT = 220;
const DOCK_PANEL_GAP = 12;
const LEFT_DOCK_TOP_OFFSET = 56;
const RIGHT_DOCK_TOP_OFFSET = 16;
const DOCK_BOTTOM_OFFSET = 64;

function useZoneTheme(zoneId: string | null) {
  React.useEffect(() => {
    const theme = (zoneId && ZONE_THEMES[zoneId]) || DEFAULT_THEME;

    // Update all theme-color meta tags
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((el) => {
      el.content = theme.color;
    });

    // Dynamic title: "Zone Name — World of Geneva"
    document.title = zoneId && ZONE_THEMES[zoneId]
      ? `${theme.label} — World of Geneva`
      : "World of Geneva";
  }, [zoneId]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function usePersistentNumber(key: string, initialValue: number): [number, React.Dispatch<React.SetStateAction<number>>] {
  const [value, setValue] = React.useState(() => {
    if (typeof window === "undefined") return initialValue;
    const raw = Number(window.localStorage.getItem(key));
    return Number.isFinite(raw) ? raw : initialValue;
  });

  React.useEffect(() => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // noop
    }
  }, [key, value]);

  return [value, setValue];
}

function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = React.useState(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));

  React.useEffect(() => {
    const update = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return size;
}

function resolveOnboardingMode(event: Event): OnboardingStartMode {
  const customEvent = event as CustomEvent<{ mode?: OnboardingStartMode }>;
  return customEvent.detail?.mode ?? "create-character";
}

function GameWorld(): React.ReactElement {
  const [characterOpen, setCharacterOpen] = React.useState(false);
  const [onboardingOpen, setOnboardingOpen] = React.useState(false);
  const [onboardingMode, setOnboardingMode] = React.useState<OnboardingStartMode>("create-character");
  const [mapOpen, setMapOpen] = React.useState(false);
  const [questLogOpen, setQuestLogOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [inboxOpen, setInboxOpen] = React.useState(false);
  const [currentZone, setCurrentZone] = React.useState<string | null>("village-square");
  const [isCompactWorldUI, setIsCompactWorldUI] = React.useState(false);
  const [deferredDialogsReady, setDeferredDialogsReady] = React.useState(false);
  const { address, characterProgress, refreshCharacterProgress, refreshProfessions } = useWalletContext();

  // Toggleable panel visibility: null = use default (shown on desktop, hidden on mobile)
  const [chatVisible, setChatVisible] = React.useState<boolean | null>(null);
  const [ranksVisible, setRanksVisible] = React.useState<boolean | null>(null);
  const [walletVisible, setWalletVisible] = React.useState<boolean | null>(null);
  const [professionsVisible, setProfessionsVisible] = React.useState(false);
  const viewport = useViewportSize();

  const showChat = chatVisible ?? !isCompactWorldUI;
  const showRanks = ranksVisible ?? !isCompactWorldUI;
  const showWallet = walletVisible ?? !isCompactWorldUI;
  const showLeftDock = professionsVisible || showRanks;
  const showRightDock = showWallet || showChat;

  const minWorldStageWidth = Math.max(360, Math.floor(viewport.width * 0.32));
  const singleDockMaxWidth = Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, Math.floor(viewport.width * 0.36)));
  const dualDockWidthBudget = Math.max(
    MIN_DOCK_WIDTH * 2,
    viewport.width - minWorldStageWidth - 48,
  );
  const sharedDockMaxWidth = Math.max(
    MIN_DOCK_WIDTH,
    Math.min(MAX_DOCK_WIDTH, Math.floor(dualDockWidthBudget / 2)),
  );
  const leftDockMaxWidth = showLeftDock && showRightDock ? sharedDockMaxWidth : singleDockMaxWidth;
  const rightDockMaxWidth = showLeftDock && showRightDock ? sharedDockMaxWidth : singleDockMaxWidth;
  const leftAvailableHeight = Math.max(
    MIN_DOCK_PANEL_HEIGHT * 2 + DOCK_PANEL_GAP,
    viewport.height - LEFT_DOCK_TOP_OFFSET - DOCK_BOTTOM_OFFSET,
  );
  const rightAvailableHeight = Math.max(
    MIN_DOCK_PANEL_HEIGHT * 2 + DOCK_PANEL_GAP,
    viewport.height - RIGHT_DOCK_TOP_OFFSET - DOCK_BOTTOM_OFFSET,
  );
  const defaultLeftTopWidth = clamp(
    Math.round(viewport.width * (showRightDock ? 0.19 : 0.21)),
    MIN_DOCK_WIDTH,
    Math.min(320, leftDockMaxWidth),
  );
  const defaultLeftBottomWidth = clamp(
    Math.round(viewport.width * (showRightDock ? 0.22 : 0.24)),
    MIN_DOCK_WIDTH,
    Math.min(360, leftDockMaxWidth),
  );
  const defaultRightTopWidth = clamp(
    Math.round(viewport.width * (showLeftDock ? 0.27 : 0.31)),
    Math.max(MIN_DOCK_WIDTH + 40, 320),
    Math.min(440, rightDockMaxWidth),
  );
  const defaultRightBottomWidth = clamp(
    Math.round(viewport.width * (showLeftDock ? 0.24 : 0.27)),
    Math.max(MIN_DOCK_WIDTH + 20, 300),
    Math.min(400, rightDockMaxWidth),
  );
  const defaultLeftTopHeight = clamp(
    Math.round(leftAvailableHeight * 0.36),
    240,
    leftAvailableHeight,
  );
  const defaultLeftBottomHeight = clamp(
    Math.round(leftAvailableHeight * 0.46),
    260,
    leftAvailableHeight,
  );
  const defaultRightTopHeight = clamp(
    Math.round(rightAvailableHeight * 0.52),
    320,
    rightAvailableHeight,
  );
  const defaultRightBottomHeight = clamp(
    Math.round(rightAvailableHeight * 0.38),
    260,
    rightAvailableHeight,
  );

  const [leftTopWidthRaw, setLeftTopWidthRaw] = usePersistentNumber(`${DOCK_STORAGE_PREFIX}:left-top-width`, defaultLeftTopWidth);
  const [leftBottomWidthRaw, setLeftBottomWidthRaw] = usePersistentNumber(`${DOCK_STORAGE_PREFIX}:left-bottom-width`, defaultLeftBottomWidth);
  const [rightTopWidthRaw, setRightTopWidthRaw] = usePersistentNumber(`${DOCK_STORAGE_PREFIX}:right-top-width`, defaultRightTopWidth);
  const [rightBottomWidthRaw, setRightBottomWidthRaw] = usePersistentNumber(`${DOCK_STORAGE_PREFIX}:right-bottom-width`, defaultRightBottomWidth);
  const [leftTopHeightRaw, setLeftTopHeightRaw] = usePersistentNumber(`${DOCK_STORAGE_PREFIX}:left-top-height`, defaultLeftTopHeight);
  const [leftBottomHeightRaw, setLeftBottomHeightRaw] = usePersistentNumber(`${DOCK_STORAGE_PREFIX}:left-bottom-height`, defaultLeftBottomHeight);
  const [rightTopHeightRaw, setRightTopHeightRaw] = usePersistentNumber(`${DOCK_STORAGE_PREFIX}:right-top-height`, defaultRightTopHeight);
  const [rightBottomHeightRaw, setRightBottomHeightRaw] = usePersistentNumber(`${DOCK_STORAGE_PREFIX}:right-bottom-height`, defaultRightBottomHeight);

  const leftTopWidth = clamp(leftTopWidthRaw, MIN_DOCK_WIDTH, leftDockMaxWidth);
  const leftBottomWidth = clamp(leftBottomWidthRaw, MIN_DOCK_WIDTH, leftDockMaxWidth);
  const rightTopWidth = clamp(rightTopWidthRaw, MIN_DOCK_WIDTH, rightDockMaxWidth);
  const rightBottomWidth = clamp(rightBottomWidthRaw, MIN_DOCK_WIDTH, rightDockMaxWidth);

  const leftTopHeight = professionsVisible
    ? clamp(
        leftTopHeightRaw,
        MIN_DOCK_PANEL_HEIGHT,
        professionsVisible && showRanks
          ? Math.max(MIN_DOCK_PANEL_HEIGHT, leftAvailableHeight - MIN_DOCK_PANEL_HEIGHT - DOCK_PANEL_GAP)
          : leftAvailableHeight,
      )
    : 0;
  const leftBottomHeight = showRanks
    ? clamp(
        leftBottomHeightRaw,
        MIN_DOCK_PANEL_HEIGHT,
        professionsVisible
          ? Math.max(MIN_DOCK_PANEL_HEIGHT, leftAvailableHeight - leftTopHeight - DOCK_PANEL_GAP)
          : leftAvailableHeight,
      )
    : 0;
  const rightTopHeight = showWallet
    ? clamp(
        rightTopHeightRaw,
        MIN_DOCK_PANEL_HEIGHT,
        showWallet && showChat
          ? Math.max(MIN_DOCK_PANEL_HEIGHT, rightAvailableHeight - MIN_DOCK_PANEL_HEIGHT - DOCK_PANEL_GAP)
          : rightAvailableHeight,
      )
    : 0;
  const rightBottomHeight = showChat
    ? clamp(
        rightBottomHeightRaw,
        MIN_DOCK_PANEL_HEIGHT,
        showWallet
          ? Math.max(MIN_DOCK_PANEL_HEIGHT, rightAvailableHeight - rightTopHeight - DOCK_PANEL_GAP)
          : rightAvailableHeight,
      )
    : 0;

  const startLeftWidthResize = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    startWidth: number,
    setWidth: React.Dispatch<React.SetStateAction<number>>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;

    const onMove = (moveEvent: PointerEvent) => {
      setWidth(clamp(startWidth + (moveEvent.clientX - startX), MIN_DOCK_WIDTH, leftDockMaxWidth));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [leftDockMaxWidth]);

  const startRightWidthResize = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    startWidth: number,
    setWidth: React.Dispatch<React.SetStateAction<number>>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;

    const onMove = (moveEvent: PointerEvent) => {
      setWidth(clamp(startWidth - (moveEvent.clientX - startX), MIN_DOCK_WIDTH, rightDockMaxWidth));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [rightDockMaxWidth]);

  const startTopHeightResize = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    startHeight: number,
    setHeight: React.Dispatch<React.SetStateAction<number>>,
    maxHeight: number,
  ) => {
    event.preventDefault();
    const startY = event.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      setHeight(clamp(startHeight + (moveEvent.clientY - startY), MIN_DOCK_PANEL_HEIGHT, maxHeight));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const startBottomHeightResize = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    startHeight: number,
    setHeight: React.Dispatch<React.SetStateAction<number>>,
    maxHeight: number,
  ) => {
    event.preventDefault();
    const startY = event.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      setHeight(clamp(startHeight - (moveEvent.clientY - startY), MIN_DOCK_PANEL_HEIGHT, maxHeight));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const focusOwnedCharacter = React.useCallback((zoneId?: string) => {
    if (!address) return;

    void (async () => {
      const trackedWallet = await WalletManager.getInstance().getTrackedWalletAddress();
      const walletToFocus = trackedWallet ?? address;
      const latestProgress = await refreshCharacterProgress(true);
      const targetZoneId = latestProgress?.zoneId ?? zoneId;

      if (targetZoneId) {
        gameBus.emit("followPlayer", { zoneId: targetZoneId, walletAddress: walletToFocus });
        return;
      }

      gameBus.emit("lockToPlayer", { walletAddress: walletToFocus });
    })();
  }, [address, refreshCharacterProgress]);

  const toggleProfessions = React.useCallback(() => {
    const nextVisible = !professionsVisible;
    setProfessionsVisible(nextVisible);
    if (nextVisible) {
      void refreshProfessions();
    }
  }, [professionsVisible, refreshProfessions]);

  // Listen for global "open onboarding" event (from Navbar sign-in button)
  React.useEffect(() => {
    const handler = (event: Event) => {
      setOnboardingMode(resolveOnboardingMode(event));
      setOnboardingOpen(true);
    };
    window.addEventListener(OPEN_ONBOARDING_EVENT, handler);
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, handler);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        setCharacterOpen((current) => !current);
      } else if (key === "m") {
        setMapOpen((current) => { if (!current) playSoundEffect("ui_map_open"); return !current; });
      } else if (key === "q") {
        setQuestLogOpen((current) => !current);
      } else if (key === "i" && address && currentZone) {
        gameBus.emit("inspectSelf", { zoneId: currentZone, walletAddress: address });
      } else if (key === "l") {
        setChatVisible((v) => !(v ?? !isCompactWorldUI));
      } else if (key === "r") {
        setRanksVisible((v) => !(v ?? !isCompactWorldUI));
      } else if (key === "w") {
        setWalletVisible((v) => !(v ?? !isCompactWorldUI));
      } else if (key === "b") {
        gameBus.emit("inventoryOpen", undefined as never);
      } else if (key === "p") {
        toggleProfessions();
      } else if (key === "n") {
        setInboxOpen((c) => !c);
      } else if (event.code === "Space" && address) {
        event.preventDefault();
        focusOwnedCharacter(characterProgress?.zoneId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [address, currentZone, characterProgress, focusOwnedCharacter, isCompactWorldUI, toggleProfessions]);

  React.useEffect(() => {
    const unsub1 = gameBus.on("zoneChanged", ({ zoneId }) => {
      setCurrentZone(zoneId);
    });
    const unsub2 = gameBus.on("inboxOpen", () => setInboxOpen(true));
    const unsub3 = gameBus.on("settingsOpen", () => setSettingsOpen(true));
    const unsub4 = gameBus.on("characterOpen", () => setCharacterOpen(true));
    const unsub5 = gameBus.on("mapOpen", () => { playSoundEffect("ui_map_open"); setMapOpen(true); });
    const unsub6 = gameBus.on("questLogOpen", () => setQuestLogOpen(true));
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); };
  }, []);

  // Dynamic PWA theme color + title per zone
  useZoneTheme(currentZone);

  // Deep link: ?inbox=1 opens the inbox on load
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("inbox") === "1") {
      setInboxOpen(true);
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const query = window.matchMedia("(max-width: 1023px), (pointer: coarse)");
    const onChange = () => setIsCompactWorldUI(query.matches);
    onChange();

    if (query.addEventListener) {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }

    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  React.useEffect(() => {
    document.body.classList.add("world-route");
    return () => {
      document.body.classList.remove("world-route");
    };
  }, []);

  React.useEffect(() => {
    if (deferredDialogsReady || typeof window === "undefined") return;

    let cancelled = false;
    const ready = () => {
      if (!cancelled) setDeferredDialogsReady(true);
    };

    const idle = "requestIdleCallback" in window
      ? (window as Window & {
          requestIdleCallback: (callback: () => void, options?: { timeout: number }) => number;
          cancelIdleCallback: (handle: number) => void;
        }).requestIdleCallback(ready, { timeout: 600 })
      : null;
    const fallback = window.setTimeout(ready, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      if (idle !== null && "cancelIdleCallback" in window) {
        (window as Window & { cancelIdleCallback: (handle: number) => void }).cancelIdleCallback(idle);
      }
    };
  }, [deferredDialogsReady]);

  // Lock camera to connected player's agent entity
  React.useEffect(() => {
    if (!address) return;
    focusOwnedCharacter(characterProgress?.zoneId);
  }, [address, characterProgress?.zoneId, focusOwnedCharacter]);

  // Track open_game once per mount
  React.useEffect(() => {
    trackOpenGame(address);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background music (low volume, looping)
  useBackgroundMusic("world-theme");

  return (
    <div className="relative h-full w-full overflow-hidden">
      <React.Suspense fallback={<RouteFallback />}>
        <GameCanvas />
      </React.Suspense>
      <React.Suspense fallback={null}>
        {showLeftDock && (
          <div className="pointer-events-none absolute left-2 top-14 bottom-16 z-30 md:left-4">
            <div
              aria-hidden={!professionsVisible}
              className={`absolute left-0 top-0 min-h-0 overflow-hidden transition-opacity ${
                professionsVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
              }`}
              style={{ width: `${leftTopWidth}px`, height: `${leftTopHeight}px` }}
            >
              <ProfessionsPanel className="h-full w-full max-w-none max-h-full overflow-auto" />
              {professionsVisible && (
                <>
                  <div
                    onPointerDown={(event) => startLeftWidthResize(event, leftTopWidth, setLeftTopWidthRaw)}
                    className="absolute -right-1.5 top-1/2 h-24 w-3 -translate-y-1/2 cursor-col-resize rounded-full border border-[#24314d] bg-[#0a0f1ecc] transition-colors hover:border-[#ffcc00] hover:bg-[#1a2238]"
                    title="Resize professions panel"
                  />
                  <div
                    onPointerDown={(event) => startTopHeightResize(
                      event,
                      leftTopHeight,
                      setLeftTopHeightRaw,
                      showRanks ? Math.max(MIN_DOCK_PANEL_HEIGHT, leftAvailableHeight - leftBottomHeight - DOCK_PANEL_GAP) : leftAvailableHeight,
                    )}
                    className="absolute inset-x-4 -bottom-1.5 h-3 cursor-row-resize rounded-full border border-[#24314d] bg-[#0a0f1ecc] transition-colors hover:border-[#ffcc00] hover:bg-[#1a2238]"
                    title="Resize professions panel"
                  />
                </>
              )}
            </div>
            {showRanks && (
              <div
                className="absolute bottom-0 left-0 min-h-0"
                style={{ width: `${leftBottomWidth}px`, height: `${leftBottomHeight}px` }}
              >
                <PlayerPanel className="pointer-events-auto h-full w-full max-w-none max-h-full overflow-auto" />
                <div
                  onPointerDown={(event) => startLeftWidthResize(event, leftBottomWidth, setLeftBottomWidthRaw)}
                  className="pointer-events-auto absolute -right-1.5 top-1/2 h-24 w-3 -translate-y-1/2 cursor-col-resize rounded-full border border-[#24314d] bg-[#0a0f1ecc] transition-colors hover:border-[#ffcc00] hover:bg-[#1a2238]"
                  title="Resize lobby panel"
                />
                <div
                  onPointerDown={(event) => startBottomHeightResize(
                    event,
                    leftBottomHeight,
                    setLeftBottomHeightRaw,
                    professionsVisible ? Math.max(MIN_DOCK_PANEL_HEIGHT, leftAvailableHeight - leftTopHeight - DOCK_PANEL_GAP) : leftAvailableHeight,
                  )}
                  className="pointer-events-auto absolute inset-x-4 -top-1.5 h-3 cursor-row-resize rounded-full border border-[#24314d] bg-[#0a0f1ecc] transition-colors hover:border-[#ffcc00] hover:bg-[#1a2238]"
                  title="Resize lobby panel"
                />
              </div>
            )}
          </div>
        )}
        {showRightDock && (
          <div className="pointer-events-none absolute right-2 top-4 bottom-16 z-30 md:right-4">
            {showWallet && (
              <div
                className="absolute right-0 top-0 min-h-0"
                style={{ width: `${rightTopWidth}px`, height: `${rightTopHeight}px` }}
              >
                {address ? (
                  <>
                    <WalletPanel className="pointer-events-auto h-full w-full max-w-none max-h-full" />
                    <div
                      onPointerDown={(event) => startRightWidthResize(event, rightTopWidth, setRightTopWidthRaw)}
                      className="pointer-events-auto absolute -left-1.5 top-1/2 h-24 w-3 -translate-y-1/2 cursor-col-resize rounded-full border border-[#24314d] bg-[#0a0f1ecc] transition-colors hover:border-[#ffcc00] hover:bg-[#1a2238]"
                      title="Resize inventory panel"
                    />
                    <div
                      onPointerDown={(event) => startTopHeightResize(
                        event,
                        rightTopHeight,
                        setRightTopHeightRaw,
                        showChat ? Math.max(MIN_DOCK_PANEL_HEIGHT, rightAvailableHeight - rightBottomHeight - DOCK_PANEL_GAP) : rightAvailableHeight,
                      )}
                      className="pointer-events-auto absolute inset-x-4 -bottom-1.5 h-3 cursor-row-resize rounded-full border border-[#24314d] bg-[#0a0f1ecc] transition-colors hover:border-[#ffcc00] hover:bg-[#1a2238]"
                      title="Resize inventory panel"
                    />
                  </>
                ) : (
                  <WorldConnectPrompt
                    title="Summon Champion"
                    description="Connect your wallet to open your champion panel, inventory, and account controls."
                  />
                )}
              </div>
            )}
            {showChat && (address || !showWallet) && (
              <div
                className="absolute bottom-0 right-0 min-h-0"
                style={{ width: `${rightBottomWidth}px`, height: `${rightBottomHeight}px` }}
              >
                {address ? (
                  <AgentChatPanel
                    walletAddress={address}
                    currentZone={currentZone}
                    className="pointer-events-auto h-full max-h-full w-full max-w-none"
                  />
                ) : (
                  <ChatLog
                    zoneId={currentZone}
                    className="pointer-events-auto h-full max-h-full w-full max-w-none overflow-auto"
                  />
                )}
                <div
                  onPointerDown={(event) => startRightWidthResize(event, rightBottomWidth, setRightBottomWidthRaw)}
                  className="pointer-events-auto absolute -left-1.5 top-1/2 h-24 w-3 -translate-y-1/2 cursor-col-resize rounded-full border border-[#24314d] bg-[#0a0f1ecc] transition-colors hover:border-[#ffcc00] hover:bg-[#1a2238]"
                  title="Resize console panel"
                />
                <div
                  onPointerDown={(event) => startBottomHeightResize(
                    event,
                    rightBottomHeight,
                    setRightBottomHeightRaw,
                    showWallet ? Math.max(MIN_DOCK_PANEL_HEIGHT, rightAvailableHeight - rightTopHeight - DOCK_PANEL_GAP) : rightAvailableHeight,
                  )}
                  className="pointer-events-auto absolute inset-x-4 -top-1.5 h-3 cursor-row-resize rounded-full border border-[#24314d] bg-[#0a0f1ecc] transition-colors hover:border-[#ffcc00] hover:bg-[#1a2238]"
                  title="Resize console panel"
                />
              </div>
            )}
          </div>
        )}
        {deferredDialogsReady && <DeferredWorldDialogs />}
        {questLogOpen && (
          <QuestLogDialog open={questLogOpen} onClose={() => setQuestLogOpen(false)} walletAddress={address} />
        )}
        {characterOpen && (
          <CharacterDialog
            onOpenChange={setCharacterOpen}
            open={characterOpen}
            onRequestCreate={() => {
              setCharacterOpen(false);
              setOnboardingMode("create-character");
              setOnboardingOpen(true);
            }}
          />
        )}
        {onboardingOpen && (
          <OnboardingFlow
            initialMode={onboardingMode}
            onClose={() => {
              setOnboardingOpen(false);
            }}
          />
        )}
        {settingsOpen && <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
        {inboxOpen && <InboxDialog open={inboxOpen} onClose={() => setInboxOpen(false)} />}
        {mapOpen && <WorldMap open={mapOpen} onClose={() => setMapOpen(false)} />}
        <div
          className="absolute left-1/2 -translate-x-1/2 z-30"
          style={{
            bottom: isCompactWorldUI ? "calc(env(safe-area-inset-bottom, 0px) + 8px)" : "8px",
          }}
        >
          <HotkeyBar
            mobile={isCompactWorldUI}
            onCharacter={() => setCharacterOpen((c) => !c)}
            onMap={() => setMapOpen((c) => !c)}
            onQuestLog={() => setQuestLogOpen((c) => !c)}
            onInspect={() => {
              if (address && currentZone) {
                gameBus.emit("inspectSelf", { zoneId: currentZone, walletAddress: address });
              }
            }}
            onInbox={() => setInboxOpen((c) => !c)}
            onChat={() => setChatVisible((v) => !(v ?? !isCompactWorldUI))}
            onRanks={() => setRanksVisible((v) => !(v ?? !isCompactWorldUI))}
            onWallet={() => setWalletVisible((v) => !(v ?? !isCompactWorldUI))}
            onProfessions={toggleProfessions}
            onSettings={() => setSettingsOpen((s) => !s)}
            inboxActive={inboxOpen}
            chatActive={showChat}
            ranksActive={showRanks}
            walletActive={showWallet}
            professionsActive={professionsVisible}
            settingsActive={settingsOpen}
          />
        </div>
      </React.Suspense>
    </div>
  );
}

function AppShell(): React.ReactElement {
  const location = useLocation();
  const isWorldRoute = location.pathname === "/world";
  const [onboardingOpen, setOnboardingOpen] = React.useState(false);
  const [onboardingMode, setOnboardingMode] = React.useState<OnboardingStartMode>("create-character");
  const { address } = useWalletContext();

  // Listen for global "open onboarding" event on non-world routes
  React.useEffect(() => {
    if (isWorldRoute) return; // GameWorld handles its own listener
    const handler = (event: Event) => {
      setOnboardingMode(resolveOnboardingMode(event));
      setOnboardingOpen(true);
    };
    window.addEventListener(OPEN_ONBOARDING_EVENT, handler);
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, handler);
  }, [isWorldRoute]);

  return (
    <div className={`relative h-full w-full ${isWorldRoute ? "" : "flex flex-col"}`}>
      <Navbar />
      {/* <PushNotificationBanner walletAddress={address} /> */}
      {isWorldRoute ? (
        <div className="h-full w-full pt-0">
          <GameWorld />
        </div>
      ) : (
        <>
          <React.Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/mobile" element={<MobileLoginPage />} />
              <Route path="/marketplace" element={<MarketplacePage />} />
              <Route path="/market" element={<RealMoneyMarketPage />} />
              <Route path="/x402" element={<X402AgentPage />} />
              <Route path="/races" element={<RacesClassesPage />} />
              <Route path="/story" element={<StoryPage />} />
              <Route path="/media" element={<MediaPage />} />
              <Route path="/leaderboards" element={<LeaderboardPage />} />
              <Route path="/news" element={<NewsPage />} />
              <Route path="/champions" element={<ChampionsPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
              <Route path="/terms" element={<TermsOfUsePage />} />
              <Route path="*" element={<LandingPage />} />
            </Routes>
          </React.Suspense>
          {onboardingOpen && (
            <React.Suspense fallback={null}>
              <OnboardingFlow
                initialMode={onboardingMode}
                onClose={() => setOnboardingOpen(false)}
              />
            </React.Suspense>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Detects if we're inside a Farcaster Mini App (Warpcast webview).
 * At the root path, renders the Mini App instead of the landing page.
 */
function RootDetector(): React.ReactElement {
  const [mode, setMode] = React.useState<"miniapp" | "website">("website");

  React.useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) setMode("website");
    }, 400);

    (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        const inMiniApp = await sdk.isInMiniApp();
        if (!cancelled) setMode(inMiniApp ? "miniapp" : "website");
      } catch {
        if (!cancelled) setMode("website");
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  if (mode === "miniapp") {
    return (
      <React.Suspense fallback={<RouteFallback />}>
        <FarcasterMiniApp />
      </React.Suspense>
    );
  }

  return <AppShell />;
}

export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <GameProvider>
        <WalletProvider>
          <ToastProvider>
            <Routes>
              {/* Farcaster Mini App — explicit route always works */}
              <Route
                path="/farcaster"
                element={(
                  <React.Suspense fallback={<RouteFallback />}>
                    <FarcasterMiniApp />
                  </React.Suspense>
                )}
              />

              {/* Root — auto-detect Warpcast vs normal browser */}
              <Route path="/" element={<RootDetector />} />

              {/* All other routes — normal app */}
              <Route path="*" element={<AppShell />} />
            </Routes>
          </ToastProvider>
        </WalletProvider>
      </GameProvider>
    </BrowserRouter>
  );
}
