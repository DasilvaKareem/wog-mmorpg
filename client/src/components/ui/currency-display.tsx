import * as React from "react";
import { cn } from "@/lib/utils";
import { formatGoldToMetals } from "@/lib/currency";

export interface CurrencyDisplayProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Gold amount as decimal (e.g., 123.4567) */
  amount: number | string;
  /** Show metal icons (coins) */
  showIcons?: boolean;
  /** Show full labels (e.g., "gold" instead of "g") */
  showLabels?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Hide zero denominations */
  hideZero?: boolean;
}

/**
 * CurrencyDisplay Component
 *
 * Displays GOLD cryptocurrency amounts as RPG-style metal denominations
 * (Gold/Silver/Copper). Pure UI abstraction - blockchain still uses decimal GOLD.
 *
 * @example
 * <CurrencyDisplay amount={123.4567} />
 * // Renders: "🪙 123g 🥈 45s 🥉 67c"
 *
 * @example
 * <CurrencyDisplay amount={10.05} showLabels />
 * // Renders: "🪙 10 gold 🥈 5 silver"
 *
 * @example
 * <CurrencyDisplay amount={0.0025} hideZero />
 * // Renders: "🥉 25c"
 */
export function CurrencyDisplay({
  amount,
  showIcons = true,
  showLabels = false,
  size = "md",
  hideZero = false,
  className,
  ...props
}: CurrencyDisplayProps): React.ReactElement {
  // Parse amount to number if it's a string
  const goldAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

  // Handle invalid amounts
  if (!Number.isFinite(goldAmount) || goldAmount < 0) {
    return <span className={cn("text-gray-500", className)} {...props}>Invalid amount</span>;
  }

  const { gold, silver, copper } = formatGoldToMetals(goldAmount);

  // Size classes
  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base"
  };

  const iconSize = {
    sm: "text-[10px]",
    md: "text-xs",
    lg: "text-sm"
  };

  // Metal denomination parts
  const parts: React.ReactNode[] = [];

  // Gold
  if (gold > 0 || (!hideZero && silver === 0 && copper === 0)) {
    parts.push(
      <span key="gold" className="text-yellow-400 font-bold whitespace-nowrap">
        {showIcons && <span className={cn(iconSize[size], "mr-0.5")}>🪙</span>}
        {gold}
        {showLabels ? (gold === 1 ? ' gold' : ' gold') : 'g'}
      </span>
    );
  }

  // Silver
  if (silver > 0 || (!hideZero && gold > 0 && copper > 0)) {
    parts.push(
      <span key="silver" className="text-gray-300 font-bold whitespace-nowrap">
        {showIcons && <span className={cn(iconSize[size], "mr-0.5")}>🥈</span>}
        {silver}
        {showLabels ? (silver === 1 ? ' silver' : ' silver') : 's'}
      </span>
    );
  }

  // Copper
  if (copper > 0) {
    parts.push(
      <span key="copper" className="text-amber-600 font-bold whitespace-nowrap">
        {showIcons && <span className={cn(iconSize[size], "mr-0.5")}>🥉</span>}
        {copper}
        {showLabels ? (copper === 1 ? ' copper' : ' copper') : 'c'}
      </span>
    );
  }

  // Handle zero case
  if (parts.length === 0) {
    return (
      <span className={cn("text-gray-500", sizeClasses[size], className)} {...props}>
        {showIcons && <span className={cn(iconSize[size], "mr-0.5")}>🥉</span>}
        0{showLabels ? ' copper' : 'c'}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1", sizeClasses[size], className)} {...props}>
      {parts}
    </span>
  );
}

/**
 * CurrencyDisplayCompact Component
 *
 * Compact version showing only the highest denomination(s)
 *
 * @example
 * <CurrencyDisplayCompact amount={123.4567} />
 * // Renders: "🪙 123g" (omits silver/copper for brevity)
 */
export function CurrencyDisplayCompact({
  amount,
  className,
  ...props
}: Omit<CurrencyDisplayProps, 'hideZero'>): React.ReactElement {
  const goldAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  const { gold, silver, copper } = formatGoldToMetals(goldAmount);

  // Show only the most significant denomination
  if (gold > 0) {
    return (
      <span className={cn("text-yellow-400 font-bold", className)} {...props}>
        🪙 {gold}g{silver > 0 || copper > 0 ? '+' : ''}
      </span>
    );
  }

  if (silver > 0) {
    return (
      <span className={cn("text-gray-300 font-bold", className)} {...props}>
        🥈 {silver}s{copper > 0 ? '+' : ''}
      </span>
    );
  }

  return (
    <span className={cn("text-amber-600 font-bold", className)} {...props}>
      🥉 {copper}c
    </span>
  );
}

/**
 * CurrencyDiff Component
 *
 * Shows the difference between two amounts with +/- indicator
 *
 * @example
 * <CurrencyDiff before={100} after={85.5} />
 * // Renders: "-14g 50s" in red
 */
export function CurrencyDiff({
  before,
  after,
  className,
  ...props
}: {
  before: number;
  after: number;
  className?: string;
}): React.ReactElement {
  const diff = after - before;
  const isPositive = diff > 0;
  const isNegative = diff < 0;

  return (
    <span
      className={cn(
        "font-bold",
        isPositive && "text-green-400",
        isNegative && "text-red-400",
        !isPositive && !isNegative && "text-gray-400",
        className
      )}
      {...props}
    >
      {isPositive && '+'}
      {isNegative && '-'}
      <CurrencyDisplay amount={Math.abs(diff)} showIcons={false} hideZero />
    </span>
  );
}
