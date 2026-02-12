import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

const MAX_LEVEL = 60;

function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return 100 * level * level;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

interface XpBarProps {
  level: number;
  xp: number;
  className?: string;
}

export function XpBar({ level, xp, className }: XpBarProps): ReactElement {
  const currentLevel = Math.max(1, level);
  const currentLevelXp = xpForLevel(currentLevel);
  const nextLevelXp = currentLevel >= MAX_LEVEL ? currentLevelXp : xpForLevel(currentLevel + 1);
  const span = Math.max(1, nextLevelXp - currentLevelXp);
  const currentInLevel = clamp(xp - currentLevelXp, 0, span);
  const progressPercent = currentLevel >= MAX_LEVEL ? 100 : (currentInLevel / span) * 100;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-[8px] uppercase tracking-wide text-[#9aa7cc]">
        <span>XP</span>
        <span>
          Lv {currentLevel} 
          {currentLevel >= MAX_LEVEL ? "(MAX)" : `${currentInLevel}/${span}`}
        </span>
      </div>
      <div className="relative h-4 border-2 border-black bg-[#0f1528] shadow-[2px_2px_0_0_#000]">
        <div
          className="h-full bg-[repeating-linear-gradient(45deg,#54f28b_0px,#54f28b_4px,#3dd775_4px,#3dd775_8px)]"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
