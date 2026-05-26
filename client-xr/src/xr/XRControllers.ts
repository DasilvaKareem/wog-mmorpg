import * as THREE from "three";
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";

/**
 * XR controller setup: rays, grips, teleport arc, and pointer events.
 */
export class XRControllers {
  readonly leftController: THREE.Group;
  readonly rightController: THREE.Group;
  readonly leftGrip: THREE.Group;
  readonly rightGrip: THREE.Group;

  // Teleport
  private teleportLine: THREE.Line;
  private teleportMarker: THREE.Mesh;
  private teleportTarget: THREE.Vector3 | null = null;
  private isTeleporting = false;

  // Pointer ray for right controller
  private pointerLine: THREE.Line;

  // Callbacks
  onTeleport?: (position: THREE.Vector3) => void;
  onSelect?: (controller: THREE.Group, intersection: THREE.Intersection[]) => void;

  private raycaster = new THREE.Raycaster();
  private tempMatrix = new THREE.Matrix4();

  private rig: THREE.Object3D;

  // ── Smooth locomotion state ──
  /** Snap-turn debounce so a held right-stick X doesn't spin continuously. */
  private snapTurnCooldown = 0;
  /** Optional terrain-height sampler — when set, rig Y is clamped to ground after
   *  horizontal movement, and teleport lands on the actual terrain elevation.
   *  Vertical fly (right-stick Y) can still lift above it. */
  elevationAt?: (worldX: number, worldZ: number) => number;
  /** Extra rig-height offset above terrain (boots → eyes is handled by HMD pose;
   *  this just keeps feet from clipping when the terrain dips). */
  groundOffset = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private groundObjects: THREE.Object3D[],
    cameraRig?: THREE.Group,
    elevationAt?: (worldX: number, worldZ: number) => number
  ) {
    this.rig = cameraRig ?? scene;
    this.elevationAt = elevationAt;
    const factory = new XRControllerModelFactory();

    // ── Left controller: teleport ──
    this.leftController = renderer.xr.getController(0);
    this.leftGrip = renderer.xr.getControllerGrip(0);
    this.leftGrip.add(factory.createControllerModel(this.leftGrip));
    this.rig.add(this.leftController);
    this.rig.add(this.leftGrip);

    // ── Right controller: select/interact ──
    this.rightController = renderer.xr.getController(1);
    this.rightGrip = renderer.xr.getControllerGrip(1);
    this.rightGrip.add(factory.createControllerModel(this.rightGrip));
    this.rig.add(this.rightController);
    this.rig.add(this.rightGrip);

    // ── Teleport arc (left controller) ──
    const teleportGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    this.teleportLine = new THREE.Line(
      teleportGeo,
      new THREE.LineBasicMaterial({ color: 0x44ff88, linewidth: 2 })
    );
    this.teleportLine.visible = false;
    this.leftController.add(this.teleportLine);

    this.teleportMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.25, 16),
      new THREE.MeshBasicMaterial({ color: 0x44ff88, side: THREE.DoubleSide })
    );
    this.teleportMarker.rotation.x = -Math.PI / 2;
    this.teleportMarker.visible = false;
    scene.add(this.teleportMarker);

    // ── Pointer ray (right controller) ──
    const pointerGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -5),
    ]);
    this.pointerLine = new THREE.Line(
      pointerGeo,
      new THREE.LineBasicMaterial({ color: 0x44ddff, linewidth: 2 })
    );
    this.rightController.add(this.pointerLine);

    // ── Events ──
    // XR controller events aren't in the base Object3DEventMap typings
    const leftAny = this.leftController as any;
    const rightAny = this.rightController as any;

    leftAny.addEventListener("selectstart", () => {
      this.isTeleporting = true;
    });

    leftAny.addEventListener("selectend", () => {
      if (this.teleportTarget && this.isTeleporting) {
        this.onTeleport?.(this.teleportTarget.clone());
      }
      this.isTeleporting = false;
      this.teleportLine.visible = false;
      this.teleportMarker.visible = false;
    });

    rightAny.addEventListener("selectstart", () => {
      const intersections = this.raycastFrom(this.rightController);
      this.onSelect?.(this.rightController, intersections);
    });
  }

  /** Per-frame update: compute teleport arc, pointer ray, and apply thumbstick
   *  locomotion. Pass real dt so movement speed is frame-rate independent. */
  update(dt: number = 1 / 72) {
    // Teleport: cast ray from left controller to ground
    if (this.isTeleporting) {
      const intersections = this.raycastFrom(this.leftController, this.groundObjects);
      if (intersections.length > 0) {
        const hit = intersections[0].point;
        this.teleportTarget = hit;
        this.teleportMarker.position.copy(hit);
        this.teleportMarker.position.y += 0.01;
        this.teleportMarker.visible = true;

        // Update teleport line to point at target
        const positions = this.teleportLine.geometry.attributes.position;
        if (positions) {
          const local = this.leftController.worldToLocal(hit.clone());
          (positions as THREE.BufferAttribute).setXYZ(1, local.x, local.y, local.z);
          positions.needsUpdate = true;
        }
        this.teleportLine.visible = true;
      } else {
        this.teleportTarget = null;
        this.teleportMarker.visible = false;
        this.teleportLine.visible = false;
      }
    }

    this.applyThumbstickLocomotion(dt);
  }

  /** Read Quest 2 thumbsticks via WebXR xr-standard gamepad mapping and move
   *  the camera rig. Left stick = smooth horizontal locomotion in HMD-facing
   *  direction. Right stick Y = fly up/down. Right stick X = 30° snap turn.
   *  Floor-snaps Y to terrain when not actively flying. */
  private applyThumbstickLocomotion(dt: number) {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    const DEADZONE = 0.15;
    let strafe = 0, fwd = 0, vert = 0, turn = 0;
    for (const src of session.inputSources) {
      const gp = (src as any).gamepad as Gamepad | undefined;
      // xr-standard maps thumbstick to axes[2] (X) and axes[3] (Y).
      if (!gp?.axes || gp.axes.length < 4) continue;
      const ax = gp.axes[2] ?? 0;
      const ay = gp.axes[3] ?? 0;
      const x = Math.abs(ax) < DEADZONE ? 0 : ax;
      const y = Math.abs(ay) < DEADZONE ? 0 : ay;
      if (src.handedness === "left") {
        strafe = x;
        fwd = y;            // pushing forward = -y on Quest; we flip below
      } else if (src.handedness === "right") {
        vert = -y;          // push up = -y → ascend
        turn = x;
      }
    }

    // ── Snap turn (right stick X) ──
    this.snapTurnCooldown = Math.max(0, this.snapTurnCooldown - dt);
    if (Math.abs(turn) > 0.6 && this.snapTurnCooldown <= 0) {
      const step = Math.PI / 6; // 30°
      this.rig.rotation.y += turn > 0 ? -step : step;
      this.snapTurnCooldown = 0.32;
    }

    // ── Translate ──
    if (strafe === 0 && fwd === 0 && vert === 0) return;
    const MOVE_SPEED = 3.5;  // m/s horizontal
    const FLY_SPEED  = 2.8;  // m/s vertical

    // Direction = headset forward projected to XZ. The XR camera is parented
    // under the rig, so its world transform already includes rig rotation.
    const cam = this.renderer.xr.getCamera();
    const camDir = new THREE.Vector3();
    cam.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 1e-6) camDir.set(0, 0, -1);
    camDir.normalize();
    // Right-hand strafe vector (rotate camDir 90° CW around +Y).
    const right = new THREE.Vector3(-camDir.z, 0, camDir.x);

    const dh = MOVE_SPEED * dt;
    this.rig.position.x += (camDir.x * -fwd + right.x * strafe) * dh;
    this.rig.position.z += (camDir.z * -fwd + right.z * strafe) * dh;
    this.rig.position.y += vert * FLY_SPEED * dt;

    // Floor snap: when not actively flying up, never let the rig sink below
    // terrain. Flying still works because pressing the right stick lifts y
    // above ground; releasing it keeps current altitude (no gravity yet).
    if (this.elevationAt) {
      const groundY = this.elevationAt(this.rig.position.x, this.rig.position.z) + this.groundOffset;
      if (vert <= 0 && this.rig.position.y < groundY) {
        this.rig.position.y = groundY;
      }
    }
  }

  private raycastFrom(
    controller: THREE.Group,
    targets?: THREE.Object3D[]
  ): THREE.Intersection[] {
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);
    return this.raycaster.intersectObjects(targets ?? this.scene.children, true);
  }

  dispose() {
    this.rig.remove(this.leftController);
    this.rig.remove(this.rightController);
    this.rig.remove(this.leftGrip);
    this.rig.remove(this.rightGrip);
    this.scene.remove(this.teleportMarker);
  }
}
