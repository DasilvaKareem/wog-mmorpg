// Global error display so we can see what breaks on prod
window.onerror = (msg, src, line, col, err) => {
  const el = document.createElement("pre");
  el.dataset.debugOverlay = "true";
  el.style.cssText = "position:fixed;top:0;left:0;right:0;background:#200;color:#f88;padding:12px;font:12px monospace;z-index:9999;white-space:pre-wrap";
  el.textContent = `${msg}\n${src}:${line}:${col}\n${err?.stack ?? ""}`;
  document.body.appendChild(el);
};

import * as THREE from "three";
import { WorldManager } from "./scene/WorldManager.js";
import { EntityManager, type QuestIndicatorState } from "./scene/EntityManager.js";
import { EffectsManager } from "./scene/EffectsManager.js";
import { IntentLinesManager } from "./scene/IntentLinesManager.js";
import { SkyRenderer } from "./scene/SkyRenderer.js";
import { ToonPipeline, NO_OUTLINE_LAYER } from "./scene/ToonPipeline.js";
import { DesktopControls } from "./input/DesktopControls.js";
import { XRSessionManager } from "./xr/XRSessionManager.js";
// XRControllers imported dynamically to avoid crashing non-XR browsers
type XRControllersType = import("./xr/XRControllers.js").XRControllers;
import { EntityInspector } from "./hud/EntityInspector.js";
import { initProfessionCatalogs, setPlayerProfessionLevels } from "./data/professionCatalogs.js";
import { ZoneNameBadge } from "./hud/IntentModeBadge.js";
import { ZoneBanner } from "./hud/ZoneBanner.js";
import { EventBanner } from "./hud/EventBanner.js";
import { IntentTooltip } from "./hud/IntentTooltip.js";
import { Minimap } from "./hud/Minimap.js";
import { WorldMap } from "./hud/WorldMap.js";
import { AgentChat } from "./hud/AgentChat.js";
import { LandingPage } from "./hud/LandingPage.js";
import { CharacterSelect } from "./hud/CharacterSelect.js";
import type { CharacterReadyDetail } from "./hud/CharacterSelect.js";
import { PlayerPanel } from "./hud/PlayerPanel.js";
import { QuestPanel } from "./hud/QuestPanel.js";
import { NpcDialog } from "./hud/NpcDialog.js";
import { BagPanel } from "./hud/BagPanel.js";
import { SettingsPanel } from "./hud/SettingsPanel.js";
import { SkillsPanel } from "./hud/SkillsPanel.js";
import { RecipesPanel } from "./hud/RecipesPanel.js";
import type { LearnedTechnique } from "./hud/LearnedTechniquesList.js";
import type { Edict } from "./hud/EdictEditor.js";
import { InboxPanel } from "./hud/InboxPanel.js";
import { TradeOfferDialog } from "./hud/TradeOfferDialog.js";
import { OutgoingTradesPanel } from "./hud/OutgoingTradesPanel.js";
import { BetsPanel } from "./hud/BetsPanel.js";
import { TutorialOverlay } from "./hud/TutorialOverlay.js";
import { NotificationsPanel } from "./hud/NotificationsPanel.js";
import { installMobileResponsiveStyles } from "./hud/MobileResponsive.js";
import { ActionBar } from "./hud/ActionBar.js";
import { VitalsPanel } from "./hud/VitalsPanel.js";
import { BuffBar } from "./hud/BuffBar.js";
import { ArenaHud } from "./hud/ArenaHud.js";
import { getEquipmentTuner } from "./hud/EquipmentTuner.js";
import { AnimationLabPanel } from "./hud/AnimationLabPanel.js";
import { CANDIDATE_BASES, fetchActivePlayers, fetchZonesBatch, fetchZoneList, fetchWorldLayout, postCommand, fetchQuestLog, fetchZoneQuests, acceptQuest, talkToNpc, completeQuest, abandonQuest, fetchInventory, fetchProfessionStatus, sendFriendRequest, inviteToParty, acceptPartyInvite, declinePartyInvite, sendInboxMessage, logoutCharacter, fetchCharacters, equipItem, unequipItem, sendAgentChat, fetchWalletBalance, toUrl, listTrade, acceptTradeOffer, rejectTradeOffer, fetchIncomingTrades, fetchTradeStatus, fetchOutgoingTrades, cancelTrade, challengeDuel, acceptDuel, declineDuel, fetchActivePools, placeBet, claimWinnings, fetchBettingHistory, fetchCurrentBattle, fetchBattleDetails, cancelPvpBattle, focusAgentQuest, recycleItem, craftAtStation } from "./api.js";
import type { InventoryItem } from "./types.js";
import { getAuthToken, getCachedToken, getSavedWalletAddress } from "./auth.js";
import { ClickMarker } from "./scene/ClickMarker.js";
import { AnimationLab } from "./scene/AnimationLab.js";
import { GauntletCursor } from "./hud/GauntletCursor.js";
import type { ActivePlayer, Entity, FriendInfo, QuestLogResponse, VisibleIntent, ZoneResponse } from "./types.js";
import { createSfxManager, playSoundEffect } from "./sfx.js";
import { QualityManager } from "./quality/QualityManager.js";
import {
  trackXRGameEntered,
  trackXRPanelOpened,
  trackXRVRSessionStarted,
  trackXRVRSessionEnded,
  trackXRNpcDialogOpened,
  trackXRQuestAccepted,
  trackXRQuestCompleted,
  trackXRQuestAbandoned,
  trackXRSessionDuration,
} from "./analytics.js";

let gauntletCursor: GauntletCursor | null = null;
const urlParams = new URLSearchParams(window.location.search);
const isAnimationLab = urlParams.get("animlab") === "1";
const pageMode = document.body.dataset.appMode;
const isDisplayMode = pageMode === "display" || /\/display\.html$/i.test(window.location.pathname) || urlParams.get("mode") === "display";
const queryWallet = urlParams.get("wallet")?.trim().toLowerCase() || urlParams.get("followWallet")?.trim().toLowerCase() || "";
const followEntityId = urlParams.get("entityId")?.trim() || urlParams.get("followEntityId")?.trim() || "";
let followWalletAddress = queryWallet
  || (isDisplayMode && !followEntityId ? (getSavedWalletAddress()?.trim().toLowerCase() ?? "") : "");
const displayFollowTarget = followWalletAddress || followEntityId;

// In display mode with no URL-provided target, keep watching localStorage in
// case the user logs in on another tab after display.html was opened.
if (isDisplayMode && !queryWallet && !followEntityId) {
  const dumpWogKeys = () => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("wog")) keys.push(k);
    }
    return keys;
  };
  console.log("[display] Initial localStorage wog-keys:", dumpWogKeys());
  let pollCount = 0;
  const resolveWallet = (): boolean => {
    const next = getSavedWalletAddress()?.trim().toLowerCase() ?? "";
    if (next && next !== followWalletAddress) {
      followWalletAddress = next;
      console.log("[display] Follow wallet resolved:", next);
      return true;
    }
    return false;
  };
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key.startsWith("wog:")) resolveWallet();
  });
  if (!followWalletAddress) {
    const timer = window.setInterval(() => {
      pollCount++;
      if (resolveWallet()) {
        window.clearInterval(timer);
      } else if (pollCount % 5 === 0) {
        console.log(`[display] Still waiting for wallet (poll #${pollCount}). wog-keys:`, dumpWogKeys());
      }
    }, 2000);
  }
}
document.body.dataset.appMode = isDisplayMode ? "display" : "controller";
const API_BASE = import.meta.env.VITE_API_URL || "";
void initProfessionCatalogs(API_BASE);
// Resolve audio URLs against the Vite base (prod serves under /xr/, dev at /).
// Hardcoded "/audio/..." would 404 on prod because the bucket path is /xr/audio.
const AUDIO_BASE = new URL("audio/", new URL(import.meta.env.BASE_URL, window.location.href)).href;
function audioUrl(file: string): string {
  return AUDIO_BASE + encodeURIComponent(file);
}
const ZONE_BGM_URLS: Record<string, string> = {
  "emerald-woods":    audioUrl("emerald-woods.mp3"),
  "moondancer-glade": audioUrl("moondancer-glade.mp3"),
  "felsrock-citadel": audioUrl("felsrock-citadel.mp3"),
  "lake-lumina":      audioUrl("lake-lumina.mp3"),
  "wild-meadow":      audioUrl("wild-meadow.mp3"),
  "village-square":   audioUrl("chronicles-of-the-verdant-valley.mp3"),
};
const BGM_DEFAULT_URL = audioUrl("secrets-of-the-library.mp3");

const BGM_VOLUME_KEY = "wog-music-volume";
const BGM_DEFAULT_VOLUME = 0.35;

function readBgmVolume(): number {
  if (typeof window === "undefined") return BGM_DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(BGM_VOLUME_KEY);
    if (raw === null) return BGM_DEFAULT_VOLUME;
    const n = Number(raw);
    if (!Number.isFinite(n)) return BGM_DEFAULT_VOLUME;
    return Math.min(1, Math.max(0, n));
  } catch {
    return BGM_DEFAULT_VOLUME;
  }
}

class BgmManager {
  private audio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private pendingUrl: string | null = null;
  private pendingTimer: number | null = null;
  private silenceTimer: number | null = null;
  private volume = readBgmVolume();
  private readonly swapDelayMs = 500;
  // Minecraft-style ambient silence between tracks: track plays once, then
  // a randomized quiet gap, then the zone's track plays again.
  private readonly silenceMinMs = 60_000;   // 1 min
  private readonly silenceMaxMs = 180_000;  // 3 min

  constructor() {
    if (typeof window === "undefined") return;
    this.audio = new Audio();
    this.audio.loop = false;
    this.audio.preload = "auto";
    this.audio.volume = this.volume;
    this.audio.addEventListener("error", () => {
      console.warn("[bgm] audio error for", this.currentUrl, this.audio?.error?.code, this.audio?.error?.message);
    });
    this.audio.addEventListener("playing", () => {
      console.log("[bgm] playing", this.currentUrl);
    });
    this.audio.addEventListener("ended", () => {
      this.scheduleReplay();
    });
    this.syncMutedFromStorage();
    window.addEventListener("wog:music-toggle", this.syncMutedFromStorage);
    window.addEventListener("wog:music-volume", this.syncVolumeFromStorage);
    for (const evt of ["click", "touchstart", "keydown"] as const) {
      document.addEventListener(evt, this.resumeOnInteraction, { passive: true });
    }
  }

  dispose() {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
      this.pendingUrl = null;
    }
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("wog:music-toggle", this.syncMutedFromStorage);
      window.removeEventListener("wog:music-volume", this.syncVolumeFromStorage);
    }
    for (const evt of ["click", "touchstart", "keydown"] as const) {
      document.removeEventListener(evt, this.resumeOnInteraction);
    }
    if (!this.audio) return;
    this.audio.pause();
    this.audio.src = "";
    this.audio = null;
  }

  setZone(zoneId: string | null) {
    const nextUrl = (zoneId && ZONE_BGM_URLS[zoneId]) || BGM_DEFAULT_URL;
    if (this.currentUrl === nextUrl) {
      if (this.pendingTimer !== null) {
        clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
        this.pendingUrl = null;
      }
      return;
    }
    if (this.pendingUrl === nextUrl) return;
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingUrl = nextUrl;
    console.log("[bgm] setZone pending", zoneId, "→", nextUrl);
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = null;
      this.pendingUrl = null;
      if (!this.audio || this.currentUrl === nextUrl) return;
      console.log("[bgm] setZone swap →", nextUrl);
      this.currentUrl = nextUrl;
      this.swapTrack(nextUrl);
      playSoundEffect("move_zone_transition");
    }, this.swapDelayMs);
  }

  private syncMutedFromStorage = () => {
    if (!this.audio || typeof window === "undefined") return;
    try {
      this.audio.muted = window.localStorage.getItem("wog-music-muted") === "1";
    } catch {
      this.audio.muted = false;
    }
    // Don't force-play if we're intentionally in a silence gap.
    if (!this.audio.muted && this.audio.paused && this.currentUrl && this.silenceTimer === null) {
      this.audio.play().catch(() => {});
    }
  };

  private syncVolumeFromStorage = () => {
    if (!this.audio) return;
    this.volume = readBgmVolume();
    this.audio.volume = this.volume;
  };

  private resumeOnInteraction = () => {
    if (!this.audio || !this.currentUrl || this.audio.muted) return;
    if (!this.audio.paused) return;
    // Respect active silence gap — don't break the quiet stretch.
    if (this.silenceTimer !== null) return;
    this.audio.play().catch(() => {});
  };

  private scheduleReplay() {
    if (this.silenceTimer !== null) clearTimeout(this.silenceTimer);
    const delay = this.silenceMinMs + Math.random() * (this.silenceMaxMs - this.silenceMinMs);
    console.log("[bgm] silence gap", Math.round(delay / 1000) + "s →", this.currentUrl);
    this.silenceTimer = window.setTimeout(() => {
      this.silenceTimer = null;
      if (!this.audio || !this.currentUrl) return;
      if (this.audio.muted) return;
      try { this.audio.currentTime = 0; } catch {}
      console.log("[bgm] replay after silence →", this.currentUrl);
      this.audio.play().catch(() => {});
    }, delay);
  }

  private swapTrack(url: string) {
    if (!this.audio) return;
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.syncMutedFromStorage();
    this.audio.pause();
    try { this.audio.currentTime = 0; } catch {}
    this.audio.src = url;
    this.audio.load();
    if (this.audio.muted) return;
    this.audio.play().catch(() => {});
  }
}

