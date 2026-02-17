import * as React from "react";

import { AuctionHouseDialog } from "@/components/AuctionHouseDialog";
import { CharacterDialog } from "@/components/CharacterDialog";
import { ColiseumDialog } from "@/components/ColiseumDialog";
import { InspectDialog } from "@/components/InspectDialog";
import { GameCanvas } from "@/components/GameCanvas";
import { LandingPage } from "@/components/LandingPage";
import { MarketplacePage } from "@/components/MarketplacePage";
import { X402AgentPage } from "@/components/X402AgentPage";
import { ShopDialog } from "@/components/ShopDialog";
import { GuildDialog } from "@/components/GuildDialog";
import { WalletPanel } from "@/components/WalletPanel";
import { ProfessionPanel } from "@/components/ProfessionPanel";
import { ZoneSelector } from "@/components/ZoneSelector";
import { ChatLog } from "@/components/ChatLog";
import { Leaderboard } from "@/components/Leaderboard";
import { LobbyViewer } from "@/components/LobbyViewer";
import { ToastProvider } from "@/components/ui/toast";
import { GameProvider } from "@/context/GameContext";
import { WalletProvider, useWalletContext } from "@/context/WalletContext";
import { gameBus } from "@/lib/eventBus";

type Page = "landing" | "game" | "marketplace" | "x402";

function AppShell(): React.ReactElement {
  const [page, setPage] = React.useState<Page>("landing");
  const [characterOpen, setCharacterOpen] = React.useState(false);
  const [currentZone, setCurrentZone] = React.useState<string | null>("village-square");
  const { address } = useWalletContext();

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (page !== "game") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        setCharacterOpen((current) => !current);
      } else if (key === "i" && address && currentZone) {
        gameBus.emit("inspectSelf", { zoneId: currentZone, walletAddress: address });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page, address, currentZone]);

  React.useEffect(() => {
    const unsubscribe = gameBus.on("zoneChanged", ({ zoneId }) => {
      setCurrentZone(zoneId);
    });

    return unsubscribe;
  }, []);

  if (page === "landing") {
    return (
      <LandingPage
        onEnterGame={() => setPage("game")}
        onPlayNow={() => {
          setPage("game");
          // Open character dialog after a tick so game canvas mounts first
          window.setTimeout(() => setCharacterOpen(true), 100);
        }}
        onOpenMarketplace={() => setPage("marketplace")}
        onX402={() => setPage("x402")}
      />
    );
  }

  if (page === "marketplace") {
    return <MarketplacePage onBack={() => setPage("landing")} />;
  }

  if (page === "x402") {
    return <X402AgentPage onBack={() => setPage("landing")} />;
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <GameCanvas />
      {/* On mobile (< md), only show WalletPanel and ZoneSelector. On desktop, show all panels */}
      <WalletPanel />
      <ProfessionPanel />
      <ZoneSelector />
      <LobbyViewer className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-96 hidden md:block" />
      <ChatLog
        zoneId={currentZone}
        className="absolute bottom-4 right-4 z-30 w-96 hidden md:block"
      />
      <Leaderboard className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[420px] hidden md:block" />
      <ShopDialog />
      <GuildDialog />
      <AuctionHouseDialog />
      <ColiseumDialog />
      <InspectDialog />
      <CharacterDialog onOpenChange={setCharacterOpen} open={characterOpen} />
    </div>
  );
}

export default function App(): React.ReactElement {
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
