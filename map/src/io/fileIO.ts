import { useEditorStore } from "../store/editorStore";
import { exportToV2, parseV2 } from "./exportFormat";

/**
 * Download the current map as a JSON file.
 */
export function downloadMap(filename: string) {
  const data = exportToV2();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Open a file picker and load a map JSON file.
 */
export function pickAndLoadMap() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const data = parseV2(raw);
      if (!data) {
        alert("Invalid map file format");
        return;
      }
      useEditorStore.getState().loadMap(data);
    } catch {
      alert("Failed to parse map file");
    }
  };

  input.click();
}

/**
 * Load terrain data from the shard API.
 */
export async function loadFromShard(zoneId: string): Promise<boolean> {
  try {
    const res = await fetch(`/v2/terrain/zone/${zoneId}`);
    if (!res.ok) return false;
    const raw = await res.json();
    const data = parseV2(raw);
    if (!data) return false;
    useEditorStore.getState().loadMap(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save terrain data to the shard (writes to disk + updates in-memory cache).
 * This persists to world/content/terrain/<zoneId>.json and deploys with the app.
 */
export async function saveToShard(): Promise<{ ok: boolean; error?: string }> {
  const data = exportToV2();
  if (!data.zoneId || data.zoneId === "untitled") {
    return { ok: false, error: "Set a zone ID before saving" };
  }

  try {
    const res = await fetch(`/v2/terrain/zone/${data.zoneId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      return { ok: false, error: err.error };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to connect to shard. Is it running on :3000?" };
  }
}

/** Known zone IDs from world layout */
export const ZONE_IDS = [
  "village-square",
  "wild-meadow",
  "dark-forest",
  "auroral-plains",
  "emerald-woods",
  "viridian-range",
  "moondancer-glade",
  "felsrock-citadel",
  "lake-lumina",
  "azurshard-chasm",
] as const;