// Equipment tuner — hidden by default, press P to toggle
const equipTuner = getEquipmentTuner();
(window as any).__equipTuner = equipTuner;

// Live-update weapon meshes from tuner every frame — only when panel is open
function syncWeaponsToTuner() {
  if (!equipTuner.isVisible()) return;
  const slot = equipTuner.getSlot("sword");
  if (!slot) return;
  for (const weapon of EntityManager.weaponInstances) {
    weapon.position.set(slot.pos.x, slot.pos.y, slot.pos.z);
    weapon.rotation.set(slot.rot.x, slot.rot.y, slot.rot.z);
  }
}

// ── Config ──────────────────────────────────────────────────────────

// Resolve quality tier before the renderer is constructed — antialias is
// a context-creation flag and can't be changed without a reload.
const qualityBoot = QualityManager.init();
const qualityCfg = qualityBoot.config;
console.log(
  `[quality] tier=${qualityBoot.tier} source=${qualityBoot.source} detected=${qualityBoot.detected}`,
);
// Expose for devtools verification: window.__quality.current() / .config()
(window as unknown as { __quality: typeof QualityManager }).__quality = QualityManager;

let ZONE_POLL_INTERVAL = qualityCfg.pollNearbyMs;
let ACTIVE_PLAYERS_POLL_INTERVAL = qualityCfg.pollPlayersMs;
const COORD_SCALE = 1 / 10; // server coords → 3D units
/** Poll zones whose center is within this distance (3D units) of the camera */
const POLL_RADIUS = 90;
const EVENT_DEDUPE_RETENTION_MS = 10_000;
const GATHER_NODE_TYPES = new Set(["ore-node", "flower-node", "nectar-node", "crop-node"]);

// ── Renderer ────────────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({
  antialias: qualityCfg.antialias,
  powerPreference: "high-performance",
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityCfg.dprCap));
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x88aacc, 0.018);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.5,
  200
);

// ── Toon post-processing ─────────────────────────────────────────────

camera.layers.enable(NO_OUTLINE_LAYER); // render text/sprites/UI but exclude from outlines

const toonPipeline = new ToonPipeline({
  renderer, scene, camera,
  outlineThickness: qualityCfg.outlineThickness,
  outlineColor: 0x000000,
  renderScale: qualityCfg.renderScale,
  normalScale: qualityCfg.normalScale,
});

// ── Subsystems ──────────────────────────────────────────────────────

const world = new WorldManager();
scene.add(world.group);

const entities = new EntityManager();
entities.setElevationProvider(world);
entities.setEnvironmentAssets(world.getEnvironmentAssets());
entities.setCharacterAssets(world.getCharacterAssets());
entities.setArmorSystem(world.getArmorSystem());
scene.add(entities.group);

const effects = new EffectsManager(entities);
effects.setElevationProvider(world);
effects.setCamera(camera);
scene.add(effects.group);

const intentLines = new IntentLinesManager(entities);
scene.add(intentLines.group);

const sky = new SkyRenderer(scene);
const clickMarker = new ClickMarker();
clickMarker.setElevationProvider(world);
scene.add(clickMarker.mesh);
const bgm = new BgmManager();
createSfxManager();

// Settings UI: #settings-toggle gear → SettingsPanel with an Audio tab
// (music + SFX mute + volume). Persists to localStorage and dispatches
// "wog:music-toggle" / "wog:music-volume" so BgmManager syncs.
const settingsPanel = new SettingsPanel();

const controls = new DesktopControls(camera, renderer.domElement);
controls.setInputEnabled(!isDisplayMode);
controls.collisionCheck = (x, z) => world.isWalkable(x, z);
controls.setTerrainGroup(world.group);
const inspector = new EntityInspector({
  canActOnPlayer: (entity) => {
    return entity.type === "player"
      && !!entity.walletAddress
      && !!ownWalletAddress
      && entity.walletAddress.toLowerCase() !== ownWalletAddress;
  },
  onAddFriend: async (entity) => {
    if (!ownWalletAddress || !entity.walletAddress) throw new Error("Friend request unavailable");
    const token = await getAuthToken(ownWalletAddress);
    if (!token) throw new Error("You need to sign in first");
    const fromWallet = ownCustodialWallet ?? ownWalletAddress;
    const result = await sendFriendRequest(token, fromWallet, entity.walletAddress);
    if (!result.ok) throw new Error(result.error ?? "Failed to send friend request");
    return `Friend request sent to ${entity.name}`;
  },
  onParty: async (entity) => {
    if (!ownWalletAddress || !entity.walletAddress) throw new Error("Party invite unavailable");
    if (!ownEntityId) throw new Error("Deploy your agent first");
    const token = await getAuthToken(ownWalletAddress);
    if (!token) throw new Error("You need to sign in first");
    const fromZoneId = entities.getEntity(ownEntityId)?.zoneId;
    if (!fromZoneId) throw new Error("Your champion is not in a zone");
    const result = await inviteToParty(token, ownEntityId, fromZoneId, entity.walletAddress);
    if (!result.ok) throw new Error(result.error ?? "Failed to send party invite");
    return `Party invite sent to ${entity.name}`;
  },
  onTrade: async (entity) => {
    if (!ownWalletAddress || !entity.walletAddress) throw new Error("Trade unavailable for that player");
    if (!ownEntityId) throw new Error("Deploy your agent first");
    if (entity.walletAddress.toLowerCase() === ownWalletAddress.toLowerCase()) {
      throw new Error("You can't trade with yourself");
    }
    // Pull a fresh inventory snapshot before opening so the picker isn't stale.
    lastInventoryPollTime = 0;
    await pollInventory();
    if (currentInventoryItems.length === 0) {
      throw new Error("Your bag is empty — nothing to trade");
    }
    pendingTradeTarget = { wallet: entity.walletAddress, name: entity.name };
    tradeOfferDialog.open(entity.name, currentInventoryItems);
    return `Trade dialog opened for ${entity.name}`;
  },
  onDuel: async (entity) => {
    if (!ownWalletAddress || !entity.walletAddress) throw new Error("Duel unavailable for that player");
    if (!ownEntityId) throw new Error("Deploy your agent first");
    if (entity.walletAddress.toLowerCase() === ownWalletAddress.toLowerCase()) {
      throw new Error("You can't duel yourself");
    }
    const token = await getAuthToken(ownWalletAddress);
    if (!token) throw new Error("You need to sign in first");
    agentChat.addSystemMessage(`Issuing duel challenge to ${entity.name}...`, "progress");
    const result = await challengeDuel(token, { targetWallet: entity.walletAddress, format: "1v1" });
    if (!result.ok) {
      agentChat.addSystemMessage(`Duel failed: ${result.error ?? "unknown error"}`, "error");
      throw new Error(result.error ?? "Failed to issue duel");
    }
    agentChat.addSystemMessage(
      `Duel challenge sent. Reserved 1v1 slot — waiting for ${entity.name} to accept.`,
      "success",
    );
    return `Duel challenge sent to ${entity.name}`;
  },
  canCommandAgent: () => !!ownWalletAddress && !!ownEntityId,
  onAgentGather: async (entity) => {
    if (!ownWalletAddress || !ownEntityId) throw new Error("Deploy your agent first");
    const token = await getAuthToken(ownWalletAddress);
    if (!token) throw new Error("You need to sign in first");
    // Use deterministic slash commands — bypass the LLM entirely so the agent
    // immediately switches focus without waiting for an AI round-trip.
    const cmd = entity.type === "ore-node" ? "/focus mine"
      : entity.type === "flower-node" || entity.type === "nectar-node" ? "/focus herb"
      : "/focus gather";
    const verb = entity.type === "ore-node" ? "Mine"
      : entity.type === "crop-node" ? "Harvest"
      : "Gather";
    const result = await sendAgentChat(token, cmd);
    if (!result.ok) throw new Error(result.error ?? "Failed to message agent");
    return `${verb}ing ${entity.name} — agent focus updated`;
  },
});
const zoneNameBadge = new ZoneNameBadge();
const zoneBanner = new ZoneBanner();
const eventBanner = new EventBanner();
const intentTooltip = new IntentTooltip();
const minimap = new Minimap();
const worldMap = new WorldMap();
const agentChat = new AgentChat();
agentChat.setOnAgentReply((entityId, text) => {
  entities.showLocalSpeechBubble(entityId, text);
});
const charSelect = !isAnimationLab
  && !isDisplayMode
  ? new CharacterSelect({
    charAssets: world.getCharacterAssets(),
    onCharacterReady: (detail: CharacterReadyDetail) => {
      charSelect!.hide();
      ownWalletAddress = detail.walletAddress.toLowerCase();
      ownCustodialWallet = detail.custodialWallet?.toLowerCase() ?? null;
      ownEntityId = detail.entityId || null;
      void import("./scene/AnimationResolver.js").then(m => m.setAnimDebugSelfName(detail.characterName));
      inboxPanel.setCustodialWallet(ownCustodialWallet);
      inboxPanel.setCharacterName(detail.characterName);
      playerPanel.setFriendIdentity(ownWalletAddress, ownCustodialWallet ?? ownWalletAddress);
      lastInboxPollTime = 0;
      lastFriendsPollTime = 0;
      void pollInbox();
      void pollFriends();
      agentChat.setWallet(ownWalletAddress);
      agentChat.setEntityId(detail.entityId || null);
      questPanel.setPlayer(ownWalletAddress, true);
      controls.setLandingMode(false);
      setGameplayHudVisible(true);
      gameSessionStartMs = Date.now();
      trackXRGameEntered({ walletAddress: detail.walletAddress, entityId: detail.entityId, zoneId: detail.zoneId, characterName: detail.characterName });
      if (detail.zoneId === "village-square" && !localStorage.getItem("wog:tutorial-v1")) {
        const tut = new TutorialOverlay((id) => togglePanel(id as ManagedPanelId));
        tut.start();
      }
      console.log("[enter] Character ready:", detail.characterName, "zone:", detail.zoneId);

      // Move camera to their zone and find the entity
      const zoneCenter = world.getZoneCenter(detail.zoneId);
      if (zoneCenter) {
        controls.setTarget(zoneCenter.x, 0, zoneCenter.z);
        world.updateLoading(zoneCenter.x, zoneCenter.z);
      }
      void findOwnCharacter();
    },
    onBack: () => {
      charSelect!.hide();
      landing!.show();
    },
  })
  : null;

const landing = !isAnimationLab
  && !isDisplayMode
  ? new LandingPage({
    onEnterWorld: ({ walletAddress }) => {
      if (walletAddress) {
        ownWalletAddress = walletAddress.toLowerCase();
        void charSelect!.show(ownWalletAddress);
      } else {
        // Guest mode — skip character select, enter as spectator
        controls.setLandingMode(false);
        setGameplayHudVisible(true);
        console.log("[enter] Guest spectator mode");
      }
    },
  })
  : null;
const animationLab = isAnimationLab ? new AnimationLab(scene, camera, renderer.domElement) : null;
const animationLabPanel = isAnimationLab && animationLab
  ? new AnimationLabPanel(animationLab, {
    applyPreset: (preset) => animationLab.applyCameraPreset(preset, camera),
  })
  : null;
void animationLabPanel;

if (isAnimationLab) {
  const equipTunerEl = document.getElementById("equip-tuner");
  if (equipTunerEl) {
    equipTunerEl.style.left = "12px";
    equipTunerEl.style.right = "auto";
    equipTunerEl.style.top = "12px";
  }
}

equipTuner.setOnChange((slot, pos, rot) => {
  if (animationLab) {
    animationLab.applyEquipmentTuning(slot, pos, rot);
    return;
  }
  entities.applyEquipmentTuning(slot, pos, rot);
});

// XR — camera must be child of cameraRig for VR locomotion
const xrSession = new XRSessionManager(renderer, scene, camera);
xrSession.cameraRig.add(camera);
let xrControllers: XRControllersType | null = null;

// ── HUD elements ────────────────────────────────────────────────────

const hudEntities = document.getElementById("hud-entities")!;
const hudFps = document.getElementById("hud-fps")!;
const hudLock = document.getElementById("lock-indicator")!;

function setGameplayHudVisible(visible: boolean) {
  if (isDisplayMode) visible = false;
  gauntletCursor?.setEnabled(visible);
  const ids = [
    "hud",
    "lock-indicator",
    "controls-help",
    "vr-button",
    "player-panel",
    "panel-toggle",
    "agent-chat",
    "minimap",
    "world-map",
    "intent-tooltip",
    "intent-mode-badge",
    "quest-panel",
    "vitals-panel",
  ];

  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.visibility = visible ? "visible" : "hidden";
    el.style.opacity = visible ? "1" : "0";
    el.style.pointerEvents = visible ? "" : "none";
  }
}

// ── State ───────────────────────────────────────────────────────────

