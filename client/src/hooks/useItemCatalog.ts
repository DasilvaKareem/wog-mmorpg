import * as React from "react";
import { API_URL } from "@/config";

export interface CatalogItem {
  tokenId: number;
  name: string;
  description: string;
  copperPrice: number;
  category: string;
  equipSlot?: string;
  armorSlot?: string;
  statBonuses?: Partial<Record<string, number>>;
  maxDurability?: number;
}

let cached: CatalogItem[] | null = null;
let fetching: Promise<CatalogItem[]> | null = null;

async function load(): Promise<CatalogItem[]> {
  if (cached) return cached;
  if (fetching) return fetching;
  fetching = fetch(`${API_URL}/items/catalog`)
    .then((r) => (r.ok ? r.json() : []))
    .then((data: CatalogItem[]) => {
      cached = data;
      return data;
    })
    .catch(() => [] as CatalogItem[]);
  return fetching;
}

export function useItemCatalog(): {
  catalog: CatalogItem[];
  getItem: (tokenId: number) => CatalogItem | undefined;
} {
  const [catalog, setCatalog] = React.useState<CatalogItem[]>(cached ?? []);

  React.useEffect(() => {
    if (cached) {
      setCatalog(cached);
      return;
    }
    void load().then(setCatalog);
  }, []);

  const getItem = React.useCallback(
    (tokenId: number) => catalog.find((i) => i.tokenId === tokenId),
    [catalog],
  );

  return { catalog, getItem };
}
