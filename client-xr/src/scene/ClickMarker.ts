import * as THREE from "three";
import type { ElevationProvider } from "../types.js";

/**
 * A pulsing ring that appears on the ground where the player clicked to move.
 * Fades out automatically when the character arrives or after a timeout.
 */
export class ClickMarker {
  readonly mesh: THREE.Mesh;
  private age = 0;
  private active = false;
  private elevation: ElevationProvider | null = null;

  /** Server-coordinate destination (for arrival check) */
  targetServerX = 0;
  targetServerY = 0;

  constructor() {
    const geo = new THREE.RingGeometry(0.3, 0.5, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ff88,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 999;
  }

  setElevationProvider(ep: ElevationProvider) {
    this.elevation = ep;
  }

  /** Place the marker at a 3D world position */
  show(x: number, z: number) {
    const y = this.elevation ? this.elevation.getElevationAt(x, z) + 0.05 : 0.05;
    this.mesh.position.set(x, y, z);
    this.mesh.visible = true;
    this.active = true;
    this.age = 0;
  }

  hide() {
    this.mesh.visible = false;
    this.active = false;
  }

  update(dt: number) {
    if (!this.active) return;
    this.age += dt;

    // Timeout after 8 seconds
    if (this.age > 8) {
      this.hide();
      return;
    }

    // Pulse scale
    const pulse = 1 + 0.15 * Math.sin(this.age * 6);
    this.mesh.scale.setScalar(pulse);

    // Fade out over last 2 seconds
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    if (this.age > 6) {
      mat.opacity = 0.8 * (1 - (this.age - 6) / 2);
    } else {
      mat.opacity = 0.8;
    }
  }

  /** Check if entity has arrived close to the target (server coords) */
  checkArrival(entityServerX: number, entityServerY: number, threshold = 15) {
    if (!this.active) return;
    const dx = entityServerX - this.targetServerX;
    const dy = entityServerY - this.targetServerY;
    if (dx * dx + dy * dy < threshold * threshold) {
      this.hide();
    }
  }
}
