import * as React from "react";
import { API_URL } from "../config.js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item } from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useGameBridge } from "@/hooks/useGameBridge";
import { useWallet } from "@/hooks/useWallet";
import type { Entity } from "@/types";

interface CatalogItem {
  tokenId: string;
  name: string;
  description: string;
  goldPrice: number;
  category: string;
}

interface NpcShopResponse {
  npcId: string;
  npcName: string;
  items: CatalogItem[];
}

export function ShopDialog(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [merchant, setMerchant] = React.useState<Entity | null>(null);
  const [zoneId, setZoneId] = React.useState("human-meadow");
  const [items, setItems] = React.useState<CatalogItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState("weapon");
  const [buyingTokenId, setBuyingTokenId] = React.useState<string | null>(null);

  const { isConnected, buyItem } = useWallet();
  const { notify } = useToast();

  const loadCatalog = React.useCallback(async (nextZoneId: string, entityId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/shop/npc/${nextZoneId}/${entityId}`);
      if (!res.ok) {
        setItems([]);
        return;
      }
      const data: NpcShopResponse = await res.json();
      setItems(data.items);
      if (data.items.length > 0) {
        setActiveCategory(data.items[0].category);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useGameBridge("zoneChanged", ({ zoneId: nextZoneId }) => {
    setZoneId(nextZoneId);
  });

  useGameBridge("merchantClick", (entity) => {
    if (entity.type !== "merchant") return;
    setMerchant(entity);
    setOpen(true);
    void loadCatalog(zoneId, entity.id);
  });

  const groupedItems = React.useMemo(() => {
    return items.reduce<Record<string, CatalogItem[]>>((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push(item);
      return acc;
    }, {});
  }, [items]);

  const categories = React.useMemo(() => Object.keys(groupedItems), [groupedItems]);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setItems([]);
          setMerchant(null);
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-3xl text-[9px]">
        <DialogHeader>
          <DialogTitle>{merchant?.name ?? "Merchant"}</DialogTitle>
          <DialogDescription>
            Zone: <span className="text-slate-300">{zoneId}</span>
          </DialogDescription>
        </DialogHeader>

        {!isConnected ? (
          <div className="border-2 border-black bg-[#ff4d6d] p-3 text-[8px] text-black shadow-[3px_3px_0_0_#000]">
            Connect your wallet to buy items.
          </div>
        ) : null}

        {loading ? <p className="text-[8px] text-[#9aa7cc]">Loading merchant inventory...</p> : null}

        {!loading && items.length === 0 ? (
          <p className="text-[8px] text-[#9aa7cc]">No items found for this merchant.</p>
        ) : null}

        {!loading && items.length > 0 ? (
          <Tabs onValueChange={setActiveCategory} value={activeCategory}>
            <TabsList>
              {categories.map((category) => (
                <TabsTrigger key={category} value={category}>
                  {category}
                </TabsTrigger>
              ))}
            </TabsList>

            {categories.map((category) => (
              <TabsContent key={category} value={category}>
                <div className="max-h-96 space-y-1 overflow-auto pr-1">
                  {groupedItems[category].map((item) => (
                    <Item
                      description={item.description}
                      disabled={!isConnected || buyingTokenId === item.tokenId}
                      key={`${item.tokenId}-${item.name}`}
                      name={item.name}
                      onBuy={() => {
                        setBuyingTokenId(item.tokenId);
                        void buyItem(Number(item.tokenId), 1)
                          .then((ok) => {
                            notify(
                              ok ? `Purchased ${item.name}.` : `Could not buy ${item.name}.`,
                              ok ? "success" : "error"
                            );
                          })
                          .finally(() => {
                            setBuyingTokenId(null);
                          });
                      }}
                      price={item.goldPrice}
                    />
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        ) : null}

        <div className="mt-3 flex items-center justify-between">
          <Badge variant="secondary">{items.length} items</Badge>
          <Button onClick={() => setOpen(false)} type="button" variant="secondary">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
