import { useState } from "react";
import {
  Paintbrush,
  Eraser,
  PaintBucket,
  RectangleHorizontal,
  Pipette,
  Grid3x3,
  Undo2,
  Redo2,
  Save,
  FolderOpen,
  FilePlus,
  Loader2,
  Upload,
} from "lucide-react";
import { useEditorStore, type Tool } from "../store/editorStore";
import { downloadMap, pickAndLoadMap, loadFromShard, saveToShard, ZONE_IDS } from "../io/fileIO";

const tools: { id: Tool; icon: typeof Paintbrush; label: string; key: string }[] = [
  { id: "brush", icon: Paintbrush, label: "Brush", key: "B" },
  { id: "eraser", icon: Eraser, label: "Eraser", key: "E" },
  { id: "fill", icon: PaintBucket, label: "Fill", key: "G" },
  { id: "rect", icon: RectangleHorizontal, label: "Rect Fill", key: "R" },
  { id: "eyedropper", icon: Pipette, label: "Eyedropper", key: "I" },
];

export function Toolbar() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const showGrid = useEditorStore((s) => s.showGrid);
  const toggleGrid = useEditorStore((s) => s.toggleGrid);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const [loadingZone, setLoadingZone] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleLoadZone = async (zoneId: string) => {
    setLoadingZone(true);
    const ok = await loadFromShard(zoneId);
    setLoadingZone(false);
    if (!ok) alert(`Failed to load zone "${zoneId}". Is the shard running on :3000?`);
  };

  return (
    <div className="border-b border-zinc-800 p-2">
      {/* Load Zone */}
      <div className="mb-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Load Zone
        </div>
        <div className="flex gap-1">
          <select
            id="zone-select"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) handleLoadZone(e.target.value);
              e.target.value = "";
            }}
            disabled={loadingZone}
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500 disabled:opacity-50"
          >
            <option value="" disabled>
              Select zone...
            </option>
            {ZONE_IDS.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          {loadingZone && <Loader2 size={16} className="animate-spin text-zinc-400" />}
        </div>
      </div>

      {/* Tools */}
      <div className="mb-2 flex flex-wrap gap-1">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.key})`}
            className={`rounded p-1.5 ${
              tool === t.id
                ? "bg-blue-600 text-white"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <t.icon size={16} />
          </button>
        ))}
        <div className="mx-1 w-px bg-zinc-700" />
        <button
          onClick={toggleGrid}
          title="Toggle Grid (H)"
          className={`rounded p-1.5 ${
            showGrid ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:bg-zinc-800"
          }`}
        >
          <Grid3x3 size={16} />
        </button>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1">
        <button onClick={undo} title="Undo (Cmd+Z)" className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
          <Undo2 size={16} />
        </button>
        <button onClick={redo} title="Redo (Cmd+Y)" className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
          <Redo2 size={16} />
        </button>
        <div className="mx-1 w-px bg-zinc-700" />
        <button
          onClick={() => {
            const s = useEditorStore.getState();
            const name = `${s.zoneId || "map"}.json`;
            downloadMap(name);
          }}
          title="Save Map"
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <Save size={16} />
        </button>
        <button
          onClick={() => pickAndLoadMap()}
          title="Open Map"
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <FolderOpen size={16} />
        </button>
        <button
          onClick={() => {
            const id = prompt("Zone ID:", "new-zone");
            if (!id) return;
            const biome = prompt("Biome:", "temperate") || "temperate";
            const w = parseInt(prompt("Width (tiles):", "64") || "64", 10);
            const h = parseInt(prompt("Height (tiles):", "64") || "64", 10);
            useEditorStore.getState().newMap(id, biome, w, h);
          }}
          title="New Map"
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <FilePlus size={16} />
        </button>
      </div>

      {/* Save to Shard */}
      <div className="mt-2">
        <button
          onClick={async () => {
            setSaving(true);
            const result = await saveToShard();
            setSaving(false);
            if (result.ok) {
              alert("Saved! Terrain written to world/content/terrain/. Deploy to go live.");
            } else {
              alert(`Save failed: ${result.error}`);
            }
          }}
          disabled={saving}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-emerald-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          Save to Shard
        </button>
        <p className="mt-1 text-[10px] text-zinc-600">
          Writes to world/content/terrain/ and updates live server
        </p>
      </div>
    </div>
  );
}
