import { OVERWORLD_COLS, OVERWORLD_TILE_PX } from "../tiles/overworldMapping";

let tilesheetImage: HTMLImageElement | null = null;
let loadPromise: Promise<HTMLImageElement> | null = null;

/**
 * Load the Overworld.png tilesheet. Returns the cached image on subsequent calls.
 */
export function loadTilesheet(): Promise<HTMLImageElement> {
  if (tilesheetImage) return Promise.resolve(tilesheetImage);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      tilesheetImage = img;
      resolve(img);
    };
    img.onerror = () => reject(new Error("Failed to load Overworld.png"));
    img.src = `${import.meta.env.BASE_URL}assets/Overworld.png`;
  });

  return loadPromise;
}

/**
 * Get the cached tilesheet image (null if not yet loaded).
 */
export function getTilesheet(): HTMLImageElement | null {
  return tilesheetImage;
}

/**
 * Get the source rect (sx, sy, sw, sh) for a given Overworld frame index.
 */
export function getTileRect(frameIndex: number): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} {
  const col = frameIndex % OVERWORLD_COLS;
  const row = Math.floor(frameIndex / OVERWORLD_COLS);
  return {
    sx: col * OVERWORLD_TILE_PX,
    sy: row * OVERWORLD_TILE_PX,
    sw: OVERWORLD_TILE_PX,
    sh: OVERWORLD_TILE_PX,
  };
}