let lockedEntityId: string | null = null;
let ownWalletAddress: string | null = null;
let ownCustodialWallet: string | null = null;
let ownEntityId: string | null = null;
let ownCharacterInfo: { level: number; characterTokenId: string | null; agentId: string | null } | null = null;
let latestActivePlayers: ActivePlayer[] = [];
let autoLockEnabled = isDisplayMode;
let manualUnlockUntilMs = 0;
let isPollingNearbyZones = false;
let isPollingActivePlayers = false;
let lastQuestPollTime = 0;
let questLogData: QuestLogResponse | null = null;
let logoutInFlight = false;
const QUEST_POLL_INTERVAL = 5_000;
const processedRecentEventIds = new Map<string, number>();

async function logoutOwnCharacter(reason: string) {
  if (logoutInFlight || !ownWalletAddress || !ownEntityId) return;

  const ownEntity = entities.getEntity(ownEntityId);
  const zoneId = ownEntity?.zoneId;
  if (!zoneId) return;

  logoutInFlight = true;
  try {
    const token = getCachedToken(ownWalletAddress) ?? await getAuthToken(ownWalletAddress);
    if (!token) return;
    const result = await logoutCharacter(token, { zoneId, entityId: ownEntityId });
    if (!result.ok) {
      console.warn(`[logout] Failed during ${reason}: ${result.error ?? "unknown error"}`);
    }
  } catch (error) {
    console.warn(`[logout] Failed during ${reason}:`, error);
  } finally {
    logoutInFlight = false;
  }
}

function queueLogoutOnExit(reason: string) {
  if (logoutInFlight || !ownWalletAddress || !ownEntityId) return;

  const ownEntity = entities.getEntity(ownEntityId);
  const zoneId = ownEntity?.zoneId;
  const token = ownWalletAddress ? getCachedToken(ownWalletAddress) : null;
  if (!zoneId || !token) return;

  logoutInFlight = true;
  void fetch(`${API_BASE}/logout`, {
    method: "POST",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ zoneId, entityId: ownEntityId }),
  }).catch((error) => {
    console.warn(`[logout] keepalive failed during ${reason}:`, error);
    logoutInFlight = false;
  });
}

function filterNewZoneEvents(events: NonNullable<ZoneResponse["recentEvents"]>) {
  const now = Date.now();
  for (const [eventId, seenAt] of processedRecentEventIds) {
    if (now - seenAt > EVENT_DEDUPE_RETENTION_MS) {
      processedRecentEventIds.delete(eventId);
    }
  }

  const freshEvents: NonNullable<ZoneResponse["recentEvents"]> = [];
  for (const event of events) {
    if (processedRecentEventIds.has(event.id)) continue;
    processedRecentEventIds.set(event.id, now);
    freshEvents.push(event);
  }
  return freshEvents;
}

// ── Lock-on mode ────────────────────────────────────────────────────

/** Lock camera to a character entity */
function lockOn(entityId: string) {
  const ent = entities.getEntity(entityId);
  if (!ent) return;
  lockedEntityId = entityId;
  controls.locked = true;
  intentLines.setFocusEntity(entityId);
  hudLock.textContent = ent.name;
  hudLock.style.display = "block";
  console.log("[lock] Locked to:", ent.name, entityId);
}

function unlockCamera() {
  lockedEntityId = null;
  controls.locked = false;
  intentLines.setFocusEntity(null);
  hudLock.style.display = "none";
}

/** Try to find and lock onto the player's own character by wallet address */
function tryLockOwnCharacter(activePlayers: ActivePlayer[]) {
  if (!ownWalletAddress) return;
  if (lockedEntityId && entities.getEntity(lockedEntityId)) return;

  const me = activePlayers.find(
    (p) => p.walletAddress?.toLowerCase() === ownWalletAddress
  );
  if (!me) return;

  ownEntityId = me.id;

  // Move camera to the player's zone so zone polling picks it up
  const zoneCenter = world.getZoneCenter(me.zoneId);
  if (zoneCenter) {
    controls.setTarget(zoneCenter.x, 0, zoneCenter.z);
  }

  // If entity is already loaded in scene, lock on immediately
  const pos = entities.getEntityPosition(me.id);
  if (pos && autoLockEnabled && Date.now() >= manualUnlockUntilMs) {
    lockOn(me.id);
    controls.setTarget(pos.x, pos.y, pos.z);
  }
}

function tryFollowDisplayTarget(activePlayers: ActivePlayer[]) {
  if (!isDisplayMode) return;
  let target: ActivePlayer | undefined;
  if (followEntityId) {
    target = activePlayers.find((player) => player.id === followEntityId);
  } else if (followWalletAddress) {
    target = activePlayers.find((player) => player.walletAddress?.toLowerCase() === followWalletAddress);
  }
  if (!target) return;

  ownEntityId = target.id;

  const zoneCenter = world.getZoneCenter(target.zoneId);
  if (zoneCenter) {
    controls.setTarget(zoneCenter.x, 0, zoneCenter.z);
  }

  const pos = entities.getEntityPosition(target.id);
  if (pos) {
    controls.setTarget(pos.x, pos.y, pos.z);
  }

  if (Date.now() >= manualUnlockUntilMs && lockedEntityId !== target.id) {
    lockOn(target.id);
  }
}

/**
 * Full sequence: call /agent/status to get entityId + zoneId,
 * move camera to their zone, poll that zone, then lock on.
 */
async function findOwnCharacter() {
  if (!ownWalletAddress) return;

  // Display mode is watch-only — /character/:wallet has no auth, skip signing.
  const token = isDisplayMode ? null : await getAuthToken(ownWalletAddress);
  if (!isDisplayMode && !token) {
    console.log("[autolock] No auth token");
    return;
  }

  try {
    const data = await fetchCharacters(ownWalletAddress, token);
    const liveEntity = data?.liveEntity;
    if (!liveEntity?.id || !liveEntity.zoneId) {
      console.log("[autolock] No live entity for wallet", ownWalletAddress);
      return;
    }

    console.log("[autolock] Found entity:", liveEntity.id, "zone:", liveEntity.zoneId, "name:", liveEntity.name);
    ownEntityId = liveEntity.id;
    ownCharacterInfo = {
      level: liveEntity.level ?? 1,
      characterTokenId: liveEntity.characterTokenId ?? null,
      agentId: liveEntity.agentId ?? null,
    };
    agentChat.setEntityId(liveEntity.id);
    hudLock.textContent = `FINDING: ${liveEntity.name ?? "character"}`;
    hudLock.style.display = "block";

    const zoneCenter = world.getZoneCenter(liveEntity.zoneId);
    if (zoneCenter) {
      controls.setTarget(zoneCenter.x, 0, zoneCenter.z);
      world.updateLoading(zoneCenter.x, zoneCenter.z);
    }

    await pollNearbyZones();

    const pos = entities.getEntityPosition(liveEntity.id);
    if (pos) {
      controls.setTarget(pos.x, pos.y, pos.z);
      if (autoLockEnabled) {
        lockOn(liveEntity.id);
        console.log("[autolock] Locked to", liveEntity.name);
      } else {
        console.log("[autolock] Found character, camera moved (spacebar to lock)");
      }
    } else {
      console.log("[autolock] Entity not in scene yet, poll loop will retry");
    }
  } catch (err) {
    console.log("[autolock] Error:", err);
  }
}

// ── Player panel (leaderboard + zone lobby) ─────────────────────────

const playerPanel = new PlayerPanel({
  onPlayerClick: (player) => {
    if (player.id) {
      const pos = entities.getEntityPosition(player.id);
      if (pos) {
        lockOn(player.id);
        controls.setTarget(pos.x, pos.y, pos.z);
      }
    }
  },
  onZoneClick: (zoneId) => {
    const center = world.getZoneCenter(zoneId);
    if (center) {
      unlockCamera();
      controls.setTarget(center.x, 0, center.z);
    }
  },
  getAuthToken: async () => ownWalletAddress ? getAuthToken(ownWalletAddress) : null,
  onFriendRequestCountChange: (count: number) => {
    actionBar.setBadge("players", count);
  },
  onFriendLocate: (friend: FriendInfo) => {
    locateFriend(friend);
  },
  onAddFriend: async (player) => {
    if (!ownWalletAddress || !player.walletAddress) throw new Error("Friend request unavailable");
    const token = await getAuthToken(ownWalletAddress);
    if (!token) throw new Error("You need to sign in first");
    const fromWallet = ownCustodialWallet ?? ownWalletAddress;
    const result = await sendFriendRequest(token, fromWallet, player.walletAddress);
    if (!result.ok) throw new Error(result.error ?? "Failed to send friend request");
    lastFriendsPollTime = 0;
    return `Friend request sent to ${player.name}`;
  },
  onPartyInviteFriend: async (friend) => {
    if (!ownWalletAddress) throw new Error("Party invite unavailable");
    if (!ownEntityId) throw new Error("Deploy your agent first");
    const token = await getAuthToken(ownWalletAddress);
    if (!token) throw new Error("You need to sign in first");
    const fromZoneId = entities.getEntity(ownEntityId)?.zoneId;
    if (!fromZoneId) throw new Error("Your champion is not in a zone");
    const result = await inviteToParty(token, ownEntityId, fromZoneId, friend.wallet);
    if (!result.ok) throw new Error(result.error ?? "Failed to send party invite");
    return `Party invite sent to ${friend.name ?? friend.wogName ?? "friend"}`;
  },
});

function locateFriend(friend: FriendInfo) {
  const online = latestActivePlayers.find((player) =>
    player.walletAddress?.toLowerCase() === friend.wallet.toLowerCase()
  );
  if (online?.id) {
    const pos = entities.getEntityPosition(online.id);
    if (pos) {
      lockOn(online.id);
      controls.setTarget(pos.x, pos.y, pos.z);
      return;
    }
  }

  if (friend.zoneId) {
    const center = world.getZoneCenter(friend.zoneId);
    if (center) {
      unlockCamera();
      controls.setTarget(center.x, 0, center.z);
    }
  }
}

type QuestActionContext = {
  token: string;
  zoneId: string;
} | null;

async function prepareQuestAction(label: string): Promise<QuestActionContext> {
  if (!ownWalletAddress || !ownEntityId) {
    agentChat.addSystemMessage(`${label}: deploy your agent first.`, "error");
    return null;
  }
  const token = await getAuthToken(ownWalletAddress);
  if (!token) {
    agentChat.addSystemMessage(`${label}: auth failed — sign in again.`, "error");
    return null;
  }
  const ownEntity = entities.getEntity(ownEntityId);
  const zoneId = ownEntity?.zoneId;
  if (!zoneId) {
    agentChat.addSystemMessage(`${label}: not in a zone yet.`, "error");
    return null;
  }
  return { token, zoneId };
}

async function dispatchGotoNpc(
  token: string,
  body: Record<string, unknown>,
  label: string,
  npcLabel: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/agent/goto-npc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      agentChat.addSystemMessage(`${label}: heading to ${npcLabel} — will finish on arrival.`, "progress");
      return true;
    }
    const text = (await res.text()).slice(0, 140);
    agentChat.addSystemMessage(`${label}: agent can't walk to ${npcLabel} (${res.status}) ${text}`, "error");
    return false;
  } catch (err) {
    agentChat.addSystemMessage(`${label}: network error sending agent to ${npcLabel} — ${err}`, "error");
    return false;
  }
}

