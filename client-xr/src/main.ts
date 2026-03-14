// Global error display so we can see what breaks on prod
window.onerror = (msg, src, line, col, err) => {
  const el = document.createElement("pre");
  el.style.cssText = "position:fixed;top:0;left:0;right:0;background:#200;color:#f88;padding:12px;font:12px monospace;z-index:9999;white-space:pre-wrap";
  el.textContent = `${msg}\n${src}:${line}:${col}\n${err?.stack ?? ""}`;
  document.body.appendChild(el);
};

import * as THREE from "three";
import { TerrainRenderer } from "./scene/TerrainRenderer.js";
import { EntityManager } from "./scene/EntityManager.js";
import { EffectsManager } from "./scene/EffectsManager.js";
import { SkyRenderer } from "./scene/SkyRenderer.js";
import { DesktopControls } from "./input/DesktopControls.js";
import { XRSessionManager } from "./xr/XRSessionManager.js";
// XRControllers imported dynamically to avoid crashing non-XR browsers
type XRControllersType = import("./xr/XRControllers.js").XRControllers;
import { EntityInspector } from "./hud/EntityInspector.js";
import { Minimap } from "./hud/Minimap.js";
import { ChatLog } from "./hud/ChatLog.js";
import { fetchZone, fetchZoneList, fetchTerrain, fetchWorldLayout } from "./api.js";
import type { ZoneResponse, WorldLayout } from "./types.js";

// ── Config ──────────────────────────────────────────────────────────

const POLL_INTERVAL = 1000;
const COORD_SCALE = 1 / 10; // server coords (0-640) → 3D units (0-64)

// ── Renderer ────────────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x88aacc, 0.008);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);

// ── Subsystems ──────────────────────────────────────────────────────

const terrain = new TerrainRenderer();
scene.add(terrain.group);

const entities = new EntityManager();
entities.setTerrain(terrain);
scene.add(entities.group);

const effects = new EffectsManager(entities);
effects.setTerrain(terrain);
effects.setCamera(camera);
scene.add(effects.group);

const sky = new SkyRenderer(scene);
const controls = new DesktopControls(camera, renderer.domElement);
const inspector = new EntityInspector();
const minimap = new Minimap();
const chatLog = new ChatLog();

// XR
const xrSession = new XRSessionManager(renderer, scene, camera);
let xrControllers: XRControllersType | null = null;

// ── HUD elements ────────────────────────────────────────────────────

const hudZone = document.getElementById("hud-zone")!;
const hudEntities = document.getElementById("hud-entities")!;
const hudTime = document.getElementById("hud-time")!;
const hudFps = document.getElementById("hud-fps")!;
const hudLock = document.getElementById("lock-indicator")!;

// ── State ───────────────────────────────────────────────────────────

let currentZoneId = "";
let lastZoneData: ZoneResponse | null = null;
let worldLayout: WorldLayout | null = null;
let lockedEntityId: string | null = null;

// ── Lock-on mode ────────────────────────────────────────────────────

function lockOn(entityId: string) {
  const ent = entities.getEntity(entityId);
  if (!ent) return;
  lockedEntityId = entityId;
  hudLock.textContent = `LOCKED: ${ent.name}`;
  hudLock.style.display = "block";
}

function unlockCamera() {
  lockedEntityId = null;
  hudLock.style.display = "none";
}

// ── Find first zone with most entities ──────────────────────────────

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

// ── Terrain loading ─────────────────────────────────────────────────

async function loadTerrain(zoneId: string) {
  const data = await fetchTerrain(zoneId);
  if (!data) {
    console.warn(`Failed to load terrain for ${zoneId}`);
    return;
  }
  terrain.build(data);
}

// ── Zone polling ────────────────────────────────────────────────────

async function pollZone() {
  if (!currentZoneId) return;

  const data = await fetchZone(currentZoneId);
  if (!data) return;

  lastZoneData = data;
  entities.sync(data.entities);

  // HUD
  hudZone.textContent = data.zoneId;
  hudEntities.textContent = String(Object.keys(data.entities).length);

  if (data.gameTime) {
    const gt = data.gameTime;
    const hh = String(gt.hour).padStart(2, "0");
    const mm = String(gt.minute).padStart(2, "0");
    hudTime.textContent = `${hh}:${mm} (${gt.phase})`;
  }

  sky.update(data.gameTime);

  if (data.recentEvents) {
    chatLog.addEvents(data.recentEvents);
    effects.processEvents(data.recentEvents);
  }

  effects.syncActiveEffects(data.entities);

  // Update lock indicator — unlock if entity left zone
  if (lockedEntityId) {
    if (data.entities[lockedEntityId]) {
      hudLock.textContent = `LOCKED: ${data.entities[lockedEntityId].name}`;
    } else {
      unlockCamera();
    }
  }

  minimap.update(data.entities);
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
              terrain.group.children as THREE.Object3D[]
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
          },
        });
      });
    }
  });
}

