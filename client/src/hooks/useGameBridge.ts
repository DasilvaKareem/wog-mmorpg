import * as React from "react";

import { gameBus, type GameEventMap } from "@/lib/eventBus";

export function useGameBridge<K extends keyof GameEventMap>(
  event: K,
  handler: (payload: GameEventMap[K]) => void
): void {
  const handlerRef = React.useRef(handler);

  React.useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  React.useEffect(() => {
    const unsubscribe = gameBus.on(event, (payload) => {
      handlerRef.current(payload);
    });
    return unsubscribe;
  }, [event]);
}
