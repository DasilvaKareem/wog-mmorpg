/**
 * Tripo3D Asset Generator — generate 3D models from text/image prompts
 * via the Tripo API, then load them into Three.js as glTF.
 *
 * Usage (from browser console or code):
 *   const tripo = new TripoAssetGenerator("tsk_...");
 *   const group = await tripo.generate("a wooden treasure chest");
 *   scene.add(group);
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const API_BASE = "https://api.tripo3d.ai/v2/openapi";
const POLL_INTERVAL = 3_000; // ms
const MAX_POLL_TIME = 300_000; // 5 min timeout

// ── Types ──────────────────────────────────────────────────────────────

export interface TripoTaskResult {
  task_id: string;
  type: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled" | "unknown";
  progress: number;
  output?: {
    model?: string; // glb download URL
    rendered_image?: string;
    pbr_model?: string;
    base_model?: string;
  };
}

export interface GenerateOptions {
  /** Negative prompt — things to avoid */
  negativePrompt?: string;
  /** Model version (default: "v2.0-20240919") */
  modelVersion?: string;
  /** Output format: "glb" | "fbx" | "obj" | "stl" (default: "glb") */
  format?: string;
  /** Whether to enable PBR textures */
  pbr?: boolean;
  /** Auto-add to a Three.js scene after generation */
  addToScene?: THREE.Scene;
  /** Position to place the loaded model */
  position?: THREE.Vector3;
  /** Uniform scale factor */
  scale?: number;
  /** If true, also run stylization after base generation */
  stylize?: "cartoon" | "realistic" | "sculpture";
}

// ── Generator ──────────────────────────────────────────────────────────

export class TripoAssetGenerator {
  private apiKey: string;
  private loader = new GLTFLoader();
  private cache = new Map<string, THREE.Group>();

  constructor(apiKey?: string) {
    this.apiKey = apiKey || (import.meta as any).env?.VITE_TRIPO_API_KEY || "";
    if (!this.apiKey) {
      console.warn("[Tripo] No API key set. Call setApiKey() or set VITE_TRIPO_API_KEY.");
    }
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  // ── Core: text → 3D model ───────────────────────────────────────────

  /** Generate a 3D model from a text prompt and return a Three.js Group. */
  async generate(prompt: string, opts: GenerateOptions = {}): Promise<THREE.Group> {
    // Check cache
    const cacheKey = prompt.toLowerCase().trim();
    if (this.cache.has(cacheKey)) {
      console.log(`[Tripo] Cache hit: "${prompt}"`);
      return this.cache.get(cacheKey)!.clone();
    }

    console.log(`[Tripo] Generating: "${prompt}" ...`);

    // 1) Submit text_to_model task
    const taskId = await this.submitTask({
      type: "text_to_model",
      prompt,
      negative_prompt: opts.negativePrompt,
      model_version: opts.modelVersion || "v2.0-20240919",
    });

    // 2) Poll until done
    const result = await this.pollTask(taskId);

    // 3) Optionally run stylization
    if (opts.stylize && result.output?.model) {
      return this.stylizeAndLoad(taskId, opts);
    }

    // 4) Download + load glTF/GLB into Three.js
    const modelUrl = result.output?.pbr_model ?? result.output?.model;
    if (!modelUrl) throw new Error(`[Tripo] No model URL in task ${taskId}`);

    const group = await this.loadModel(modelUrl, prompt);

    // Apply transforms
    if (opts.scale) group.scale.setScalar(opts.scale);
    if (opts.position) group.position.copy(opts.position);
    if (opts.addToScene) opts.addToScene.add(group);

    // Cache it
    this.cache.set(cacheKey, group);

    console.log(`[Tripo] Done: "${prompt}" → ${group.children.length} meshes`);
    return group;
  }

  // ── Image → 3D ──────────────────────────────────────────────────────

  /** Generate a 3D model from an image URL. */
  async generateFromImage(imageUrl: string, opts: GenerateOptions = {}): Promise<THREE.Group> {
    console.log(`[Tripo] Generating from image...`);

    // First upload the image if it's a local blob/data URL
    let fileToken: string | undefined;
    if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) {
      fileToken = await this.uploadImage(imageUrl);
    }

    const taskId = await this.submitTask({
      type: "image_to_model",
      file: fileToken ? { type: "jpg", file_token: fileToken } : undefined,
      image_url: fileToken ? undefined : imageUrl,
      model_version: opts.modelVersion || "v2.0-20240919",
    });

    const result = await this.pollTask(taskId);
    const modelUrl = result.output?.pbr_model ?? result.output?.model;
    if (!modelUrl) throw new Error(`[Tripo] No model URL in task ${taskId}`);

    const group = await this.loadModel(modelUrl, "image-model");
    if (opts.scale) group.scale.setScalar(opts.scale);
    if (opts.position) group.position.copy(opts.position);
    if (opts.addToScene) opts.addToScene.add(group);
    return group;
  }

