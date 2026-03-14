import * as React from "react";
import { cn } from "@/lib/utils";
import { fetchProfessions } from "@/ShardClient";
import { useWalletContext } from "@/context/WalletContext";

/** All 8 professions with display info */
const ALL_PROFESSIONS: { id: string; name: string; icon: string }[] = [
  { id: "mining",          name: "Mining",          icon: "\u26CF\uFE0F" },
  { id: "herbalism",       name: "Herbalism",       icon: "\uD83C\uDF3F" },
  { id: "skinning",        name: "Skinning",        icon: "\uD83E\uDE93" },
  { id: "blacksmithing",   name: "Blacksmithing",   icon: "\uD83D\uDD28" },
  { id: "alchemy",         name: "Alchemy",         icon: "\u2697\uFE0F" },
  { id: "cooking",         name: "Cooking",         icon: "\uD83C\uDF73" },
  { id: "leatherworking",  name: "Leatherworking",  icon: "\uD83E\uDDE4" },
  { id: "jewelcrafting",   name: "Jewelcrafting",   icon: "\uD83D\uDC8E" },
];

interface ProfessionsPanelProps {
  className?: string;
}

export function ProfessionsPanel({ className }: ProfessionsPanelProps): React.ReactElement {
  const { address } = useWalletContext();
  const [learned, setLearned] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!address) {
      setLearned([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchProfessions(address).then((res) => {
      if (!cancelled) {
        setLearned(res.learned);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [address]);

  return (
    <div
      className={cn(
        "bg-[#0a0f1a]/90 border-2 border-[#24314d] backdrop-blur-sm shadow-[4px_4px_0_0_#000] w-56",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#24314d]">
        <span className="text-[14px]">{"\uD83D\uDEE0\uFE0F"}</span>
        <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#ffcc00]">
          Professions
        </span>
        <span className="ml-auto text-[9px] text-[#556b8a] font-bold">P</span>
      </div>

      {/* Body */}
      <div className="px-2 py-2 space-y-1">
        {loading ? (
          <div className="text-[10px] text-[#556b8a] text-center py-3">Loading...</div>
        ) : !address ? (
          <div className="text-[10px] text-[#556b8a] text-center py-3">Connect wallet to view</div>
        ) : (
          ALL_PROFESSIONS.map((prof) => {
            const isLearned = learned.includes(prof.id);
            return (
              <div
                key={prof.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-[5px] rounded-sm",
                  isLearned
                    ? "bg-[#1a2e1a]/60"
                    : "bg-[#0f1830]/40 opacity-50",
                )}
              >
                <span className="text-[16px] leading-none w-5 text-center">{prof.icon}</span>
                <span
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-wide flex-1",
                    isLearned ? "text-[#c8d6e5]" : "text-[#556b8a]",
                  )}
                >
                  {prof.name}
                </span>
                {isLearned ? (
                  <span className="text-[9px] font-bold text-[#54f28b]">LEARNED</span>
                ) : (
                  <span className="text-[9px] font-bold text-[#3a4a6a]">--</span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-[#24314d]">
        <span className="text-[8px] text-[#556b8a]">
          {learned.length}/{ALL_PROFESSIONS.length} learned
        </span>
      </div>
    </div>
  );
}
