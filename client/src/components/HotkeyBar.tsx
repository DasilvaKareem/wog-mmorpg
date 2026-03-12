import * as React from "react";
import { cn } from "@/lib/utils";

interface HotkeyBarProps {
  onCharacter: () => void;
  onMap: () => void;
  onQuestLog: () => void;
  onInspect: () => void;
  onInbox: () => void;
  onChat: () => void;
  onRanks: () => void;
  onWallet: () => void;
  onSettings: () => void;
  inboxActive?: boolean;
  chatActive?: boolean;
  ranksActive?: boolean;
  walletActive?: boolean;
  settingsActive?: boolean;
  mobile?: boolean;
}

type Slot = {
  key: string;
  label: string;
  icon?: string;
  text?: string;
  actionKey: "character" | "map" | "questLog" | "inspect" | "inbox" | "chat" | "ranks" | "wallet" | "settings";
  toggleable?: boolean;
};

const slots: Slot[] = [
  { icon: "/icons/armor.png", key: "C", label: "Character", actionKey: "character" },
  { icon: "/icons/commet.png", key: "M", label: "Map", actionKey: "map" },
  { icon: "/icons/quest.png", key: "Q", label: "Quest Log", actionKey: "questLog" },
  { icon: "/icons/sword.png", key: "I", label: "Inspect", actionKey: "inspect" },
  { text: "\u2709", key: "N", label: "Inbox", actionKey: "inbox", toggleable: true },
  { text: "...", key: "L", label: "Chat", actionKey: "chat", toggleable: true },
  { icon: "/icons/level.png", key: "R", label: "Ranks", actionKey: "ranks", toggleable: true },
  { icon: "/icons/gold.png", key: "W", label: "Wallet", actionKey: "wallet", toggleable: true },
  { text: "\u2699", key: "O", label: "Settings", actionKey: "settings", toggleable: true },
];

export function HotkeyBar({
  onCharacter,
  onMap,
  onQuestLog,
  onInspect,
  onInbox,
  onChat,
  onRanks,
  onWallet,
  onSettings,
  inboxActive = false,
  chatActive = false,
  ranksActive = false,
  walletActive = false,
  settingsActive = false,
  mobile = false,
}: HotkeyBarProps): React.ReactElement {
  const actions: Record<string, () => void> = {
    character: onCharacter,
    map: onMap,
    questLog: onQuestLog,
    inspect: onInspect,
    inbox: onInbox,
    chat: onChat,
    ranks: onRanks,
    wallet: onWallet,
    settings: onSettings,
  };

  const activeMap: Record<string, boolean> = {
    inbox: inboxActive,
    chat: chatActive,
    ranks: ranksActive,
    wallet: walletActive,
    settings: settingsActive,
  };

  const size = mobile ? "w-11 h-11" : "w-12 h-12";
  const imgSize = mobile ? "w-7 h-7" : "w-7 h-7";

  return (
    <div className="flex gap-1" data-tutorial-id="hotkey-bar">
      {slots.map((slot) => {
        const isActive = slot.toggleable && activeMap[slot.actionKey];
        return (
          <button
            key={slot.key}
            onClick={actions[slot.actionKey]}
            title={`${slot.label} (${slot.key})`}
            data-tutorial-id={`hotkey-${slot.actionKey}`}
            className={cn(
              "relative flex flex-col items-center justify-center border-2 border-black backdrop-blur-sm shadow-[2px_2px_0_0_#000] hover:border-[#54f28b] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-none cursor-pointer",
              size,
              isActive
                ? "bg-[#1a2e1a]/90 border-[#54f28b]"
                : "bg-[#0f1830]/80 hover:bg-[#1a2338]/90"
            )}
          >
            {slot.icon ? (
              <img
                src={slot.icon}
                alt={slot.label}
                className={cn(imgSize, "object-contain drop-shadow-lg")}
                draggable={false}
              />
            ) : (
              <span className="text-[20px] text-[#9aa7cc] font-bold leading-none">{slot.text}</span>
            )}
            <span className="text-[7px] leading-none text-[#9aa7cc] mt-[2px] font-bold">{slot.key}</span>
          </button>
        );
      })}
    </div>
  );
}
