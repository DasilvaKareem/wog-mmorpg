import * as THREE from "three";

/**
 * Third-person orbit camera for desktop mode (orbit + zoom around target).
 * No dependency on OrbitControls — hand-rolled for simplicity.
 */
export class DesktopControls {
  private yaw = 0;
  private pitch = 0.6; // radians from horizontal
  private distance = 15;
  private target = new THREE.Vector3(0, 0, 0);
  private landingMode = false;
  private inputEnabled = true;
  private autoOrbitSpeed = 0;

  private isDragging = false;
  private dragButton: number | null = null;
  private lastMouse = { x: 0, y: 0 };
  private keys = new Set<string>();

  // Touch state
  private touchStart = { x: 0, y: 0 };
  private touchMoved = false;
  private activeTouchId: number | null = null;
  private pinchStartDist = 0;
  private pinchStartDistance = 0;
  private static readonly TAP_THRESHOLD_PX = 10;

  /** Previous target position for movement-direction tracking */
  private prevTarget = new THREE.Vector3(0, 0, 0);
  /** Whether the user is manually controlling the camera yaw (suppresses auto-follow) */
  private userControlledYaw = false;
  private userYawTimer = 0;

  /** Optional collision check — return false to block movement */
  collisionCheck: ((x: number, z: number) => boolean) | null = null;

