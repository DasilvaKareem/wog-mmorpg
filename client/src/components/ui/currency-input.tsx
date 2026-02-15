import * as React from "react";
import { cn } from "@/lib/utils";
import { formatGoldToMetals, parseMetalsToGold } from "@/lib/currency";
import { Input } from "./input";

export interface CurrencyInputProps {
  /** Current gold value (decimal) */
  value?: number;
  /** Callback when value changes */
  onChange: (goldAmount: number) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Maximum allowed gold amount */
  max?: number;
  /** Minimum allowed gold amount */
  min?: number;
  /** Custom class name */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Show labels */
  showLabels?: boolean;
}

/**
 * CurrencyInput Component
 *
 * Three-field input for entering amounts in Gold/Silver/Copper denominations.
 * Automatically converts to decimal GOLD for blockchain transactions.
 *
 * @example
 * const [amount, setAmount] = useState(10.0525);
 * <CurrencyInput value={amount} onChange={setAmount} />
 * // Renders: [10]g [5]s [25]c input fields
 *
 * @example
 * <CurrencyInput
 *   value={0}
 *   onChange={handleBid}
 *   max={500}
 *   disabled={isProcessing}
 * />
 */
export function CurrencyInput({
  value = 0,
  onChange,
  disabled = false,
  max,
  min = 0,
  className,
  size = "md",
  showLabels = true
}: CurrencyInputProps): React.ReactElement {
  // Local state for individual fields
  const [gold, setGold] = React.useState(0);
  const [silver, setSilver] = React.useState(0);
  const [copper, setCopper] = React.useState(0);

  // Update local state when external value changes
  React.useEffect(() => {
    const breakdown = formatGoldToMetals(value);
    setGold(breakdown.gold);
    setSilver(breakdown.silver);
    setCopper(breakdown.copper);
  }, [value]);

  // Handle field changes with validation
  const handleChange = (newGold: number, newSilver: number, newCopper: number) => {
    // Clamp silver and copper to 0-99
    const clampedSilver = Math.min(99, Math.max(0, Math.floor(newSilver)));
    const clampedCopper = Math.min(99, Math.max(0, Math.floor(newCopper)));
    const clampedGold = Math.max(0, Math.floor(newGold));

    // Calculate total gold
    let totalGold = parseMetalsToGold(clampedGold, clampedSilver, clampedCopper);

    // Apply min/max constraints
    if (min !== undefined && totalGold < min) {
      totalGold = min;
    }
    if (max !== undefined && totalGold > max) {
      totalGold = max;
      // Recompute breakdown based on max
      const maxBreakdown = formatGoldToMetals(max);
      setGold(maxBreakdown.gold);
      setSilver(maxBreakdown.silver);
      setCopper(maxBreakdown.copper);
      onChange(max);
      return;
    }

    onChange(totalGold);
  };

  // Size-based styles
  const sizeClasses = {
    sm: "h-7 text-[8px]",
    md: "h-9 text-[10px]",
    lg: "h-11 text-xs"
  };

  const widthClasses = {
    sm: "w-12",
    md: "w-16",
    lg: "w-20"
  };

  const iconSize = {
    sm: "text-[10px]",
    md: "text-xs",
    lg: "text-sm"
  };

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      {/* Gold Input */}
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min="0"
          max={max}
          value={gold}
          onChange={(e) => {
            const val = parseInt(e.target.value) || 0;
            setGold(val);
            handleChange(val, silver, copper);
          }}
          disabled={disabled}
          className={cn(
            widthClasses[size],
            sizeClasses[size],
            "text-center font-bold"
          )}
        />
        <span className={cn("text-yellow-400 font-bold whitespace-nowrap", iconSize[size])}>
          🪙 {showLabels && 'g'}
        </span>
      </div>

      {/* Silver Input */}
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min="0"
          max="99"
          value={silver}
          onChange={(e) => {
            const val = parseInt(e.target.value) || 0;
            const clamped = Math.min(99, Math.max(0, val));
            setSilver(clamped);
            handleChange(gold, clamped, copper);
          }}
          disabled={disabled}
          className={cn(
            widthClasses[size],
            sizeClasses[size],
            "text-center font-bold"
          )}
        />
        <span className={cn("text-gray-300 font-bold whitespace-nowrap", iconSize[size])}>
          🥈 {showLabels && 's'}
        </span>
      </div>

      {/* Copper Input */}
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min="0"
          max="99"
          value={copper}
          onChange={(e) => {
            const val = parseInt(e.target.value) || 0;
            const clamped = Math.min(99, Math.max(0, val));
            setCopper(clamped);
            handleChange(gold, silver, clamped);
          }}
          disabled={disabled}
          className={cn(
            widthClasses[size],
            sizeClasses[size],
            "text-center font-bold"
          )}
        />
        <span className={cn("text-amber-600 font-bold whitespace-nowrap", iconSize[size])}>
          🥉 {showLabels && 'c'}
        </span>
      </div>
    </div>
  );
}

/**
 * SimpleCurrencyInput Component
 *
 * Single-field input that accepts a gold decimal amount directly.
 * Displays the breakdown but only has one input field.
 *
 * @example
 * <SimpleCurrencyInput value={10.0525} onChange={setAmount} />
 */
export function SimpleCurrencyInput({
  value = 0,
  onChange,
  disabled = false,
  max,
  min = 0,
  className,
  size = "md"
}: Omit<CurrencyInputProps, 'showLabels'>): React.ReactElement {
  const breakdown = formatGoldToMetals(value);

  const sizeClasses = {
    sm: "h-7 text-[8px]",
    md: "h-9 text-[10px]",
    lg: "h-11 text-xs"
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Input
        type="number"
        min={min}
        max={max}
        step="0.0001"
        value={value}
        onChange={(e) => {
          const val = parseFloat(e.target.value) || 0;
          onChange(val);
        }}
        disabled={disabled}
        className={cn("w-32", sizeClasses[size])}
        placeholder="0.0000"
      />
      <span className="text-[8px] text-gray-500">
        = {breakdown.gold}g {breakdown.silver}s {breakdown.copper}c
      </span>
    </div>
  );
}

/**
 * CurrencyInputWithPresets Component
 *
 * Currency input with quick-select preset buttons
 *
 * @example
 * <CurrencyInputWithPresets
 *   value={amount}
 *   onChange={setAmount}
 *   presets={[1, 10, 100, 1000]}
 * />
 */
export function CurrencyInputWithPresets({
  value = 0,
  onChange,
  disabled = false,
  max,
  min = 0,
  className,
  presets = [1, 10, 100, 1000]
}: CurrencyInputProps & { presets?: number[] }): React.ReactElement {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <CurrencyInput
        value={value}
        onChange={onChange}
        disabled={disabled}
        max={max}
        min={min}
      />
      <div className="flex gap-1 flex-wrap">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(Math.min(max || Infinity, preset))}
            disabled={disabled}
            className="px-2 py-1 text-[8px] bg-gray-200 hover:bg-gray-300 border-2 border-black disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {preset}g
          </button>
        ))}
        {max && (
          <button
            type="button"
            onClick={() => onChange(max)}
            disabled={disabled}
            className="px-2 py-1 text-[8px] bg-yellow-200 hover:bg-yellow-300 border-2 border-black font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            MAX
          </button>
        )}
      </div>
    </div>
  );
}
