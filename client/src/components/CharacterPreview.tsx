import * as React from "react";
import { ASSET_BASE_URL } from "@/config";

/**
 * Standalone canvas character preview for onboarding.
 * Composites layered sprite PNGs without Phaser — pure canvas.
 *
 * Shows the down-facing idle frame (row 0, col 0) scaled up.
 */

const FRAME_W = 16;
const FRAME_H = 22;
const SCALE = 8;
const CANVAS_W = FRAME_W * SCALE; // 128
const CANVAS_H = FRAME_H * SCALE; // 176

// Map onboarding skin color ids → available body layer filenames
const SKIN_MAP: Record<string, string> = {
  fair: "pale",
  light: "light",
  medium: "medium",
  tan: "olive",
  brown: "dark",
  dark: "dark",
};

// Map onboarding eye color ids → available eye layer filenames
const EYE_MAP: Record<string, string> = {
  brown: "brown",
  blue: "blue",
  green: "green",
  amber: "gold",
  gray: "brown",
  violet: "red",
};

// Map onboarding hair style ids → available hair layer filenames
const HAIR_MAP: Record<string, string> = {
  short: "short",
  long: "long",
  braided: "long",
  mohawk: "mohawk",
  bald: "",          // no hair layer
  ponytail: "ponytail",
  locs: "long",
  afro: "short",
  cornrows: "short",
  "bantu-knots": "short",
  bangs: "long",
  topknot: "ponytail",
};

interface Props {
  skinColor: string;
  eyeColor: string;
  hairStyle: string;
  /** Kept for API compat but not used in preview rendering */
  classId?: string;
}

// Image cache to avoid reloading PNGs on every render
const imageCache = new Map<string, HTMLImageElement>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached?.complete) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    // Do NOT set crossOrigin — we only use drawImage() (never getImageData),
    // so a tainted canvas is fine. Setting crossOrigin causes load failures
    // when the CDN (R2) doesn't return CORS headers.
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

export function CharacterPreview({ skinColor, eyeColor, hairStyle }: Props): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    setLoadFailed(false);

    const base = ASSET_BASE_URL
      ? `${ASSET_BASE_URL}/sprites/layers`
      : "/sprites/layers";

    // Build layer list in draw order
    const layers: string[] = [];

    // Body (always present)
    const skin = SKIN_MAP[skinColor] ?? "medium";
    layers.push(`${base}/body/body-${skin}.png`);

    // Eyes
    const eyes = EYE_MAP[eyeColor] ?? "brown";
    layers.push(`${base}/eyes/eyes-${eyes}.png`);

    // Hair (skip if bald)
    const hair = HAIR_MAP[hairStyle] ?? "";
    if (hair) {
      layers.push(`${base}/hair/hair-${hair}.png`);
    }

    // Equipment layers intentionally omitted — the body sprites already
    // include default clothing, so stacking armor/helm/weapon overlays
    // on a 16×22 pixel frame makes the preview unreadable.  Equipment
    // is shown in-game via the full LayeredSpriteCompositor.

    let cancelled = false;

    Promise.all(layers.map((src) => loadImage(src).catch(() => null))).then(
      (images) => {
        if (cancelled) return;

        // Check if body (first layer) loaded — if not, nothing will render
        if (!images[0]) {
          setLoadFailed(true);
          return;
        }

        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.imageSmoothingEnabled = false;

        for (const img of images) {
          if (!img) continue;
          // Draw only the first frame (row 0, col 0) = down-facing idle
          ctx.drawImage(
            img,
            0, 0, FRAME_W, FRAME_H,       // source: first frame
            0, 0, CANVAS_W, CANVAS_H,      // dest: scaled up
          );
        }
      }
    );

    return () => { cancelled = true; };
  }, [skinColor, eyeColor, hairStyle]);

  if (loadFailed) {
    return (
      <div
        className="flex items-center justify-center border-2 border-[#2a3450] bg-[#0b1020] text-[#6d77a3] text-[10px] text-center"
        style={{ width: CANVAS_W, height: CANVAS_H }}
      >
        <span>Sprite layers<br/>not loaded</span>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      className="border-2 border-[#2a3450] bg-[#0b1020]"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
