import * as React from "react";

import { AuctionHouseDialog } from "@/components/AuctionHouseDialog";
import { CharacterDialog } from "@/components/CharacterDialog";
import { ColiseumDialog } from "@/components/ColiseumDialog";
import { GameCanvas } from "@/components/GameCanvas";
import { LandingPage } from "@/components/LandingPage";
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
import { WalletProvider } from "@/context/WalletContext";
import { gameBus } from "@/lib/eventBus";

type Page = "landing" | "game";

function AppShell(): React.ReactElement {
  const [page, setPage] = React.useState<Page>("landing");
  const [characterOpen, setCharacterOpen] = React.useState(false);
  const [currentZone, setCurrentZone] = React.useState<string | null>("human-meadow");

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (page !== "game") return;
      if (event.key.toLowerCase() !== "c") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      setCharacterOpen((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page]);

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
      />
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <GameCanvas />
      <WalletPanel />
      <ProfessionPanel />
      <ZoneSelector />
      <LobbyViewer className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-96" />
      <ChatLog
        zoneId={currentZone}
        className="absolute bottom-4 right-4 z-30 w-96"
      />
      <Leaderboard className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[420px]" />
      <ShopDialog />
      <GuildDialog />
      <AuctionHouseDialog />
      <ColiseumDialog />
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
