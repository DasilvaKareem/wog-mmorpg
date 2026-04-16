import { useState } from "react";
import { Plus, Trash2, Upload, Loader2 } from "lucide-react";
import { useEditorStore, type EditorNpc } from "../store/editorStore";
import { saveNpcsToShard } from "../io/fileIO";

/**
 * Canonical NPC types recognized by the shard. New NPCs default to
 * "merchant" since that's the most common placement in a village.
 */
const NPC_TYPES = [
  "merchant",
  "quest-giver",
  "lore-npc",
  "auctioneer",
  "guild-registrar",
  "arena-master",
  "trainer",
  "profession-trainer",
  "mob",
  "boss",
  "forge",
  "anvil",
  "campfire",
  "alchemy-station",
  "cooking-fire",
] as const;

export function NpcEditorPanel() {
  const layer = useEditorStore((s) => s.layer);
  const npcs = useEditorStore((s) => s.npcs);
  const selectedIndex = useEditorStore((s) => s.selectedNpcIndex);
  const npcsDirty = useEditorStore((s) => s.npcsDirty);
  const selectNpc = useEditorStore((s) => s.selectNpc);
  const addNpc = useEditorStore((s) => s.addNpc);
  const updateNpc = useEditorStore((s) => s.updateNpc);
  const removeNpc = useEditorStore((s) => s.removeNpc);
  const width = useEditorStore((s) => s.width);
  const height = useEditorStore((s) => s.height);
  const zoneId = useEditorStore((s) => s.zoneId);

  const [saving, setSaving] = useState(false);

  if (layer !== "npcs") return null;

  const selected = selectedIndex !== null ? npcs[selectedIndex] : null;

  const handleAdd = () => {
    // Place at center of zone so the new NPC is visible
    const npc: EditorNpc = {
      type: "merchant",
      name: "New NPC",
      x: Math.round((width * 10) / 2),
      y: Math.round((height * 10) / 2),
      hp: 999,
    };
    addNpc(npc);
  };

  const handleSave = async () => {
    setSaving(true);
    const res = await saveNpcsToShard();
    setSaving(false);
    if (res.ok) {
      alert(`Saved ${res.spawned ?? npcs.length} NPCs. They were hot-reloaded on the shard.`);
    } else {
      alert(`Save failed: ${res.error}`);
    }
  };

  return (
    <div className="border-b border-zinc-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          NPC Editor
        </span>
        {npcsDirty && (
          <span className="rounded bg-amber-700/30 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
            UNSAVED
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mb-2 flex gap-1">
        <button
          onClick={handleAdd}
          className="flex flex-1 items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
          title="Add NPC at zone center"
        >
          <Plus size={12} /> Add
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !npcsDirty || !zoneId || zoneId === "untitled"}
          className="flex flex-1 items-center justify-center gap-1 rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          title="Write NPCs to shard + hot-reload"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Save
        </button>
      </div>

      {/* NPC list */}
      <div className="mb-2 max-h-40 overflow-y-auto rounded border border-zinc-800">
        {npcs.length === 0 ? (
          <div className="p-2 text-center text-[10px] text-zinc-600">
            No NPCs. Add one or load a zone.
          </div>
        ) : (
          npcs.map((n, i) => (
            <button
              key={i}
              onClick={() => selectNpc(i)}
              className={`block w-full truncate px-2 py-0.5 text-left text-[11px] ${
                selectedIndex === i
                  ? "bg-blue-600/30 text-blue-200"
                  : "text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <span className="text-zinc-500">{n.type.slice(0, 4)}</span>{" "}
              {n.name} <span className="text-zinc-600">({n.x},{n.y})</span>
            </button>
          ))
        )}
      </div>

      {/* Selected NPC editor */}
      {selected && selectedIndex !== null && (
        <div className="space-y-1.5 rounded border border-zinc-800 bg-zinc-950 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-zinc-400">
              Editing #{selectedIndex}
            </span>
            <button
              onClick={() => removeNpc(selectedIndex)}
              title="Delete NPC (Del)"
              className="rounded p-1 text-red-400 hover:bg-red-900/30"
            >
              <Trash2 size={12} />
            </button>
          </div>

          <NpcField label="Name">
            <input
              type="text"
              value={selected.name}
              onChange={(e) => updateNpc(selectedIndex, { name: e.target.value })}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
            />
          </NpcField>

          <NpcField label="Type">
            <select
              value={selected.type}
              onChange={(e) => updateNpc(selectedIndex, { type: e.target.value })}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
            >
              {NPC_TYPES.includes(selected.type as typeof NPC_TYPES[number]) ? null : (
                <option value={selected.type}>{selected.type} (custom)</option>
              )}
              {NPC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </NpcField>

          <div className="grid grid-cols-2 gap-1">
            <NpcField label="X">
              <NumField
                value={selected.x}
                onChange={(v) => updateNpc(selectedIndex, { x: v })}
              />
            </NpcField>
            <NpcField label="Y">
              <NumField
                value={selected.y}
                onChange={(v) => updateNpc(selectedIndex, { y: v })}
              />
            </NpcField>
          </div>

          <div className="grid grid-cols-2 gap-1">
            <NpcField label="HP">
              <NumField
                value={selected.hp}
                onChange={(v) => updateNpc(selectedIndex, { hp: v })}
              />
            </NpcField>
            <NpcField label="Level">
              <NumField
                value={selected.level ?? 0}
                onChange={(v) =>
                  updateNpc(selectedIndex, { level: v > 0 ? v : undefined })
                }
              />
            </NpcField>
          </div>

          {(selected.type === "mob" || selected.type === "boss") && (
            <NpcField label="XP Reward">
              <NumField
                value={selected.xpReward ?? 0}
                onChange={(v) =>
                  updateNpc(selectedIndex, { xpReward: v > 0 ? v : undefined })
                }
              />
            </NpcField>
          )}
        </div>
      )}

      <p className="mt-2 text-[9px] leading-tight text-zinc-600">
        Click NPC to select. Drag to move. Del to remove. Esc to deselect.
      </p>
    </div>
  );
}

function NpcField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function NumField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      className="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
    />
  );
}
