import { Trash2 } from "lucide-react";
import { useEditorStore } from "../store/editorStore";
import { PROP_MODELS, getPropModel } from "../tiles/propModels";

/**
 * Props layer panel: pick a model to place, list/edit existing placements.
 * Terrain save (upper-right) persists props alongside tiles.
 */
export function PropPalettePanel() {
  const layer = useEditorStore((s) => s.layer);
  const props = useEditorStore((s) => s.props);
  const selectedIndex = useEditorStore((s) => s.selectedPropIndex);
  const selectedModel = useEditorStore((s) => s.selectedPropModel);
  const propsDirty = useEditorStore((s) => s.propsDirty);
  const tool = useEditorStore((s) => s.tool);
  const selectProp = useEditorStore((s) => s.selectProp);
  const updateProp = useEditorStore((s) => s.updateProp);
  const removeProp = useEditorStore((s) => s.removeProp);
  const setSelectedPropModel = useEditorStore((s) => s.setSelectedPropModel);

  if (layer !== "props") return null;

  const selected = selectedIndex !== null ? props[selectedIndex] : null;

  // Group models by category
  const byCategory = PROP_MODELS.reduce<Record<string, typeof PROP_MODELS>>((acc, m) => {
    (acc[m.category] ||= []).push(m);
    return acc;
  }, {});

  return (
    <div className="border-b border-zinc-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Props (3D)
        </span>
        {propsDirty && (
          <span className="rounded bg-amber-700/30 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
            UNSAVED
          </span>
        )}
      </div>

      <p className="mb-2 text-[9px] leading-tight text-zinc-500">
        Pick a model, then click the map to place. Props save with terrain (use the main Save
        button). Tool: <span className="text-zinc-300">{tool}</span>
      </p>

      {/* Model picker */}
      <div className="mb-3 max-h-56 overflow-y-auto rounded border border-zinc-800">
        {Object.entries(byCategory).map(([cat, models]) => (
          <div key={cat}>
            <div className="bg-zinc-900 px-2 py-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
              {cat}
            </div>
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedPropModel(m.id)}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] ${
                  selectedModel === m.id
                    ? "bg-blue-600/30 text-blue-200"
                    : "text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: m.color }}
                />
                {m.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Placed props list */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Placed ({props.length})
        </span>
      </div>
      <div className="mb-2 max-h-32 overflow-y-auto rounded border border-zinc-800">
        {props.length === 0 ? (
          <div className="p-2 text-center text-[10px] text-zinc-600">
            No props. Click the map to place one.
          </div>
        ) : (
          props.map((p, i) => (
            <button
              key={i}
              onClick={() => selectProp(i)}
              className={`block w-full truncate px-2 py-0.5 text-left text-[11px] ${
                selectedIndex === i
                  ? "bg-blue-600/30 text-blue-200"
                  : "text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <span className="text-zinc-500">#{i}</span> {p.model}{" "}
              <span className="text-zinc-600">
                ({p.x.toFixed(1)},{p.z.toFixed(1)})
              </span>
            </button>
          ))
        )}
      </div>

      {/* Selected prop editor */}
      {selected && selectedIndex !== null && (
        <div className="space-y-1.5 rounded border border-zinc-800 bg-zinc-950 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-zinc-400">
              #{selectedIndex} — {getPropModel(selected.model)?.label ?? selected.model}
            </span>
            <button
              onClick={() => removeProp(selectedIndex)}
              title="Delete prop (Del)"
              className="rounded p-1 text-red-400 hover:bg-red-900/30"
            >
              <Trash2 size={12} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1">
            <Field label="X (tiles)">
              <NumField
                value={selected.x}
                step={0.1}
                onChange={(v) => updateProp(selectedIndex, { x: v })}
              />
            </Field>
            <Field label="Z (tiles)">
              <NumField
                value={selected.z}
                step={0.1}
                onChange={(v) => updateProp(selectedIndex, { z: v })}
              />
            </Field>
          </div>

          <Field label={`Rotation: ${((selected.rotY ?? 0) * (180 / Math.PI)).toFixed(0)}°`}>
            <input
              type="range"
              min={0}
              max={Math.PI * 2}
              step={Math.PI / 16}
              value={selected.rotY ?? 0}
              onChange={(e) =>
                updateProp(selectedIndex, { rotY: parseFloat(e.target.value) })
              }
              className="w-full"
            />
          </Field>

          <Field label={`Scale: ${(selected.scale ?? 1).toFixed(2)}×`}>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.05}
              value={selected.scale ?? 1}
              onChange={(e) =>
                updateProp(selectedIndex, { scale: parseFloat(e.target.value) })
              }
              className="w-full"
            />
          </Field>
        </div>
      )}

      <p className="mt-2 text-[9px] leading-tight text-zinc-600">
        Brush = place. Click prop = select. Drag = move. Del = remove.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function NumField({
  value,
  step = 1,
  onChange,
}: {
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
    />
  );
}
