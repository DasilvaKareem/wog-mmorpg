// In-memory inventory marks. Right-clicking an item tags it as "sell",
// "auction", or "destroy"; the Process Marks modal in InventoryDialog
// reads this state and fires the matching API call for each tagged item.
//
// Marks live only in-session — no localStorage. Reasons:
//   1. Stale marks across server restarts are a footgun (the item may be
//      gone, equipped, or transformed).
//   2. Each browser tab gets its own state — no cross-tab sync surprises.
//   3. Keeps the surface small. We can add persistence later if users ask.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";

export type ItemMarkAction = "sell" | "auction" | "destroy";

/**
 * Stable key for an item slot in the inventory.
 *   - Crafted items with rolled stats → `instanceId` (each is unique)
 *   - Stackable items → `tokenId:N` string
 * Picking the right key matters: if two items in the bag share a key, marking
 * one would mark both.
 */
export function itemMarkKey(tokenId: number | string, instanceId?: string | null): string {
  return instanceId ? `inst:${instanceId}` : `tok:${tokenId}`;
}

interface ItemMarksContextValue {
  marks: ReadonlyMap<string, ItemMarkAction>;
  setMark: (key: string, action: ItemMarkAction) => void;
  clearMark: (key: string) => void;
  clearAll: () => void;
  getMark: (key: string) => ItemMarkAction | undefined;
  counts: { sell: number; auction: number; destroy: number; total: number };
}

const ItemMarksContext = createContext<ItemMarksContextValue | null>(null);

export function ItemMarksProvider({ children }: { children: ReactNode }): ReactElement {
  // Map identity changes on every setMark so subscribers re-render. This is
  // simpler than tracking a version counter and the inventory is small (<100
  // items typically), so the copy cost is negligible.
  const [marks, setMarks] = useState<Map<string, ItemMarkAction>>(() => new Map());

  const setMark = useCallback((key: string, action: ItemMarkAction) => {
    setMarks((current) => {
      const next = new Map(current);
      next.set(key, action);
      return next;
    });
  }, []);

  const clearMark = useCallback((key: string) => {
    setMarks((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setMarks((current) => (current.size === 0 ? current : new Map()));
  }, []);

  const getMark = useCallback((key: string) => marks.get(key), [marks]);

  const counts = useMemo(() => {
    let sell = 0, auction = 0, destroy = 0;
    for (const action of marks.values()) {
      if (action === "sell") sell++;
      else if (action === "auction") auction++;
      else if (action === "destroy") destroy++;
    }
    return { sell, auction, destroy, total: sell + auction + destroy };
  }, [marks]);

  const value = useMemo<ItemMarksContextValue>(
    () => ({ marks, setMark, clearMark, clearAll, getMark, counts }),
    [marks, setMark, clearMark, clearAll, getMark, counts],
  );

  return <ItemMarksContext.Provider value={value}>{children}</ItemMarksContext.Provider>;
}

export function useItemMarks(): ItemMarksContextValue {
  const ctx = useContext(ItemMarksContext);
  if (!ctx) {
    throw new Error("useItemMarks must be used inside ItemMarksProvider");
  }
  return ctx;
}
