import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { generateTileImage } from "../fal/falClient";
import { extractTiles } from "../fal/tileExtractor";

export function FalPanel() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  const hasKey = !!import.meta.env.VITE_FAL_API_KEY;

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setPreviews([]);

    try {
      const imageUrl = await generateTileImage(prompt.trim());
      const tiles = await extractTiles(imageUrl, 16);
      setPreviews(tiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <Sparkles size={12} />
        AI Tile Gen
      </div>

      {!hasKey && (
        <p className="mb-2 text-[10px] text-zinc-600">
          Set VITE_FAL_API_KEY in .env to enable
        </p>
      )}

      <div className="flex gap-1">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          placeholder="e.g. lava tiles 16x16 pixel art"
          disabled={!hasKey || loading}
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
        />
        <button
          onClick={generate}
          disabled={!hasKey || loading || !prompt.trim()}
          className="rounded bg-purple-700 px-2 py-1 text-xs text-white hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : "Go"}
        </button>
      </div>

      {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}

      {previews.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[10px] text-zinc-500">
            Generated {previews.length} tiles
          </div>
          <div className="flex flex-wrap gap-1">
            {previews.map((src, i) => (
              <img
                key={i}
                src={src}
                width={32}
                height={32}
                className="rounded border border-zinc-700"
                style={{ imageRendering: "pixelated" }}
                alt={`Generated tile ${i}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
