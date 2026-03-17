import * as THREE from "three";
import type { GameTime } from "../types.js";

/**
 * Day/night sky + directional lighting + fog color sync.
 * Uses a cubemap skybox for the daytime sky and tints it per time-of-day.
 */
export class SkyRenderer {
  readonly ambientLight: THREE.AmbientLight;
  readonly sunLight: THREE.DirectionalLight;

  private skyColors = {
    dawn:  new THREE.Color(0xffaa66),
    day:   new THREE.Color(0x87ceeb),
    dusk:  new THREE.Color(0xff6644),
    night: new THREE.Color(0x0a0a20),
  };

  private ambientLevels = { dawn: 1.2, day: 1.5, dusk: 1.0, night: 0.7 };
  private sunLevels = { dawn: 1.2, day: 1.8, dusk: 1.0, night: 0.5 };

  private cubeTexture: THREE.CubeTexture | null = null;

  constructor(private scene: THREE.Scene) {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(this.ambientLight);

    scene.add(new THREE.HemisphereLight(0x87ceeb, 0x556644, 0.6));

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sunLight.position.set(50, 80, 30);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 200;
    const d = 60;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    scene.add(this.sunLight);

    // Load skybox immediately — use color fallback until it's ready
    scene.background = this.skyColors.day.clone();
    this.loadSkybox();
  }

  private loadSkybox() {
    const loader = new THREE.CubeTextureLoader();
    const base = new URL("skybox/", new URL(import.meta.env.BASE_URL, window.location.href)).href;
    loader.setPath(base);
    loader.load(
      ["px.png", "nx.png", "py.png", "ny.png", "pz.png", "nz.png"],
      (texture) => {
        console.log("Skybox loaded successfully");
        this.cubeTexture = texture;
        this.scene.background = texture;
      },
      undefined,
      (err) => {
        console.warn("Skybox failed to load, falling back to color:", err);
      }
    );
  }

  update(gameTime: GameTime | undefined) {
    if (!gameTime) return;

    const phase = gameTime.phase;
    const targetSky = this.skyColors[phase] ?? this.skyColors.day;

    // Sync fog color to sky tint
    const fogTarget = targetSky.clone();
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.lerp(fogTarget, 0.02);
    }

    // Ambient + sun intensity
    const targetAmbient = this.ambientLevels[phase] ?? 0.6;
    const targetSun = this.sunLevels[phase] ?? 0.8;
    this.ambientLight.intensity += (targetAmbient - this.ambientLight.intensity) * 0.02;
    this.sunLight.intensity += (targetSun - this.sunLight.intensity) * 0.02;

    // Sun color warm at dawn/dusk
    if (phase === "dawn" || phase === "dusk") {
      this.sunLight.color.lerp(new THREE.Color(0xffcc88), 0.02);
    } else {
      this.sunLight.color.lerp(new THREE.Color(0xffffff), 0.02);
    }

    // Rotate sun based on hour — clamp above horizon
    const angle = ((gameTime.hour + gameTime.minute / 60) / 24) * Math.PI * 2 - Math.PI / 2;
    this.sunLight.position.set(
      Math.cos(angle) * 60,
      Math.max(10, Math.sin(angle) * 60 + 20),
      30
    );

    // Always keep skybox as background if loaded — lighting handles mood
    if (this.cubeTexture) {
      if (this.scene.background !== this.cubeTexture) {
        this.scene.background = this.cubeTexture;
      }
    } else {
      // No skybox loaded yet — use color fallback
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.lerp(targetSky, 0.02);
      }
    }
  }
}
