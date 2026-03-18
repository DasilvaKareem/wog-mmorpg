import * as React from "react";
import { cn } from "@/lib/utils";
import { fetchProfessions, type ProfessionSkillDetail } from "@/ShardClient";
import { useWalletContext } from "@/context/WalletContext";

/** All 8 professions with display info + category */
const ALL_PROFESSIONS: { id: string; name: string; icon: string; category: "gathering" | "crafting" }[] = [
  { id: "mining",          name: "Mining",          icon: "\u26CF\uFE0F",  category: "gathering" },
  { id: "herbalism",       name: "Herbalism",       icon: "\uD83C\uDF3F",  category: "gathering" },
  { id: "skinning",        name: "Skinning",        icon: "\uD83E\uDE93",  category: "gathering" },
  { id: "blacksmithing",   name: "Blacksmithing",   icon: "\uD83D\uDD28",  category: "crafting" },
  { id: "alchemy",         name: "Alchemy",         icon: "\u2697\uFE0F",  category: "crafting" },
  { id: "cooking",         name: "Cooking",         icon: "\uD83C\uDF73",  category: "crafting" },
  { id: "leatherworking",  name: "Leatherworking",  icon: "\uD83E\uDDE4",  category: "crafting" },
  { id: "jewelcrafting",   name: "Jewelcrafting",   icon: "\uD83D\uDC8E",  category: "crafting" },
];

const SKILL_RANKS = [
  { min: 1,   label: "Novice",      color: "#8899aa" },
  { min: 50,  label: "Apprentice",  color: "#55bb55" },
  { min: 100, label: "Journeyman",  color: "#4488dd" },
  { min: 150, label: "Expert",      color: "#aa55cc" },
  { min: 200, label: "Artisan",     color: "#dd8833" },
  { min: 250, label: "Master",      color: "#ffcc00" },
  { min: 300, label: "Grand Master", color: "#ff4444" },
];

function getSkillRank(level: number) {
  for (let i = SKILL_RANKS.length - 1; i >= 0; i--) {
    if (level >= SKILL_RANKS[i].min) return SKILL_RANKS[i];
  }
  return SKILL_RANKS[0];
}

interface ProfessionsPanelProps {
  className?: string;
}

export function ProfessionsPanel({ className }: ProfessionsPanelProps): React.ReactElement {
  const { address } = useWalletContext();
  const [learned, setLearned] = React.useState<string[]>([]);
  const [skills, setSkills] = React.useState<Record<string, ProfessionSkillDetail>>({});
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!address) {
      setLearned([]);
      setSkills({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchProfessions(address).then((res) => {
      if (!cancelled) {
        setLearned(res.learned);
        setSkills(res.skills);
        setLoading(false);
      }
    });
    // Re-poll every 10s to show live progress
    const interval = setInterval(() => {
      fetchProfessions(address).then((res) => {
        if (!cancelled) {
          setLearned(res.learned);
          setSkills(res.skills);
        }
      });
    }, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [address]);

  const gathering = ALL_PROFESSIONS.filter((p) => p.category === "gathering");
  const crafting = ALL_PROFESSIONS.filter((p) => p.category === "crafting");

  function renderProfession(prof: typeof ALL_PROFESSIONS[0]) {
    const isLearned = learned.includes(prof.id);
    const skill = skills[prof.id];
    const level = skill?.level ?? 1;
    const progress = skill?.progress ?? 0;
    const actions = skill?.actions ?? 0;
    const rank = getSkillRank(level);

    return (
      <div
        key={prof.id}
        className={cn(
          "px-2 py-[6px] rounded-sm",
          isLearned ? "bg-[#1a2e1a]/60" : "bg-[#0f1830]/40 opacity-40",
        )}
      >
        <div className="flex items-center gap-2">
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
            <span className="text-[9px] font-bold" style={{ color: rank.color }}>
              Lv{level}
            </span>
          ) : (
            <span className="text-[9px] font-bold text-[#3a4a6a]">--</span>
          )}
        </div>
        {isLearned && (
          <div className="mt-1 ml-7">
            {/* Rank label */}
            <div className="flex items-center justify-between mb-[2px]">
              <span className="text-[8px] font-bold" style={{ color: rank.color }}>
                {rank.label}
              </span>
              <span className="text-[8px] text-[#556b8a]">
                {actions} action{actions !== 1 ? "s" : ""}
              </span>
            </div>
            {/* XP progress bar */}
            <div className="relative h-[6px] bg-[#1a1a2e] rounded-full overflow-hidden border border-[#24314d]/50">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                style={{
                  width: `${level >= 300 ? 100 : Math.max(2, progress)}%`,
                  background: `linear-gradient(90deg, ${rank.color}88, ${rank.color})`,
                }}
              />
            </div>
            <div className="flex justify-between mt-[1px]">
              <span className="text-[7px] text-[#445566]">{level}/300</span>
              {level < 300 && (
                <span className="text-[7px] text-[#445566]">{progress}% to next</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

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
          <>
            {/* Gathering section */}
            <div className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#557788] px-1 pt-1 pb-[2px]">
              Gathering
            </div>
            {gathering.map(renderProfession)}

            {/* Crafting section */}
            <div className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#557788] px-1 pt-2 pb-[2px]">
              Crafting
            </div>
            {crafting.map(renderProfession)}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-[#24314d] flex justify-between">
        <span className="text-[8px] text-[#556b8a]">
          {learned.length}/{ALL_PROFESSIONS.length} learned
        </span>
        {learned.length > 0 && (
          <span className="text-[8px] text-[#556b8a]">
            Avg Lv{Math.round(
              learned.reduce((sum, id) => sum + (skills[id]?.level ?? 1), 0) / learned.length
            )}
          </span>
        )}
      </div>
    </div>
  );
}
