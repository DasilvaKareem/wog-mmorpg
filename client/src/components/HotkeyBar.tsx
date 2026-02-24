import * as React from "react";

interface HotkeyBarProps {
  onCharacter: () => void;
  onMap: () => void;
  onQuestLog: () => void;
  onInspect: () => void;
  mobile?: boolean;
}

const slots = [
  { icon: "👤", key: "C", label: "Character" },
  { icon: "🗺️", key: "M", label: "Map" },
  { icon: "📜", key: "Q", label: "Quest Log" },
  { icon: "🔍", key: "I", label: "Inspect" },
] as const;

export function HotkeyBar({ onCharacter, onMap, onQuestLog, onInspect, mobile = false }: HotkeyBarProps): React.ReactElement {
  const actions = [onCharacter, onMap, onQuestLog, onInspect];

  return (
    <div className="flex gap-[2px]">
      {slots.map((slot, i) => (
        <button
          key={slot.key}
          onClick={actions[i]}
          title={`${slot.label} (${slot.key})`}
          className={`flex flex-col items-center justify-center border-2 border-black bg-[#0f1830] shadow-[2px_2px_0_0_#000] hover:bg-[#1a2338] hover:border-[#54f28b] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-none cursor-pointer ${mobile ? "w-12 h-12" : "w-10 h-10"}`}
        >
          <span className={mobile ? "text-[18px] leading-none" : "text-[16px] leading-none"}>{slot.icon}</span>
          <span className={mobile ? "text-[8px] leading-none text-[#9aa7cc] mt-[2px]" : "text-[7px] leading-none text-[#9aa7cc] mt-[2px]"}>{slot.key}</span>
        </button>
      ))}
    </div>
  );
}