// ── Zone switching ──────────────────────────────────────────────────

const ZONE_ORDER = [
  "village-square",
  "wild-meadow",
  "dark-forest",
  "auroral-plains",
  "emerald-woods",
  "viridian-range",
  "moondancer-glade",
  "felsrock-citadel",
  "lake-lumina",
  "azurshard-chasm",
];

function switchZone(zoneId: string) {
  if (zoneId === currentZoneId) return;
  currentZoneId = zoneId;
  terrain.dispose();
  entities.dispose();
  effects.dispose();
  inspector.hide();
  unlockCamera();

  // Apply zone offset so world-space entity coords become zone-local
  const zoneInfo = worldLayout?.zones[zoneId];
  const ox = zoneInfo?.offset.x ?? 0;
  const oz = zoneInfo?.offset.z ?? 0;
  entities.setZoneOffset(ox, oz);
  effects.setZoneOffset(ox, oz);

  // Center camera: zone is 64x64 in 3D units
  controls.setTarget(32, 0, 32);
  updateZoneBar();
  loadTerrain(zoneId);
  pollZone();
}

// Zone bar buttons
const zoneBar = document.getElementById("zone-bar")!;
const zoneButtons: HTMLButtonElement[] = [];

function buildZoneBar() {
  for (let i = 0; i < ZONE_ORDER.length; i++) {
    const btn = document.createElement("button");
    const label = ZONE_ORDER[i].replace(/-/g, " ");
    btn.textContent = `${i + 1}. ${label}`;
    btn.addEventListener("click", () => switchZone(ZONE_ORDER[i]));
    zoneBar.appendChild(btn);
    zoneButtons.push(btn);
  }
}

function updateZoneBar() {
  for (let i = 0; i < ZONE_ORDER.length; i++) {
    zoneButtons[i].classList.toggle("active", ZONE_ORDER[i] === currentZoneId);
  }
}

// Keyboard 1-0 + Escape to unlock
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    unlockCamera();
    inspector.hide();
    return;
  }
  const key = e.key === "0" ? 10 : parseInt(e.key);
  const idx = key - 1;
  if (idx >= 0 && idx < ZONE_ORDER.length) {
    switchZone(ZONE_ORDER[idx]);
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
        // Entity left zone — unlock
        unlockCamera();
      }
    }
    controls.update(dt);
  }

  entities.update(dt, camera);
  effects.update(dt);
  terrain.update(dt);
  chatLog.update();

  renderer.render(scene, camera);
}

// ── Start ───────────────────────────────────────────────────────────

async function init() {
  console.log("WoG XR Client starting...");

  buildZoneBar();

  // Load world layout (zone offsets) + pick initial zone in parallel
  const [layout, initialZone] = await Promise.all([
    fetchWorldLayout(),
    pickInitialZone(),
  ]);
  worldLayout = layout;

  currentZoneId = initialZone;
  console.log(`Viewing zone: ${currentZoneId}`);
  updateZoneBar();

  // Apply zone offset
  const zoneInfo = worldLayout?.zones[currentZoneId];
  entities.setZoneOffset(zoneInfo?.offset.x ?? 0, zoneInfo?.offset.z ?? 0);
  effects.setZoneOffset(zoneInfo?.offset.x ?? 0, zoneInfo?.offset.z ?? 0);

  // Center camera at zone center (64/2 = 32 Three.js units)
  controls.setTarget(32, 0, 32);

  // Load terrain + initial poll in parallel
  await Promise.all([
    loadTerrain(currentZoneId),
    pollZone(),
  ]);

  // Poll loop
  setInterval(pollZone, POLL_INTERVAL);

  // Render loop
  renderer.setAnimationLoop(animate);
}

init().catch((err) => {
  console.error("Init failed:", err);
  document.body.style.background = "#200";
  document.body.innerHTML = `<pre style="color:#f88;padding:20px;font:14px monospace">${err}\n${err?.stack ?? ""}</pre>`;
});
