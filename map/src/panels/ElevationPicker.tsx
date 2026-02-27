import { useEditorStore } from "../store/editorStore";

const ELEVATIONS = [0, 1, 2, 3];
const COLORS = [
  "bg-zinc-700",
  "bg-yellow-700",
  "bg-orange-700",
  "bg-red-700",
];

export function ElevationPicker() {
  const layer = useEditorStore((s) => s.layer);
  const selected = useEditorStore((s) => s.selectedElevation);
  const setElev = useEditorStore((s) => s.setSelectedElevation);

  if (layer !== "elevation") return null;

  return (
    <div className="border-b border-zinc-800 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Elevation
      </div>
      <div className="flex gap-1">
        {ELEVATIONS.map((e) => (
          <button
            key={e}
            onClick={() => setElev(e)}
            className={`flex h-8 w-8 items-center justify-center rounded text-xs font-bold ${
              COLORS[e]
            } ${
              selected === e
                ? "ring-2 ring-blue-500 ring-offset-1 ring-offset-zinc-900"
                : "opacity-60 hover:opacity-100"
            }`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
