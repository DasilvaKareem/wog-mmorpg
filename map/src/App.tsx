import { Toolbar } from "./panels/Toolbar";
import { TilePalette } from "./panels/TilePalette";
import { LayerPanel } from "./panels/LayerPanel";
import { ElevationPicker } from "./panels/ElevationPicker";
import { ZoneProperties } from "./panels/ZoneProperties";
import { FalPanel } from "./panels/FalPanel";
import { PrefabPalette } from "./panels/PrefabPalette";
import { NpcEditorPanel } from "./panels/NpcEditorPanel";
import { PropPalettePanel } from "./panels/PropPalettePanel";
import { MapCanvas } from "./canvas/MapCanvas";
import { MapCanvas3D } from "./canvas3d/MapCanvas3D";
import { useEditorStore } from "./store/editorStore";

export function App() {
  const zoneId = useEditorStore((s) => s.zoneId);
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left sidebar — tools + palette */}
      <div className="flex w-64 flex-col border-r border-zinc-800 bg-zinc-900">
        <Toolbar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PrefabPalette />
          <TilePalette />
        </div>
      </div>

      {/* Center — canvas */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400">
          <span className="font-semibold text-zinc-200">WoG Map Editor</span>
          <span className="text-zinc-600">|</span>
          <span>{zoneId || "untitled"}</span>
          <div className="ml-auto flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 p-0.5">
            <button
              className={`px-2 py-0.5 text-xs font-mono rounded ${viewMode === "2d" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              onClick={() => setViewMode("2d")}
            >
              2D
            </button>
            <button
              className={`px-2 py-0.5 text-xs font-mono rounded ${viewMode === "3d" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              onClick={() => setViewMode("3d")}
            >
              3D
            </button>
          </div>
        </div>
        {viewMode === "2d" ? <MapCanvas /> : <MapCanvas3D />}
      </div>

      {/* Right sidebar — layers, elevation, zone props, FAL */}
      <div className="flex w-64 flex-col gap-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900">
        <LayerPanel />
        <NpcEditorPanel />
        <PropPalettePanel />
        <ElevationPicker />
        <ZoneProperties />
        <FalPanel />
      </div>
    </div>
  );
}
