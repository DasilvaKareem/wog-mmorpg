import * as React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";

import { AuctionHouseDialog } from "@/components/AuctionHouseDialog";
import { CharacterDialog } from "@/components/CharacterDialog";
import { ColiseumDialog } from "@/components/ColiseumDialog";
import { InspectDialog } from "@/components/InspectDialog";
import { QuestLogDialog } from "@/components/QuestLogDialog";
import { GameCanvas } from "@/components/GameCanvas";
import { LandingPage } from "@/components/LandingPage";
import { LeaderboardPage } from "@/components/LeaderboardPage";
import { MarketplacePage } from "@/components/MarketplacePage";
import { MediaPage } from "@/components/MediaPage";
import { Navbar } from "@/components/Navbar";
import { NewsPage } from "@/components/NewsPage";
import { RacesClassesPage } from "@/components/RacesClassesPage";
import { StoryPage } from "@/components/StoryPage";
import { X402AgentPage } from "@/components/X402AgentPage";
import { ShopDialog } from "@/components/ShopDialog";
import { GuildDialog } from "@/components/GuildDialog";
import { WalletPanel } from "@/components/WalletPanel";
import { ProfessionPanel } from "@/components/ProfessionPanel";
import { ZoneSelector } from "@/components/ZoneSelector";
import { ChatLog } from "@/components/ChatLog";
import { AgentChatPanel } from "@/components/AgentChatPanel";
import { PlayerPanel } from "@/components/PlayerPanel";
import { WorldMap } from "@/components/WorldMap";
import { FarcasterMiniApp } from "@/pages/FarcasterMiniApp";
import { ToastProvider } from "@/components/ui/toast";
import { GameProvider } from "@/context/GameContext";
import { WalletProvider, useWalletContext } from "@/context/WalletContext";
import { gameBus } from "@/lib/eventBus";

function GameWorld(): React.ReactElement {
  const [characterOpen, setCharacterOpen] = React.useState(false);
  const [mapOpen, setMapOpen] = React.useState(false);
  const [questLogOpen, setQuestLogOpen] = React.useState(false);
  const [currentZone, setCurrentZone] = React.useState<string | null>("village-square");
  const { address } = useWalletContext();

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
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [address, currentZone]);

  React.useEffect(() => {
    const unsubscribe = gameBus.on("zoneChanged", ({ zoneId }) => {
      setCurrentZone(zoneId);
    });
    return unsubscribe;
  }, []);

  // Lock camera to connected player's agent entity
  React.useEffect(() => {
    if (address) {
      gameBus.emit("lockToPlayer", { walletAddress: address });
    }
  }, [address]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <GameCanvas />
      <WalletPanel />
      <ProfessionPanel />
      <ZoneSelector />
      <PlayerPanel className="absolute top-14 left-1/2 -translate-x-1/2 z-30 w-[420px] hidden md:block" />
      {address ? (
        <AgentChatPanel
          walletAddress={address}
          currentZone={currentZone}
          className="absolute bottom-4 right-4 z-30 hidden md:flex"
        />
      ) : (
        <ChatLog
          zoneId={currentZone}
          className="absolute bottom-4 right-4 z-30 w-96 hidden md:block"
        />
      )}
      <ShopDialog />
      <GuildDialog />
      <AuctionHouseDialog />
      <ColiseumDialog />
      <InspectDialog />
      <QuestLogDialog open={questLogOpen} onClose={() => setQuestLogOpen(false)} walletAddress={address} />
      <CharacterDialog onOpenChange={setCharacterOpen} open={characterOpen} />
      <WorldMap open={mapOpen} onClose={() => setMapOpen(false)} />
    </div>
  );
}

function AppShell(): React.ReactElement {
  const location = useLocation();
  const isWorldRoute = location.pathname === "/world";

  return (
    <div className={`relative h-full w-full ${isWorldRoute ? "" : "flex flex-col"}`}>
      <Navbar />
      {isWorldRoute ? (
        <div className="h-full w-full pt-0">
          <GameWorld />
        </div>
      ) : (
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/x402" element={<X402AgentPage />} />
          <Route path="/races" element={<RacesClassesPage />} />
          <Route path="/story" element={<StoryPage />} />
          <Route path="/media" element={<MediaPage />} />
          <Route path="/leaderboards" element={<LeaderboardPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="*" element={<LandingPage />} />
        </Routes>
      )}
    </div>
  );
}

export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        {/* Farcaster Mini App — standalone, no WalletProvider/GameProvider needed */}
        <Route path="/farcaster" element={<FarcasterMiniApp />} />

        {/* Main app shell — everything else */}
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
