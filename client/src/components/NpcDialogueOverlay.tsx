import * as React from "react";

import { API_URL } from "@/config";
import { SCOUT_KAELA_BRIEFED_FLAG } from "@/dialogue/data/questDialogueData";
import { useDialogueRunner } from "@/dialogue/runtime";
import { buildNpcQuestDialogueScript, buildScoutKaelaDialogueScript } from "@/dialogue/questScripts";
import type { DialogueChoice, DialogueEffect, DialoguePortrait, DialogueScript } from "@/dialogue/types";
import type { ActiveQuestEntry, AvailableQuestEntry } from "@/hooks/useQuestLog";
import { useGameBridge } from "@/hooks/useGameBridge";
import { useWalletContext } from "@/context/WalletContext";
import { getAuthToken } from "@/lib/agentAuth";
import { gameBus } from "@/lib/eventBus";
import { playSoundEffect } from "@/lib/soundEffects";
import type { Entity } from "@/types";
import { NpcServiceTabs, getAvailableTabs, type NpcTab } from "@/components/npc-tabs/NpcServiceTabs";
import { NpcTrainingTab } from "@/components/npc-tabs/NpcTrainingTab";
import { NpcProfessionTab } from "@/components/npc-tabs/NpcProfessionTab";
import { NpcShopTab } from "@/components/npc-tabs/NpcShopTab";

const BG = "#11182b";
const BG_DARK = "#0a0e18";
const BORDER = "#29334d";
const TEXT = "#f1f5ff";
const DIM = "#6b7a9e";
const ACCENT = "#54f28b";
const GOLD = "#f2c854";
const CHAMPION_COLOR = "#44ddff";
const WARN = "#e0af68";
const DANGER = "#f25454";

const sentQuestIds = new Set<string>();

interface NpcAmbientDialogueAction {
  label: string;
  prompt: string;
}

interface NpcAmbientDialogueResponse {
  provider: "deterministic" | "llm";
  reply: string;
  intent: string;
  referencesQuestId?: string;
  suggestedActions: NpcAmbientDialogueAction[];
  persona: {
    id: string;
    role: string;
    archetype: string;
    tone: string;
  };
}

interface QuestGraphRenderableChoice {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "danger";
}

interface QuestGraphRenderableFreeformRoute {
  id: string;
  label: string;
}

type QuestGraphRenderableNode =
  | {
      id: string;
      type: "line";
      speaker: "npc" | "player" | "system";
      text: string;
    }
  | {
      id: string;
      type: "choice";
      speaker: "npc" | "player" | "system";
      text: string;
      choices: QuestGraphRenderableChoice[];
    }
  | {
      id: string;
      type: "freeform";
      speaker: "npc" | "player" | "system";
      text: string;
      prompt: string;
      placeholder?: string;
      routes: QuestGraphRenderableFreeformRoute[];
      fallbackText?: string;
    }
  | {
      id: string;
      type: "end";
      text?: string;
    };

interface QuestGraphSession {
  arcId: string;
  sceneId: string;
  sceneTitle: string;
  node: QuestGraphRenderableNode;
}

interface QuestGraphResponse {
  arcId: string;
  sceneId: string;
  sceneTitle?: string;
  node: QuestGraphRenderableNode;
}

interface AuthoredQuestGraphSceneTarget {
  arcId: string;
  sceneId: string;
  sceneTitle: string;
  primaryQuestIds?: string[];
}

