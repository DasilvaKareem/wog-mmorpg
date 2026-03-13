import * as React from "react";
import { ASSET_BASE_URL } from "@/config";

/**
 * Standalone canvas character preview for onboarding.
 * Composites layered sprite PNGs without Phaser — pure canvas.
 *
 * Shows the down-facing idle frame (row 0, col 0) scaled up.
 * Layers are composited at their authored frame alignment, matching the world renderer.
 */

const FRAME_W = 16;
const FRAME_H = 22;
const SCALE = 8;
const BODY_X = 6;
const WEAPON_OFFSET_X = -4;
const BUFFER_W = FRAME_W + BODY_X;
const CANVAS_W = BUFFER_W * SCALE; // 176
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

// Only these eye PNGs are clean dot-style overlays (no face outlines)
const CLEAN_EYES = new Set(["blue", "gold", "red"]);

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

// Default starter equipment visuals per class
const CLASS_EQUIPMENT: Record<string, { chest?: string; legs?: string; boots?: string; weapon?: string }> = {
  warrior:  { chest: "leather", legs: "cloth",   boots: "leather", weapon: "sword" },
  mage:     { chest: "cloth",   legs: "cloth",   boots: "cloth",   weapon: "staff" },
  ranger:   { chest: "leather", legs: "leather", boots: "leather", weapon: "bow" },
  cleric:   { chest: "cloth",   legs: "cloth",   boots: "cloth",   weapon: "mace" },
  rogue:    { chest: "leather", legs: "leather", boots: "leather", weapon: "dagger" },
  paladin:  { chest: "chain",   legs: "chain",   boots: "iron",    weapon: "sword" },
  warlock:  { chest: "cloth",   legs: "cloth",   boots: "cloth",   weapon: "staff" },
  monk:     { chest: "cloth",   legs: "cloth",   boots: "cloth" },
};

interface Props {
  skinColor: string;
  eyeColor: string;
  hairStyle: string;
  classId?: string;
}

interface LayerDef {
  src: string;
  dx?: number;
  dy?: number;
  scale?: number;
}

const ARMOR_SCALE = 0.9;

// Image cache to avoid reloading PNGs on every render
const imageCache = new Map<string, HTMLImageElement>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached?.complete) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

export function CharacterPreview({ skinColor, eyeColor, hairStyle, classId }: Props): React.ReactElement {
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

    // Build layer list in draw order (bottom → top)
    const layers: LayerDef[] = [];

    // 1. Body (always present)
    const skin = SKIN_MAP[skinColor] ?? "medium";
    layers.push({ src: `${base}/body/body-${skin}.png` });

    // 2. Eyes (only clean dot-style PNGs)
    const eye = EYE_MAP[eyeColor] ?? "brown";
    if (CLEAN_EYES.has(eye)) {
      layers.push({ src: `${base}/eyes/eyes-${eye}.png` });
    }

    // 3. Hair
    const hair = HAIR_MAP[hairStyle] ?? "short";
    if (hair) {
      layers.push({ src: `${base}/hair/hair-${hair}.png` });
    }

    // 4. Equipment based on class
    const equip = CLASS_EQUIPMENT[classId ?? "warrior"] ?? CLASS_EQUIPMENT.warrior;
    if (equip.chest) {
      layers.push({ src: `${base}/chest/chest-${equip.chest}.png`, dx: BODY_X, scale: ARMOR_SCALE });
    }
    if (equip.legs) {
      layers.push({ src: `${base}/legs/legs-${equip.legs}.png`, dx: BODY_X, scale: ARMOR_SCALE });
    }
    if (equip.boots) {
      layers.push({ src: `${base}/boots/boots-${equip.boots}.png`, dx: BODY_X, scale: ARMOR_SCALE });
    }

    const weaponLayer: LayerDef | null = equip.weapon
      ? { src: `${base}/weapons/weapon-${equip.weapon}.png`, dx: BODY_X + WEAPON_OFFSET_X }
      : null;

    let cancelled = false;

    const layerDefs = weaponLayer ? [...layers, weaponLayer] : layers;

    Promise.all(layerDefs.map((l) => loadImage(l.src).catch(() => null))).then(
      (images) => {
        if (cancelled) return;

        // Body (first layer) must load
        if (!images[0]) {
          setLoadFailed(true);
          return;
        }

        // Composite at native resolution into an offscreen 16×22 buffer,
        // then scale the result up to the display canvas.
        const buf = document.createElement("canvas");
        buf.width = BUFFER_W;
        buf.height = FRAME_H;
        const bctx = buf.getContext("2d")!;
        bctx.imageSmoothingEnabled = false;

        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          if (!img) continue;
          const layer = layerDefs[i];
          const scale = layer?.scale ?? 1;
          const drawW = Math.round(FRAME_W * scale);
          const drawH = Math.round(FRAME_H * scale);
          const dx = (layer?.dx ?? BODY_X) + Math.round((FRAME_W - drawW) / 2);
          const dy = (layer?.dy ?? 0) + Math.round((FRAME_H - drawH) / 2);
          // Extract first frame (row 0, col 0) = down-facing idle.
          // Preview art is already aligned inside each 16x22 cell.
          bctx.drawImage(img, 0, 0, FRAME_W, FRAME_H, dx, dy, drawW, drawH);
        }

        // Scale up to display canvas
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(buf, 0, 0, BUFFER_W, FRAME_H, 0, 0, CANVAS_W, CANVAS_H);
      }
    );

    return () => { cancelled = true; };
  }, [skinColor, eyeColor, hairStyle, classId]);

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
