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
import { SkyRenderer } from "./scene/SkyRenderer.js";
import { ToonPipeline } from "./scene/ToonPipeline.js";
import { DesktopControls } from "./input/DesktopControls.js";
import { XRSessionManager } from "./xr/XRSessionManager.js";
// XRControllers imported dynamically to avoid crashing non-XR browsers
type XRControllersType = import("./xr/XRControllers.js").XRControllers;
import { EntityInspector } from "./hud/EntityInspector.js";
import { Minimap } from "./hud/Minimap.js";
import { ChatLog } from "./hud/ChatLog.js";
import { PlayerPanel } from "./hud/PlayerPanel.js";
import { getEquipmentTuner } from "./hud/EquipmentTuner.js";
import { fetchZone, fetchZoneList, fetchWorldLayout } from "./api.js";
import type { Entity, ZoneResponse } from "./types.js";

// Equipment tuner — hidden by default, press P to toggle
const equipTuner = getEquipmentTuner();
equipTuner.setOnChange((slot, pos, rot) => {
  entities.applyEquipmentTuning(slot, pos, rot);
});

// ── Config ──────────────────────────────────────────────────────────

const POLL_INTERVAL = 1000;
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

const sky = new SkyRenderer(scene);
const controls = new DesktopControls(camera, renderer.domElement);
controls.collisionCheck = (x, z) => world.isWalkable(x, z);
const inspector = new EntityInspector();
const minimap = new Minimap();
const chatLog = new ChatLog();

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

// ── Lock-on mode ────────────────────────────────────────────────────

function lockOn(entityId: string) {
  const ent = entities.getEntity(entityId);
  if (!ent) return;
  lockedEntityId = entityId;
  hudLock.textContent = `LOCKED: ${ent.name}`;
  hudLock.style.display = "block";
  inspector.setLocked(true);
}

function unlockCamera() {
  lockedEntityId = null;
  hudLock.style.display = "none";
  inspector.setLocked(false);
}

// ── Player panel (leaderboard + zone lobby) ─────────────────────────

const playerPanel = new PlayerPanel({
  onPlayerClick: (entityId) => {
    lockOn(entityId);
    // Pan camera to the entity
    const pos = entities.getEntityPosition(entityId);
    if (pos) controls.setTarget(pos.x, pos.y, pos.z);
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
  const allEvents: NonNullable<ZoneResponse["recentEvents"]> = [];

  for (const { id, data } of results) {
    if (!data) continue;
    for (const [eid, ent] of Object.entries(data.entities)) {
      merged[eid] = ent;
    }
    totalEntities += Object.keys(data.entities).length;
    if (data.gameTime) gameTime = data.gameTime;
    if (data.recentEvents) allEvents.push(...data.recentEvents);
  }

  entities.sync(merged);

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

  // Update lock indicator
  if (lockedEntityId) {
    if (merged[lockedEntityId]) {
      hudLock.textContent = `LOCKED: ${merged[lockedEntityId].name}`;
    } else {
      unlockCamera();
    }
  }

  // Player panel
  playerPanel.update(merged);

  // Minimap — pass camera in server coords
  minimap.update(merged, target.x / COORD_SCALE, target.z / COORD_SCALE);
}

// ── Raycaster for entity picking ────────────────────────────────────

const raycaster = new THREE.Raycaster();
const ndcMouse = new THREE.Vector2();

renderer.domElement.addEventListener("click", (e) => {
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
              if (ent) console.log("VR select:", ent.name, ent.type);
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

  // Poll loop
  setInterval(pollNearbyZones, POLL_INTERVAL);

  // Render loop
  renderer.setAnimationLoop(animate);
}

init().catch((err) => {
  console.error("Init failed:", err);
  document.body.style.background = "#200";
  document.body.innerHTML = `<pre style="color:#f88;padding:20px;font:14px monospace">${err}\n${err?.stack ?? ""}</pre>`;
});