const questPanel = new QuestPanel({
  onAcceptQuest: async (questId, npcEntityId, npcName) => {
    const label = "Accept quest";
    const ctx = await prepareQuestAction(label);
    if (!ctx) return;
    const npcLabel = npcName || "quest giver";

    agentChat.addSystemMessage(`${label}: contacting ${npcLabel}...`, "info");
    const result = await acceptQuest(ctx.token, ownEntityId!, questId);
    if (result.ok) {
      trackXRQuestAccepted(questId);
      agentChat.addSystemMessage(`Quest accepted from ${npcLabel}.`, "success");
      lastQuestPollTime = 0;
      void pollQuests();
      return;
    }

    if (result.error?.includes("Too far")) {
      const ok = await dispatchGotoNpc(
        ctx.token,
        { entityId: npcEntityId, zoneId: ctx.zoneId, name: npcName, action: "accept-quest", questId },
        label,
        npcLabel,
      );
      if (ok) {
        lastQuestPollTime = 0;
        void pollQuests();
      }
    } else {
      agentChat.addSystemMessage(`${label} failed: ${result.error ?? "unknown error"}`, "error");
    }
  },
  onCompleteQuest: async (questId, npcEntityId, questTitle) => {
    const label = `Turn in "${questTitle}"`;
    const ctx = await prepareQuestAction(label);
    if (!ctx) return;
    const npcLabel = "quest giver";

    agentChat.addSystemMessage(`${label}: contacting ${npcLabel}...`, "info");
    const result = await completeQuest(ctx.token, ownEntityId!, questId, npcEntityId);
    if (result.ok) {
      trackXRQuestCompleted(questId, questTitle);
      agentChat.addSystemMessage(`Quest complete: "${questTitle}". Rewards granted.`, "success");
      eventBanner.show("quest-complete", questTitle);
      lastQuestPollTime = 0;
      void pollQuests();
      return;
    }

    if (result.error?.includes("Too far")) {
      const ok = await dispatchGotoNpc(
        ctx.token,
        { entityId: npcEntityId, zoneId: ctx.zoneId, action: "complete-quest", questId },
        label,
        npcLabel,
      );
      if (ok) {
        lastQuestPollTime = 0;
        void pollQuests();
      }
    } else {
      agentChat.addSystemMessage(`${label} failed: ${result.error ?? "unknown error"}`, "error");
    }
  },
  onTalkToNpc: async (npcEntityId, npcName) => {
    const label = "Talk quest";
    const ctx = await prepareQuestAction(label);
    if (!ctx) return;
    const npcLabel = npcName || "NPC";

    agentChat.addSystemMessage(`${label}: approaching ${npcLabel}...`, "info");
    const result = await talkToNpc(ctx.token, ownEntityId!, npcEntityId);
    if (result.ok) {
      agentChat.addSystemMessage(`Spoke to ${npcLabel}. Quest progressed.`, "success");
      lastQuestPollTime = 0;
      void pollQuests();
      return;
    }

    if (result.error?.includes("Too far")) {
      const ok = await dispatchGotoNpc(
        ctx.token,
        { entityId: npcEntityId, zoneId: ctx.zoneId, name: npcName, action: "talk-quest" },
        label,
        npcLabel,
      );
      if (ok) {
        lastQuestPollTime = 0;
        void pollQuests();
      }
    } else {
      agentChat.addSystemMessage(`${label} failed: ${result.error ?? "unknown error"}`, "error");
    }
  },
  onAbandonQuest: async (questId, questTitle) => {
    const label = `Abandon "${questTitle}"`;
    if (!ownWalletAddress || !ownEntityId) {
      agentChat.addSystemMessage(`${label}: deploy your agent first.`, "error");
      return;
    }
    const token = await getAuthToken(ownWalletAddress);
    if (!token) {
      agentChat.addSystemMessage(`${label}: auth failed — sign in again.`, "error");
      return;
    }
    const result = await abandonQuest(token, ownEntityId, questId);
    if (result.ok) {
      trackXRQuestAbandoned(questId, questTitle);
      agentChat.addSystemMessage(`Quest abandoned: "${questTitle}".`, "info");
      eventBanner.show("quest-abandoned", questTitle);
      lastQuestPollTime = 0;
      void pollQuests();
    } else {
      agentChat.addSystemMessage(`${label} failed: ${result.error ?? "unknown error"}`, "error");
    }
  },
  onOpenAvailable: () => {
    void refreshAvailableQuestsNow();
  },
  onFocusQuest: async (questId, questTitle) => {
    if (!ownWalletAddress) {
      agentChat.addSystemMessage("Focus failed: deploy your agent first.", "error");
      questPanel.setFocusedQuestId(null);
      return;
    }
    const token = await getAuthToken(ownWalletAddress);
    if (!token) {
      agentChat.addSystemMessage("Focus failed: auth.", "error");
      questPanel.setFocusedQuestId(null);
      return;
    }
    const result = await focusAgentQuest(token, questId);
    if (result.ok) {
      questPanel.setFocusedQuestId(result.focusedQuestId ?? null);
      agentChat.addSystemMessage(
        questId ? `Agent now focused on "${questTitle}".` : "Quest focus cleared.",
        "success",
      );
    } else {
      agentChat.addSystemMessage(`Focus failed: ${result.error ?? "unknown error"}`, "error");
      // Roll back the optimistic toggle by re-querying the agent status the next tick.
    }
  },
});

const bagPanel = new BagPanel({
  onEquipItem: async (item) => {
    if (!ownWalletAddress || !ownEntityId) return;
    const ent = entities.getEntity(ownEntityId);
    if (!ent?.zoneId) return;
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return;
    const isEquipped = item.equipped && item.equippedSlot;
    const result = isEquipped
      ? await unequipItem(token, { zoneId: ent.zoneId, entityId: ownEntityId, slot: item.equippedSlot! })
      : await equipItem(token, { zoneId: ent.zoneId, entityId: ownEntityId, tokenId: item.tokenId });
    if (!result.ok) {
      console.warn("[bag] equip/unequip failed:", result.error);
      return;
    }
    lastInventoryPollTime = 0;
    void pollInventory();
  },
  onRecycleItem: async (item, qty) => {
    if (!ownWalletAddress) return;
    const sellerWallet = ownCustodialWallet ?? ownWalletAddress;
    const stack = item.quantity ?? 1;
    const sellQty = qty > 1 ? stack : 1;
    const ask = sellQty > 1
      ? `Recycle all ${stack}x ${item.name}?`
      : `Recycle 1x ${item.name}?`;
    if (!window.confirm(ask)) return;
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return;
    const result = await recycleItem(token, sellerWallet, item.tokenId, sellQty);
    if (result.ok && result.data) {
      agentChat.addSystemMessage(
        `Recycled ${result.data.quantity}x ${result.data.item} for ${result.data.totalPayoutCopper}c`,
        "success",
      );
      lastInventoryPollTime = 0;
      void pollInventory();
    } else {
      agentChat.addSystemMessage(result.error ?? "Recycle failed", "error");
    }
  },
});
bagPanel.setPlayer(null, true);

const CRAFT_STATION: Record<string, { endpoint: string; stationType: string; stationField: string }> = {
  blacksmithing: { endpoint: "/crafting/forge",       stationType: "forge",          stationField: "forgeId"      },
  alchemy:       { endpoint: "/alchemy/brew",         stationType: "alchemy-lab",    stationField: "alchemyLabId" },
  cooking:       { endpoint: "/cooking/cook",         stationType: "campfire",       stationField: "campfireId"   },
  leatherworking:{ endpoint: "/leatherworking/craft", stationType: "tanning-rack",   stationField: "stationId"    },
  jewelcrafting: { endpoint: "/jewelcrafting/craft",  stationType: "jewelers-bench", stationField: "stationId"    },
};

async function craftRecipe(profId: string, recipeId: string): Promise<{ ok: boolean; message: string }> {
  const cfg = CRAFT_STATION[profId];
  if (!cfg) return { ok: false, message: "Crafting not available for this profession" };
  if (!ownEntityId || !ownWalletAddress) return { ok: false, message: "Deploy your agent first" };

  const token = await getAuthToken(ownWalletAddress);
  if (!token) return { ok: false, message: "Sign in to craft" };

  const zoneId = entities.getEntity(ownEntityId)?.zoneId;
  if (!zoneId) return { ok: false, message: "Entity not in any zone" };

  const batch = await fetchZonesBatch([zoneId]);
  const zoneData = batch[zoneId];
  if (!zoneData) return { ok: false, message: "Zone data unavailable" };

  const stationEntries = Object.entries(zoneData.entities).filter(([, e]) => (e as any).type === cfg.stationType);
  if (stationEntries.length === 0) {
    return { ok: false, message: `No ${cfg.stationType} in this zone — move to a crafting area` };
  }

  const ownEnt = zoneData.entities[ownEntityId] as any;
  const px = ownEnt?.x ?? 0, pz = ownEnt?.y ?? 0;
  stationEntries.sort(([, a], [, b]) => {
    const ea = a as any, eb = b as any;
    return Math.hypot(ea.x - px, (ea.y ?? 0) - pz) - Math.hypot(eb.x - px, (eb.y ?? 0) - pz);
  });
  const [stationId] = stationEntries[0];

  const wallet = ownCustodialWallet ?? ownWalletAddress;
  const body: Record<string, string> = { walletAddress: wallet, zoneId, entityId: ownEntityId, [cfg.stationField]: stationId, recipeId };
  const result = await craftAtStation(token, cfg.endpoint, body);
  return result.ok
    ? { ok: true,  message: result.data?.message ?? "Crafted successfully!" }
    : { ok: false, message: result.error ?? "Crafting failed" };
}

const recipesPanel = new RecipesPanel();
const skillsPanel = new SkillsPanel({
  saveEdicts: (edicts) => saveEdictsToShard(edicts),
  onTabChange: (tab) => {
    if (tab === "professions") { lastProfessionPollTime = 0; void pollProfessions(); }
    else if (tab === "skills") { lastLearnedTechPollTime = 0; void pollLearnedTechniques(); }
    else if (tab === "edicts") { lastLearnedTechPollTime = 0; lastEdictsPollTime = 0; void pollLearnedTechniques(); void pollEdicts(); }
  },
  onProfessionClick: (info) => {
    void recipesPanel.show({
      ...info,
      onCraft: info.profId in CRAFT_STATION ? (recipeId) => craftRecipe(info.profId, recipeId) : undefined,
    });
  },
});
const vitalsPanel = new VitalsPanel();
const buffBar = new BuffBar();
let lastInventoryPollTime = 0;
let lastProfessionPollTime = 0;
let lastLearnedTechPollTime = 0;
let lastEdictsPollTime = 0;
let lastInboxPollTime = 0;
let lastFriendsPollTime = 0;
const INVENTORY_POLL_INTERVAL = 10_000;
const PROFESSION_POLL_INTERVAL = 15_000;
const LEARNED_TECH_POLL_INTERVAL = 20_000;
const EDICTS_POLL_INTERVAL = 30_000;
const INBOX_POLL_INTERVAL = 15_000;
const FRIENDS_POLL_INTERVAL = 15_000;

// ── Bottom-right action bar ────────────────────────────────────────
const actionBar = new ActionBar();
let currentInventoryItems: InventoryItem[] = [];
let pendingTradeTarget: { wallet: string; name: string } | null = null;
const tradeOfferDialog = new TradeOfferDialog({
  onSubmit: async ({ tokenId, quantity, askPrice, itemName }) => {
    if (!pendingTradeTarget) throw new Error("No trade recipient selected");
    if (!ownWalletAddress || !ownEntityId) throw new Error("Deploy your agent first");
    const token = await getAuthToken(ownWalletAddress);
    if (!token) throw new Error("Auth failed — sign in again");
    const sellerAddress = ownCustodialWallet ?? ownWalletAddress;

    agentChat.addSystemMessage(
      `Listing ${itemName} for ${askPrice}g (sealed via BITE) — sending to ${pendingTradeTarget.name}...`,
      "progress",
    );
    const result = await listTrade(token, {
      sellerAddress,
      tokenId,
      quantity,
      askPrice,
      targetBuyerWallet: pendingTradeTarget.wallet,
    });
    if (!result.ok) {
      const err = result.error ?? "trade-list failed";
      agentChat.addSystemMessage(`Trade offer failed: ${err}`, "error");
      throw new Error(err);
    }
    agentChat.addSystemMessage(
      `Offer #${result.tradeId} sent to ${pendingTradeTarget.name}.`,
      "success",
    );
    pendingTradeTarget = null;
  },
});

