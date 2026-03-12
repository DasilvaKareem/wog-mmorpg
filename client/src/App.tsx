import * as React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";

import { Navbar } from "@/components/Navbar";
import { ToastProvider } from "@/components/ui/toast";
import { GameProvider } from "@/context/GameContext";
import { WalletProvider, useWalletContext } from "@/context/WalletContext";
import { PushNotificationBanner } from "@/components/PushNotificationBanner";
import { gameBus } from "@/lib/eventBus";
import { OPEN_ONBOARDING_EVENT, type OnboardingStartMode } from "@/lib/onboarding";
import { WalletManager } from "@/lib/walletManager";

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
const HotkeyBar = React.lazy(() =>
  import("@/components/HotkeyBar").then((mod) => ({ default: mod.HotkeyBar }))
);
const OnboardingFlow = React.lazy(() =>
  import("@/components/OnboardingFlow").then((mod) => ({ default: mod.OnboardingFlow }))
);
const PlayerPanel = React.lazy(() =>
  import("@/components/PlayerPanel").then((mod) => ({ default: mod.PlayerPanel }))
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
  return <div className="min-h-screen bg-[#060d12]" />;
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
  const [currentZone, setCurrentZone] = React.useState<string | null>("village-square");
  const [isCompactWorldUI, setIsCompactWorldUI] = React.useState(false);
  const { address } = useWalletContext();

  // Toggleable panel visibility: null = use default (shown on desktop, hidden on mobile)
  const [chatVisible, setChatVisible] = React.useState<boolean | null>(null);
  const [ranksVisible, setRanksVisible] = React.useState<boolean | null>(null);
  const [walletVisible, setWalletVisible] = React.useState<boolean | null>(null);

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
      } else if (event.code === "Space" && address) {
        event.preventDefault();
        focusOwnedCharacter();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [address, currentZone, focusOwnedCharacter, isCompactWorldUI]);

  React.useEffect(() => {
    const unsubscribe = gameBus.on("zoneChanged", ({ zoneId }) => {
      setCurrentZone(zoneId);
    });
    return unsubscribe;
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

  // Lock camera to connected player's agent entity
  React.useEffect(() => {
    if (address) {
      focusOwnedCharacter();
    }
  }, [address, focusOwnedCharacter]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <React.Suspense fallback={<RouteFallback />}>
        <GameCanvas />
      </React.Suspense>
      <React.Suspense fallback={null}>
        {showWallet && <WalletPanel />}
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
        <ShopDialog />
        <GuildDialog />
        <AuctionHouseDialog />
        <ColiseumDialog />
        <InspectDialog />
        <NpcInfoDialog />
        <QuestLogDialog open={questLogOpen} onClose={() => setQuestLogOpen(false)} walletAddress={address} />
        <CharacterDialog
          onOpenChange={setCharacterOpen}
          open={characterOpen}
          onRequestCreate={() => {
            setCharacterOpen(false);
            setOnboardingMode("create-character");
            setOnboardingOpen(true);
          }}
        />
        {onboardingOpen && (
          <OnboardingFlow
            initialMode={onboardingMode}
            onClose={() => setOnboardingOpen(false)}
          />
        )}
        <WorldMap open={mapOpen} onClose={() => setMapOpen(false)} />
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
            onChat={() => setChatVisible((v) => !(v ?? !isCompactWorldUI))}
            onRanks={() => setRanksVisible((v) => !(v ?? !isCompactWorldUI))}
            onWallet={() => setWalletVisible((v) => !(v ?? !isCompactWorldUI))}
            chatActive={showChat}
            ranksActive={showRanks}
            walletActive={showWallet}
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
  const [mode, setMode] = React.useState<"checking" | "miniapp" | "website">("checking");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        const inMiniApp = await sdk.isInMiniApp();
        if (!cancelled) setMode(inMiniApp ? "miniapp" : "website");
      } catch {
        if (!cancelled) setMode("website");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (mode === "checking") {
    // Brief blank screen while detecting — resolves in <100ms
    return <div className="min-h-screen bg-[#060d12]" />;
  }

  if (mode === "miniapp") {
    return (
      <React.Suspense fallback={<RouteFallback />}>
        <FarcasterMiniApp />
      </React.Suspense>
    );
  }

  return (
    <GameProvider>
      <WalletProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </WalletProvider>
    </GameProvider>
  );
}

export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
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
        <Route
          path="*"
          element={
            <GameProvider>
              <WalletProvider>
                <ToastProvider>
                  <AppShell />
                </ToastProvider>
              </WalletProvider>
            </GameProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
