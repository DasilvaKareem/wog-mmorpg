import * as React from "react";
import Phaser from "phaser";

import { useGameContext } from "@/context/GameContext";
import { WorldScene } from "@/WorldScene";

export function GameCanvas(): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { gameRef } = useGameContext();
  const isLowPowerDevice = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 1024;
  }, []);

  React.useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const resolution = Math.min(dpr, isLowPowerDevice ? 1.5 : 2);

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      backgroundColor: "#111111",
      pixelArt: true,
      render: {
        pixelArt: true,
        antialias: false,
        roundPixels: true,
        powerPreference: isLowPowerDevice ? "low-power" : "high-performance",
      },
      fps: {
        target: isLowPowerDevice ? 45 : 60,
        forceSetTimeOut: true,
      },
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
  }, [gameRef, isLowPowerDevice]);

  return <div className="world-canvas-container h-full w-full" ref={containerRef} />;
}