  // ── Batch generation ─────────────────────────────────────────────────

  /** Generate multiple assets in parallel. */
  async generateBatch(
    prompts: string[],
    opts: GenerateOptions = {},
  ): Promise<Map<string, THREE.Group>> {
    const results = new Map<string, THREE.Group>();
    const tasks = prompts.map(async (prompt) => {
      const group = await this.generate(prompt, opts);
      results.set(prompt, group);
    });
    await Promise.allSettled(tasks);
    return results;
  }

  // ── Internals ────────────────────────────────────────────────────────

  private async submitTask(body: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${API_BASE}/task`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[Tripo] Submit failed (${res.status}): ${text}`);
    }
    const json = await res.json();
    if (json.code !== 0) throw new Error(`[Tripo] API error: ${JSON.stringify(json)}`);
    return json.data.task_id;
  }

  private async pollTask(taskId: string): Promise<TripoTaskResult> {
    const start = Date.now();
    while (Date.now() - start < MAX_POLL_TIME) {
      const res = await fetch(`${API_BASE}/task/${taskId}`, {
        headers: this.headers(),
      });
      if (!res.ok) throw new Error(`[Tripo] Poll failed (${res.status})`);
      const json = await res.json();
      const task: TripoTaskResult = json.data;

      if (task.status === "success") return task;
      if (task.status === "failed" || task.status === "cancelled") {
        throw new Error(`[Tripo] Task ${taskId} ${task.status}`);
      }

      console.log(`[Tripo] ${taskId} — ${task.status} (${task.progress}%)`);
      await this.sleep(POLL_INTERVAL);
    }
    throw new Error(`[Tripo] Task ${taskId} timed out after ${MAX_POLL_TIME / 1000}s`);
  }

  private async loadModel(url: string, name: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const group = new THREE.Group();
          group.name = `tripo_${name.replace(/\s+/g, "_").substring(0, 32)}`;
          group.add(...gltf.scene.children.map((c) => c.clone()));
          resolve(group);
        },
        undefined,
        (err) => reject(new Error(`[Tripo] GLTFLoader error: ${err}`)),
      );
    });
  }

  private async stylizeAndLoad(
    originalTaskId: string,
    opts: GenerateOptions,
  ): Promise<THREE.Group> {
    const styleTaskId = await this.submitTask({
      type: "stylize_model",
      original_model_task_id: originalTaskId,
      style: opts.stylize,
    });
    const result = await this.pollTask(styleTaskId);
    const modelUrl = result.output?.pbr_model ?? result.output?.model;
    if (!modelUrl) throw new Error(`[Tripo] No model URL for stylized task`);

    const group = await this.loadModel(modelUrl, `stylized_${opts.stylize}`);
    if (opts.scale) group.scale.setScalar(opts.scale);
    if (opts.position) group.position.copy(opts.position);
    if (opts.addToScene) opts.addToScene.add(group);
    return group;
  }

  private async uploadImage(dataUrl: string): Promise<string> {
    const blob = await fetch(dataUrl).then((r) => r.blob());
    const form = new FormData();
    form.append("file", blob, "image.jpg");

    const res = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`[Tripo] Upload failed (${res.status})`);
    const json = await res.json();
    return json.data.image_token;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
