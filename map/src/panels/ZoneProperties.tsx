import { useEditorStore } from "../store/editorStore";

export function ZoneProperties() {
  const zoneId = useEditorStore((s) => s.zoneId);
  const biome = useEditorStore((s) => s.biome);
  const width = useEditorStore((s) => s.width);
  const height = useEditorStore((s) => s.height);
  const setZoneId = useEditorStore((s) => s.setZoneId);
  const setBiome = useEditorStore((s) => s.setBiome);

  return (
    <div className="border-b border-zinc-800 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Zone Properties
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-500">Zone ID</span>
          <input
            type="text"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-500">Biome</span>
          <input
            type="text"
            value={biome}
            onChange={(e) => setBiome(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500"
          />
        </label>
        <div className="flex gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-500">Width</span>
            <span className="text-xs text-zinc-300">{width}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-500">Height</span>
            <span className="text-xs text-zinc-300">{height}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
