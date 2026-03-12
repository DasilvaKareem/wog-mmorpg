import { ASSET_BASE_URL } from "@/config";

export const TUTORIAL_MASTER_NAME = "Scout Kaela";
export const TUTORIAL_MASTER_ZONE_ID = "village-square";
export const TUTORIAL_MASTER_POSITION = { x: 110, y: 108 };
export const TUTORIAL_MASTER_ASSET_PATH = "assets/npcs/tutorial-master.png";
export const TUTORIAL_MASTER_R2_KEY = `/${TUTORIAL_MASTER_ASSET_PATH}`;

const PENDING_KEY = "wog:tutorial-master:pending";
const SEEN_KEY = "wog:tutorial-master:seen";
const PORTRAIT_CACHE = "wog-tutorial-master-v1";

export type TutorialSection = {
  title: string;
  lines: string[];
};

export const TUTORIAL_MASTER_INTRO =
  "I am Scout Kaela. I brief every new arrival on the controls, quests, agent deployment, rankings, and the systems that matter in Geneva.";

export const TUTORIAL_MASTER_HOTKEYS = [
  { key: "C", label: "Character console" },
  { key: "M", label: "World map" },
  { key: "Q", label: "Quest log" },
  { key: "I", label: "Inspect self" },
  { key: "L", label: "Chat panel" },
  { key: "R", label: "Ranks / leaderboard" },
  { key: "W", label: "Wallet + inventory" },
  { key: "O", label: "Settings" },
  { key: "Space", label: "Focus your character" },
  { key: "ESC / arrows", label: "Release camera lock" },
];

export const TUTORIAL_MASTER_SECTIONS: TutorialSection[] = [
  {
    title: "First Steps",
    lines: [
      "Talk to Guard Captain Marcus to start the newcomer quest chain.",
      "Press Q to track quests and see who to visit next.",
      "Press R any time to check rankings and see who is climbing.",
    ],
  },
  {
    title: "Deploy Your Agent",
    lines: [
      "Your first character tries to deploy automatically after minting.",
      "Later you can redeploy from the Character Console with C.",
      "Once deployed, your agent can fight, quest, trade, gather, and travel on its own.",
    ],
  },
  {
    title: "What You Can Do",
    lines: [
      "Fight mobs, level up, and push into harder zones.",
      "Mine ore, gather herbs, skin beasts, cook, brew, and craft gear.",
      "Trade in shops, use the auction house, join guilds, and enter ranked PvP.",
    ],
  },
];

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function isTutorialMaster(entityName: string | null | undefined): boolean {
  return entityName === TUTORIAL_MASTER_NAME;
}

export function getTutorialMasterPortraitUrl(): string {
  const base = ASSET_BASE_URL ? ASSET_BASE_URL.replace(/\/$/, "") : "";
  return base ? `${base}/${TUTORIAL_MASTER_ASSET_PATH}` : `/${TUTORIAL_MASTER_ASSET_PATH}`;
}

export function hasSeenTutorialMasterIntro(): boolean {
  if (!canUseStorage()) return false;
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function queueTutorialMasterIntro(): void {
  if (!canUseStorage() || hasSeenTutorialMasterIntro()) return;
  try {
    window.localStorage.setItem(PENDING_KEY, "1");
  } catch {
    // noop
  }
}

export function consumeTutorialMasterIntro(): boolean {
  if (!canUseStorage()) return false;
  try {
    const pending = window.localStorage.getItem(PENDING_KEY) === "1";
    if (pending) window.localStorage.removeItem(PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
}

export function markTutorialMasterIntroSeen(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // noop
  }
}

export async function warmTutorialMasterPortraitCache(): Promise<void> {
  if (typeof window === "undefined" || typeof caches === "undefined") return;

  try {
    const url = getTutorialMasterPortraitUrl();
    const cache = await caches.open(PORTRAIT_CACHE);
    const existing = await cache.match(url);
    if (existing) return;

    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return;
    await cache.put(url, response.clone());
  } catch {
    // Asset is optional until the portrait file is added locally / uploaded to R2.
  }
}
