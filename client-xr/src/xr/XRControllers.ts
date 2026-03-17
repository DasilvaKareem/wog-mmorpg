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

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private groundObjects: THREE.Object3D[],
    cameraRig?: THREE.Group
  ) {
    this.rig = cameraRig ?? scene;
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

  /** Per-frame update: compute teleport arc, pointer ray */
  update() {
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