const inboxPanel = new InboxPanel({
  onUnreadChange: (count: number) => {
    actionBar.setBadge("inbox", count);
  },
  onAcceptTrade: async (offer) => {
    if (!ownWalletAddress) {
      agentChat.addSystemMessage("Accept trade: deploy your agent first.", "error");
      return { ok: false };
    }
    const token = await getAuthToken(ownWalletAddress);
    if (!token) {
      agentChat.addSystemMessage("Accept trade: auth failed — sign in again.", "error");
      return { ok: false };
    }
    const buyerAddress = ownCustodialWallet ?? ownWalletAddress;
    const itemDisplay = offer.itemName ?? `token #${offer.tokenId}`;
    agentChat.addSystemMessage(
      `Accepting offer from ${offer.sellerName} for ${itemDisplay} (${offer.askPrice}g) — BITE CTX can take ~30s.`,
      "progress",
    );
    const result = await acceptTradeOffer(token, {
      tradeId: offer.tradeId,
      buyerAddress,
      bidPrice: offer.askPrice,
    });
    if (!result.ok) {
      agentChat.addSystemMessage(`Trade failed: ${result.error ?? "unknown error"}`, "error");
      return { ok: false, error: result.error };
    }
    if (result.matched) {
      agentChat.addSystemMessage(`Trade complete! Received ${itemDisplay}.`, "success");
    } else {
      agentChat.addSystemMessage(
        `Trade submitted but did not match: ${result.reason ?? "see logs"}`,
        "error",
      );
    }
    lastInventoryPollTime = 0;
    void pollInventory();
    return { ok: true };
  },
  onDeclineTrade: async (offer) => {
    if (!ownWalletAddress) {
      agentChat.addSystemMessage("Decline trade: deploy your agent first.", "error");
      return { ok: false };
    }
    const token = await getAuthToken(ownWalletAddress);
    if (!token) {
      agentChat.addSystemMessage("Decline trade: auth failed.", "error");
      return { ok: false };
    }
    const result = await rejectTradeOffer(token, offer.tradeId);
    if (!result.ok) {
      agentChat.addSystemMessage(`Decline failed: ${result.error ?? "unknown error"}`, "error");
      return { ok: false, error: result.error };
    }
    agentChat.addSystemMessage(`Offer from ${offer.sellerName} declined.`, "info");
    return { ok: true };
  },
  onTradeResult: (data) => {
    // A trade-result message (accepted / declined / expired) just landed — the
    // seller's gold or inventory has likely changed. Force the next inventory
    // poll to bypass the throttle so the UI catches the delta within ~1s.
    lastInventoryPollTime = 0;
    void pollInventory();
    if (data.kind === "trade-completed") {
      agentChat.addSystemMessage(
        data.tradeId !== undefined ? `Trade #${data.tradeId} settled.` : "Trade settled.",
        "success",
      );
    } else if (data.kind === "trade-declined") {
      agentChat.addSystemMessage(
        data.tradeId !== undefined ? `Trade #${data.tradeId} declined by buyer.` : "Trade declined.",
        "info",
      );
    } else if (data.kind === "trade-expired") {
      agentChat.addSystemMessage(
        data.tradeId !== undefined ? `Trade #${data.tradeId} expired.` : "Trade expired.",
        "info",
      );
    }
  },
  onMatchFound: (data) => {
    const arena = data.arenaName ?? "the coliseum";
    const team = data.team ? data.team.toUpperCase() : "";
    agentChat.addSystemMessage(
      `Match found in ${arena} — you're on team ${team}. Opening arena viewer…`,
      "success",
    );
    playSoundEffect("ui_notification");
    if (data.battleId) {
      npcDialog.setCurrentBattleId(data.battleId);
      void npcDialog.openBattleViewer(data.battleId);
      void refreshCurrentBattle(data.battleId);
    }
  },
  onOpenBattle: (battleId) => {
    npcDialog.setCurrentBattleId(battleId);
    void npcDialog.openBattleViewer(battleId);
    void refreshCurrentBattle(battleId);
  },
  onAcceptDuel: async (challengeId) => {
    if (!ownWalletAddress) {
      agentChat.addSystemMessage("Accept duel: deploy your agent first.", "error");
      return { ok: false };
    }
    const token = await getAuthToken(ownWalletAddress);
    if (!token) {
      agentChat.addSystemMessage("Accept duel: auth failed.", "error");
      return { ok: false };
    }
    agentChat.addSystemMessage("Accepting duel — queueing now.", "progress");
    const result = await acceptDuel(token, challengeId);
    if (!result.ok) {
      agentChat.addSystemMessage(`Duel accept failed: ${result.error ?? "unknown error"}`, "error");
      return { ok: false, error: result.error };
    }
    agentChat.addSystemMessage("Duel accepted — match will start as soon as both are queued.", "success");
    return { ok: true };
  },
  onDeclineDuel: async (challengeId) => {
    if (!ownWalletAddress) return { ok: false };
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return { ok: false };
    const result = await declineDuel(token, challengeId);
    if (!result.ok) {
      agentChat.addSystemMessage(`Duel decline failed: ${result.error ?? "unknown error"}`, "error");
      return { ok: false, error: result.error };
    }
    agentChat.addSystemMessage("Duel declined.", "info");
    return { ok: true };
  },
  onAcceptPartyInvite: async (inviteId) => {
    if (!ownWalletAddress || !ownCustodialWallet) {
      agentChat.addSystemMessage("Deploy your agent first.", "error");
      return { ok: false };
    }
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return { ok: false };
    const result = await acceptPartyInvite(token, ownCustodialWallet, inviteId);
    if (!result.ok) {
      agentChat.addSystemMessage(`Party join failed: ${result.error ?? "unknown error"}`, "error");
      return { ok: false, error: result.error };
    }
    agentChat.addSystemMessage("Joined the party!", "success");
    return { ok: true };
  },
  onDeclinePartyInvite: async (inviteId) => {
    if (!ownWalletAddress || !ownCustodialWallet) return { ok: false };
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return { ok: false };
    const result = await declinePartyInvite(token, ownCustodialWallet, inviteId);
    if (!result.ok) {
      agentChat.addSystemMessage(`Decline failed: ${result.error ?? "unknown error"}`, "error");
      return { ok: false, error: result.error };
    }
    agentChat.addSystemMessage("Party invite declined.", "info");
    return { ok: true };
  },
});
const outgoingTradesPanel = new OutgoingTradesPanel({
  refresh: async () => {
    if (!ownWalletAddress) return [];
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return [];
    const wallet = ownCustodialWallet ?? ownWalletAddress;
    const res = await fetchOutgoingTrades(token, wallet);
    return res?.offers ?? [];
  },
  onCancel: async (tradeId) => {
    if (!ownWalletAddress) {
      agentChat.addSystemMessage("Cancel failed: deploy your agent first.", "error");
      return { ok: false };
    }
    const token = await getAuthToken(ownWalletAddress);
    if (!token) {
      agentChat.addSystemMessage("Cancel failed: auth — sign in again.", "error");
      return { ok: false };
    }
    agentChat.addSystemMessage(`Cancelling trade #${tradeId}...`, "progress");
    const result = await cancelTrade(token, tradeId);
    if (!result.ok) {
      agentChat.addSystemMessage(`Cancel failed: ${result.error ?? "unknown error"}`, "error");
      return { ok: false, error: result.error };
    }
    agentChat.addSystemMessage(`Trade #${tradeId} cancelled.`, "info");
    return { ok: true };
  },
});

const betsPanel = new BetsPanel({
  refreshPools: () => fetchActivePools(),
  refreshHistory: async () => {
    if (!ownWalletAddress) return [];
    const wallet = ownCustodialWallet ?? ownWalletAddress;
    const history = await fetchBettingHistory(wallet);
    return history?.bets ?? [];
  },
  onPlaceBet: async (poolId, choice, amount) => {
    if (!ownWalletAddress) {
      agentChat.addSystemMessage("Bet failed: deploy your agent first.", "error");
      return { ok: false };
    }
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return { ok: false };
    const wallet = ownCustodialWallet ?? ownWalletAddress;
    agentChat.addSystemMessage(`Placing ${amount}g on ${choice}...`, "progress");
    const result = await placeBet(token, { poolId, choice, amount, walletAddress: wallet });
    if (!result.ok) {
      agentChat.addSystemMessage(`Bet failed: ${result.error ?? "unknown error"}`, "error");
      return { ok: false, error: result.error };
    }
    agentChat.addSystemMessage(`Bet placed: ${amount}g on ${choice}.`, "success");
    return { ok: true };
  },
  onClaim: async (poolId) => {
    if (!ownWalletAddress) return { ok: false };
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return { ok: false };
    const wallet = ownCustodialWallet ?? ownWalletAddress;
    agentChat.addSystemMessage(`Claiming winnings...`, "progress");
    const result = await claimWinnings(token, poolId, wallet);
    if (!result.ok) {
      agentChat.addSystemMessage(`Claim failed: ${result.error ?? "unknown error"}`, "error");
      return { ok: false, error: result.error };
    }
    agentChat.addSystemMessage(`Winnings claimed.`, "success");
    lastInventoryPollTime = 0;
    void pollInventory();
    return { ok: true };
  },
});

// Unified notifications hub — inbox / trades / bets all live under one icon.
const notificationsPanel = new NotificationsPanel({
  inbox: inboxPanel,
  trades: outgoingTradesPanel,
  bets: betsPanel,
});

// Install responsive panel overrides AFTER all panels have injected their
// own stylesheets so our `!important` overrides take precedence cleanly.
installMobileResponsiveStyles();

actionBar.addButton({ id: "bag", icon: "\u{1F392}", label: "Bag", key: "B", onClick: () => togglePanel("bag") });
actionBar.addButton({ id: "skills", icon: "\u2692", label: "Skills", key: "P", onClick: () => togglePanel("skills") });
actionBar.addButton({ id: "quests", icon: "\u{1F4DC}", label: "Quests", key: "Q", onClick: () => togglePanel("quests") });
let unreadChat = 0;
const clearChatUnread = () => {
  if (unreadChat === 0) return;
  unreadChat = 0;
  actionBar.setBadge("chat", 0);
};
actionBar.addButton({ id: "chat", icon: "\u{1F4AC}", label: "Chat", key: "T", onClick: () => togglePanel("chat") });
actionBar.addButton({ id: "players", icon: "\u{1F465}", label: "Players", key: "U", onClick: () => togglePanel("players") });
actionBar.addButton({ id: "inbox", icon: "\u{1F4EC}", label: "Inbox", key: "I", onClick: () => togglePanel("inbox") });
actionBar.addButton({ id: "equip", icon: "\u{1F6E1}", label: "Equipment", key: "E", onClick: () => {
  if (ownEntityId) {
    const ent = entities.getEntity(ownEntityId);
    if (ent) inspector.show(ent, window.innerWidth / 2, window.innerHeight / 2);
  }
}});
actionBar.addButton({ id: "settings", icon: "\u2699", label: "Settings", key: "", onClick: () => togglePanel("settings") });

type ManagedPanelId = "bag" | "skills" | "quests" | "chat" | "players" | "inbox" | "settings";
type ManagedPanel = {
  show: () => void;
  hide: () => void;
  isVisible: () => boolean;
  onOpen?: () => void;
};

const managedPanels: Record<ManagedPanelId, ManagedPanel> = {
  bag: {
    show: () => bagPanel.show(),
    hide: () => bagPanel.hide(),
    isVisible: () => bagPanel.isVisible(),
    onOpen: () => { lastInventoryPollTime = 0; void pollInventory(); },
  },
  skills: {
    show: () => skillsPanel.show(),
    hide: () => skillsPanel.hide(),
    isVisible: () => skillsPanel.isVisible(),
    onOpen: () => kickSkillsPollForActiveTab(),
  },
  quests: {
    show: () => questPanel.show(),
    hide: () => questPanel.hide(),
    isVisible: () => questPanel.isVisible(),
  },
  chat: {
    show: () => agentChat.expand(),
    hide: () => agentChat.hide(),
    isVisible: () => agentChat.isVisible(),
    onOpen: () => clearChatUnread(),
  },
  players: {
    show: () => playerPanel.show(),
    hide: () => playerPanel.hide(),
    isVisible: () => playerPanel.isVisible(),
  },
  inbox: {
    show: () => notificationsPanel.show(),
    hide: () => notificationsPanel.hide(),
    isVisible: () => notificationsPanel.isVisible(),
    onOpen: () => { lastInboxPollTime = 0; void pollInbox(); },
  },
  settings: {
    show: () => settingsPanel.show(),
    hide: () => settingsPanel.hide(),
    isVisible: () => settingsPanel.isVisible(),
  },
};

function isSinglePanelMobileMode(): boolean {
  return window.matchMedia("(max-width: 900px), (pointer: coarse)").matches;
}

function refreshActionBarActiveStates() {
  for (const [id, panel] of Object.entries(managedPanels) as Array<[ManagedPanelId, ManagedPanel]>) {
    actionBar.setActive(id, panel.isVisible());
  }
}

function closeOtherPanels(except: ManagedPanelId) {
  for (const [id, panel] of Object.entries(managedPanels) as Array<[ManagedPanelId, ManagedPanel]>) {
    if (id === except) continue;
    if (panel.isVisible()) panel.hide();
  }
}

function openPanel(id: ManagedPanelId) {
  if (isSinglePanelMobileMode()) closeOtherPanels(id);
  const panel = managedPanels[id];
  panel.show();
  panel.onOpen?.();
  trackXRPanelOpened(id);
  refreshActionBarActiveStates();
}

function closePanel(id: ManagedPanelId) {
  managedPanels[id].hide();
  refreshActionBarActiveStates();
}

function togglePanel(id: ManagedPanelId) {
  if (managedPanels[id].isVisible()) closePanel(id);
  else openPanel(id);
}

