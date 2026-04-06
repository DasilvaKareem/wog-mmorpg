// Global error display so we can see what breaks on prod
window.onerror = (msg, src, line, col, err) => {
  const el = document.createElement("pre");
  el.style.cssText = "position:fixed;top:0;left:0;right:0;background:#200;color:#f88;padding:12px;font:12px monospace;z-index:9999;white-space:pre-wrap";
  el.textContent = `${msg}\n${src}:${line}:${col}\n${err?.stack ?? ""}`;
  document.body.appendChild(el);
};

import * as THREE from "three";
import { WorldManager } from "./scene/WorldManager.js";
import { EntityManager } from "./scene/EntityManager.js";
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
import { PlayerPanel } from "./hud/PlayerPanel.js";
import { getEquipmentTuner } from "./hud/EquipmentTuner.js";
import { AnimationLabPanel } from "./hud/AnimationLabPanel.js";
import { fetchActivePlayers, fetchZone, fetchZoneList, fetchWorldLayout } from "./api.js";
import { getAuthToken } from "./auth.js";
import { AnimationLab } from "./scene/AnimationLab.js";
import type { ActivePlayer, Entity, VisibleIntent, ZoneResponse } from "./types.js";

const isAnimationLab = new URLSearchParams(window.location.search).get("animlab") === "1";
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "https://wog.urbantech.dev" : "");

// Equipment tuner — hidden by default, press P to toggle
const equipTuner = getEquipmentTuner();

// ── Config ──────────────────────────────────────────────────────────

const ZONE_POLL_INTERVAL = 500;
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
scene.add(entities.group);

const effects = new EffectsManager(entities);
effects.setElevationProvider(world);
effects.setCamera(camera);
scene.add(effects.group);

const intentLines = new IntentLinesManager(entities);
scene.add(intentLines.group);

const sky = new SkyRenderer(scene);
const controls = new DesktopControls(camera, renderer.domElement);
controls.collisionCheck = (x, z) => world.isWalkable(x, z);
const inspector = new EntityInspector();
const intentModeBadge = new IntentModeBadge();
const intentTooltip = new IntentTooltip();
const minimap = new Minimap();
const agentChat = new AgentChat();
const landing = !isAnimationLab
  ? new LandingPage({
    onEnterWorld: ({ walletAddress }) => {
      ownWalletAddress = walletAddress?.toLowerCase() ?? null;
      agentChat.setWallet(ownWalletAddress);
      controls.setLandingMode(false);
      setGameplayHudVisible(true);
      console.log("[enter] Wallet:", ownWalletAddress);
      // Immediately try to find and lock to own character
      if (ownWalletAddress) {
        void findAndLockOwnCharacter();
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
  const ids = [
    "hud",
    "lock-indicator",
    "controls-help",
    "vr-button",
    "player-panel",
    "panel-toggle",
    "agent-chat",
    "minimap",
    "intent-tooltip",
    "intent-mode-badge",
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
let isPollingNearbyZones = false;
let isPollingActivePlayers = false;
const processedRecentEventIds = new Map<string, number>();

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
async function findAndLockOwnCharacter() {
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

    // 4. Lock on now that the entity should be in scene
    const pos = entities.getEntityPosition(status.entityId);
    if (pos) {
      lockOn(status.entityId);
      controls.setTarget(pos.x, pos.y, pos.z);
      console.log("[autolock] Locked to", status.entity?.name);
    } else {
      console.log("[autolock] Entity not in scene yet, poll loop will retry");
    }
  } catch (err) {
    console.log("[autolock] Error:", err);
  }
}

// ── Player panel (leaderboard + zone lobby) ─────────────────────────

const playerPanel = new PlayerPanel({
  onPlayerClick: (_player) => {
    // No-op — camera stays locked on own character
  },
  onZoneClick: (_zoneId) => {
    // No-op — camera stays locked on own character
  },
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
    entities.sync(merged, visibleIntents);
    intentLines.sync(merged, visibleIntents);
    intentTooltip.setText(intentLines.getPrimaryIntentLabel());

    // HUD
    hudEntities.textContent = String(totalEntities);

    if (gameTime) {
      minimap.setGameTime(gameTime);
    }

    sky.update(gameTime);

    const newEvents = filterNewZoneEvents(allEvents);
    if (newEvents.length > 0) {
      agentChat.addEvents(newEvents);
      effects.processEvents(newEvents);
      entities.processEvents(newEvents);
    }

    effects.syncActiveEffects(merged);

    // Auto-lock to own character once it appears in scene
    if (ownEntityId && !lockedEntityId && merged[ownEntityId]) {
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

    // Minimap — pass camera in server coords
    minimap.update(merged, target.x / COORD_SCALE, target.z / COORD_SCALE);
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

// ── Raycaster for entity picking ────────────────────────────────────

const raycaster = new THREE.Raycaster();
const ndcMouse = new THREE.Vector2();

renderer.domElement.addEventListener("click", (e) => {
  if (landing?.isActive()) return;
  if (isAnimationLab) return;
  ndcMouse.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndcMouse, camera);

  // Click entity — show inspector and lock camera to it
  const entityHits = raycaster.intersectObjects(entities.group.children, true);
  const entity = entities.getEntityAt(entityHits);
  if (entity) {
    inspector.show(entity, e.clientX, e.clientY);
    lockOn(entity.id);
    return;
  }

  // Ground click — unlock camera
  unlockCamera();
  inspector.hide();
});

// ── Resize ──────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  toonPipeline.setSize(window.innerWidth, window.innerHeight);
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
  // Don't intercept keys while typing in agent chat
  if (agentChat.isFocused()) return;
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
  if (e.key === "v" || e.key === "V") {
    const mode = intentLines.cycleVisibilityMode();
    intentModeBadge.setMode(mode);
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
  // agentChat is event-driven, no per-frame update needed

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