  // Ground plane for click-to-move raycasting
  readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(
    private camera: THREE.PerspectiveCamera,
    private domElement: HTMLElement
  ) {
    domElement.addEventListener("mousedown", this.onMouseDown);
    domElement.addEventListener("mousemove", this.onMouseMove);
    domElement.addEventListener("mouseup", this.onMouseUp);
    domElement.addEventListener("wheel", this.onWheel, { passive: false });
    domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    domElement.addEventListener("touchstart", this.onTouchStart, { passive: false });
    domElement.addEventListener("touchmove", this.onTouchMove, { passive: false });
    domElement.addEventListener("touchend", this.onTouchEnd, { passive: false });
    domElement.addEventListener("touchcancel", this.onTouchEnd, { passive: false });
    // iOS Safari fires proprietary gesture events for pinch; we handle pinch via touch events.
    domElement.addEventListener("gesturestart", this.onGesture, { passive: false });
    domElement.addEventListener("gesturechange", this.onGesture, { passive: false });
    domElement.addEventListener("gestureend", this.onGesture, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    this.updateCamera();
  }

  /** Set orbit target (usually player position) */
  setTarget(x: number, y: number, z: number) {
    this.target.set(x, y, z);
  }

  /** Get current orbit target position */
  getTarget(): THREE.Vector3 {
    return this.target;
  }

  setLandingMode(enabled: boolean) {
    this.landingMode = enabled;
    this.autoOrbitSpeed = enabled ? 0.1 : 0;
    this.isDragging = false;
    this.dragButton = null;
    this.keys.clear();
  }

  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) {
      this.isDragging = false;
      this.dragButton = null;
      this.activeTouchId = null;
      this.pinchStartDist = 0;
      this.touchMoved = false;
      this.keys.clear();
    }
  }

  /** When true, WASD is disabled (camera follows a locked entity) */
  locked = false;

  /** Per-frame update: WASD movement when unlocked, orbit-only when locked */
  update(dt: number) {
    if (!this.landingMode && !this.locked) {
      const speed = 20 * dt;
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);

      let moveX = 0;
      let moveZ = 0;

      if (this.keys.has("w") || this.keys.has("arrowup")) { moveX += forward.x * speed; moveZ += forward.z * speed; }
      if (this.keys.has("s") || this.keys.has("arrowdown")) { moveX -= forward.x * speed; moveZ -= forward.z * speed; }
      if (this.keys.has("a") || this.keys.has("arrowleft")) { moveX -= right.x * speed; moveZ -= right.z * speed; }
      if (this.keys.has("d") || this.keys.has("arrowright")) { moveX += right.x * speed; moveZ += right.z * speed; }

      if (moveX !== 0 || moveZ !== 0) {
        if (this.collisionCheck) {
          const canX = this.collisionCheck(this.target.x + moveX, this.target.z);
          const canZ = this.collisionCheck(this.target.x, this.target.z + moveZ);
          if (canX) this.target.x += moveX;
          if (canZ) this.target.z += moveZ;
        } else {
          this.target.x += moveX;
          this.target.z += moveZ;
        }
      }
    }

    if (this.landingMode && !this.isDragging) {
      this.yaw += this.autoOrbitSpeed * dt;
    }

    // MMO-style auto-follow: rotate camera behind the character when locked and moving
    if (this.locked && !this.isDragging) {
      if (this.userControlledYaw) {
        this.userYawTimer -= dt;
        if (this.userYawTimer <= 0) this.userControlledYaw = false;
      }

      const dx = this.target.x - this.prevTarget.x;
      const dz = this.target.z - this.prevTarget.z;
      const moveDist = Math.sqrt(dx * dx + dz * dz);

      // Only adjust if character moved a meaningful amount
      if (moveDist > 0.01 && !this.userControlledYaw) {
        // Camera orbits FROM this angle — offset by PI to sit behind the character
        const targetYaw = Math.atan2(dx, dz) + Math.PI;

        // Smooth lerp towards target yaw, handling angle wrapping
        let delta = targetYaw - this.yaw;
        // Normalize to [-PI, PI]
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;

        const lerpSpeed = 2.0 * dt; // smooth follow
        this.yaw += delta * Math.min(lerpSpeed, 1);
      }
    }
    this.prevTarget.copy(this.target);

    this.updateCamera();
  }

  /** Get a ray from the camera through a screen point */
  getRay(screenX: number, screenY: number): THREE.Ray {
    const ndc = new THREE.Vector2(
      (screenX / this.domElement.clientWidth) * 2 - 1,
      -(screenY / this.domElement.clientHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster.ray;
  }

  /** Get world position where a screen click hits the ground plane */
  getGroundHit(screenX: number, screenY: number): THREE.Vector3 | null {
    const ray = this.getRay(screenX, screenY);
    const hit = new THREE.Vector3();
    if (ray.intersectPlane(this.groundPlane, hit)) return hit;
    return null;
  }

  private updateCamera() {
    const x = this.target.x + this.distance * Math.sin(this.yaw) * Math.cos(this.pitch);
    const y = this.target.y + this.distance * Math.sin(this.pitch);
    const z = this.target.z + this.distance * Math.cos(this.yaw) * Math.cos(this.pitch);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  // ── Event handlers ──

  private onMouseDown = (e: MouseEvent) => {
    if (!this.inputEnabled) return;
    if (this.landingMode) return;
    if (e.button === 2) {
      this.isDragging = true;
      this.dragButton = e.button;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.inputEnabled) return;
    if (!this.isDragging) return;
    const dx = e.clientX - this.lastMouse.x;
    const dy = e.clientY - this.lastMouse.y;
    this.lastMouse = { x: e.clientX, y: e.clientY };

    this.yaw -= dx * 0.005;
    this.pitch = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, this.pitch + dy * 0.005));
    // Suppress auto-follow briefly after manual camera rotation
    this.userControlledYaw = true;
    this.userYawTimer = 1.5; // seconds before auto-follow resumes
    this.updateCamera();
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.inputEnabled) return;
    if (e.button === this.dragButton) {
      this.isDragging = false;
      this.dragButton = null;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.inputEnabled) return;
    if (this.landingMode) return;
    e.preventDefault();
    this.distance = Math.max(5, Math.min(50, this.distance + e.deltaY * 0.02));
    this.updateCamera();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.inputEnabled) return;
    if (this.landingMode) return;
    
    // Don't intercept movement keys if an input is focused (e.g. typing a character name)
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;

    this.keys.add(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.inputEnabled) return;
    if (this.landingMode) return;

    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;

    this.keys.delete(e.key.toLowerCase());
  };

  // ── Touch handlers (mobile orbit + pinch-zoom; tap passes through as click) ──

  private onTouchStart = (e: TouchEvent) => {
    if (!this.inputEnabled) return;
    if (this.landingMode) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.activeTouchId = t.identifier;
      this.touchStart = { x: t.clientX, y: t.clientY };
      this.lastMouse = { x: t.clientX, y: t.clientY };
      this.touchMoved = false;
      this.isDragging = false;
    } else if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      this.pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      this.pinchStartDistance = this.distance;
      this.isDragging = false;
      this.activeTouchId = null;
      // Mark as "moved" so iOS Safari doesn't fire a synthesized click on pinch-release.
      this.touchMoved = true;
      e.preventDefault();
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    if (!this.inputEnabled) return;
    if (this.landingMode) return;

    if (e.touches.length === 2 && this.pinchStartDist > 0) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = this.pinchStartDist / Math.max(1, d);
      this.distance = Math.max(5, Math.min(50, this.pinchStartDistance * ratio));
      this.updateCamera();
      e.preventDefault();
      return;
    }

    if (e.touches.length !== 1 || this.activeTouchId === null) return;
    const t = Array.from(e.touches).find((tt) => tt.identifier === this.activeTouchId);
    if (!t) return;

    const totalDx = t.clientX - this.touchStart.x;
    const totalDy = t.clientY - this.touchStart.y;
    if (!this.touchMoved && Math.hypot(totalDx, totalDy) > DesktopControls.TAP_THRESHOLD_PX) {
      this.touchMoved = true;
      this.isDragging = true;
    }
    if (!this.isDragging) return;

    const dx = t.clientX - this.lastMouse.x;
    const dy = t.clientY - this.lastMouse.y;
    this.lastMouse = { x: t.clientX, y: t.clientY };

    this.yaw -= dx * 0.005;
    this.pitch = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, this.pitch + dy * 0.005));
    this.userControlledYaw = true;
    this.userYawTimer = 1.5;
    this.updateCamera();
    e.preventDefault();
  };

  private onGesture = (e: Event) => {
    if (!this.inputEnabled) return;
    e.preventDefault();
  };

  private onTouchEnd = (e: TouchEvent) => {
    if (!this.inputEnabled) return;
    if (this.touchMoved) {
      // Suppress the synthesized click after a drag-orbit.
      e.preventDefault();
    }
    if (e.touches.length < 2) this.pinchStartDist = 0;
    if (e.touches.length === 0) {
      this.activeTouchId = null;
      this.isDragging = false;
      this.touchMoved = false;
    }
  };

  dispose() {
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    this.domElement.removeEventListener("mousemove", this.onMouseMove);
    this.domElement.removeEventListener("mouseup", this.onMouseUp);
    this.domElement.removeEventListener("touchstart", this.onTouchStart);
    this.domElement.removeEventListener("touchmove", this.onTouchMove);
    this.domElement.removeEventListener("touchend", this.onTouchEnd);
    this.domElement.removeEventListener("touchcancel", this.onTouchEnd);
    this.domElement.removeEventListener("gesturestart", this.onGesture);
    this.domElement.removeEventListener("gesturechange", this.onGesture);
    this.domElement.removeEventListener("gestureend", this.onGesture);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