const AUTHORED_QUEST_GRAPH_SCENES: Record<string, { arcId: string; sceneId: string; sceneTitle: string }> = {
  "Scout Kaela": {
    arcId: "village-square-onboarding",
    sceneId: "kaela_briefing",
    sceneTitle: "Scout Kaela Briefing",
  },
  "Guard Captain Marcus": {
    arcId: "village-square-onboarding",
    sceneId: "marcus_arrival",
    sceneTitle: "Guard Captain Marcus Arrival",
  },
  "Guard Captain Marcus Contracts": {
    arcId: "village-square-welcome-tour",
    sceneId: "marcus_contracts",
    sceneTitle: "Guard Captain Marcus Contracts",
  },
  "Grimwald the Trader": {
    arcId: "village-square-welcome-tour",
    sceneId: "grimwald_trade_intro",
    sceneTitle: "Grimwald's First Bargain",
  },
  "Bron the Blacksmith": {
    arcId: "village-square-welcome-tour",
    sceneId: "bron_forge_handoff",
    sceneTitle: "Bron's Forge Handoff",
  },
  "Thrain Ironforge - Warrior Trainer": {
    arcId: "village-square-welcome-tour",
    sceneId: "thrain_training_counsel",
    sceneTitle: "Thrain's Training Counsel",
  },
  "Herbalist Willow": {
    arcId: "village-square-welcome-tour",
    sceneId: "willow_foragers_counsel",
    sceneTitle: "Willow's Forager Counsel",
  },
  "Chef Gastron": {
    arcId: "village-square-welcome-tour",
    sceneId: "gastron_campfire_welcome",
    sceneTitle: "Gastron's Campfire Welcome",
  },
  "Grizzled Miner Torvik": {
    arcId: "village-square-welcome-tour",
    sceneId: "torvik_miner_briefing",
    sceneTitle: "Torvik's Miner Briefing",
  },
  "Ranger Thornwood": {
    arcId: "wild-meadow-frontiers",
    sceneId: "thornwood_frontier",
    sceneTitle: "Ranger Thornwood Frontier Orders",
  },
  "Druid Caelum": {
    arcId: "wild-meadow-frontiers",
    sceneId: "caelum_essence",
    sceneTitle: "Druid Caelum and the Living Flow",
  },
  "Warden Sylvara": {
    arcId: "wild-meadow-frontiers",
    sceneId: "sylvara_guardians",
    sceneTitle: "Warden Sylvara and the Emerald Woods",
  },
  "Sage Thessaly": {
    arcId: "wild-meadow-frontiers",
    sceneId: "thessaly_aurundel",
    sceneTitle: "Sage Thessaly and Aurundel's Burden",
  },
  "Priestess Selene": {
    arcId: "dark-forest-thresholds",
    sceneId: "selene_shadows",
    sceneTitle: "Priestess Selene and the Dark Forest Trial",
  },
  "Arcanist Voss": {
    arcId: "dark-forest-thresholds",
    sceneId: "voss_unbound",
    sceneTitle: "Arcanist Voss and the Modernist Gambit",
  },
  "Stonekeeper Durgan": {
    arcId: "dark-forest-thresholds",
    sceneId: "durgan_depths",
    sceneTitle: "Stonekeeper Durgan and the Gemloch Depths",
  },
  "Remnant Keeper Nyx": {
    arcId: "dark-forest-thresholds",
    sceneId: "nyx_selerion",
    sceneTitle: "Remnant Keeper Nyx and the Selerion Fragments",
  },
  "Windcaller Aelara": {
    arcId: "auroral-plains-tempests",
    sceneId: "aelara_tempests",
    sceneTitle: "Windcaller Aelara and the Auroral Tempests",
  },
  "Gemloch Overseer Barak": {
    arcId: "dwarven-strongholds",
    sceneId: "barak_range",
    sceneTitle: "Gemloch Overseer Barak and the High Pass",
  },
  "Forgeguard Captain Haldor": {
    arcId: "dwarven-strongholds",
    sceneId: "haldor_citadel",
    sceneTitle: "Forgeguard Captain Haldor and the Broken Citadel",
  },
  "Runesmith Korra": {
    arcId: "dwarven-strongholds",
    sceneId: "korra_reforge",
    sceneTitle: "Runesmith Korra and the Reforging Effort",
  },
  "Verdant Warden Sylva": {
    arcId: "emerald-woods-canopy",
    sceneId: "sylva_canopy",
    sceneTitle: "Verdant Warden Sylva and the Canopy Watch",
  },
  "Herbalist Fern": {
    arcId: "emerald-woods-canopy",
    sceneId: "fern_grove",
    sceneTitle: "Herbalist Fern and the Deep Grove",
  },
  "Lumen Priestess Aurelia": {
    arcId: "lake-lumina-reflections",
    sceneId: "aurelia_lake",
    sceneTitle: "Lumen Priestess Aurelia and the Drowned Light",
  },
  "Tide Alchemist Nereus": {
    arcId: "lake-lumina-reflections",
    sceneId: "nereus_tides",
    sceneTitle: "Tide Alchemist Nereus and the Purification Work",
  },
  "Dragonkin Watcher Azael": {
    arcId: "azurshard-abyss",
    sceneId: "azael_watch",
    sceneTitle: "Dragonkin Watcher Azael and the Chasm's Law",
  },
  "Crystal Sage Velara": {
    arcId: "azurshard-abyss",
    sceneId: "velara_resonance",
    sceneTitle: "Crystal Sage Velara and the Harmonic Work",
  },
  "Elder Druid Moonwhisper": {
    arcId: "moondancer-glade-rites",
    sceneId: "moonwhisper_rites",
    sceneTitle: "Elder Druid Moonwhisper and the Broken Pact",
  },
  "Moonherb Gatherer Lirien": {
    arcId: "moondancer-glade-rites",
    sceneId: "lirien_moonherbs",
    sceneTitle: "Moonherb Gatherer Lirien and the Salvage Work",
  },
  "Prospector Helga": {
    arcId: "viridian-prospects",
    sceneId: "helga_prospect",
    sceneTitle: "Prospector Helga and the Upper Veins",
  },
};

