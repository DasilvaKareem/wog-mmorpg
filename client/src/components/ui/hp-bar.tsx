import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

interface HpBarProps {
  hp: number;
  maxHp: number;
  className?: string;
}

export function HpBar({ hp, maxHp, className }: HpBarProps): ReactElement {
  const safeMax = Math.max(1, maxHp);
  const safeHp = clamp(hp, 0, safeMax);
  const progressPercent = (safeHp / safeMax) * 100;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-[8px] uppercase tracking-wide text-[#9aa7cc]">
        <span>HP</span>
        <span>
          {safeHp}/{safeMax}
        </span>
      </div>
      <div className="relative h-4 border-2 border-black bg-[#0f1528] shadow-[2px_2px_0_0_#000]">
        <div
          className="h-full bg-[repeating-linear-gradient(45deg,#ff4d6d_0px,#ff4d6d_4px,#e63859_4px,#e63859_8px)]"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
