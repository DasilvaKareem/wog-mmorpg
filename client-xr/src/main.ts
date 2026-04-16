// Global error display so we can see what breaks on prod
window.onerror = (msg, src, line, col, err) => {
  const el = document.createElement("pre");
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
import { IntentModeBadge } from "./hud/IntentModeBadge.js";
import { IntentTooltip } from "./hud/IntentTooltip.js";
import { Minimap } from "./hud/Minimap.js";
import { AgentChat } from "./hud/AgentChat.js";
import { LandingPage } from "./hud/LandingPage.js";
import { CharacterSelect } from "./hud/CharacterSelect.js";
import type { CharacterReadyDetail } from "./hud/CharacterSelect.js";
import { PlayerPanel } from "./hud/PlayerPanel.js";
import { QuestPanel } from "./hud/QuestPanel.js";
import { NpcDialog } from "./hud/NpcDialog.js";
import { RunPanel } from "./hud/RunPanel.js";
import { BagPanel } from "./hud/BagPanel.js";
import { SkillsPanel } from "./hud/SkillsPanel.js";
import { ActionBar } from "./hud/ActionBar.js";
import { VitalsPanel } from "./hud/VitalsPanel.js";
import { getEquipmentTuner } from "./hud/EquipmentTuner.js";
import { AnimationLabPanel } from "./hud/AnimationLabPanel.js";
import { fetchActivePlayers, fetchZone, fetchZoneList, fetchWorldLayout, postCommand, fetchQuestLog, fetchZoneQuests, acceptQuest, talkToNpc, completeQuest, fetchInventory, fetchProfessionStatus, sendFriendRequest, sendInboxMessage, logoutCharacter } from "./api.js";
import { getAuthToken, getCachedToken } from "./auth.js";
import { ClickMarker } from "./scene/ClickMarker.js";
import { AnimationLab } from "./scene/AnimationLab.js";
import { GauntletCursor } from "./hud/GauntletCursor.js";
import type { ActivePlayer, Entity, QuestLogResponse, VisibleIntent, ZoneResponse } from "./types.js";

let gauntletCursor: GauntletCursor | null = null;
const isAnimationLab = new URLSearchParams(window.location.search).get("animlab") === "1";
const API_BASE = import.meta.env.VITE_API_URL || "";

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

const ZONE_POLL_INTERVAL = 250;
const ACTIVE_PLAYERS_POLL_INTERVAL = 1000;
const COORD_SCALE = 1 / 10; // server coords → 3D units
/** Poll zones whose center is within this distance (3D units) of the camera */
const POLL_RADIUS = 90;
const EVENT_DEDUPE_RETENTION_MS = 10_000;

// ── Renderer ────────────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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
  outlineThickness: 1.2,
  outlineColor: 0x000000,
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
const runPanel = new RunPanel({
  onToggle: () => {
    void toggleRunMode();
  },
});

const controls = new DesktopControls(camera, renderer.domElement);
controls.collisionCheck = (x, z) => world.isWalkable(x, z);
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
    const result = await sendFriendRequest(token, ownWalletAddress, entity.walletAddress);
    if (!result.ok) throw new Error(result.error ?? "Failed to send friend request");
    return `Friend request sent to ${entity.name}`;
  },
  onTrade: async (entity) => {
    if (!ownWalletAddress || !entity.walletAddress) throw new Error("Trade request unavailable");
    const token = await getAuthToken(ownWalletAddress);
    if (!token) throw new Error("You need to sign in first");
    const ownName = entities.getEntity(ownEntityId ?? "")?.name ?? ownWalletAddress.slice(0, 8);
    const result = await sendInboxMessage(token, {
      to: entity.walletAddress,
      type: "trade-request",
      body: `${ownName} wants to trade with you.`,
      data: {
        kind: "trade-request",
        targetEntityId: entity.id,
        targetName: entity.name,
        fromEntityId: ownEntityId,
      },
    });
    if (!result.ok) throw new Error(result.error ?? "Failed to send trade request");
    return `Trade request sent to ${entity.name}`;
  },
  onDuel: async (entity) => {
    if (!ownWalletAddress || !entity.walletAddress) throw new Error("Duel request unavailable");
    const token = await getAuthToken(ownWalletAddress);
    if (!token) throw new Error("You need to sign in first");
    const ownName = entities.getEntity(ownEntityId ?? "")?.name ?? ownWalletAddress.slice(0, 8);
    const result = await sendInboxMessage(token, {
      to: entity.walletAddress,
      type: "direct",
      body: `${ownName} challenged you to a duel. Meet at the coliseum and queue 1v1.`,
      data: {
        kind: "duel-request",
        challengerEntityId: ownEntityId,
        challengerName: ownName,
        targetEntityId: entity.id,
        targetName: entity.name,
      },
    });
    if (!result.ok) throw new Error(result.error ?? "Failed to send duel request");
    return `Duel challenge sent to ${entity.name}`;
  },
});
const intentModeBadge = new IntentModeBadge();
const intentTooltip = new IntentTooltip();
const minimap = new Minimap();
const agentChat = new AgentChat();
const charSelect = !isAnimationLab
  ? new CharacterSelect({
    charAssets: world.getCharacterAssets(),
    onCharacterReady: (detail: CharacterReadyDetail) => {
      charSelect!.hide();
      ownWalletAddress = detail.walletAddress.toLowerCase();
      ownEntityId = detail.entityId || null;
      desiredRunMode = null;
      runPanel.reset();
      agentChat.setWallet(ownWalletAddress);
      agentChat.setEntityId(detail.entityId || null);
      questPanel.setPlayer(ownWalletAddress, true);
      controls.setLandingMode(false);
      setGameplayHudVisible(true);
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
      desiredRunMode = null;
      runPanel.reset();
      landing!.show();
    },
  })
  : null;

