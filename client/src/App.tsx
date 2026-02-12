import * as React from "react";

import { CharacterDialog } from "@/components/CharacterDialog";
import { GameCanvas } from "@/components/GameCanvas";
import { ShopDialog } from "@/components/ShopDialog";
import { GuildDialog } from "@/components/GuildDialog";
import { WalletPanel } from "@/components/WalletPanel";
import { ProfessionPanel } from "@/components/ProfessionPanel";
import { ZoneSelector } from "@/components/ZoneSelector";
import { ChatLog } from "@/components/ChatLog";
import { LobbyViewer } from "@/components/LobbyViewer";
import { ToastProvider } from "@/components/ui/toast";
import { GameProvider } from "@/context/GameContext";
import { WalletProvider } from "@/context/WalletContext";
import { gameBus } from "@/lib/eventBus";

function AppShell(): React.ReactElement {
  const [characterOpen, setCharacterOpen] = React.useState(false);
  const [currentZone, setCurrentZone] = React.useState<string | null>("human-meadow");

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "c") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      setCharacterOpen((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  React.useEffect(() => {
    const unsubscribe = gameBus.on("zoneChanged", ({ zoneId }) => {
      setCurrentZone(zoneId);
    });

    return unsubscribe;
  }, []);

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
      <ShopDialog />
      <GuildDialog />
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
