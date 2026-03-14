import * as THREE from "three";

/**
 * Manages WebXR immersive-vr session lifecycle.
 * Handles entering/exiting VR mode and provides the XR camera rig.
 */
export class XRSessionManager {
  readonly cameraRig = new THREE.Group();
  private session: XRSession | null = null;
  private onSessionStart?: () => void;
  private onSessionEnd?: () => void;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private desktopCamera: THREE.PerspectiveCamera
  ) {
    this.cameraRig.name = "xr-camera-rig";
    scene.add(this.cameraRig);

    // Listen for session end
    renderer.xr.addEventListener("sessionend", () => {
      this.session = null;
      this.onSessionEnd?.();
    });
  }

  get isPresenting(): boolean {
    return this.renderer.xr.isPresenting;
  }

  get xrCamera(): THREE.Camera {
    return this.renderer.xr.getCamera();
  }

  /** Position the VR rig in world space */
  setRigPosition(x: number, y: number, z: number) {
    this.cameraRig.position.set(x, y, z);
  }

  /** Enter immersive VR */
  async enterVR(callbacks?: { onStart?: () => void; onEnd?: () => void }) {
    if (!navigator.xr) {
      console.warn("WebXR not available");
      return;
    }

    this.onSessionStart = callbacks?.onStart;
    this.onSessionEnd = callbacks?.onEnd;

    const supported = await navigator.xr.isSessionSupported("immersive-vr");
    if (!supported) {
      console.warn("immersive-vr not supported");
      return;
    }

    const session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
    });

    this.session = session;
    this.renderer.xr.enabled = true;
    await this.renderer.xr.setSession(session);

    // Position rig at current desktop camera target
    this.cameraRig.position.copy(this.desktopCamera.position);
    this.cameraRig.position.y = 0; // floor level

    this.onSessionStart?.();
  }

  /** Exit VR */
  async exitVR() {
    if (this.session) {
      await this.session.end();
      this.session = null;
      this.renderer.xr.enabled = false;
    }
  }
}
