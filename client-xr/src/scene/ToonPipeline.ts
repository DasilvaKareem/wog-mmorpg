/**
 * Toon/Cel-shading post-processing pipeline.
 * - Generates a gradient map texture for MeshToonMaterial (hard light bands)
 * - Edge detection via depth + normal discontinuity (post-processing outlines)
 * - Distance-based line attenuation to reduce noise on far objects
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

// ── Gradient map (programmatic, no external image) ──────────────────

/**
 * Creates a small DataTexture with hard-stepped brightness bands.
 * 4 tones: shadow → mid-shadow → mid-light → light
 * NearestFilter ensures hard cel-shading transitions.
 */
export function createGradientMap(): THREE.DataTexture {
  const colors = [140, 180, 215, 245]; // luminance steps — high shadow floor for visibility
  const size = colors.length;
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const v = colors[i];
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Shared gradient map instance — reuse across all MeshToonMaterials */
let _gradientMap: THREE.DataTexture | null = null;
export function getGradientMap(): THREE.DataTexture {
  if (!_gradientMap) _gradientMap = createGradientMap();
  return _gradientMap;
}

// ── MeshToonMaterial factory helpers ─────────────────────────────────

/** Drop-in replacement for new MeshLambertMaterial({...}) */
export function toonMat(opts: {
  color?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color: opts.color,
    emissive: opts.emissive,
    emissiveIntensity: opts.emissiveIntensity,
    transparent: opts.transparent,
    opacity: opts.opacity,
    side: opts.side,
    map: opts.map ?? undefined,
    gradientMap: getGradientMap(),
  });
}

// ── Edge detection shader ───────────────────────────────────────────

const EdgeDetectionShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2() },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 500.0 },
    outlineThickness: { value: 1.0 },
    outlineColor: { value: new THREE.Color(0x000000) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tNormal;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float outlineThickness;
    uniform vec3 outlineColor;
    varying vec2 vUv;

    float getLinearDepth(vec2 uv) {
      float z_b = texture2D(tDepth, uv).r;
      float z_n = 2.0 * z_b - 1.0;
      return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z_n * (cameraFar - cameraNear));
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float rawDepth = texture2D(tDepth, vUv).r;

      // Skip sky / background
      if (rawDepth >= 0.9999) {
        gl_FragColor = color;
        return;
      }

      vec2 texel = vec2(1.0 / resolution.x, 1.0 / resolution.y) * outlineThickness;
      float centerDepth = getLinearDepth(vUv);

      // Depth edge detection (Sobel-like)
      float d_t = getLinearDepth(vUv + vec2(0.0, texel.y));
      float d_b = getLinearDepth(vUv + vec2(0.0, -texel.y));
      float d_l = getLinearDepth(vUv + vec2(-texel.x, 0.0));
      float d_r = getLinearDepth(vUv + vec2(texel.x, 0.0));
      float depthEdge = sqrt(pow(d_r - d_l, 2.0) + pow(d_t - d_b, 2.0));
      float depthIndicator = smoothstep(0.5, 0.6, depthEdge);

      // Normal edge detection
      vec3 n_t = texture2D(tNormal, vUv + vec2(0.0, texel.y)).rgb;
      vec3 n_b = texture2D(tNormal, vUv + vec2(0.0, -texel.y)).rgb;
      vec3 n_l = texture2D(tNormal, vUv + vec2(-texel.x, 0.0)).rgb;
      vec3 n_r = texture2D(tNormal, vUv + vec2(texel.x, 0.0)).rgb;
      vec3 nDiffX = n_r - n_l;
      vec3 nDiffY = n_t - n_b;
      float normalEdgeSq = dot(nDiffX, nDiffX) + dot(nDiffY, nDiffY);
      float normalIndicator = smoothstep(0.08, 0.13, normalEdgeSq);

      float edge = max(depthIndicator, normalIndicator);

      if (edge > 0.1) {
        // Distance attenuation — fade outlines on far geometry
        float lineAlpha = clamp(12.0 / (2.0 + centerDepth), 0.0, 1.0);
        gl_FragColor = mix(color, vec4(outlineColor, 1.0), lineAlpha * edge);
      } else {
        gl_FragColor = color;
      }
    }
  `,
};

// ── Composer setup ──────────────────────────────────────────────────

export interface ToonPipelineConfig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  outlineThickness?: number;
  outlineColor?: number;
}

export class ToonPipeline {
  private composer: EffectComposer;
  private normalRT: THREE.WebGLRenderTarget;
  private depthRT: THREE.WebGLRenderTarget;
  private normalMaterial = new THREE.MeshNormalMaterial();
  private edgePass: ShaderPass;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  constructor(config: ToonPipelineConfig) {
    const { renderer, scene, camera } = config;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const pr = renderer.getPixelRatio();
    const w = window.innerWidth * pr;
    const h = window.innerHeight * pr;

    // Normal + depth in one render target (depth texture attached)
    this.normalRT = new THREE.WebGLRenderTarget(w, h);
    this.normalRT.texture.minFilter = THREE.NearestFilter;
    this.normalRT.texture.magFilter = THREE.NearestFilter;
    this.normalRT.depthTexture = new THREE.DepthTexture(w, h);
    this.normalRT.depthTexture.type = THREE.UnsignedShortType;

    // Alias for clarity — same RT
    this.depthRT = this.normalRT;

    // Composer
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // Edge detection pass
    this.edgePass = new ShaderPass(EdgeDetectionShader);
    this.edgePass.uniforms.resolution.value.set(w, h);
    this.edgePass.uniforms.tNormal.value = this.normalRT.texture;
    this.edgePass.uniforms.tDepth.value = this.normalRT.depthTexture;
    this.edgePass.uniforms.outlineThickness.value = config.outlineThickness ?? 1.2;
    this.edgePass.uniforms.outlineColor.value.setHex(config.outlineColor ?? 0x000000);
    this.edgePass.uniforms.cameraNear.value = camera.near;
    this.edgePass.uniforms.cameraFar.value = camera.far;
    this.composer.addPass(this.edgePass);
  }

  /** Call instead of renderer.render(scene, camera) */
  render() {
    // 1. Render normals + depth in one pass (depth texture auto-filled)
    this.scene.overrideMaterial = this.normalMaterial;
    this.renderer.setRenderTarget(this.normalRT);
    this.renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;

    // 2. Composite with edge detection (RenderPass does the color render)
    this.renderer.setRenderTarget(null);
    this.composer.render();
  }

  /** Must call on window resize */
  setSize(w: number, h: number) {
    const pr = this.renderer.getPixelRatio();
    const rtW = w * pr;
    const rtH = h * pr;

    this.composer.setSize(w, h);
    this.normalRT.setSize(rtW, rtH);

    this.edgePass.uniforms.resolution.value.set(rtW, rtH);
    this.edgePass.uniforms.cameraNear.value = this.camera.near;
    this.edgePass.uniforms.cameraFar.value = this.camera.far;
  }
}
