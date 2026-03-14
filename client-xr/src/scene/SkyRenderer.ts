import * as THREE from "three";
import type { GameTime } from "../types.js";

/**
 * Day/night sky + directional lighting + fog color sync.
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

  private ambientLevels = { dawn: 0.5, day: 0.8, dusk: 0.4, night: 0.15 };
  private sunLevels = { dawn: 0.6, day: 1.0, dusk: 0.5, night: 0.05 };

  constructor(private scene: THREE.Scene) {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
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

    scene.background = this.skyColors.day.clone();
  }

  update(gameTime: GameTime | undefined) {
    if (!gameTime) return;

    const phase = gameTime.phase;
    const targetSky = this.skyColors[phase] ?? this.skyColors.day;
    const bg = this.scene.background as THREE.Color;
    bg.lerp(targetSky, 0.02);

    // Sync fog color to sky
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(bg);
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

    // Rotate sun based on hour
    const angle = ((gameTime.hour + gameTime.minute / 60) / 24) * Math.PI * 2 - Math.PI / 2;
    this.sunLight.position.set(
      Math.cos(angle) * 60,
      Math.sin(angle) * 60 + 20,
      30
    );
  }
}
