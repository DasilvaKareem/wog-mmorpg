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
    night: new THREE.Color(0x3a3a5a),
  };

  private ambientLevels = { dawn: 1.2, day: 1.5, dusk: 1.1, night: 1.1 };
  private sunLevels = { dawn: 1.2, day: 1.8, dusk: 1.0, night: 0.9 };

  // Cloud tint per phase (RGB) and overall opacity. Night = darker + sparser.
  private cloudTints = {
    dawn:  new THREE.Color(1.0, 0.85, 0.72),
    day:   new THREE.Color(1.0, 0.98, 0.95),
    dusk:  new THREE.Color(1.0, 0.74, 0.58),
    night: new THREE.Color(0.45, 0.48, 0.58),
  };
  private cloudOpacity = { dawn: 0.85, day: 0.9, dusk: 0.85, night: 0.55 };

  // Per-phase star visibility — only really pop at night.
  private starLevels = { dawn: 0.05, day: 0.0, dusk: 0.1, night: 1.0 };

  private cubeTexture: THREE.CubeTexture | null = null;
  private clouds: THREE.Mesh;
  private cloudUniforms: { uTime: { value: number }; uTint: { value: THREE.Color }; uOpacity: { value: number } };
  private stars: THREE.Mesh;
  private starUniforms: { uTime: { value: number }; uNight: { value: number } };

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

    // Inner cloud sphere — drifts shader-noise clouds over the cubemap.
    // Radius 180 fits inside camera.far=200. fog:false bypasses scene FogExp2.
    this.cloudUniforms = {
      uTime: { value: 0 },
      uTint: { value: this.cloudTints.day.clone() },
      uOpacity: { value: this.cloudOpacity.day },
    };
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.BackSide,
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(wp.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3  uTint;
        uniform float uOpacity;
        varying vec3 vWorldDir;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          // Discard below horizon — no clouds underground.
          if (dir.y < -0.02) discard;

          // Project sky direction to a plane "above" the player.
          vec2 uv = dir.xz / max(dir.y + 0.25, 0.15);
          vec2 drift = vec2(uTime * 0.012, uTime * 0.004);

          float n  = noise(uv * 1.6 + drift);
          n += noise(uv * 3.2 + drift * 1.7) * 0.5;
          n += noise(uv * 6.4 + drift * 2.3) * 0.25;
          n /= 1.75;

          // Light coverage — only the high-density peaks become cloud.
          float cloud = smoothstep(0.58, 0.82, n);

          // Fade clouds near the horizon for a softer skyline.
          float horizonFade = smoothstep(0.0, 0.25, dir.y);

          float alpha = cloud * horizonFade * uOpacity;
          if (alpha < 0.01) discard;

          gl_FragColor = vec4(uTint, alpha);
        }
      `,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 24), cloudMat);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -1;
    scene.add(this.clouds);

    // Starfield sphere — additive, slightly larger so it sits behind clouds.
    this.starUniforms = {
      uTime: { value: 0 },
      uNight: { value: 0 },
    };
    const starMat = new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(wp.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uNight;
        varying vec3 vWorldDir;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          if (uNight <= 0.001) discard;
          vec3 dir = normalize(vWorldDir);
          if (dir.y < 0.02) discard;

          // Project onto plane and grid-hash for star seeds.
          vec2 uv = dir.xz / max(dir.y + 0.35, 0.12);
          vec2 cell = floor(uv * 220.0);
          float seed = hash(cell);

          // Only the top ~0.4% of cells hold stars.
          float star = step(0.996, seed);

          // Per-star twinkle: phase offset by seed, gentle pulse.
          float twinkle = 0.55 + 0.45 * sin(uTime * 3.0 + seed * 30.0);

          // Fade in near zenith, fade out near horizon and during day.
          float heightFade = smoothstep(0.05, 0.55, dir.y);

          float a = star * twinkle * heightFade * uNight;
          if (a < 0.01) discard;

          gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * a, a);
        }
      `,
    });
    this.stars = new THREE.Mesh(new THREE.SphereGeometry(190, 32, 24), starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -2;
    scene.add(this.stars);
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

  /** Per-frame: drift the cloud noise and keep the spheres around the camera. */
  tick(dt: number, cameraPosition: THREE.Vector3) {
    this.cloudUniforms.uTime.value += dt;
    this.starUniforms.uTime.value += dt;
    this.clouds.position.copy(cameraPosition);
    this.stars.position.copy(cameraPosition);
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

    // Cloud tint + opacity ease toward phase targets
    const cloudTarget = this.cloudTints[phase] ?? this.cloudTints.day;
    const opacityTarget = this.cloudOpacity[phase] ?? this.cloudOpacity.day;
    this.cloudUniforms.uTint.value.lerp(cloudTarget, 0.02);
    this.cloudUniforms.uOpacity.value += (opacityTarget - this.cloudUniforms.uOpacity.value) * 0.02;

    // Star visibility eases in at night, out by day
    const starTarget = this.starLevels[phase] ?? 0;
    this.starUniforms.uNight.value += (starTarget - this.starUniforms.uNight.value) * 0.02;

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
