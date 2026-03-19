import * as React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";

import { Navbar } from "@/components/Navbar";
import { ToastProvider } from "@/components/ui/toast";
import { GameProvider } from "@/context/GameContext";
import { WalletProvider, useWalletContext } from "@/context/WalletContext";
import { PushNotificationBanner } from "@/components/PushNotificationBanner";
import { gameBus } from "@/lib/eventBus";
import { OPEN_ONBOARDING_EVENT, type OnboardingStartMode } from "@/lib/onboarding";
import { consumeTutorialMasterIntro } from "@/lib/tutorialMaster";


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
const ShopDialog = React.lazy(() =>
  import("@/components/ShopDialog").then((mod) => ({ default: mod.ShopDialog }))
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
const TutorialMasterModal = React.lazy(() =>
  import("@/components/TutorialMasterModal").then((mod) => ({ default: mod.TutorialMasterModal }))
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
  const [tutorialMasterOpen, setTutorialMasterOpen] = React.useState(false);
  const [currentZone, setCurrentZone] = React.useState<string | null>("village-square");
  const [isCompactWorldUI, setIsCompactWorldUI] = React.useState(false);
  const [deferredDialogsReady, setDeferredDialogsReady] = React.useState(false);
  const { address, characterProgress } = useWalletContext();

  // Toggleable panel visibility: null = use default (shown on desktop, hidden on mobile)
  const [chatVisible, setChatVisible] = React.useState<boolean | null>(null);
  const [ranksVisible, setRanksVisible] = React.useState<boolean | null>(null);
  const [walletVisible, setWalletVisible] = React.useState<boolean | null>(null);
  const [professionsVisible, setProfessionsVisible] = React.useState(false);

  const showChat = chatVisible ?? !isCompactWorldUI;
  const showRanks = ranksVisible ?? !isCompactWorldUI;
  const showWallet = walletVisible ?? !isCompactWorldUI;

  const focusOwnedCharacter = React.useCallback((zoneId?: string) => {
    if (!address) return;

    void (async () => {
      const trackedWallet = await WalletManager.getInstance().getTrackedWalletAddress();
      const walletToFocus = trackedWallet ?? address;
      let attempts = 0;
      const maxAttempts = 8;

      const retry = window.setInterval(() => {
        if (zoneId) {
          gameBus.emit("switchZone", { zoneId });
        }
        gameBus.emit("lockToPlayer", { walletAddress: walletToFocus });
        if (++attempts >= maxAttempts) {
          window.clearInterval(retry);
        }
      }, 350);
    })();
  }, [address]);

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
        setMapOpen((current) => !current);
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
        setProfessionsVisible((v) => !v);
      } else if (key === "n") {
        setInboxOpen((c) => !c);
      } else if (event.code === "Space" && address) {
        event.preventDefault();
        focusOwnedCharacter(characterProgress?.zoneId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [address, currentZone, characterProgress, focusOwnedCharacter, isCompactWorldUI]);

  React.useEffect(() => {
    const unsub1 = gameBus.on("zoneChanged", ({ zoneId }) => {
      setCurrentZone(zoneId);
    });
    const unsub2 = gameBus.on("inboxOpen", () => setInboxOpen(true));
    const unsub3 = gameBus.on("settingsOpen", () => setSettingsOpen(true));
    const unsub4 = gameBus.on("characterOpen", () => setCharacterOpen(true));
    const unsub5 = gameBus.on("mapOpen", () => setMapOpen(true));
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
    if (address) {
      focusOwnedCharacter();
    }
  }, [address, focusOwnedCharacter]);

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
        {showWallet && <WalletPanel />}
        {professionsVisible && (
          <ProfessionsPanel className="absolute top-14 left-2 md:left-4 z-30" />
        )}
        {showRanks && (
          <PlayerPanel className="absolute bottom-16 left-2 md:left-4 z-30 w-56 sm:w-64 md:w-72 lg:w-80 max-w-[45vw] max-h-[55vh] overflow-auto" />
        )}
        {showChat && (
          address ? (
            <AgentChatPanel
              walletAddress={address}
              currentZone={currentZone}
              className="absolute bottom-16 right-2 md:right-4 z-30"
            />
          ) : (
            <ChatLog
              zoneId={currentZone}
              className="absolute bottom-16 right-2 md:right-4 z-30 w-80 lg:w-96 max-w-[45vw] max-h-[45vh] overflow-auto"
            />
          )
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
              if (consumeTutorialMasterIntro()) {
                setTutorialMasterOpen(true);
              }
            }}
          />
        )}
        {tutorialMasterOpen && (
          <React.Suspense fallback={null}>
            <TutorialMasterModal
              open={tutorialMasterOpen}
              onClose={() => setTutorialMasterOpen(false)}
              onShowChat={() => setChatVisible(true)}
              onShowRanks={() => setRanksVisible(true)}
              onShowWallet={() => setWalletVisible(true)}
            />
          </React.Suspense>
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
            onProfessions={() => setProfessionsVisible((v) => !v)}
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
      <PushNotificationBanner walletAddress={address} />
      {isWorldRoute ? (
        <div className="h-full w-full pt-0">
          <GameWorld />
        </div>
      ) : (
        <>
          <React.Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
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
