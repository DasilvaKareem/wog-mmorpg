import * as React from "react";
import type { Entity } from "@/types";

const BORDER = "#29334d";
const TEXT = "#f1f5ff";
const DIM = "#6b7a9e";
const ACCENT = "#54f28b";

export type NpcTab = "dialogue" | "training" | "professions" | "shop";

interface TabDef {
  key: NpcTab;
  label: string;
  icon: string;
}

const ALL_TABS: TabDef[] = [
  { key: "dialogue", label: "Dialogue", icon: "!" },
  { key: "training", label: "Training", icon: "T" },
  { key: "professions", label: "Profession", icon: "P" },
  { key: "shop", label: "Shop", icon: "$" },
];

export function getAvailableTabs(entity: Entity): NpcTab[] {
  const tabs: NpcTab[] = ["dialogue"];
  if (entity.teachesClass) tabs.push("training");
  if (entity.teachesProfession) tabs.push("professions");
  if (entity.type === "merchant" && entity.shopItems?.length) tabs.push("shop");
  return tabs;
}

interface Props {
  entity: Entity;
  activeTab: NpcTab;
  onTabChange: (tab: NpcTab) => void;
}

export function NpcServiceTabs({ entity, activeTab, onTabChange }: Props): React.ReactElement | null {
  const tabs = React.useMemo(() => {
    const available = getAvailableTabs(entity);
    return ALL_TABS.filter((t) => available.includes(t.key));
  }, [entity]);

  if (tabs.length <= 1) return null;

  return (
    <div
      className="flex gap-0 border-b"
      style={{ borderColor: BORDER, background: "#0d1322" }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
            style={{
              color: active ? TEXT : DIM,
              background: "transparent",
              borderBottom: active ? `2px solid ${ACCENT}` : "2px solid transparent",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            <span style={{ color: active ? ACCENT : DIM }}>[{tab.icon}]</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
