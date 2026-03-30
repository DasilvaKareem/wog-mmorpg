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
import { ToonPipeline } from "./scene/ToonPipeline.js";
import { DesktopControls } from "./input/DesktopControls.js";
import { XRSessionManager } from "./xr/XRSessionManager.js";
// XRControllers imported dynamically to avoid crashing non-XR browsers
type XRControllersType = import("./xr/XRControllers.js").XRControllers;
import { EntityInspector } from "./hud/EntityInspector.js";
import { IntentModeBadge } from "./hud/IntentModeBadge.js";
import { IntentTooltip } from "./hud/IntentTooltip.js";
import { Minimap } from "./hud/Minimap.js";
import { ChatLog } from "./hud/ChatLog.js";
import { PlayerPanel } from "./hud/PlayerPanel.js";
import { getEquipmentTuner } from "./hud/EquipmentTuner.js";
import { AnimationLabPanel } from "./hud/AnimationLabPanel.js";
import { fetchActivePlayers, fetchZone, fetchZoneList, fetchWorldLayout } from "./api.js";
import { AnimationLab } from "./scene/AnimationLab.js";
import type { ActivePlayer, Entity, VisibleIntent, ZoneResponse } from "./types.js";

const isAnimationLab = new URLSearchParams(window.location.search).get("animlab") === "1";

// Equipment tuner — hidden by default, press P to toggle
const equipTuner = getEquipmentTuner();

// ── Config ──────────────────────────────────────────────────────────

const ZONE_POLL_INTERVAL = 500;
const ACTIVE_PLAYERS_POLL_INTERVAL = 1000;
const COORD_SCALE = 1 / 10; // server coords → 3D units
/** Poll zones whose center is within this distance (3D units) of the camera */
const POLL_RADIUS = 90;

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
const chatLog = new ChatLog();
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

// ── State ───────────────────────────────────────────────────────────

let lockedEntityId: string | null = null;
let pendingTrackedPlayerId: string | null = null;
let pendingTrackedPlayerName: string | null = null;
let isPollingNearbyZones = false;
let isPollingActivePlayers = false;

// ── Lock-on mode ────────────────────────────────────────────────────

function lockOn(entityId: string) {
  const ent = entities.getEntity(entityId);
  if (!ent) return;
  lockedEntityId = entityId;
  pendingTrackedPlayerId = null;
  pendingTrackedPlayerName = null;
  intentLines.setFocusEntity(entityId);
  hudLock.textContent = `LOCKED: ${ent.name}`;
  hudLock.style.display = "block";
  inspector.setLocked(true);
}

function unlockCamera() {
  lockedEntityId = null;
  pendingTrackedPlayerId = null;
  pendingTrackedPlayerName = null;
  intentLines.setFocusEntity(null);
  hudLock.style.display = "none";
  inspector.setLocked(false);
}

function trackPlayer(player: ActivePlayer) {
  const pos = entities.getEntityPosition(player.id);
  if (pos) {
    lockOn(player.id);
    controls.setTarget(pos.x, pos.y, pos.z);
    return;
  }

  pendingTrackedPlayerId = player.id;
  pendingTrackedPlayerName = player.name;
  hudLock.textContent = `TRACKING: ${player.name}`;
  hudLock.style.display = "block";
  inspector.setLocked(true);
  controls.setTarget(player.x * COORD_SCALE, 0, player.y * COORD_SCALE);
}

// ── Player panel (leaderboard + zone lobby) ─────────────────────────

const playerPanel = new PlayerPanel({
  onPlayerClick: (player) => {
    trackPlayer(player);
  },
  onZoneClick: (zoneId) => {
    const center = world.getZoneCenter(zoneId);
    if (center) controls.setTarget(center.x, 0, center.z);
  },
});

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

    entities.sync(merged);
    intentLines.sync(merged, Array.from(mergedIntents.values()));
    intentTooltip.setText(intentLines.getPrimaryIntentLabel());

    // HUD
    hudEntities.textContent = String(totalEntities);

    if (gameTime) {
      minimap.setGameTime(gameTime);
    }

    sky.update(gameTime);

    if (allEvents.length > 0) {
      chatLog.addEvents(allEvents);
      effects.processEvents(allEvents);
      entities.processEvents(allEvents);
    }

    effects.syncActiveEffects(merged);

    if (pendingTrackedPlayerId && merged[pendingTrackedPlayerId]) {
      const entityId = pendingTrackedPlayerId;
      pendingTrackedPlayerId = null;
      pendingTrackedPlayerName = null;
      lockOn(entityId);
    }

    // Update lock indicator
    if (lockedEntityId) {
      if (merged[lockedEntityId]) {
        hudLock.textContent = `LOCKED: ${merged[lockedEntityId].name}`;
      } else {
        unlockCamera();
      }
    } else if (pendingTrackedPlayerId) {
      hudLock.textContent = `TRACKING: ${pendingTrackedPlayerName ?? "Player"}`;
      hudLock.style.display = "block";
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
  } finally {
    isPollingActivePlayers = false;
  }
}

// ── Raycaster for entity picking ────────────────────────────────────

const raycaster = new THREE.Raycaster();
const ndcMouse = new THREE.Vector2();

renderer.domElement.addEventListener("click", (e) => {
  if (isAnimationLab) return;
  ndcMouse.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndcMouse, camera);

  // Check entities first
  const entityHits = raycaster.intersectObjects(entities.group.children, true);
  const entity = entities.getEntityAt(entityHits);
  if (entity) {
    inspector.show(entity, e.clientX, e.clientY);
    lockOn(entity.id);
    return;
  }

  // Ground click — unlock camera
  unlockCamera();
  const groundHit = controls.getGroundHit(e.clientX, e.clientY);
  if (groundHit) {
    const sx = Math.round(groundHit.x / COORD_SCALE);
    const sz = Math.round(groundHit.z / COORD_SCALE);
    console.log(`Ground → server (${sx}, ${sz})`);
    inspector.hide();
  }
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
                lockOn(ent.id);
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



// Keyboard: Escape = unlock camera
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    unlockCamera();
    inspector.hide();
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
    // Follow locked entity
    if (lockedEntityId) {
      const pos = entities.getEntityPosition(lockedEntityId);
      if (pos) {
        controls.setTarget(pos.x, pos.y, pos.z);
      } else {
        unlockCamera();
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
  chatLog.update();

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
    document.getElementById("chat-log")?.style.setProperty("display", "none");
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
