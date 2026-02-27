import { useEffect, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { TILE_CATEGORIES } from "../tiles/tileCategories";
import { mapOldTileToOverworld } from "../tiles/overworldMapping";
import { loadTilesheet, getTilesheet, getTileRect } from "../canvas/tilesheetLoader";

const PREVIEW_SIZE = 32;

function TileButton({ name, idx }: { name: string; idx: number }) {
  const selectedTile = useEditorStore((s) => s.selectedTile);
  const setSelectedTile = useEditorStore((s) => s.setSelectedTile);
  const setTool = useEditorStore((s) => s.setTool);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvas) return;
    const img = getTilesheet();
    if (!img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    // Checkerboard background for transparency
    ctx.fillStyle = "#27272a";
    ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    ctx.fillStyle = "#3f3f46";
    for (let y = 0; y < PREVIEW_SIZE; y += 8) {
      for (let x = (y % 16 === 0 ? 8 : 0); x < PREVIEW_SIZE; x += 16) {
        ctx.fillRect(x, y, 8, 8);
      }
    }

    const owIdx = mapOldTileToOverworld(idx);
    if (owIdx >= 0) {
      const { sx, sy, sw, sh } = getTileRect(owIdx);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    }
  }, [canvas, idx]);

  const isSelected = selectedTile === idx;

  return (
    <button
      onClick={() => {
        setSelectedTile(idx);
        setTool("brush");
      }}
      title={name}
      className={`rounded border ${
        isSelected
          ? "border-blue-500 ring-1 ring-blue-500"
          : "border-zinc-700 hover:border-zinc-500"
      }`}
    >
      <canvas
        ref={setCanvas}
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        className="block"
      />
    </button>
  );
}

export function TilePalette() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadTilesheet().then(() => setReady(true));
  }, []);

  if (!ready) {
    return <div className="p-3 text-xs text-zinc-500">Loading tiles...</div>;
  }

  return (
    <div className="p-2">
      {TILE_CATEGORIES.map((cat) => (
        <div key={cat.label} className="mb-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {cat.label}
          </div>
          <div className="flex flex-wrap gap-1">
            {cat.tiles.map((t) => (
              <TileButton key={t.name} name={t.name} idx={t.idx} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
