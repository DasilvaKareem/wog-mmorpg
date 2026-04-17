import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { PREFABS, type Prefab } from "../tiles/prefabs";
import { mapOldTileToOverworld } from "../tiles/overworldMapping";
import { loadTilesheet, getTileRect } from "../canvas/tilesheetLoader";

const CELL_PX = 10; // pixel size per prefab cell in the thumbnail

function renderThumbnail(
  canvas: HTMLCanvasElement,
  prefab: Prefab,
  tilesheet: HTMLImageElement,
) {
  const w = prefab.width * CELL_PX;
  const h = prefab.height * CELL_PX;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#1a1a1f";
  ctx.fillRect(0, 0, w, h);

  const drawTile = (tileIdx: number, x: number, y: number) => {
    const owIdx = mapOldTileToOverworld(tileIdx);
    if (owIdx < 0) return;
    const { sx, sy, sw, sh } = getTileRect(owIdx);
    ctx.drawImage(tilesheet, sx, sy, sw, sh, x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
  };

  for (let y = 0; y < prefab.height; y++) {
    for (let x = 0; x < prefab.width; x++) {
      const cell = prefab.cells[y * prefab.width + x];
      if (!cell) continue;
      if (cell.ground !== undefined) drawTile(cell.ground, x, y);
      if (cell.overlay !== undefined) drawTile(cell.overlay, x, y);
    }
  }
}

function PrefabThumb({ prefab, selected, onSelect }: {
  prefab: Prefab;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadTilesheet().then((img) => {
      if (ref.current) renderThumbnail(ref.current, prefab, img);
      setReady(true);
    });
  }, [prefab]);

  return (
    <button
      onClick={onSelect}
      title={`${prefab.name} (${prefab.width}×${prefab.height})`}
      className={`flex flex-col items-center gap-1 rounded border p-1.5 transition ${
        selected
          ? "border-blue-500 bg-blue-600/20"
          : "border-zinc-700 bg-zinc-800 hover:border-zinc-500"
      }`}
    >
      <div className="flex h-14 w-full items-center justify-center overflow-hidden rounded bg-zinc-900">
        <canvas
          ref={ref}
          className="max-h-full max-w-full"
          style={{ imageRendering: "pixelated" }}
        />
        {!ready && <span className="text-[9px] text-zinc-600">...</span>}
      </div>
      <span className="line-clamp-2 text-center text-[9px] leading-tight text-zinc-300">
        {prefab.name}
      </span>
      <span className="text-[8px] text-zinc-600">
        {prefab.width}×{prefab.height}
      </span>
    </button>
  );
}

const CATEGORIES: { id: Prefab["category"]; label: string }[] = [
  { id: "house", label: "Houses" },
  { id: "village", label: "Village" },
  { id: "nature", label: "Nature" },
  { id: "path", label: "Paths" },
];

export function PrefabPalette() {
  const selectedPrefabId = useEditorStore((s) => s.selectedPrefabId);
  const setSelectedPrefab = useEditorStore((s) => s.setSelectedPrefab);
  const setTool = useEditorStore((s) => s.setTool);
  const tool = useEditorStore((s) => s.tool);

  const handleSelect = (id: string) => {
    setSelectedPrefab(id);
    setTool("stamp");
  };

  return (
    <div className="border-b border-zinc-800 p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Prefabs
        </span>
        {tool === "stamp" && (
          <span className="rounded bg-blue-600/30 px-1.5 py-0.5 text-[9px] font-semibold text-blue-300">
            STAMP MODE
          </span>
        )}
      </div>
      <p className="mb-2 text-[9px] leading-tight text-zinc-500">
        Click a prefab, then click on the map to stamp it. T = rotate, Esc = cancel.
      </p>
      {CATEGORIES.map((cat) => {
        const items = PREFABS.filter((p) => p.category === cat.id);
        if (items.length === 0) return null;
        return (
          <div key={cat.id} className="mb-3">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
              {cat.label}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {items.map((p) => (
                <PrefabThumb
                  key={p.id}
                  prefab={p}
                  selected={tool === "stamp" && selectedPrefabId === p.id}
                  onSelect={() => handleSelect(p.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
