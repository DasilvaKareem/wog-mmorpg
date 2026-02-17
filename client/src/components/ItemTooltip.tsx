import * as React from "react";
import type { CatalogItem } from "@/hooks/useItemCatalog";

const QUALITY_COLORS: Record<string, string> = {
  common: "#9aa7cc",
  uncommon: "#54f28b",
  rare: "#5dadec",
  epic: "#b48efa",
  legendary: "#ffcc00",
};

interface ItemTooltipProps {
  item: CatalogItem;
  equipped: {
    tokenId: number;
    durability: number;
    maxDurability: number;
    broken?: boolean;
    quality?: string;
    rolledStats?: Partial<Record<string, number>>;
    bonusAffix?: string;
  };
  style?: React.CSSProperties;
}

const STAT_LABELS: Record<string, string> = {
  str: "STR",
  def: "DEF",
  hp: "HP",
  agi: "AGI",
  int: "INT",
  mp: "MP",
  faith: "FAITH",
  luck: "LUCK",
};

export function ItemTooltip({ item, equipped, style }: ItemTooltipProps): React.ReactElement {
  const quality = equipped.quality ?? "common";
  const nameColor = QUALITY_COLORS[quality] ?? QUALITY_COLORS.common;
  const durPct = equipped.maxDurability > 0 ? equipped.durability / equipped.maxDurability : 1;
  const durColor = durPct > 0.5 ? "#54f28b" : durPct > 0.2 ? "#f2c854" : "#f25454";

  const statEntries = item.statBonuses ? Object.entries(item.statBonuses) : [];
  const rolledEntries = equipped.rolledStats ? Object.entries(equipped.rolledStats) : [];

  return (
    <div
      className="pointer-events-none absolute z-[999] min-w-[180px] max-w-[240px] border-2 p-2"
      style={{
        background: "#0a0e1a",
        borderColor: "#29334d",
        fontFamily: "monospace",
        fontSize: "11px",
        lineHeight: "1.4",
        ...style,
      }}
    >
      {/* Name with quality color */}
      <div className="font-bold" style={{ color: nameColor }}>
        {item.name}
      </div>

      {/* Quality badge */}
      {quality !== "common" && (
        <div className="text-[10px] uppercase" style={{ color: nameColor, opacity: 0.8 }}>
          {quality}
        </div>
      )}

      {/* Slot */}
      {item.equipSlot && (
        <div className="mt-1 text-[10px]" style={{ color: "#6b7a9e" }}>
          {item.equipSlot.toUpperCase()}
        </div>
      )}

      {/* Description */}
      <div className="mt-1" style={{ color: "#8894b0" }}>
        {item.description}
      </div>

      {/* Base stat bonuses */}
      {statEntries.length > 0 && (
        <div className="mt-1">
          {statEntries.map(([stat, val]) => (
            <div key={stat} style={{ color: "#54f28b" }}>
              +{val} {STAT_LABELS[stat] ?? stat.toUpperCase()}
            </div>
          ))}
        </div>
      )}

      {/* Rolled bonus stats */}
      {rolledEntries.length > 0 && (
        <div className="mt-1">
          {rolledEntries.map(([stat, val]) => (
            <div key={stat} style={{ color: "#5dadec" }}>
              +{val} {STAT_LABELS[stat] ?? stat.toUpperCase()} (rolled)
            </div>
          ))}
        </div>
      )}

      {/* Bonus affix */}
      {equipped.bonusAffix && (
        <div className="mt-1" style={{ color: "#b48efa" }}>
          {equipped.bonusAffix}
        </div>
      )}

      {/* Durability bar */}
      {equipped.maxDurability > 0 && (
        <div className="mt-1">
          <div className="flex items-center gap-1">
            <span style={{ color: "#6b7a9e" }}>DUR</span>
            <div
              className="flex-1 h-[6px] border"
              style={{ borderColor: "#29334d", background: "#11182b" }}
            >
              <div
                className="h-full"
                style={{
                  width: `${durPct * 100}%`,
                  background: durColor,
                }}
              />
            </div>
            <span style={{ color: durColor }}>
              {equipped.durability}/{equipped.maxDurability}
            </span>
          </div>
          {equipped.broken && (
            <div className="text-[10px] font-bold" style={{ color: "#f25454" }}>
              BROKEN
            </div>
          )}
        </div>
      )}
    </div>
  );
}