function initDesktopPanelDragging() {
  const isDesktop = () => !window.matchMedia("(max-width: 900px), (pointer: coarse)").matches;
  const draggableDefs: Array<{ id: string; handleSelector?: string }> = [
    { id: "bag-panel", handleSelector: ".bag-header" },
    { id: "skills-panel", handleSelector: ".sk-drag-handle" },
    { id: "quest-panel", handleSelector: ".qp-header" },
    { id: "player-panel", handleSelector: ".pp-drag-handle" },
    { id: "inbox-panel", handleSelector: ".ibx-header" },
    { id: "outgoing-trades-panel", handleSelector: ".otp-header" },
    { id: "bets-panel", handleSelector: ".bp-header" },
    { id: "settings-panel", handleSelector: ".settings-header" },
    { id: "agent-chat", handleSelector: ".agent-chat-tabs" },
  ];

  // Storage version. Bump when validator rules change so stale positions get
  // discarded automatically (no need for the user to run wogResetPanels()).
  const PANEL_DRAG_STORAGE_VERSION = 2;

  // One-time migration: wipe pre-v2 keys. The loose validator accepted
  // positions like (5, 10) that get pinned behind AgentChat / chat log /
  // status HUD in the upper-left corner, leaving the panel's drag handle
  // obscured. Bumping the version forces a clean default for everyone.
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("wog:panel-pos:") && !k.startsWith(`wog:panel-pos:v${PANEL_DRAG_STORAGE_VERSION}:`)) {
        stale.push(k);
      }
    }
    for (const k of stale) localStorage.removeItem(k);
    if (stale.length > 0) console.log(`[panel-drag] migrated ${stale.length} legacy panel-position key(s) to v${PANEL_DRAG_STORAGE_VERSION}`);
  } catch {
    // localStorage unavailable — ignore.
  }

  // Minimum visible area of the drag handle that must stay on-screen so the
  // user can always grab the panel and pull it back.
  const MIN_VISIBLE_PX = 32;

  // Upper-left HUD overlap zone. AgentChat (collapsed), ChatLog, and status
  // indicators live here and intercept pointer events — a panel restored
  // into this rectangle has its drag handle obscured. We refuse positions
  // here even though they pass the on-screen reachability check.
  const HUD_ZONE_LEFT = 80;
  const HUD_ZONE_TOP = 60;

  const isPanelRendered = (el: HTMLElement): boolean => {
    // offsetParent is null for display:none, but null also for fixed-position
    // roots whose ancestors are visible — so fall back to a size check.
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  };

  const reachable = (left: number, top: number, panelId: string): boolean => {
    // AgentChat's default home is the lower-left; don't reject its own corner.
    const isAgentChat = panelId === "agent-chat";
    if (!isAgentChat && left < HUD_ZONE_LEFT && top < HUD_ZONE_TOP) return false;
    return (
      left + MIN_VISIBLE_PX >= 0 &&
      top >= 0 &&
      left <= window.innerWidth - MIN_VISIBLE_PX &&
      top <= window.innerHeight - MIN_VISIBLE_PX
    );
  };

  const resetters: Array<() => void> = [];

  for (const def of draggableDefs) {
    const el = document.getElementById(def.id) as HTMLDivElement | null;
    if (!el) continue;
    const handle = (def.handleSelector ? el.querySelector(def.handleSelector) : null) as HTMLElement | null ?? el;
    const key = `wog:panel-pos:v${PANEL_DRAG_STORAGE_VERSION}:${def.id}`;

    const clamp = (left: number, top: number) => {
      const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - el.offsetHeight);
      return { left: Math.min(maxLeft, Math.max(0, left)), top: Math.min(maxTop, Math.max(0, top)) };
    };
    const applyPos = (left: number, top: number) => {
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    };
    const saveCurrent = () => {
      const left = el.offsetLeft;
      const top = el.offsetTop;
      // Don't persist positions that would re-trigger the upper-left HUD-trap
      // bug on next reload. The user can still drop the panel there for the
      // current session, but on reload CSS defaults restore a usable spot.
      if (!reachable(left, top, def.id)) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify({ left, top }));
    };
    const clearSaved = () => {
      localStorage.removeItem(key);
      el.style.left = "";
      el.style.top = "";
      el.style.right = "";
      el.style.bottom = "";
    };
    resetters.push(clearSaved);

    const readSaved = (): { left: number; top: number } | null => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try {
        const pos = JSON.parse(raw) as { left?: number; top?: number };
        if (typeof pos.left !== "number" || typeof pos.top !== "number") return null;
        if (!reachable(pos.left, pos.top, def.id)) {
          // Position is unreachable in this viewport OR sits behind the HUD
          // overlap zone in the upper-left. Discard so CSS default kicks in
          // and the panel returns to a known-good corner.
          console.warn(`[panel-drag] discarding bad saved position for ${def.id}:`, pos);
          localStorage.removeItem(key);
          return null;
        }
        return { left: pos.left, top: pos.top };
      } catch {
        localStorage.removeItem(key);
        return null;
      }
    };

    // Try to restore position now; if the panel isn't rendered yet, we'll
    // retry the first time it actually becomes visible. This is the key fix:
    // applying coords from localStorage while the panel was display:none used
    // to silently leave a stale layout that resized to (0,0) on first show.
    let positionApplied = false;
    const tryApplySaved = () => {
      if (positionApplied) return;
      const pos = readSaved();
      if (!pos) { positionApplied = true; return; }
      if (!isPanelRendered(el)) return; // wait for next show
      const next = clamp(pos.left, pos.top);
      applyPos(next.left, next.top);
      positionApplied = true;
    };
    tryApplySaved();

    if (!positionApplied) {
      // Observe display/style changes; re-apply on first visibility.
      const obs = new MutationObserver(() => {
        if (positionApplied) { obs.disconnect(); return; }
        tryApplySaved();
        if (positionApplied) obs.disconnect();
      });
      obs.observe(el, { attributes: true, attributeFilter: ["style", "class"] });
    }

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.style.cursor = "move";
    handle.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (!isDesktop() || ev.pointerType === "touch") return;
      if (def.id === "agent-chat") {
        if ((ev.target as HTMLElement).closest("button, input, textarea, select")) return;
      } else if ((ev.target as HTMLElement).closest("button, input, textarea, select, [data-action]")) {
        return;
      }
      dragging = true;
      offsetX = ev.clientX - el.offsetLeft;
      offsetY = ev.clientY - el.offsetTop;
      applyPos(el.offsetLeft, el.offsetTop);
      handle.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    handle.addEventListener("pointermove", (ev: PointerEvent) => {
      if (!dragging) return;
      const next = clamp(ev.clientX - offsetX, ev.clientY - offsetY);
      applyPos(next.left, next.top);
    });
    const stopDrag = (ev: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      const next = clamp(el.offsetLeft, el.offsetTop);
      applyPos(next.left, next.top);
      saveCurrent();
    };
    handle.addEventListener("pointerup", stopDrag);
    handle.addEventListener("pointercancel", stopDrag);

    window.addEventListener("resize", () => {
      if (!isDesktop()) return;
      // Don't touch hidden panels — their offsetLeft/Top are 0 and would
      // overwrite the user's saved position with (0, 0).
      if (!isPanelRendered(el)) return;
      const next = clamp(el.offsetLeft, el.offsetTop);
      applyPos(next.left, next.top);
      saveCurrent();
    });
  }

  // Emergency reset: from devtools, run `wogResetPanels()` to clear every
  // saved panel position and fall back to CSS defaults.
  (window as unknown as { wogResetPanels?: () => void }).wogResetPanels = () => {
    for (const r of resetters) r();
    console.log("[panel-drag] all panel positions reset to defaults");
  };
}

function initPanelVisibilitySync() {
  const observer = new MutationObserver(() => {
    refreshActionBarActiveStates();
  });
  const panelIds: Record<ManagedPanelId, string> = {
    bag: "bag-panel",
    skills: "skills-panel",
    quests: "quest-panel",
    chat: "agent-chat",
    players: "player-panel",
    inbox: "notifications-panel",
    settings: "settings-panel",
  };
  for (const panelId of Object.values(panelIds)) {
    const el = document.getElementById(panelId);
    if (!el) continue;
    observer.observe(el, { attributes: true, attributeFilter: ["style", "class"] });
  }
}

refreshActionBarActiveStates();
initDesktopPanelDragging();
initPanelVisibilitySync();

/**
 * Snapshot of the most recent zone-entity merge. Kept in sync with the
 * VitalsPanel feed so PvP code paths (party detection, ArenaHud) can read
 * fresh state without re-fetching.
 */
let latestEntities: Record<string, Entity> = {};

const npcDialog = new NpcDialog({
  getAuthToken: async () => ownWalletAddress ? getAuthToken(ownWalletAddress) : null,
  getOwnEntityId: () => ownEntityId,
  getOwnWalletAddress: () => ownWalletAddress,
  getOwnInventoryWallet: () => ownCustodialWallet ?? ownWalletAddress,
  getOwnParty: () => {
    if (!ownEntityId) return null;
    const own = latestEntities[ownEntityId];
    if (!own?.partyId) return null;
    let size = 1;
    for (const ent of Object.values(latestEntities)) {
      if (ent.id !== own.id && ent.partyId === own.partyId && ent.type === "player") size++;
    }
    return { leaderId: ownEntityId, size };
  },
  getOwnCharacterInfo: () => {
    if (!ownCharacterInfo) return null;
    // Prefer the live in-world entity's level (it ticks up on level-up) over
    // the cached liveEntity snapshot taken at autolock time.
    const ent = ownEntityId ? entities.getEntity(ownEntityId) : null;
    const currentLevel = ent?.level ?? ownCharacterInfo.level;
    if (currentLevel > ownCharacterInfo.level) {
      eventBanner.show("level-up", `${ent?.name ?? "You"} reached level ${currentLevel}`);
      ownCharacterInfo.level = currentLevel;
    }
    return {
      level: currentLevel,
      characterTokenId: ownCharacterInfo.characterTokenId,
      agentId: ownCharacterInfo.agentId,
    };
  },
  notify: (text, kind) => agentChat.addSystemMessage(text, kind),
  onShowQuests: () => {
    openPanel("quests");
    questPanel.showAvailable();
    refreshActionBarActiveStates();
  },
});

// ── Persistent PvP HUD ──────────────────────────────────────────────
// Hidden by default; the global current-battle poller below shows/hides it
// based on /api/pvp/player/:agentId/current-battle responses.
const arenaHud = new ArenaHud({
  onForfeit: async (battleId) => {
    if (!ownWalletAddress) {
      agentChat.addSystemMessage("Forfeit failed: deploy your agent first.", "error");
      return;
    }
    const token = await getAuthToken(ownWalletAddress);
    if (!token) {
      agentChat.addSystemMessage("Forfeit failed: auth.", "error");
      return;
    }
    agentChat.addSystemMessage("Forfeiting battle…", "progress");
    const result = await cancelPvpBattle(token, battleId);
    if (result.ok) {
      agentChat.addSystemMessage("Battle forfeit.", "info");
      arenaHud.clear();
      npcDialog.setCurrentBattleId(null);
    } else {
      agentChat.addSystemMessage(`Forfeit failed: ${result.error ?? "unknown error"}`, "error");
    }
  },
  onOpenViewer: (battleId) => {
    void npcDialog.openBattleViewer(battleId);
  },
});

let currentBattlePollTimer: ReturnType<typeof setInterval> | null = null;
let currentBattleIdle = 2000;
let currentBattleActive = 1000;
let lastKnownBattleId: string | null = null;

async function refreshCurrentBattle(forceBattleId?: string): Promise<void> {
  if (!ownEntityId) return;
  const targetId = forceBattleId ?? lastKnownBattleId;
  if (targetId) {
    const details = await fetchBattleDetails(targetId);
    if (details) {
      if (arenaHud.currentBattleId() === targetId) {
        arenaHud.updateDetails(details, ownEntityId);
      } else {
        arenaHud.setBattle(targetId, details, ownEntityId);
      }
      lastKnownBattleId = targetId;
      npcDialog.setCurrentBattleId(targetId);
    }
    return;
  }
  const status = await fetchCurrentBattle(ownEntityId);
  if (status?.inBattle && status.battleId) {
    const details = await fetchBattleDetails(status.battleId);
    if (details) {
      arenaHud.setBattle(status.battleId, details, ownEntityId);
      lastKnownBattleId = status.battleId;
      npcDialog.setCurrentBattleId(status.battleId);
    }
  } else if (lastKnownBattleId) {
    arenaHud.clear();
    lastKnownBattleId = null;
    npcDialog.setCurrentBattleId(null);
    agentChat.addSystemMessage("Match over.", "info");
  }
}

function scheduleCurrentBattlePoll() {
  if (currentBattlePollTimer) clearInterval(currentBattlePollTimer);
  const ms = arenaHud.hasBattle() ? currentBattleActive : currentBattleIdle;
  currentBattlePollTimer = setInterval(() => {
    if (!ownEntityId) return;
    void (async () => {
      await refreshCurrentBattle();
      const wantActive = arenaHud.hasBattle();
      const currentMs = wantActive ? currentBattleActive : currentBattleIdle;
      if (currentMs !== ms) scheduleCurrentBattlePoll();
    })();
  }, ms);
}
scheduleCurrentBattlePoll();

if (landing) {
  controls.setLandingMode(true);
  setGameplayHudVisible(false);
} else if (isDisplayMode) {
  controls.setLandingMode(false);
  setGameplayHudVisible(false);
}

// ── Find initial zone with most entities ────────────────────────────

async function pickInitialZone(): Promise<string> {
  const zones = await fetchZoneList();
  let best = "village-square";
  let bestCount = 0;
  for (const [zoneId, info] of Object.entries(zones)) {
    if (info.entityCount > bestCount) {
      bestCount = info.entityCount;
      best = zoneId;
    }
  }
  return best;
}

// ── Multi-zone polling ──────────────────────────────────────────────

