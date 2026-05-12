/**
 * Auto-detect a starting quality tier from device capabilities.
 *
 * Heuristic scoring; if a signal is unavailable (e.g. deviceMemory on iOS
 * Safari, or WEBGL_debug_renderer_info on locked-down browsers) we silently
 * skip that signal rather than fail. Users can always override via the
 * Settings → Graphics panel.
 */

import type { Tier } from "./tierConfig.js";

function getGpuRenderer(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "";
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    return typeof renderer === "string" ? renderer.toLowerCase() : "";
  } catch {
    return "";
  }
}

function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
}

export function detectTier(): Tier {
  const gpu = getGpuRenderer();
  if (/swiftshader|llvmpipe|software/i.test(gpu)) return "potato";

  let score = 0;

  const cores = navigator.hardwareConcurrency ?? 0;
  if (cores >= 8) score += 2;
  else if (cores >= 4) score += 1;

  // deviceMemory is GB, only available on Chromium-based browsers
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof mem === "number") {
    if (mem >= 8) score += 2;
    else if (mem >= 4) score += 1;
    else if (mem <= 2) score -= 1;
  }

  const dpr = window.devicePixelRatio ?? 1;
  if (dpr <= 1.5) score += 1;

  const viewportArea = window.innerWidth * window.innerHeight;
  if (viewportArea >= 1920 * 1080) score += 1;
  else if (viewportArea < 1280 * 720) score -= 1;

  if (gpu) {
    if (/apple m[1-9]|rtx|radeon rx|geforce gtx 1[6-9]|arc /.test(gpu)) score += 2;
    else if (/adreno 7|mali-g[78]|apple a1[5-9]/.test(gpu)) score += 1;
    else if (/adreno [56]|mali-g[5-7]|powervr|intel hd|uhd graphics 6[0-2]0/.test(gpu)) score -= 1;
  }

  if (isMobileUserAgent() && viewportArea < 1280 * 720) score -= 1;

  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  if (score >= 1) return "low";
  return "potato";
}