const AUTHORED_PROGRESSIVE_QUEST_SCENES: Record<string, AuthoredQuestGraphSceneTarget[]> = {
  "Guard Captain Marcus": [{
    arcId: "village-square-welcome-tour",
    sceneId: "marcus_contracts",
    sceneTitle: "Guard Captain Marcus Contracts",
    primaryQuestIds: ["welcome_adventurer", "ready_for_battle"],
  }],
  "Grimwald the Trader": [{
    arcId: "village-square-welcome-tour",
    sceneId: "grimwald_trade_intro",
    sceneTitle: "Grimwald's First Bargain",
    primaryQuestIds: ["traders_bargain"],
  }],
  "Bron the Blacksmith": [{
    arcId: "village-square-welcome-tour",
    sceneId: "bron_forge_handoff",
    sceneTitle: "Bron's Forge Handoff",
    primaryQuestIds: ["blacksmiths_offer"],
  }],
  "Thrain Ironforge - Warrior Trainer": [{
    arcId: "village-square-welcome-tour",
    sceneId: "thrain_training_counsel",
    sceneTitle: "Thrain's Training Counsel",
    primaryQuestIds: ["warriors_wisdom"],
  }],
  "Herbalist Willow": [{
    arcId: "village-square-welcome-tour",
    sceneId: "willow_foragers_counsel",
    sceneTitle: "Willow's Forager Counsel",
    primaryQuestIds: ["foragers_knowledge"],
  }],
  "Chef Gastron": [{
    arcId: "village-square-welcome-tour",
    sceneId: "gastron_campfire_welcome",
    sceneTitle: "Gastron's Campfire Welcome",
    primaryQuestIds: ["cooks_secret"],
  }],
  "Grizzled Miner Torvik": [{
    arcId: "village-square-welcome-tour",
    sceneId: "torvik_miner_briefing",
    sceneTitle: "Torvik's Miner Briefing",
    primaryQuestIds: ["miners_greeting"],
  }],
  "Farmhand Amos": [
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "amos_mining",
      sceneTitle: "Farmhand Amos and Stone Foundations",
      primaryQuestIds: ["farm_mining_foundation", "farm_mining_claim"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "amos_herbalism",
      sceneTitle: "Farmhand Amos and Green Acres",
      primaryQuestIds: ["farm_herb_first_harvest", "farm_herb_green_acres"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "amos_skinning",
      sceneTitle: "Farmhand Amos and Pest Control",
      primaryQuestIds: ["farm_skin_pest_control", "farm_skin_homesteader"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "amos_smithing",
      sceneTitle: "Farmhand Amos and Nails for the Cause",
      primaryQuestIds: ["farm_smith_nails", "farm_smith_real_estate"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "amos_alchemy",
      sceneTitle: "Farmhand Amos and Field Remedies",
      primaryQuestIds: ["farm_alch_field_remedy", "farm_alch_apothecary"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "amos_cooking",
      sceneTitle: "Farmhand Amos and the Harvest Feast",
      primaryQuestIds: ["farm_cook_harvest_feast", "farm_cook_kitchen_dreams"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "amos_leather",
      sceneTitle: "Farmhand Amos and Ranch Work",
      primaryQuestIds: ["farm_leather_saddles", "farm_leather_ranch"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "amos_jewel",
      sceneTitle: "Farmhand Amos and Sunstone Prospects",
      primaryQuestIds: ["farm_jewel_sunstone", "farm_jewel_gem_estate"],
    },
  ],
  "Plot Registrar Helga": [
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "helga_mining_claim",
      sceneTitle: "Plot Registrar Helga and the Mason's Claim",
      primaryQuestIds: ["farm_mining_claim"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "helga_herb_claim",
      sceneTitle: "Plot Registrar Helga and Green Acres",
      primaryQuestIds: ["farm_herb_green_acres"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "helga_skin_claim",
      sceneTitle: "Plot Registrar Helga and the Homesteader's Way",
      primaryQuestIds: ["farm_skin_homesteader"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "helga_smith_claim",
      sceneTitle: "Plot Registrar Helga and Built-to-Last Ground",
      primaryQuestIds: ["farm_smith_real_estate"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "helga_alch_claim",
      sceneTitle: "Plot Registrar Helga and the Farm Apothecary",
      primaryQuestIds: ["farm_alch_apothecary"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "helga_cook_claim",
      sceneTitle: "Plot Registrar Helga and a Kitchen of Your Own",
      primaryQuestIds: ["farm_cook_kitchen_dreams"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "helga_leather_claim",
      sceneTitle: "Plot Registrar Helga and Ranch Ground",
      primaryQuestIds: ["farm_leather_ranch"],
    },
    {
      arcId: "sunflower-fields-homesteads",
      sceneId: "helga_jewel_claim",
      sceneTitle: "Plot Registrar Helga and the Gem Estate",
      primaryQuestIds: ["farm_jewel_gem_estate"],
    },
  ],
};

function pickProgressiveScene(
  scenes: AuthoredQuestGraphSceneTarget[],
  activeQuestIds: string[],
  completedQuestIds: string[],
  availableQuestIds: string[],
): AuthoredQuestGraphSceneTarget | null {
  const byPriority = [
    activeQuestIds,
    availableQuestIds,
    completedQuestIds,
  ];

  for (const questIds of byPriority) {
    const matched = scenes.find((scene) => {
      const relevantQuestIds = scene.primaryQuestIds ?? [];
      return relevantQuestIds.some((questId) => questIds.includes(questId));
    });
    if (matched) return matched;
  }

  return null;
}

function questGiverArcId(name: string): string {
  return `questgiver-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")}`;
}

function isScoutKaela(name: string | null | undefined): boolean {
  return name === "Scout Kaela";
}

function getQuestGraphScene(
  name: string | null | undefined,
  storyFlags: string[],
  activeQuestIds: string[],
  completedQuestIds: string[],
  availableQuestIds: string[],
): { arcId: string; sceneId: string; sceneTitle: string } | null {
  if (!name) return null;

  if (name === "Scout Kaela") {
    return AUTHORED_QUEST_GRAPH_SCENES[name];
  }

  if (name === "Guard Captain Marcus") {
    const welcomeQuestTouched = activeQuestIds.includes("welcome_adventurer")
      || completedQuestIds.includes("welcome_adventurer");
    if (!storyFlags.includes(SCOUT_KAELA_BRIEFED_FLAG) || !welcomeQuestTouched) {
      return AUTHORED_QUEST_GRAPH_SCENES[name];
    }
  }

  const authoredScene = AUTHORED_QUEST_GRAPH_SCENES[name];
  if (authoredScene && name !== "Guard Captain Marcus") {
    return authoredScene;
  }

  const progressiveScenes = AUTHORED_PROGRESSIVE_QUEST_SCENES[name];
  if (progressiveScenes) {
    const matchedScene = pickProgressiveScene(progressiveScenes, activeQuestIds, completedQuestIds, availableQuestIds);
    if (matchedScene) {
      return matchedScene;
    }
  }

  return {
    arcId: questGiverArcId(name),
    sceneId: "root",
    sceneTitle: `${name} Contract Board`,
  };
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || target.isContentEditable;
}

function useTypewriter(text: string, speed = 20): {
  displayed: string;
  done: boolean;
  skip: () => void;
} {
  const [displayed, setDisplayed] = React.useState("");
  const [done, setDone] = React.useState(false);
  const indexRef = React.useRef(0);

  React.useEffect(() => {
    setDisplayed("");
    setDone(false);
    indexRef.current = 0;
    if (!text) {
      setDone(true);
      return;
    }
    const interval = window.setInterval(() => {
      indexRef.current += 1;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        setDone(true);
        window.clearInterval(interval);
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, speed);
    return () => window.clearInterval(interval);
  }, [text, speed]);

  const skip = React.useCallback(() => {
    setDisplayed(text);
    setDone(true);
    indexRef.current = text.length;
  }, [text]);

  return { displayed, done, skip };
}

function choiceColors(choice: Pick<DialogueChoice, "variant"> | Pick<QuestGraphRenderableChoice, "style">): {
  border: string;
  text: string;
  background: string;
} {
  const variant = (choice as Pick<DialogueChoice, "variant">).variant
    ?? (choice as Pick<QuestGraphRenderableChoice, "style">).style;
  if (variant === "primary") {
    return { border: ACCENT, text: "#0a0e18", background: ACCENT };
  }
  if (variant === "danger") {
    return { border: DANGER, text: DANGER, background: "transparent" };
  }
  return { border: BORDER, text: DIM, background: "transparent" };
}

function speakerMeta(speaker: "npc" | "champion" | "player" | "system", npcName: string, championName: string): {
  name: string;
  color: string;
  icon: string;
} {
  if (speaker === "champion" || speaker === "player") {
    return { name: championName, color: CHAMPION_COLOR, icon: "\u2694" };
  }
  if (speaker === "system") {
    return { name: "System", color: ACCENT, icon: "*" };
  }
  return { name: npcName, color: GOLD, icon: "!" };
}

function PortraitPanel({ portrait }: { portrait: DialoguePortrait }): React.ReactElement {
  const sharedStyle: React.CSSProperties = {
    bottom: 0,
    [portrait.side]: "max(1vw, calc(50% - 520px))",
    zIndex: 51,
  };

  return portrait.src ? (
    <img
      alt={portrait.alt}
      className="absolute pointer-events-none select-none hidden sm:block"
      src={portrait.src}
      style={{
        ...sharedStyle,
        height: "min(55vh, 440px)",
        objectFit: "contain",
        objectPosition: "bottom",
        filter: "drop-shadow(4px 4px 12px rgba(0,0,0,0.7))",
      }}
    />
  ) : (
    <div
      className="absolute pointer-events-none select-none hidden sm:flex items-end"
      style={sharedStyle}
    >
      <div
        className="border-2 px-4 py-5 shadow-2xl"
        style={{
          borderColor: portrait.accent ?? BORDER,
          background: "rgba(10,14,24,0.92)",
          minWidth: 180,
        }}
      >
        <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: DIM }}>
          Portrait Ready
        </div>
        <div className="mt-2 text-[20px] font-bold" style={{ color: portrait.accent ?? TEXT }}>
          {portrait.label ?? portrait.alt}
        </div>
        <div className="mt-1 text-[11px]" style={{ color: DIM }}>
          Wire your generated character or NPC portrait into the dialogue node.
        </div>
      </div>
    </div>
  );
}

export function NpcDialogueOverlay(): React.ReactElement | null {
  const { address } = useWalletContext();
  const [open, setOpen] = React.useState(false);
  const [npc, setNpc] = React.useState<Entity | null>(null);
  const [script, setScript] = React.useState<DialogueScript | null>(null);
  const [graphSession, setGraphSession] = React.useState<QuestGraphSession | null>(null);
  const [championName, setChampionName] = React.useState("Champion");
  const [playerEntityId, setPlayerEntityId] = React.useState<string | null>(null);
  const [askValue, setAskValue] = React.useState("");
  const [graphInputValue, setGraphInputValue] = React.useState("");
  const [graphError, setGraphError] = React.useState<string | null>(null);
  const [graphLoading, setGraphLoading] = React.useState(false);
  const [ambientReply, setAmbientReply] = React.useState<NpcAmbientDialogueResponse | null>(null);
  const [ambientLoading, setAmbientLoading] = React.useState(false);
  const [ambientError, setAmbientError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<NpcTab>("dialogue");
  const [currentZoneId, setCurrentZoneId] = React.useState("village-square");

  useGameBridge("zoneChanged", ({ zoneId }) => setCurrentZoneId(zoneId));

  const handleClose = React.useCallback(() => {
    playSoundEffect("ui_dialog_close");
    setOpen(false);
    setNpc(null);
    setScript(null);
    setGraphSession(null);
    setAskValue("");
    setGraphInputValue("");
    setGraphError(null);
    setGraphLoading(false);
    setAmbientReply(null);
    setAmbientError(null);
    setAmbientLoading(false);
    setActiveTab("dialogue");
  }, []);

  const handleEffects = React.useCallback((effects: DialogueEffect[]) => {
    void (async () => {
      for (const effect of effects) {
        if (effect.type === "acceptQuest") {
          sentQuestIds.add(effect.quest.questId);
          gameBus.emit("agentGoToNpc", {
            entityId: effect.npc.id,
            zoneId: effect.npc.zoneId ?? "",
            name: effect.npc.name,
            type: "quest-giver",
            action: "accept-quest",
            questId: effect.quest.questId,
            questTitle: effect.quest.title,
          });
          continue;
        }

        if (effect.type === "turnInQuest") {
          gameBus.emit("agentGoToNpc", {
            entityId: effect.npc.id,
            zoneId: effect.npc.zoneId ?? "",
            name: effect.npc.name,
            type: "quest-giver",
            action: "complete-quest",
            questId: effect.quest.questId,
            questTitle: effect.quest.title,
          });
          continue;
        }

        if (effect.type === "setStoryFlag") {
          if (!address || !playerEntityId) {
            console.warn("[dialogue] Missing wallet or player entity for story flag", effect.flag);
            continue;
          }

          try {
            const token = await getAuthToken(address);
            if (!token) {
              console.warn("[dialogue] Failed to acquire auth token for story flag", effect.flag);
              continue;
            }

            const res = await fetch(`${API_URL}/story/flags`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ entityId: playerEntityId, flag: effect.flag }),
            });

            if (res.ok) {
              await res.json().catch(() => null);
            }
          } catch (error) {
            console.warn("[dialogue] Failed to persist story flag", effect.flag, error);
          }
          continue;
        }

        if (effect.type === "close") {
          handleClose();
        }
      }
    })();
  }, [address, handleClose, playerEntityId]);

  const { node, history, advance, choose } = useDialogueRunner(open ? script : null, {
    onEffects: handleEffects,
    onClose: handleClose,
  });

  const legacyNode = graphSession ? null : node;
  const graphNode = graphSession?.node ?? null;
  const activeNode = graphNode ?? legacyNode;
  const currentText = activeNode?.text ?? "";
  const { displayed, done, skip } = useTypewriter(currentText, 20);

  const runQuestGraphStart = React.useCallback(async (
    target: { arcId: string; sceneId: string; sceneTitle: string },
    nextPlayerId: string,
    walletAddress: string,
  ): Promise<boolean> => {
    try {
      const token = await getAuthToken(walletAddress);
      if (!token) return false;

      const res = await fetch(`${API_URL}/quest-arcs/${target.arcId}/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entityId: nextPlayerId,
          sceneId: target.sceneId,
          commit: true,
        }),
      });

      if (!res.ok) return false;
      const data = await res.json() as QuestGraphResponse;
      setGraphSession({
        arcId: data.arcId,
        sceneId: data.sceneId,
        sceneTitle: data.sceneTitle ?? target.sceneTitle,
        node: data.node,
      });
      setScript(null);
      setGraphInputValue("");
      setGraphError(null);
      return true;
    } catch {
      return false;
    }
  }, []);

  const advanceQuestGraph = React.useCallback(async (input?: { choiceId?: string; freeformInput?: string }) => {
    if (!graphSession || !npc || !address || !playerEntityId || graphLoading) return;

    setGraphLoading(true);
    setGraphError(null);
    try {
      const token = await getAuthToken(address);
      if (!token) {
        setGraphError("Wallet auth failed. Reconnect and try again.");
        return;
      }

      const res = await fetch(`${API_URL}/quest-arcs/${graphSession.arcId}/advance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entityId: playerEntityId,
          sceneId: graphSession.sceneId,
          nodeId: graphSession.node.id,
          choiceId: input?.choiceId,
          freeformInput: input?.freeformInput,
          commit: true,
        }),
      });

      const data = await res.json().catch(() => null) as
        | (QuestGraphResponse & { resolution?: { fallbackText?: string } })
        | null;

      if (!res.ok || !data) {
        setGraphError((data as { error?: string } | null)?.error ?? "Quest graph request failed.");
        return;
      }

      setGraphSession((prev) => prev ? {
        ...prev,
        sceneTitle: data.sceneTitle ?? prev.sceneTitle,
        node: data.node,
      } : prev);
      setGraphInputValue("");
      setGraphError(data.resolution?.fallbackText ?? null);
    } catch {
      setGraphError("Failed to reach quest graph service.");
    } finally {
      setGraphLoading(false);
    }
  }, [address, graphLoading, graphSession, npc, playerEntityId]);

  const handleAdvance = React.useCallback(() => {
    if (!done) {
      skip();
      return;
    }
    if (graphSession) {
      if (graphSession.node.type === "choice" || graphSession.node.type === "freeform") return;
      if (graphSession.node.type === "end") {
        handleClose();
        return;
      }
      void advanceQuestGraph();
      return;
    }
    if (node?.choices?.length) return;
    advance();
  }, [advance, advanceQuestGraph, done, graphSession, handleClose, node?.choices, skip]);

  const handleChoice = React.useCallback((choiceId: string) => {
    if (!done) {
      skip();
      return;
    }
    if (graphSession) {
      void advanceQuestGraph({ choiceId });
      return;
    }
    choose(choiceId);
  }, [advanceQuestGraph, choose, done, graphSession, skip]);

  const submitAmbientPrompt = React.useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || !npc || !address || !playerEntityId || ambientLoading) return;

    setAmbientLoading(true);
    setAmbientError(null);
    try {
      const token = await getAuthToken(address);
      if (!token) {
        setAmbientError("Wallet auth failed. Reconnect and try again.");
        return;
      }

      const res = await fetch(`${API_URL}/npc/dialogue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entityId: playerEntityId,
          npcEntityId: npc.id,
          message: trimmed,
          recentHistory: history.slice(-6).map((entry) => ({
            role: entry.speaker === "npc" ? "npc" : "player",
            content: entry.text,
          })),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        setAmbientError(errorData?.error ?? "NPC dialogue request failed.");
        return;
      }

      const data = await res.json();
      setAmbientReply(data);
      setAskValue("");
    } catch {
      setAmbientError("Failed to reach NPC dialogue service.");
    } finally {
      setAmbientLoading(false);
    }
  }, [address, ambientLoading, history, npc, playerEntityId]);

  useGameBridge("questNpcClick", async (entity: Entity) => {
    playSoundEffect("ui_dialog_open");
    setOpen(true);
    setNpc(entity);
    setPlayerEntityId(null);
    setScript(null);
    setGraphSession(null);
    setAskValue("");
    setGraphInputValue("");
    setGraphError(null);
    setGraphLoading(false);
    setAmbientReply(null);
    setAmbientError(null);
    setAmbientLoading(false);
    setActiveTab("dialogue");

    if (isScoutKaela(entity.name)) {
      setChampionName("Champion");
    }

    let resolvedChampionName = "Champion";
    let resolvedChampionOrigin: string | null = null;
    let playerId: string | null = null;
    let resolvedStoryFlags: string[] = [];
    let activeQuests: ActiveQuestEntry[] = [];
    let completedQuestIds: string[] = [];
    let availableQuests: AvailableQuestEntry[] = [];

    if (address) {
      try {
        const logRes = await fetch(`${API_URL}/questlog/${address}`);
        if (logRes.ok) {
          const logData = await logRes.json();
          resolvedChampionName = logData.playerName ?? resolvedChampionName;
          resolvedChampionOrigin = logData.origin ?? resolvedChampionOrigin;
          playerId = logData.entityId ?? null;
          resolvedStoryFlags = Array.isArray(logData.storyFlags) ? logData.storyFlags : [];
          activeQuests = (logData.activeQuests ?? []).filter(
            (quest: ActiveQuestEntry) => quest.npcEntityId === entity.id,
          );
          completedQuestIds = Array.isArray(logData.completedQuests)
            ? logData.completedQuests.map((quest: { questId: string }) => quest.questId)
            : [];
        }
      } catch {
        // Ignore quest log failures and still open the dialogue shell.
      }
    }

    try {
      const url = playerId
        ? `${API_URL}/quests/npc/${entity.id}?playerId=${playerId}`
        : `${API_URL}/quests/npc/${entity.id}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        availableQuests = (data.quests ?? [])
          .map((quest: any) => ({
            questId: quest.id,
            title: quest.title,
            description: quest.description,
            npcEntityId: entity.id,
            npcName: entity.name,
            objective: quest.objective,
            rewards: quest.rewards,
          }))
          .filter((quest: AvailableQuestEntry) => !sentQuestIds.has(quest.questId));
      }
    } catch {
      // Ignore availability failures and fall back to whichever dialogue path still works.
    }

    setChampionName(resolvedChampionName);
    setPlayerEntityId(playerId);

    const graphTarget = getQuestGraphScene(
      entity.name,
      resolvedStoryFlags,
      activeQuests.map((quest) => quest.questId),
      completedQuestIds,
      availableQuests.map((quest) => quest.questId),
    );
    if (graphTarget && address && playerId) {
      const started = await runQuestGraphStart(graphTarget, playerId, address);
      if (started) return;
    }

    if (isScoutKaela(entity.name)) {
      setScript(buildScoutKaelaDialogueScript({
        alreadyBriefed: resolvedStoryFlags.includes(SCOUT_KAELA_BRIEFED_FLAG),
        canPersistProgress: Boolean(address && playerId),
      }));
      return;
    }

    setScript(buildNpcQuestDialogueScript({
      npc: entity,
      quests: availableQuests,
      activeQuests,
      championName: resolvedChampionName,
      championOrigin: resolvedChampionOrigin,
    }));
  });

  React.useEffect(() => {
    if (!open || !activeNode) return;
    const handler = (event: KeyboardEvent) => {
      if (isInteractiveTarget(event.target)) return;

      if (event.key === "Escape") {
        handleClose();
        return;
      }

      // Only handle dialogue-specific shortcuts on the dialogue tab
      if (activeTab !== "dialogue") return;

      if (
        /^[1-9]$/.test(event.key)
        && done
        && (
          (graphSession?.node.type === "choice" && graphSession.node.choices.length > 0)
          || (!!node?.choices?.length)
        )
      ) {
        const index = Number(event.key) - 1;
        const choice = graphSession?.node.type === "choice"
          ? graphSession.node.choices[index]
          : node?.choices?.[index];
        if (choice) {
          event.preventDefault();
          handleChoice(choice.id);
        }
        return;
      }

      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (
          (graphSession?.node.type === "choice" && graphSession.node.choices.length > 0)
          || (!!node?.choices?.length)
        ) {
          if (!done) skip();
          return;
        }
        handleAdvance();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeNode, done, graphSession, handleAdvance, handleChoice, handleClose, node, open, skip]);

  if (!open || !npc || !activeNode) return null;

  const activeSpeaker = graphNode
    ? graphNode.type === "end" ? "system" : graphNode.speaker
    : legacyNode?.speaker ?? "system";
  const speaker = speakerMeta(activeSpeaker, npc.name, championName);
  const isChampionSpeaking = activeSpeaker === "champion" || activeSpeaker === "player";
  const activeTitle = graphSession?.sceneTitle ?? legacyNode?.title;
  const activeChoices = graphNode?.type === "choice" ? graphNode.choices : legacyNode?.choices;
  const showAmbientPanel = !graphSession;
  const showGraphFreeformPanel = graphNode?.type === "freeform";

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center" style={{ pointerEvents: "none" }}>
      <div
        className="fixed inset-0"
        onClick={handleClose}
        style={{ background: "rgba(0,0,0,0.45)", pointerEvents: "auto" }}
      />

      {legacyNode?.portrait && <PortraitPanel portrait={legacyNode.portrait} />}

      <div
        className="relative border-2 shadow-2xl select-none"
        style={{
          background: BG,
          borderColor: isChampionSpeaking ? "#1a3a4a" : BORDER,
          fontFamily: "monospace",
          color: TEXT,
          width: "min(760px, 95vw)",
          marginBottom: 24,
          pointerEvents: "auto",
        }}
      >
        <div
          className="flex items-center gap-2 px-4 py-2 border-b"
          style={{ borderColor: BORDER, background: BG_DARK }}
        >
          <div
            className="flex items-center justify-center border-2 text-sm font-bold"
            style={{
              width: 28,
              height: 28,
              borderColor: speaker.color,
              color: speaker.color,
              background: isChampionSpeaking ? "#0a1a2a" : "#1a1520",
            }}
          >
            {speaker.icon}
          </div>
          <span className="text-[13px] font-bold" style={{ color: speaker.color }}>
            {speaker.name}
          </span>
          {isChampionSpeaking && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 border"
              style={{ borderColor: "#1a3a4a", color: CHAMPION_COLOR, background: "#0a1520" }}
            >
              YOUR CHAMPION
            </span>
          )}
          <button
            onClick={handleClose}
            className="ml-auto text-[11px] font-bold px-2 py-0.5 border hover:opacity-80"
            style={{ borderColor: BORDER, color: DIM, background: "transparent", cursor: "pointer" }}
          >
            ESC
          </button>
        </div>

        {/* Service tabs — only shown when NPC has multiple services */}
        {npc && <NpcServiceTabs entity={npc} activeTab={activeTab} onTabChange={setActiveTab} />}

        {/* Non-dialogue tabs */}
        {activeTab === "training" && npc?.teachesClass && (
          <NpcTrainingTab entity={npc} onClose={handleClose} />
        )}
        {activeTab === "professions" && npc?.teachesProfession && (
          <NpcProfessionTab entity={npc} onClose={handleClose} />
        )}
        {activeTab === "shop" && npc?.shopItems?.length && (
          <NpcShopTab entity={npc} zoneId={npc.zoneId ?? currentZoneId} />
        )}

        {/* Dialogue tab content (everything below is the existing dialogue UI) */}
        {activeTab === "dialogue" && activeTitle && (
          <div className="px-4 py-1.5 border-b flex items-center gap-2" style={{ borderColor: "#1a2035", background: "#0d1322" }}>
            <span className="text-[12px] font-bold" style={{ color: TEXT }}>
              {activeTitle}
            </span>
            {legacyNode?.badge && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5"
                style={{
                  color: legacyNode.badge.color,
                  background: "#0a0e18",
                  border: `1px solid ${BORDER}`,
                }}
              >
                {legacyNode.badge.label}
              </span>
            )}
          </div>
        )}

        {activeTab === "dialogue" && (<>
        <div className="px-4 py-4" style={{ minHeight: 112 }}>
          <p className="text-[12px] leading-[1.7]" style={{ color: isChampionSpeaking ? CHAMPION_COLOR : TEXT, whiteSpace: "pre-wrap" }}>
            {displayed}
            {!done && <span className="animate-pulse" style={{ color: speaker.color }}>|</span>}
          </p>
        </div>

        {!graphSession && (legacyNode?.objective || legacyNode?.rewards) && (
          <div className="px-4 pb-3 flex flex-col sm:flex-row gap-3">
            {legacyNode?.objective && (
              <div className="flex-1 border p-2" style={{ borderColor: "#1e2842", background: BG_DARK }}>
                <div className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: DIM }}>
                  Objective
                </div>
                <div className="text-[11px]" style={{ color: TEXT }}>
                  {legacyNode.objective.label}
                </div>
              </div>
            )}
            {legacyNode?.rewards && (
              <div className="flex-1 border p-2" style={{ borderColor: "#1e2842", background: BG_DARK }}>
                <div className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: DIM }}>
                  Rewards
                </div>
                <div className="text-[11px]" style={{ color: GOLD }}>
                  {legacyNode.rewards.copperLabel}
                </div>
                <div className="text-[11px]" style={{ color: "#5dadec" }}>
                  {legacyNode.rewards.xp} XP
                </div>
              </div>
            )}
          </div>
        )}

        {!graphSession && legacyNode?.progress && (
          <div className="px-4 pb-3">
            <div className="border p-2" style={{ borderColor: "#1e2842", background: BG_DARK }}>
              <div className="flex justify-between mb-1">
                <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: DIM }}>
                  Progress
                </span>
                <span className="text-[9px] font-bold" style={{ color: legacyNode.progress.complete ? ACCENT : WARN }}>
                  {legacyNode.progress.value}/{legacyNode.progress.max}
                </span>
              </div>
              <div className="h-[8px] border rounded-sm overflow-hidden" style={{ borderColor: BORDER, background: "#0a0e18" }}>
                <div
                  className="h-full rounded-sm transition-all"
                  style={{
                    width: `${legacyNode.progress.max > 0 ? Math.min(100, Math.round((legacyNode.progress.value / legacyNode.progress.max) * 100)) : 0}%`,
                    background: legacyNode.progress.complete ? ACCENT : WARN,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {showGraphFreeformPanel && graphNode?.type === "freeform" && (
          <div className="px-4 pb-3">
            <div className="border p-3" style={{ borderColor: "#1e2842", background: BG_DARK }}>
              <div className="text-[8px] font-bold uppercase tracking-wider" style={{ color: DIM }}>
                {graphNode.prompt}
              </div>
              <div className="mt-1 text-[10px]" style={{ color: DIM }}>
                Respond in your own words or tap a route below.
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <textarea
                  value={graphInputValue}
                  onChange={(event) => setGraphInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void advanceQuestGraph({ freeformInput: graphInputValue });
                    }
                  }}
                  placeholder={graphNode.placeholder ?? "Tell the NPC what you want."}
                  disabled={graphLoading}
                  rows={2}
                  className="flex-1 border px-3 py-2 text-[11px] resize-none outline-none disabled:opacity-50"
                  style={{
                    borderColor: BORDER,
                    background: "#0a0e18",
                    color: TEXT,
                  }}
                />
                <button
                  onClick={() => void advanceQuestGraph({ freeformInput: graphInputValue })}
                  disabled={!graphInputValue.trim() || graphLoading}
                  className="px-4 py-2 text-[11px] font-bold border-2 disabled:opacity-50"
                  style={{
                    borderColor: ACCENT,
                    color: "#0a0e18",
                    background: ACCENT,
                    minWidth: 120,
                    cursor: "pointer",
                  }}
                >
                  {graphLoading ? "THINKING" : "SEND"}
                </button>
              </div>
              {graphError && (
                <div className="mt-2 text-[10px]" style={{ color: WARN }}>
                  {graphError}
                </div>
              )}
              {graphNode.routes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {graphNode.routes.map((route: QuestGraphRenderableFreeformRoute) => (
                    <button
                      key={route.id}
                      onClick={() => {
                        setGraphInputValue(route.label);
                        void advanceQuestGraph({ freeformInput: route.label });
                      }}
                      className="text-[10px] font-bold px-2.5 py-1 border"
                      style={{
                        borderColor: "#1e2842",
                        color: ACCENT,
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      {route.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {showAmbientPanel && (
          <div className="px-4 pb-3">
          <div className="border p-3" style={{ borderColor: "#1e2842", background: BG_DARK }}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <div className="text-[8px] font-bold uppercase tracking-wider" style={{ color: DIM }}>
                  Ask {npc.name}
                </div>
                <div className="text-[10px]" style={{ color: DIM }}>
                  Freeform flavor chat stays guided by quest state and NPC persona.
                </div>
              </div>
              {ambientReply && (
                <div className="text-[8px] uppercase tracking-wider" style={{ color: ambientReply.provider === "llm" ? ACCENT : WARN }}>
                  {ambientReply.provider === "llm" ? "LLM Reply" : "Fallback Reply"}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <textarea
                value={askValue}
                onChange={(event) => setAskValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitAmbientPrompt(askValue);
                  }
                }}
                placeholder={
                  address && playerEntityId
                    ? `Ask ${npc.name} about the job, the area, or your next step...`
                    : "Connect wallet and deploy a champion to unlock NPC chat."
                }
                disabled={!address || !playerEntityId || ambientLoading}
                rows={2}
                className="flex-1 border px-3 py-2 text-[11px] resize-none outline-none disabled:opacity-50"
                style={{
                  borderColor: BORDER,
                  background: "#0a0e18",
                  color: TEXT,
                }}
              />
              <button
                onClick={() => void submitAmbientPrompt(askValue)}
                disabled={!askValue.trim() || !address || !playerEntityId || ambientLoading}
                className="px-4 py-2 text-[11px] font-bold border-2 disabled:opacity-50"
                style={{
                  borderColor: ACCENT,
                  color: "#0a0e18",
                  background: ACCENT,
                  minWidth: 120,
                  cursor: "pointer",
                }}
              >
                {ambientLoading ? "THINKING" : "ASK"}
              </button>
            </div>

            {ambientError && (
              <div className="mt-2 text-[10px]" style={{ color: DANGER }}>
                {ambientError}
              </div>
            )}

            {ambientReply && (
              <div className="mt-3 border px-3 py-2" style={{ borderColor: "#1e2842", background: "#0a0e18" }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: GOLD }}>
                    {npc.name}
                  </span>
                  <span className="text-[8px] uppercase tracking-wider" style={{ color: DIM }}>
                    {ambientReply.persona.role}
                  </span>
                  <span className="text-[8px] uppercase tracking-wider" style={{ color: DIM }}>
                    {ambientReply.intent.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-[1.6]" style={{ color: TEXT, whiteSpace: "pre-wrap" }}>
                  {ambientReply.reply}
                </p>
                {ambientReply.suggestedActions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {ambientReply.suggestedActions.map((action) => (
                      <button
                        key={`${action.label}:${action.prompt}`}
                        onClick={() => {
                          setAskValue(action.prompt);
                          void submitAmbientPrompt(action.prompt);
                        }}
                        className="text-[10px] font-bold px-2.5 py-1 border"
                        style={{
                          borderColor: "#1e2842",
                          color: ACCENT,
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
        )}

        <div
          className="flex items-center justify-between px-4 py-2 border-t"
          style={{ borderColor: BORDER, background: BG_DARK }}
        >
          <span className="text-[9px]" style={{ color: DIM }}>
            {!done
              ? "Click to finish the line"
              : activeChoices?.length
              ? "Press 1-9 or click a choice"
              : showGraphFreeformPanel
              ? "Use the prompt above"
              : "Space to continue"}
          </span>

          <div className="flex flex-wrap justify-end gap-2">
            {done && activeChoices?.map((choice, index) => {
              const colors = choiceColors(choice);
              return (
                <button
                  key={choice.id}
                  onClick={() => handleChoice(choice.id)}
                  className="text-[11px] font-bold px-3 py-1.5 border-2 hover:brightness-110"
                  disabled={"disabled" in choice ? choice.disabled : false}
                  style={{
                    borderColor: colors.border,
                    color: colors.text,
                    background: colors.background,
                    cursor: "disabled" in choice && choice.disabled ? "not-allowed" : "pointer",
                    opacity: "disabled" in choice && choice.disabled ? 0.5 : 1,
                  }}
                >
                  {activeChoices.length > 1 ? `${index + 1}. ` : ""}
                  {choice.label}
                </button>
              );
            })}

            {!activeChoices?.length && !showGraphFreeformPanel && (
              <button
                onClick={handleAdvance}
                className="text-[11px] font-bold px-4 py-1.5 border-2 hover:brightness-110"
                style={{
                  borderColor: isChampionSpeaking ? CHAMPION_COLOR : GOLD,
                  color: "#0a0e18",
                  background: isChampionSpeaking ? CHAMPION_COLOR : GOLD,
                  cursor: "pointer",
                }}
              >
                {!done ? "SKIP" : graphSession
                  ? graphSession.node.type === "end" ? "CLOSE" : "NEXT"
                  : node?.next ? "NEXT" : "CLOSE"}
              </button>
            )}
          </div>
        </div>
        </>)}
      </div>
    </div>
  );
}