async function pollNearbyZones() {
  if (isPollingNearbyZones) return;
  isPollingNearbyZones = true;

  try {
    const target = controls.getTarget();
    const nearbyIds = world.getNearbyZoneIds(target.x, target.z, POLL_RADIUS);
    if (nearbyIds.length === 0) return;

    const batch = await fetchZonesBatch(nearbyIds);

    // Merge entities from all zones
    const merged: Record<string, Entity> = {};
    let gameTime: ZoneResponse["gameTime"] = undefined;
    let totalEntities = 0;
    const mergedIntents = new Map<string, VisibleIntent>();
    const allEvents: NonNullable<ZoneResponse["recentEvents"]> = [];

    for (const [id, data] of Object.entries(batch)) {
      if (!data) continue;
      for (const [eid, ent] of Object.entries(data.entities)) {
        ent.zoneId = id;
        merged[eid] = ent;
      }
      for (const intent of data.visibleIntents ?? []) {
        mergedIntents.set(intent.id, intent);
      }
      totalEntities += Object.keys(data.entities).length;
      if (data.gameTime) gameTime = data.gameTime;
      if (data.recentEvents) allEvents.push(...data.recentEvents);
    }

    const visibleIntents = Array.from(mergedIntents.values());
    const musicZoneId = ownEntityId ? (merged[ownEntityId]?.zoneId ?? null) : (nearbyIds[0] ?? null);
    bgm.setZone(musicZoneId);
    // Filter events before sync so we can feed combat metadata (crit/block/dodge)
    // into this tick's HP-delta damage numbers via preSync().
    const newEvents = filterNewZoneEvents(allEvents);
    entities.setOwnEntityId(ownEntityId);
    entities.preSync(newEvents);
    entities.sync(merged, visibleIntents);
    intentLines.sync(merged, visibleIntents);
    intentTooltip.setText(intentLines.getPrimaryIntentLabel());

    // HUD
    hudEntities.textContent = String(totalEntities);

    if (gameTime) {
      minimap.setGameTime(gameTime);
    }

    sky.update(gameTime);

    if (newEvents.length > 0) {
      agentChat.addEvents(newEvents);
      effects.processEvents(newEvents);
      entities.processEvents(newEvents);
      intentLines.processEvents(newEvents);
      if (agentChat.isExpanded()) {
        clearChatUnread();
      } else {
        unreadChat += newEvents.length;
        actionBar.setBadge("chat", unreadChat);
        actionBar.pulse("chat");
      }
    }

    effects.syncActiveEffects(merged);

    // Auto-lock to own character once it appears in scene (only if enabled)
    if (
      autoLockEnabled &&
      ownEntityId &&
      !lockedEntityId &&
      merged[ownEntityId] &&
      Date.now() >= manualUnlockUntilMs
    ) {
      lockOn(ownEntityId);
    }

    // Update lock indicator
    if (lockedEntityId) {
      if (merged[lockedEntityId]) {
        hudLock.textContent = merged[lockedEntityId].name;
      } else {
        unlockCamera();
      }
    }

    latestEntities = merged;
    vitalsPanel.update(ownEntityId ? merged[ownEntityId] : null, merged);
    buffBar.update(ownEntityId ? merged[ownEntityId] : null);

    // Minimap — pass camera in server coords
    const cameraSX = target.x / COORD_SCALE;
    const cameraSZ = target.z / COORD_SCALE;
    minimap.update(merged, cameraSX, cameraSZ);
    worldMap.update(
      merged,
      ownEntityId ? merged[ownEntityId] ?? null : null,
      cameraSX,
      cameraSZ,
    );
    const ownZoneId = ownEntityId ? merged[ownEntityId]?.zoneId ?? null : null;
    zoneNameBadge.setZoneId(ownZoneId);
    zoneBanner.setZoneId(ownZoneId);

    // Quest poll piggybacks on zone poll but self-throttles to 5s
    void pollQuests();
    // Inventory poll (only when bag is open)
    if (bagPanel.isVisible()) void pollInventory();
    if (skillsPanel.isVisible()) kickSkillsPollForActiveTab(false);
    // Inbox always polls in background so the unread badge stays fresh.
    void pollInbox();
    // Friends poll in background for request badges and online status.
    void pollFriends();
  } finally {
    isPollingNearbyZones = false;
  }
}

async function pollActivePlayers() {
  if (isPollingActivePlayers) return;
  isPollingActivePlayers = true;

  try {
    const data = await fetchActivePlayers();
    if (!data) return;
    latestActivePlayers = data.players;
    playerPanel.update(data.players);
    landing?.setOnlineCount(data.count);
    tryFollowDisplayTarget(data.players);
    tryLockOwnCharacter(data.players);
  } finally {
    isPollingActivePlayers = false;
  }
}

// ── Quest polling (throttled to 5s) ─────────────────────────────────

async function pollQuests() {
  const addr = ownWalletAddress;
  if (!addr) return;

  const now = Date.now();
  if (now - lastQuestPollTime < QUEST_POLL_INTERVAL) return;
  lastQuestPollTime = now;

  const log = await fetchQuestLog(addr);
  if (log) {
    questLogData = log;
    questPanel.updateQuestLog(log);

    if (ownEntityId && log.zoneId) {
      const zq = await fetchZoneQuests(log.zoneId, ownEntityId);
      if (zq) questPanel.updateZoneQuests(zq);

      // Build quest indicator states for NPCs
      const indicatorStates = new Map<string, QuestIndicatorState>();

      // Available quests → yellow "!" on quest giver
      if (zq) {
        for (const q of zq.quests) {
          if (q.npcEntityId) indicatorStates.set(q.npcEntityId, "available");
        }
      }

      // Active quests — in-progress "?" or ready-to-turn-in "?"
      for (const aq of log.activeQuests) {
        if (!aq.npcEntityId) continue;
        // "ready" overrides "in-progress", "in-progress" overrides "available"
        if (aq.complete) {
          indicatorStates.set(aq.npcEntityId, "ready");
        } else if (!indicatorStates.has(aq.npcEntityId) || indicatorStates.get(aq.npcEntityId) === "available") {
          indicatorStates.set(aq.npcEntityId, "in-progress");
        }
      }

      entities.updateQuestIndicators(indicatorStates);
    }
  }
}

async function refreshAvailableQuestsNow() {
  if (!ownEntityId) return;
  const zoneId = entities.getEntity(ownEntityId)?.zoneId ?? questLogData?.zoneId;
  if (!zoneId) return;
  const zq = await fetchZoneQuests(zoneId, ownEntityId);
  if (zq) {
    questPanel.updateZoneQuests(zq);
  }
}

let prevInventoryItemCount = -1;

async function pollInventory() {
  // Agents store items under their custodial wallet; fall back to owner wallet
  // when no agent has been deployed yet (shard then resolves custodial server-side).
  const addr = ownCustodialWallet ?? ownWalletAddress;
  if (!addr) return;
  const now = Date.now();
  if (now - lastInventoryPollTime < INVENTORY_POLL_INTERVAL) return;
  lastInventoryPollTime = now;

  const [inv, balance] = await Promise.all([
    fetchInventory(addr),
    fetchWalletBalance(addr),
  ]);
  if (inv) {
    if (prevInventoryItemCount !== -1 && inv.items.length > prevInventoryItemCount) {
      playSoundEffect("ui_item_pickup");
    }
    prevInventoryItemCount = inv.items.length;
    currentInventoryItems = inv.items;
    bagPanel.updateInventory(inv.items);
  }
  if (balance) {
    bagPanel.updateGold(balance.copper);
  }
}

const prevProfessionLevels = new Map<string, number>();

function professionDisplayName(id: string): string {
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function pollProfessions() {
  // Same as inventory: agents learn professions under the custodial wallet.
  const addr = ownCustodialWallet ?? ownWalletAddress;
  if (!addr) return;
  const now = Date.now();
  if (now - lastProfessionPollTime < PROFESSION_POLL_INTERVAL) return;
  lastProfessionPollTime = now;

  const data = await fetchProfessionStatus(addr);
  if (data) {
    // Detect profession level-ups before updating the panel. First sample
    // primes the map and stays silent so users don't get spammed on login.
    const primed = prevProfessionLevels.size > 0;
    for (const [profId, summary] of Object.entries(data.skills)) {
      const prev = prevProfessionLevels.get(profId);
      if (primed && prev !== undefined && summary.level > prev) {
        eventBanner.show("profession-level-up", `${professionDisplayName(profId)} → Lv ${summary.level}`);
      }
      prevProfessionLevels.set(profId, summary.level);
    }
    setPlayerProfessionLevels(data.skills);
    skillsPanel.updateProfessions(data);
  }
}

const prevLearnedTechniqueIds = new Set<string>();
let prevLearnedTechniquesPrimed = false;

async function pollLearnedTechniques() {
  if (!ownEntityId) return;
  const now = Date.now();
  if (now - lastLearnedTechPollTime < LEARNED_TECH_POLL_INTERVAL) return;
  lastLearnedTechPollTime = now;
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetch(toUrl(base, `/techniques/learned/${ownEntityId}`));
      if (!res.ok) continue;
      const data = await res.json() as { techniques?: LearnedTechnique[] };
      const techniques = data.techniques ?? [];
      if (prevLearnedTechniquesPrimed) {
        for (const t of techniques) {
          const id = String((t as any).techniqueId ?? (t as any).id ?? (t as any).name ?? "");
          if (id && !prevLearnedTechniqueIds.has(id)) {
            const name = String((t as any).name ?? id);
            eventBanner.show("skill-learned", name);
          }
        }
      }
      prevLearnedTechniqueIds.clear();
      for (const t of techniques) {
        const id = String((t as any).techniqueId ?? (t as any).id ?? (t as any).name ?? "");
        if (id) prevLearnedTechniqueIds.add(id);
      }
      prevLearnedTechniquesPrimed = true;
      skillsPanel.updateTechniques(techniques);
      return;
    } catch {
      // Try the next candidate base.
    }
  }
}

