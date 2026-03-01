import * as React from "react";

interface HotkeyBarProps {
  onCharacter: () => void;
  onMap: () => void;
  onQuestLog: () => void;
  onInspect: () => void;
  mobile?: boolean;
}

const slots = [
  { icon: "/icons/armor.png", key: "C", label: "Character" },
  { icon: "/icons/commet.png", key: "M", label: "Map" },
  { icon: "/icons/quest.png", key: "Q", label: "Quest Log" },
  { icon: "/icons/sword.png", key: "I", label: "Inspect" },
] as const;

export function HotkeyBar({ onCharacter, onMap, onQuestLog, onInspect, mobile = false }: HotkeyBarProps): React.ReactElement {
  const actions = [onCharacter, onMap, onQuestLog, onInspect];
  const size = mobile ? "w-14 h-14" : "w-12 h-12";
  const imgSize = mobile ? "w-8 h-8" : "w-7 h-7";

  return (
    <div className="flex gap-1">
      {slots.map((slot, i) => (
        <button
          key={slot.key}
          onClick={actions[i]}
          title={`${slot.label} (${slot.key})`}
          className={`relative flex flex-col items-center justify-center border-2 border-black bg-[#0f1830]/80 backdrop-blur-sm shadow-[2px_2px_0_0_#000] hover:border-[#54f28b] hover:bg-[#1a2338]/90 active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-none cursor-pointer ${size}`}
        >
          <img
            src={slot.icon}
            alt={slot.label}
            className={`${imgSize} object-contain drop-shadow-lg`}
            draggable={false}
          />
          <span className="text-[7px] leading-none text-[#9aa7cc] mt-[2px] font-bold">{slot.key}</span>
        </button>
      ))}
    </div>
  );
}