const landing = !isAnimationLab
  ? new LandingPage({
    onEnterWorld: ({ walletAddress }) => {
      if (walletAddress) {
        ownWalletAddress = walletAddress.toLowerCase();
        void charSelect!.show(ownWalletAddress);
      } else {
        // Guest mode — skip character select, enter as spectator
        desiredRunMode = null;
        runPanel.reset();
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
  gauntletCursor?.setEnabled(visible);
  const ids = [
    "hud",
    "lock-indicator",
    "controls-help",
    "vr-button",
    "player-panel",
    "panel-toggle",
    "agent-chat",
    "run-panel",
    "minimap",
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
let ownEntityId: string | null = null;
let desiredRunMode: boolean | null = null;
let autoLockEnabled = false;
let isPollingNearbyZones = false;
let isPollingActivePlayers = false;
let lastQuestPollTime = 0;
let questLogData: QuestLogResponse | null = null;
let logoutInFlight = false;
const QUEST_POLL_INTERVAL = 5_000;
const processedRecentEventIds = new Map<string, number>();
const DEFAULT_RUN_ENERGY = 100;

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

function updateRunPanelFromEntity(entity: Entity | null | undefined) {
  if (!ownWalletAddress || !ownEntityId || !entity || entity.id !== ownEntityId) {
    runPanel.update({
      available: false,
      enabled: false,
      running: false,
      energy: 0,
      maxEnergy: DEFAULT_RUN_ENERGY,
    });
    return;
  }

  if (desiredRunMode != null && entity.runModeEnabled === desiredRunMode) {
    desiredRunMode = null;
  }

  runPanel.update({
    available: true,
    enabled: desiredRunMode ?? entity.runModeEnabled ?? false,
    running: entity.isRunning ?? false,
    energy: entity.runEnergy ?? entity.maxRunEnergy ?? DEFAULT_RUN_ENERGY,
    maxEnergy: entity.maxRunEnergy ?? DEFAULT_RUN_ENERGY,
  });
}

async function toggleRunMode() {
  if (!ownWalletAddress || !ownEntityId) return;

  const ownEntity = entities.getEntity(ownEntityId);
  const zoneId = ownEntity?.zoneId;
  if (!ownEntity || !zoneId) return;

  const nextEnabled = !(desiredRunMode ?? ownEntity.runModeEnabled ?? false);
  desiredRunMode = nextEnabled;
  updateRunPanelFromEntity({
    ...ownEntity,
    runModeEnabled: nextEnabled,
  });

  const token = await getAuthToken(ownWalletAddress);
  if (!token) {
    desiredRunMode = null;
    updateRunPanelFromEntity(ownEntity);
    return;
  }

  const result = await postCommand(token, {
    zoneId,
    entityId: ownEntityId,
    action: "set-run",
    runEnabled: nextEnabled,
  });

  if (!result.ok) {
    console.log("[run] Toggle failed:", result.error);
    desiredRunMode = null;
    updateRunPanelFromEntity(entities.getEntity(ownEntityId));
  }
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
  if (pos) {
    lockOn(me.id);
    controls.setTarget(pos.x, pos.y, pos.z);
  }
}

/**
 * Full sequence: call /agent/status to get entityId + zoneId,
 * move camera to their zone, poll that zone, then lock on.
 */
async function findOwnCharacter() {
  if (!ownWalletAddress) return;

  const token = await getAuthToken(ownWalletAddress);
  if (!token) {
    console.log("[autolock] No auth token");
    return;
  }

  // 1. Get entity ID + zone from agent status endpoint
  try {
    const res = await fetch(`${API_BASE}/agent/status/${ownWalletAddress}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.log("[autolock] agent/status failed:", res.status);
      return;
    }
    const status = await res.json();
    if (!status.entityId || !status.zoneId) {
      console.log("[autolock] No character deployed. entityId:", status.entityId, "zoneId:", status.zoneId);
      return;
    }

    console.log("[autolock] Found entity:", status.entityId, "zone:", status.zoneId, "name:", status.entity?.name);
    ownEntityId = status.entityId;
    agentChat.setEntityId(status.entityId);
    hudLock.textContent = `FINDING: ${status.entity?.name ?? "character"}`;
    hudLock.style.display = "block";

    // 2. Move camera to their zone
    const zoneCenter = world.getZoneCenter(status.zoneId);
    if (zoneCenter) {
      controls.setTarget(zoneCenter.x, 0, zoneCenter.z);
      world.updateLoading(zoneCenter.x, zoneCenter.z);
    }

    // 3. Poll that zone to load the entity
    await pollNearbyZones();

    // 4. Move camera to entity but only lock if autoLockEnabled
    const pos = entities.getEntityPosition(status.entityId);
    if (pos) {
      controls.setTarget(pos.x, pos.y, pos.z);
      if (autoLockEnabled) {
        lockOn(status.entityId);
        console.log("[autolock] Locked to", status.entity?.name);
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
});

const questPanel = new QuestPanel({
  onAcceptQuest: async (questId, npcEntityId, npcName) => {
    if (!ownWalletAddress || !ownEntityId) return;
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return;
    const ownEntity = entities.getEntity(ownEntityId);
    const zoneId = ownEntity?.zoneId;
    if (!zoneId) return;

    // Try direct accept first (works if player is within 100 units of NPC)
    const result = await acceptQuest(token, ownEntityId, questId);
    if (result.ok) {
      console.log(`[quest] Accepted quest ${questId} from ${npcName}`);
      lastQuestPollTime = 0;
      void pollQuests();
      return;
    }

    // If too far, send the agent to walk there
    if (result.error?.includes("Too far")) {
      try {
        const res = await fetch(`${API_BASE}/agent/goto-npc`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ entityId: npcEntityId, zoneId, name: npcName, action: "accept-quest", questId }),
        });
        if (res.ok) {
          console.log(`[quest] Agent heading to ${npcName} to accept quest ${questId}`);
          lastQuestPollTime = 0;
          void pollQuests();
        } else {
          console.log("[quest] goto-npc failed:", res.status, await res.text());
        }
      } catch (err) {
        console.log("[quest] goto-npc error:", err);
      }
    } else {
      console.log("[quest] Accept failed:", result.error);
    }
  },
  onCompleteQuest: async (questId, npcEntityId, questTitle, questDesc, objectiveType) => {
    if (!ownWalletAddress || !ownEntityId) return;
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return;
    const ownEntity = entities.getEntity(ownEntityId);
    const zoneId = ownEntity?.zoneId;
    if (!zoneId) return;

    // Try direct complete first
    const result = await completeQuest(token, ownEntityId, questId, npcEntityId);
    if (result.ok) {
      console.log(`[quest] Completed quest ${questId}`);
      lastQuestPollTime = 0;
      void pollQuests();
      return;
    }

    // If too far, send the agent to walk there
    if (result.error?.includes("Too far")) {
      try {
        const res = await fetch(`${API_BASE}/agent/goto-npc`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ entityId: npcEntityId, zoneId, action: "complete-quest", questId }),
        });
        if (res.ok) {
          console.log(`[quest] Agent heading to NPC to turn in quest ${questId}`);
          lastQuestPollTime = 0;
          void pollQuests();
        } else {
          console.log("[quest] goto-npc failed:", res.status, await res.text());
        }
      } catch (err) {
        console.log("[quest] goto-npc error:", err);
      }
    } else {
      console.log("[quest] Complete failed:", result.error);
    }
  },
  onTalkToNpc: async (npcEntityId, npcName, questTitle, questDesc, objectiveType) => {
    if (!ownWalletAddress || !ownEntityId) return;
    const token = await getAuthToken(ownWalletAddress);
    if (!token) return;
    const ownEntity = entities.getEntity(ownEntityId);
    const zoneId = ownEntity?.zoneId;
    if (!zoneId) return;

    // Try direct talk first (if already near the NPC)
    const result = await talkToNpc(token, ownEntityId, npcEntityId);
    if (result.ok) {
      console.log(`[quest] Talk quest completed with ${npcName}`);
      lastQuestPollTime = 0;
      void pollQuests();
      return;
    }

    // If too far, send the agent to walk there and auto-complete on arrival
    if (result.error?.includes("Too far")) {
      try {
        const res = await fetch(`${API_BASE}/agent/goto-npc`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ entityId: npcEntityId, zoneId, name: npcName, action: "talk-quest" }),
        });
        if (res.ok) {
          console.log(`[quest] Agent heading to ${npcName || "NPC"} for talk quest`);
          lastQuestPollTime = 0;
          void pollQuests();
        } else {
          console.log("[quest] goto-npc failed:", res.status, await res.text());
        }
      } catch (err) {
        console.log("[quest] goto-npc error:", err);
      }
    } else {
      console.log("[quest] Talk failed:", result.error);
    }
  },
  onOpenAvailable: () => {
    void refreshAvailableQuestsNow();
  },
});

const bagPanel = new BagPanel();
const skillsPanel = new SkillsPanel();
const vitalsPanel = new VitalsPanel();
let lastInventoryPollTime = 0;
let lastProfessionPollTime = 0;
const INVENTORY_POLL_INTERVAL = 10_000;
const PROFESSION_POLL_INTERVAL = 15_000;

// ── Bottom-right action bar ────────────────────────────────────────
const actionBar = new ActionBar();
actionBar.addButton({ id: "bag", icon: "\u{1F392}", label: "Bag", key: "B", onClick: () => {
  bagPanel.toggle();
  if (bagPanel.isVisible()) { lastInventoryPollTime = 0; void pollInventory(); }
}});
actionBar.addButton({ id: "skills", icon: "\u2692", label: "Skills", key: "P", onClick: () => {
  skillsPanel.toggle();
  if (skillsPanel.isVisible()) { lastProfessionPollTime = 0; void pollProfessions(); }
}});
actionBar.addButton({ id: "quests", icon: "\u{1F4DC}", label: "Quests", key: "Q", onClick: () => {
  questPanel.toggle();
}});
actionBar.addButton({ id: "chat", icon: "\u{1F4AC}", label: "Chat", key: "T", onClick: () => {
  agentChat.toggle();
}});
actionBar.addButton({ id: "players", icon: "\u{1F465}", label: "Players", key: "U", onClick: () => {
  playerPanel.toggle();
}});
actionBar.addButton({ id: "equip", icon: "\u{1F6E1}", label: "Equipment", key: "E", onClick: () => {
  if (ownEntityId) {
    const ent = entities.getEntity(ownEntityId);
    if (ent) inspector.show(ent, window.innerWidth / 2, window.innerHeight / 2);
  }
}});

const npcDialog = new NpcDialog({
  getAuthToken: async () => ownWalletAddress ? getAuthToken(ownWalletAddress) : null,
  getOwnEntityId: () => ownEntityId,
  getOwnWalletAddress: () => ownWalletAddress,
  onShowQuests: () => questPanel.showAvailable(),
});

if (landing) {
  controls.setLandingMode(true);
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

    // Fetch all nearby zones in parallel
    const results = await Promise.all(
      nearbyIds.map((id) => fetchZone(id).then((data) => ({ id, data })))
    );

    // Merge entities from all zones
    const merged: Record<string, Entity> = {};
    let gameTime: ZoneResponse["gameTime"] = undefined;
    let totalEntities = 0;
    const mergedIntents = new Map<string, VisibleIntent>();
    const allEvents: NonNullable<ZoneResponse["recentEvents"]> = [];

    for (const { id, data } of results) {
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
    }

    effects.syncActiveEffects(merged);

    // Auto-lock to own character once it appears in scene (only if enabled)
    if (autoLockEnabled && ownEntityId && !lockedEntityId && merged[ownEntityId]) {
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

    updateRunPanelFromEntity(ownEntityId ? merged[ownEntityId] : null);
    vitalsPanel.update(ownEntityId ? merged[ownEntityId] : null, merged);

    // Minimap — pass camera in server coords
    minimap.update(merged, target.x / COORD_SCALE, target.z / COORD_SCALE);

    // Quest poll piggybacks on zone poll but self-throttles to 5s
    void pollQuests();
    // Inventory poll (only when bag is open)
    if (bagPanel.isVisible()) void pollInventory();
    if (skillsPanel.isVisible()) void pollProfessions();
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
    playerPanel.update(data.players);
    landing?.setOnlineCount(data.count);
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

async function pollInventory() {
  const addr = ownWalletAddress;
  if (!addr) return;
  const now = Date.now();
  if (now - lastInventoryPollTime < INVENTORY_POLL_INTERVAL) return;
  lastInventoryPollTime = now;

  const inv = await fetchInventory(addr);
  if (inv) {
    bagPanel.updateInventory(inv.items);
  }
}

async function pollProfessions() {
  const addr = ownWalletAddress;
  if (!addr) return;
  const now = Date.now();
  if (now - lastProfessionPollTime < PROFESSION_POLL_INTERVAL) return;
  lastProfessionPollTime = now;

  const data = await fetchProfessionStatus(addr);
  if (data) {
    skillsPanel.updateProfessions(data);
  }
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
        npcDialog.open(entity);
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

window.addEventListener("pagehide", () => {
  queueLogoutOnExit("pagehide");
});

window.addEventListener("beforeunload", () => {
  queueLogoutOnExit("beforeunload");
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

        await xrSession.enterVR({
          onStart: async () => {
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
  if (landing?.isActive()) return;
  // Don't intercept keys while typing in agent chat or NPC dialog
  if (agentChat.isFocused()) return;
  if (npcDialog.isOpen()) {
    // NpcDialog handles its own Escape internally
    return;
  }
  if (e.key === "Escape") {
    unlockCamera();
    inspector.hide();
    return;
  }
  if (e.key === "Enter" || e.key === "t" || e.key === "T") {
    e.preventDefault();
    agentChat.expand();
    return;
  }
  if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    void toggleRunMode();
    return;
  }
  if (e.key === "v" || e.key === "V") {
    const mode = intentLines.cycleVisibilityMode();
    intentModeBadge.setMode(mode);
  }
  if (e.key === "q" || e.key === "Q") {
    questPanel.toggle();
  }
  if (e.key === "b" || e.key === "B") {
    bagPanel.toggle();
    if (bagPanel.isVisible()) { lastInventoryPollTime = 0; void pollInventory(); }
  }
  if (e.key === "p" || e.key === "P") {
    skillsPanel.toggle();
    if (skillsPanel.isVisible()) { lastProfessionPollTime = 0; void pollProfessions(); }
  }
  if (e.key === "e" || e.key === "E") {
    if (ownEntityId) {
      const ent = entities.getEntity(ownEntityId);
      if (ent) inspector.show(ent, window.innerWidth / 2, window.innerHeight / 2);
    }
  }
  if (e.key === "u" || e.key === "U") {
    playerPanel.toggle();
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
  world.updateAnimations(dt);
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
    document.getElementById("run-panel")?.style.setProperty("display", "none");
    document.getElementById("minimap")?.style.setProperty("display", "none");
    document.getElementById("intent-tooltip")?.style.setProperty("display", "none");
    document.getElementById("intent-mode-badge")?.style.setProperty("display", "none");
    renderer.setAnimationLoop(animate);
    return;
  }

  console.log("WoG XR Client starting (unified world)...");

  // Load world layout + pick initial zone in parallel
  const [layout, initialZone] = await Promise.all([
    fetchWorldLayout(),
    pickInitialZone(),
  ]);

  if (!layout) {
    throw new Error("Failed to load world layout");
  }

  world.setLayout(layout);
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

  // Poll loop
  setInterval(pollNearbyZones, ZONE_POLL_INTERVAL);
  setInterval(pollActivePlayers, ACTIVE_PLAYERS_POLL_INTERVAL);

  // Render loop
  renderer.setAnimationLoop(animate);
}

init().catch((err) => {
  console.error("Init failed:", err);
  document.body.style.background = "#200";
  document.body.innerHTML = `<pre style="color:#f88;padding:20px;font:14px monospace">${err}\n${err?.stack ?? ""}</pre>`;
});