async function pollEdicts() {
  const wallet = ownWalletAddress;
  if (!wallet) return;
  const now = Date.now();
  if (now - lastEdictsPollTime < EDICTS_POLL_INTERVAL) return;
  lastEdictsPollTime = now;
  try {
    const token = await getAuthToken(wallet);
    if (!token) {
      console.warn("[edicts] load skipped: no auth token");
      return;
    }
    for (const base of CANDIDATE_BASES) {
      try {
        const res = await fetch(toUrl(base, `/agent/edicts/${wallet}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.warn("[edicts] load failed:", base || "same-origin", res.status, text);
          continue;
        }
        const data = await res.json() as { edicts?: Edict[] };
        console.log("[edicts] loaded", data.edicts?.length ?? 0, "rules for", wallet);
        skillsPanel.updateEdicts(data.edicts ?? []);
        return;
      } catch (err) {
        console.warn("[edicts] load error:", base || "same-origin", err);
      }
    }
  } catch (err) {
    console.warn("[edicts] load error:", err);
  }
}

async function saveEdictsToShard(edicts: Edict[]): Promise<{ ok: boolean; error?: string }> {
  const wallet = ownWalletAddress;
  if (!wallet) return { ok: false, error: "No owner wallet selected" };
  let lastError = "Network request failed";
  try {
    const token = await getAuthToken(wallet);
    if (!token) {
      console.warn("[edicts] save skipped: no auth token");
      return { ok: false, error: "No auth token" };
    }
    console.log("[edicts] saving", edicts.length, "rules for", wallet, edicts);
    for (const base of CANDIDATE_BASES) {
      try {
        const res = await fetch(toUrl(base, "/agent/edicts"), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ edicts }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          let errorMessage = text;
          try {
            const json = JSON.parse(text);
            if (json.error) errorMessage = json.error;
          } catch {
            // Not JSON, use raw text
          }
          lastError = errorMessage || `HTTP ${res.status}`;
          console.warn("[edicts] save failed:", base || "same-origin", res.status, text);
          continue;
        }
        console.log("[edicts] save ok");
        // Refresh cached copy from the server so any server-side normalization is reflected.
        lastEdictsPollTime = 0;
        void pollEdicts();
        return { ok: true };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn("[edicts] save error:", base || "same-origin", err);
      }
    }
    return { ok: false, error: lastError };
  } catch (err) {
    console.warn("[edicts] save error:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function kickSkillsPollForActiveTab(force = true) {
  const tab = skillsPanel.getActiveTab();
  if (tab === "professions") {
    if (force) lastProfessionPollTime = 0;
    void pollProfessions();
  } else if (tab === "skills") {
    if (force) lastLearnedTechPollTime = 0;
    void pollLearnedTechniques();
  } else {
    if (force) {
      lastLearnedTechPollTime = 0;
      lastEdictsPollTime = 0;
    }
    void pollLearnedTechniques();
    void pollEdicts();
  }
}

async function pollInbox() {
  // Inbox is keyed under the custodial wallet — that's where the agent's
  // system events, quest notifications, and a2a messages are written.
  if (!ownCustodialWallet) return;
  const now = Date.now();
  if (now - lastInboxPollTime < INBOX_POLL_INTERVAL) return;
  lastInboxPollTime = now;
  await inboxPanel.refresh();
}

async function pollFriends() {
  if (!ownWalletAddress) return;
  const socialWallet = ownCustodialWallet ?? ownWalletAddress;
  playerPanel.setFriendIdentity(ownWalletAddress, socialWallet);
  const now = Date.now();
  if (now - lastFriendsPollTime < FRIENDS_POLL_INTERVAL) return;
  lastFriendsPollTime = now;
  await playerPanel.refreshFriends();
}

// ── Raycaster for entity picking ────────────────────────────────────

const raycaster = new THREE.Raycaster();
const ndcMouse = new THREE.Vector2();

gauntletCursor = new GauntletCursor(
  renderer.domElement,
  camera,
  () => entities.group,
  (hits) => entities.getEntityAt(hits),
);
// Disable cursor raycasting while on landing/character-select screens
gauntletCursor.setEnabled(false);

renderer.domElement.addEventListener("click", (e) => {
  if (isDisplayMode) return;
  if (landing?.isActive()) return;
  if (isAnimationLab) return;
  ndcMouse.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndcMouse, camera);

  // Click entity — show inspector, attack hostiles, lock camera on non-hostiles
  const entityHits = raycaster.intersectObjects(entities.group.children, true);
  const entity = entities.getEntityAt(entityHits);
  if (entity) {
    playSoundEffect("ui_button_click");
    inspector.show(entity, e.clientX, e.clientY);
    // Hostile click — attack and keep camera on own character
    if ((entity.type === "mob" || entity.type === "boss") && ownWalletAddress && ownEntityId) {
      if (!lockedEntityId) {
        autoLockEnabled = true;
        lockOn(ownEntityId);
      }
      const ownEntity = entities.getEntity(ownEntityId);
      const zoneId = ownEntity?.zoneId;
      if (zoneId) {
        void (async () => {
          const token = await getAuthToken(ownWalletAddress!);
          if (!token) return;
          const result = await postCommand(token, {
            zoneId,
            entityId: ownEntityId!,
            action: "attack",
            targetId: entity.id,
          });
          if (!result.ok) {
            console.log("[click-attack] Failed:", result.error);
          } else {
            console.log(`[click-attack] Attacking ${entity.name}`);
          }
        })();
      }
    } else {
      // Non-hostile NPC — open dialog without locking camera
      if (NpcDialog.isNpcType(entity.type) && ownEntityId) {
        trackXRNpcDialogOpened(entity.type, entity.name);
        npcDialog.open(entity);
      } else if (GATHER_NODE_TYPES.has(entity.type)) {
        // Resource node — let the inspector's "gather" button drive the agent.
        // Do NOT auto-lock the camera; the user just wants to interact with it.
      } else {
        // Other non-hostile entity — lock camera to it
        lockOn(entity.id);
      }
    }
    return;
  }

  inspector.hide();

  // Ground click — if we own a character, move to that position
  if (ownWalletAddress && ownEntityId) {
    const groundHit = controls.getGroundHit(e.clientX, e.clientY);
    if (groundHit) {
      // Convert 3D coords → server coords
      const serverX = Math.round(groundHit.x / COORD_SCALE);
      const serverY = Math.round(groundHit.z / COORD_SCALE);

      // Look up zoneId from the entity data
      const ownEntity = entities.getEntity(ownEntityId);
      const zoneId = ownEntity?.zoneId;
      if (!zoneId) {
        console.log("[click-move] No zoneId for own entity");
        return;
      }

      // Show destination marker
      clickMarker.show(groundHit.x, groundHit.z);
      clickMarker.targetServerX = serverX;
      clickMarker.targetServerY = serverY;

      // Auto-lock camera to own character when moving
      if (!lockedEntityId) {
        autoLockEnabled = true;
        lockOn(ownEntityId);
      }

      // Send move command
      void (async () => {
        const token = await getAuthToken(ownWalletAddress!);
        if (!token) {
          console.log("[click-move] No auth token");
          clickMarker.hide();
          return;
        }
        const result = await postCommand(token, {
          zoneId,
          entityId: ownEntityId!,
          action: "move",
          x: serverX,
          y: serverY,
        });
        if (!result.ok) {
          console.log("[click-move] Command failed:", result.error);
          clickMarker.hide();
        } else {
          console.log(`[click-move] Moving to (${serverX}, ${serverY})`);
        }
      })();
      return;
    }
  }

  // No character — just unlock camera
  unlockCamera();
});

// ── Resize ──────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  toonPipeline.setSize(window.innerWidth, window.innerHeight);
});

let gameSessionStartMs = 0;

window.addEventListener("pagehide", () => {
  if (gameSessionStartMs) trackXRSessionDuration(Date.now() - gameSessionStartMs, ownWalletAddress);
  queueLogoutOnExit("pagehide");
});

window.addEventListener("beforeunload", () => {
  if (gameSessionStartMs) trackXRSessionDuration(Date.now() - gameSessionStartMs, ownWalletAddress);
  queueLogoutOnExit("beforeunload");
  bgm.dispose();
});

// ── VR button ───────────────────────────────────────────────────────

const vrButton = document.getElementById("vr-button") as HTMLButtonElement;

if (navigator.xr) {
  navigator.xr.isSessionSupported("immersive-vr").then((supported) => {
    if (supported) {
      vrButton.style.display = "block";
      vrButton.addEventListener("click", async () => {
        if (xrSession.isPresenting) {
          await xrSession.exitVR();
          vrButton.textContent = "Enter VR";
          return;
        }

        let vrStartTime = 0;
        await xrSession.enterVR({
          onStart: async () => {
            vrStartTime = Date.now();
            trackXRVRSessionStarted();
            vrButton.textContent = "Exit VR";
            const { XRControllers } = await import("./xr/XRControllers.js");
            xrControllers = new XRControllers(
              renderer, scene,
              world.group.children as THREE.Object3D[],
              xrSession.cameraRig
            );
            xrControllers.onTeleport = (pos) => {
              xrSession.cameraRig.position.set(pos.x, 0, pos.z);
            };
            xrControllers.onSelect = (_ctrl, hits) => {
              const ent = entities.getEntityAt(hits);
              if (ent) {
                console.log("VR select:", ent.name, ent.type);
              }
            };
          },
          onEnd: () => {
            trackXRVRSessionEnded(vrStartTime ? Date.now() - vrStartTime : 0);
            vrButton.textContent = "Enter VR";
            xrControllers?.dispose();
            xrControllers = null;
            xrSession.cameraRig.position.set(0, 0, 0);
            xrSession.cameraRig.rotation.set(0, 0, 0);
          },
        });
      });
    }
  });
}

// ── Zone navigation bar ─────────────────────────────────────────────



// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (isDisplayMode) return;
  if (landing?.isActive()) return;
  if (charSelect?.isActive()) return;
  // Don't intercept keys while typing in any input/textarea (e.g. Add Friends search)
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;
  // Don't intercept keys while typing in agent chat or NPC dialog
  if (agentChat.isFocused()) return;
  if (npcDialog.isOpen()) {
    // NpcDialog handles its own Escape internally
    return;
  }
  if (e.key === "Escape") {
    if (worldMap.isOpen()) {
      worldMap.close();
      return;
    }
    autoLockEnabled = false;
    manualUnlockUntilMs = Date.now() + 5_000;
    unlockCamera();
    inspector.hide();
    hudLock.textContent = "FREE CAMERA";
    hudLock.style.display = "block";
    setTimeout(() => {
      if (!lockedEntityId) hudLock.style.display = "none";
    }, 1200);
    return;
  }
  if (e.key === "Enter" || e.key === "t" || e.key === "T") {
    e.preventDefault();
    openPanel("chat");
    return;
  }
  if (e.key === "v" || e.key === "V") {
    intentLines.cycleVisibilityMode();
  }
  if (e.key === "q" || e.key === "Q") {
    togglePanel("quests");
  }
  if (e.key === "b" || e.key === "B") {
    togglePanel("bag");
  }
  if (e.key === "p" || e.key === "P") {
    togglePanel("skills");
  }
  if (e.key === "e" || e.key === "E") {
    if (ownEntityId) {
      const ent = entities.getEntity(ownEntityId);
      if (ent) inspector.show(ent, window.innerWidth / 2, window.innerHeight / 2);
    }
  }
  if (e.key === "u" || e.key === "U") {
    togglePanel("players");
  }
  if (e.key === "f" || e.key === "F") {
    openPanel("players");
    lastFriendsPollTime = 0;
    playerPanel.showFriends();
    refreshActionBarActiveStates();
    void pollFriends();
  }
  if (e.key === "i" || e.key === "I") {
    togglePanel("inbox");
  }
  if (e.key === "m" || e.key === "M") {
    e.preventDefault();
    if (xrSession.isPresenting) return;
    worldMap.toggle();
  }
  if (e.key === " ") {
    e.preventDefault();
    autoLockEnabled = !autoLockEnabled;
    if (autoLockEnabled && ownEntityId) {
      lockOn(ownEntityId);
      const pos = entities.getEntityPosition(ownEntityId);
      if (pos) controls.setTarget(pos.x, pos.y, pos.z);
      hudLock.textContent = `🔒 AUTO-LOCK ON`;
      hudLock.style.display = "block";
      console.log("[lock] Auto-lock ON — spacebar to toggle");
    } else {
      unlockCamera();
      hudLock.textContent = `🔓 FREE CAMERA`;
      hudLock.style.display = "block";
      setTimeout(() => { if (!lockedEntityId) hudLock.style.display = "none"; }, 1500);
      console.log("[lock] Auto-lock OFF — free camera");
    }
  }
});

// ── Game loop ───────────────────────────────────────────────────────

const clock = new THREE.Clock();
let frameCount = 0;
let fpsTimer = 0;

function animate() {
  const dt = clock.getDelta();
  frameCount++;
  fpsTimer += dt;
  if (fpsTimer >= 1) {
    hudFps.textContent = String(frameCount);
    frameCount = 0;
    fpsTimer = 0;
  }

  if (isAnimationLab) {
    animationLab?.update(dt);
    toonPipeline.render();
    return;
  }

  if (xrSession.isPresenting) {
    xrControllers?.update();
  } else {
    // Follow own character
    if (lockedEntityId) {
      const pos = entities.getEntityPosition(lockedEntityId);
      if (pos) {
        controls.setTarget(pos.x, pos.y, pos.z);
      }
    }
    controls.update(dt);
  }

  // Update zone loading based on camera position
  const target = controls.getTarget();
  world.updateLoading(target.x, target.z);

  entities.update(dt, camera);
  effects.update(dt);
  intentLines.update(dt);
  sky.tick(dt, camera.position);
  world.updateAnimations(dt, scene.fog instanceof THREE.FogExp2 ? scene.fog.color : undefined);
  syncWeaponsToTuner();

  // Click-to-move marker
  clickMarker.update(dt);
  if (ownEntityId) {
    const ownEnt = entities.getEntity(ownEntityId);
    if (ownEnt) clickMarker.checkArrival(ownEnt.x, ownEnt.y);
  }

  // Post-processing doesn't work with WebXR — use plain render in VR
  if (xrSession.isPresenting) {
    renderer.render(scene, camera);
  } else {
    toonPipeline.render();
  }
}

// ── Start ───────────────────────────────────────────────────────────

async function init() {
  if (isAnimationLab) {
    console.log("WoG XR Animation Lab starting...");
    hudEntities.style.display = "none";
    hudFps.style.display = "none";
    hudLock.style.display = "none";
    vrButton.style.display = "none";
    document.getElementById("player-panel")?.style.setProperty("display", "none");
    document.getElementById("panel-toggle")?.style.setProperty("display", "none");
    document.getElementById("agent-chat")?.style.setProperty("display", "none");
    document.getElementById("minimap")?.style.setProperty("display", "none");
    document.getElementById("world-map")?.style.setProperty("display", "none");
    document.getElementById("intent-tooltip")?.style.setProperty("display", "none");
    document.getElementById("intent-mode-badge")?.style.setProperty("display", "none");
    renderer.setAnimationLoop(animate);
    return;
  }

  console.log("WoG XR Client starting (unified world)...");
  if (isDisplayMode) {
    console.log("[display] Watch-only mode enabled", displayFollowTarget || "(no follow target)");
  }

  // Load world layout + pick initial zone in parallel
  const [layout, initialZone] = await Promise.all([
    fetchWorldLayout(),
    pickInitialZone(),
  ]);

  if (!layout) {
    throw new Error("Failed to load world layout");
  }

  world.setLayout(layout);
  worldMap.setLayout(layout);
  landing?.setFeaturedZone(initialZone);

  // Center camera at the initial zone
  const center = world.getZoneCenter(initialZone);
  if (center) {
    controls.setTarget(center.x, 0, center.z);
  }

  // Trigger initial terrain loading + first poll
  world.updateLoading(
    controls.getTarget().x,
    controls.getTarget().z
  );
  await pollNearbyZones();
  await pollActivePlayers();
  landing?.setReady(true);

  // Poll loop — cadence comes from QualityManager and can change live
  let zonePollTimer = window.setInterval(pollNearbyZones, ZONE_POLL_INTERVAL);
  let playersPollTimer = window.setInterval(pollActivePlayers, ACTIVE_PLAYERS_POLL_INTERVAL);

  QualityManager.subscribe((_tier, cfg) => {
    ZONE_POLL_INTERVAL = cfg.pollNearbyMs;
    ACTIVE_PLAYERS_POLL_INTERVAL = cfg.pollPlayersMs;
    clearInterval(zonePollTimer);
    clearInterval(playersPollTimer);
    zonePollTimer = window.setInterval(pollNearbyZones, ZONE_POLL_INTERVAL);
    playersPollTimer = window.setInterval(pollActivePlayers, ACTIVE_PLAYERS_POLL_INTERVAL);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.dprCap));
    toonPipeline.setRenderScale(cfg.renderScale, cfg.normalScale);
    toonPipeline.setOutlineThickness(cfg.outlineThickness);
  });

  // Display mode: resolve the followed wallet → liveEntity → camera + lock.
  // Retries every 3s until a live entity is found (character may not be
  // spawned yet, or the follow wallet may arrive late via localStorage).
  if (isDisplayMode && !followEntityId) {
    const tryResolve = async () => {
      if (!followWalletAddress) return;
      if (ownEntityId) return;
      ownWalletAddress = followWalletAddress;
      await findOwnCharacter();
    };
    void tryResolve();
    setInterval(() => { void tryResolve(); }, 3000);
  }

  // Render loop
  renderer.setAnimationLoop(animate);
}

init().catch((err) => {
  console.error("Init failed:", err);
  document.body.style.background = "#200";
  document.body.innerHTML = `<pre style="color:#f88;padding:20px;font:14px monospace">${err}\n${err?.stack ?? ""}</pre>`;
});
