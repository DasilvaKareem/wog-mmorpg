import { Eye, EyeOff } from "lucide-react";
import { useEditorStore, type Layer } from "../store/editorStore";

const LAYERS: { id: Layer; label: string; visKey: "showGround" | "showOverlay" | "showElevation" }[] = [
  { id: "ground", label: "Ground", visKey: "showGround" },
  { id: "overlay", label: "Overlay", visKey: "showOverlay" },
  { id: "elevation", label: "Elevation", visKey: "showElevation" },
];

export function LayerPanel() {
  const layer = useEditorStore((s) => s.layer);
  const setLayer = useEditorStore((s) => s.setLayer);
  const showGround = useEditorStore((s) => s.showGround);
  const showOverlay = useEditorStore((s) => s.showOverlay);
  const showElevation = useEditorStore((s) => s.showElevation);
  const toggleVis = useEditorStore((s) => s.toggleLayerVisibility);

  const vis = { showGround, showOverlay, showElevation };

  return (
    <div className="border-b border-zinc-800 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Layers
      </div>
      <div className="flex flex-col gap-1">
        {LAYERS.map((l) => (
          <div
            key={l.id}
            className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
              layer === l.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400"
            }`}
          >
            <button
              onClick={() => setLayer(l.id)}
              className="flex-1 text-left"
            >
              {l.label}
            </button>
            <button
              onClick={() => toggleVis(l.id)}
              className="p-0.5 text-zinc-500 hover:text-zinc-300"
              title={vis[l.visKey] ? "Hide layer" : "Show layer"}
            >
              {vis[l.visKey] ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
