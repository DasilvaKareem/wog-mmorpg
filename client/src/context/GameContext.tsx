import { createContext, useContext, useRef } from "react";
import type { MutableRefObject, ReactNode, ReactElement } from "react";
import type Phaser from "phaser";

import { gameBus } from "@/lib/eventBus";

interface GameContextValue {
  gameRef: MutableRefObject<Phaser.Game | null>;
  eventBus: typeof gameBus;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }): ReactElement {
  const gameRef = useRef<Phaser.Game | null>(null);

  return (
    <GameContext.Provider value={{ gameRef, eventBus: gameBus }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGameContext(): GameContextValue {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGameContext must be used inside GameProvider");
  }
  return context;
}
