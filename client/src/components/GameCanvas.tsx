import * as React from "react";
import Phaser from "phaser";

import { useGameContext } from "@/context/GameContext";
import { WorldScene } from "@/WorldScene";

export function GameCanvas(): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { gameRef } = useGameContext();

  React.useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      backgroundColor: "#111111",
      pixelArt: true,
      scene: [WorldScene],
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: "100%",
        height: "100%",
      },
    });

    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, [gameRef]);

  return <div className="h-full w-full" ref={containerRef} />;
}
