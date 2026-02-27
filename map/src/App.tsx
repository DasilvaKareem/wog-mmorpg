import { Toolbar } from "./panels/Toolbar";
import { TilePalette } from "./panels/TilePalette";
import { LayerPanel } from "./panels/LayerPanel";
import { ElevationPicker } from "./panels/ElevationPicker";
import { ZoneProperties } from "./panels/ZoneProperties";
import { FalPanel } from "./panels/FalPanel";
import { MapCanvas } from "./canvas/MapCanvas";
import { useEditorStore } from "./store/editorStore";

export function App() {
  const zoneId = useEditorStore((s) => s.zoneId);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left sidebar — tools + palette */}
      <div className="flex w-64 flex-col border-r border-zinc-800 bg-zinc-900">
        <Toolbar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TilePalette />
        </div>
      </div>

      {/* Center — canvas */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400">
          <span className="font-semibold text-zinc-200">WoG Map Editor</span>
          <span className="text-zinc-600">|</span>
          <span>{zoneId || "untitled"}</span>
        </div>
        <MapCanvas />
      </div>

      {/* Right sidebar — layers, elevation, zone props, FAL */}
      <div className="flex w-64 flex-col gap-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900">
        <LayerPanel />
        <ElevationPicker />
        <ZoneProperties />
        <FalPanel />
      </div>
    </div>
  );
}
