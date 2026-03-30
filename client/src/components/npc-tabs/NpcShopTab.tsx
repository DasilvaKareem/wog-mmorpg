import * as React from "react";
import { API_URL } from "@/config";
import type { Entity } from "@/types";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "@/components/ui/toast";
import { formatCopperString } from "@/lib/currency";

const BORDER = "#29334d";
const TEXT = "#f1f5ff";
const DIM = "#6b7a9e";
const ACCENT = "#54f28b";
const GOLD = "#f2c854";

interface CatalogItem {
  tokenId: string;
  name: string;
  description: string;
  copperPrice: number;
  category: string;
}

interface Props {
  entity: Entity;
  zoneId: string;
}

export function NpcShopTab({ entity, zoneId }: Props): React.ReactElement {
  const [items, setItems] = React.useState<CatalogItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activeCategory, setActiveCategory] = React.useState("");
  const [buyingTokenId, setBuyingTokenId] = React.useState<string | null>(null);

  const { isConnected, buyItem } = useWallet();
  const { notify } = useToast();

  React.useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/shop/npc/${zoneId}/${entity.id}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        const shopItems: CatalogItem[] = data.items ?? [];
        setItems(shopItems);
        if (shopItems.length > 0) setActiveCategory(shopItems[0].category);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [entity.id, zoneId]);

  const grouped = React.useMemo(() => {
    return items.reduce<Record<string, CatalogItem[]>>((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {});
  }, [items]);

  const categories = React.useMemo(() => Object.keys(grouped), [grouped]);

  return (
    <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
      {!isConnected && (
        <div className="px-4 py-2 border-b" style={{ borderColor: BORDER }}>
          <div className="text-[10px] font-bold" style={{ color: "#f25454" }}>
            Connect your wallet to buy items.
          </div>
        </div>
      )}

      {loading && (
        <div className="px-4 py-3 text-[10px]" style={{ color: DIM }}>Loading merchant inventory...</div>
      )}

      {!loading && items.length === 0 && (
        <div className="px-4 py-3 text-[10px]" style={{ color: DIM }}>No items found for this merchant.</div>
      )}

      {!loading && items.length > 0 && (
        <>
          {/* Category tabs */}
          <div className="flex gap-0 border-b px-2" style={{ borderColor: BORDER, background: "#0d1322" }}>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider"
                style={{
                  color: cat === activeCategory ? TEXT : DIM,
                  background: "transparent",
                  borderBottom: cat === activeCategory ? `2px solid ${GOLD}` : "2px solid transparent",
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Items */}
          <div className="px-4 py-2 space-y-1.5" style={{ maxHeight: "35vh", overflowY: "auto" }}>
            {(grouped[activeCategory] ?? []).map((item) => (
              <div
                key={`${item.tokenId}-${item.name}`}
                className="border p-2 flex items-center justify-between"
                style={{ borderColor: "#1e2842", background: "#0d1628" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold truncate" style={{ color: TEXT }}>{item.name}</div>
                  <div className="text-[9px] truncate" style={{ color: DIM }}>{item.description}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: GOLD }}>
                    {formatCopperString(item.copperPrice)}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setBuyingTokenId(item.tokenId);
                    void buyItem(Number(item.tokenId), 1)
                      .then((ok) => {
                        notify(
                          ok ? `Purchased ${item.name}.` : `Could not buy ${item.name}.`,
                          ok ? "success" : "error",
                        );
                      })
                      .finally(() => setBuyingTokenId(null));
                  }}
                  disabled={!isConnected || buyingTokenId === item.tokenId}
                  className="ml-2 px-2 py-1 text-[9px] font-bold uppercase border-2 disabled:opacity-40"
                  style={{
                    borderColor: ACCENT,
                    color: ACCENT,
                    background: "#0a1020",
                    cursor: isConnected ? "pointer" : "not-allowed",
                    fontFamily: "monospace",
                  }}
                >
                  {buyingTokenId === item.tokenId ? "..." : "BUY"}
                </button>
              </div>
            ))}
          </div>

          {/* Item count */}
          <div className="px-4 py-1.5 text-[9px]" style={{ color: DIM }}>
            {items.length} items available
          </div>
        </>
      )}
    </div>
  );
}
