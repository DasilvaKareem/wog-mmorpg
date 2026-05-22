import * as React from "react";
import { API_URL } from "@/config";
import { useWalletContext } from "@/context/WalletContext";
import { itemMarkKey, useItemMarks, type ItemMarkAction } from "@/context/ItemMarksContext";
import { ProcessMarksModal, type MarkedItemSummary } from "@/components/ProcessMarksModal";
import { gameBus } from "@/lib/eventBus";
import { formatCopperString } from "@/lib/currency";
import { getAuthToken } from "@/lib/agentAuth";
import { WalletManager } from "@/lib/walletManager";

/* ── Types ────────────────────────────────────────────────── */

interface InventoryItem {
  tokenId: number;
  name: string;
  displayName: string | null;
  description: string;
  category: "consumable" | "weapon" | "armor" | "material" | "tool";
  equipSlot: string | null;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  quantity: number;
  equipped: boolean;
  equippedCount: number;
  equippedSlot: string | null;
  durability: number | null;
  maxDurability: number | null;
  recyclableQuantity: number;
  recycleCopperValue: number;
}

type SortMode = "name" | "rarity" | "quantity" | "value";
type Category = "all" | "weapon" | "armor" | "consumable" | "material";

/* ── Constants ────────────────────────────────────────────── */

const RARITY_COLORS: Record<string, string> = {
  common: "#9aa7cc",
  uncommon: "#54f28b",
  rare: "#5dadec",
  epic: "#b48efa",
  legendary: "#ffcc00",
};

const RARITY_ORDER: Record<string, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
};

const CATEGORY_ICONS: Record<string, string> = {
  weapon: "\u2694",
  armor: "\uD83D\uDEE1",
  consumable: "\u2697",
  material: "\uD83D\uDCE6",
  tool: "\u26CF",
};

const CATEGORIES: Category[] = ["all", "weapon", "armor", "consumable", "material"];

const MARK_COLORS: Record<ItemMarkAction, string> = {
  sell: "#54f28b",
  auction: "#ffcc00",
  destroy: "#ff6b6b",
};
const MARK_GLYPHS: Record<ItemMarkAction, string> = {
  sell: "S",
  auction: "A",
  destroy: "D",
};

/* ── Component ────────────────────────────────────────────── */

export function InventoryDialog(): React.ReactElement | null {
  const { address, characterProgress } = useWalletContext();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<InventoryItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState<Category>("all");
  const [sort, setSort] = React.useState<SortMode>("name");
  const [busy, setBusy] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [fetchSeq, setFetchSeq] = React.useState(0);
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    markKey: string;
    itemName: string;
    tokenId: number;
  } | null>(null);

  const { setMark, clearMark, getMark, counts, marks } = useItemMarks();
  const [processOpen, setProcessOpen] = React.useState(false);

  // Set of tokenIds that have an active (enabled) trading rule. Drives the
  // small "AUTO" badge on item rows and the highlight in the context menu.
  const [autoTradedTokenIds, setAutoTradedTokenIds] = React.useState<Set<number>>(new Set());

  // Resolve every marked key back to the actual inventory item, skipping
  // any that no longer exist (e.g. user already sold one via another path).
  const markedItems: MarkedItemSummary[] = React.useMemo(() => {
    if (counts.total === 0) return [];
    const result: MarkedItemSummary[] = [];
    for (const item of items) {
      const key = itemMarkKey(item.tokenId);
      const action = marks.get(key);
      if (!action) continue;
      result.push({
        markKey: key,
        action,
        tokenId: item.tokenId,
        name: item.displayName ?? item.name,
        quantity: item.quantity,
        rarity: item.rarity,
        recycleCopperValue: item.recycleCopperValue,
        equipped: item.equipped,
      });
    }
    return result;
  }, [items, marks, counts.total]);

  // Custodial wallet (holds items on-chain). Resolved async from agent API.
  const [custodialWallet, setCustodialWallet] = React.useState<string | null>(null);

  // The wallet that owns items: custodial if deployed, otherwise owner
  const itemWallet = custodialWallet ?? address ?? null;

  const zoneId = characterProgress?.zoneId ?? null;

  /* ── Resolve custodial wallet ─────────────────────────── */

  const resolveCustodial = React.useCallback(async () => {
    if (!address) { setCustodialWallet(null); return; }
    // First try the cached value from WalletManager
    const cached = WalletManager.getInstance().custodialAddress;
    if (cached) { setCustodialWallet(cached); return; }
    // Otherwise fetch from server
    try {
      const res = await fetch(`${API_URL}/agent/wallet/${address}`);
      if (res.ok) {
        const data = await res.json();
        const cw = data.custodialWallet ?? null;
        setCustodialWallet(cw);
        if (cw) WalletManager.getInstance().setCustodialAddress(cw);
      }
    } catch { /* ignore */ }
  }, [address]);

  /* ── Fetch inventory ──────────────────────────────────── */

  const fetchInventory = React.useCallback(async () => {
    if (!itemWallet) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/inventory/${itemWallet}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [itemWallet]);

  /* ── Open via gameBus ─────────────────────────────────── */

  React.useEffect(() => {
    return gameBus.on("inventoryOpen", () => {
      setOpen(true);
      setError(null);
      setNotice(null);
      setSelected(null);
      setFetchSeq((n) => n + 1);
    });
  }, []);

  // Resolve custodial wallet when dialog opens
  React.useEffect(() => {
    if (open) void resolveCustodial();
  }, [open, resolveCustodial]);

  // Fetch inventory every time the dialog opens (fetchSeq bumps on each open event)
  React.useEffect(() => {
    if (open && itemWallet) void fetchInventory();
  }, [open, itemWallet, fetchInventory, fetchSeq]);

  // Fetch active auto-trading rules so we can flag items the agent is already
  // managing. Refreshes on open and whenever the trading dialog emits a change.
  const fetchTradingRules = React.useCallback(async () => {
    if (!address) return;
    const token = await getAuthToken(address).catch(() => null);
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/agent/trading-rules/${address}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const ids = new Set<number>();
      for (const r of data.rules ?? []) {
        if (r.enabled !== false) ids.add(r.tokenId);
      }
      setAutoTradedTokenIds(ids);
    } catch { /* ignore */ }
  }, [address]);

  React.useEffect(() => {
    if (open) void fetchTradingRules();
  }, [open, fetchTradingRules]);

  React.useEffect(() => {
    return gameBus.on("tradingRulesChanged", () => { void fetchTradingRules(); });
  }, [fetchTradingRules]);

  /* ── Keyboard ─────────────────────────────────────────── */

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextMenu) setContextMenu(null);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, contextMenu]);

  // Dismiss the context menu on any outside click. Capture phase so we beat
  // child handlers and don't accidentally re-open from the right-click that
  // spawned it (the right-click target is gone by the time mousedown fires).
  React.useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("mousedown", handler, true);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("mousedown", handler, true);
      window.removeEventListener("scroll", handler, true);
    };
  }, [contextMenu]);

  /* ── Actions ──────────────────────────────────────────── */

  async function handleRecycle(item: InventoryItem, quantity: number) {
    if (!itemWallet || quantity < 1) return;
    setBusy(item.tokenId);
    setError(null);
    setNotice(null);
    try {
      const authWallet = address;
      if (!authWallet) { setError("Wallet not connected"); setBusy(null); return; }
      const token = await getAuthToken(authWallet);
      if (!token) { setError("Auth failed"); setBusy(null); return; }
      const res = await fetch(`${API_URL}/shop/recycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sellerAddress: itemWallet, tokenId: item.tokenId, quantity }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Sell failed"); setBusy(null); return; }
      const payoutCopper = data.totalPayoutCopper ?? 0;
      setNotice(`Sold ${quantity}x ${item.name} for ${formatCopperString(payoutCopper)}.`);
      if (payoutCopper > 0) gameBus.emit("goldGained", { copper: payoutCopper, source: "recycle" });
      void fetchInventory();
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function handleEquip(item: InventoryItem) {
    if (!itemWallet || !zoneId) return;
    setBusy(item.tokenId);
    setError(null);
    setNotice(null);
    try {
      const authWallet = address;
      if (!authWallet) { setError("Wallet not connected"); setBusy(null); return; }
      const token = await getAuthToken(authWallet);
      if (!token) { setError("Auth failed"); setBusy(null); return; }
      const res = await fetch(`${API_URL}/equipment/equip`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ zoneId, tokenId: item.tokenId, walletAddress: itemWallet }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Equip failed"); setBusy(null); return; }
      setNotice(`Equipped ${item.name}.`);
      void fetchInventory();
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function handleUnequip(item: InventoryItem) {
    if (!itemWallet || !zoneId || !item.equippedSlot) return;
    setBusy(item.tokenId);
    setError(null);
    setNotice(null);
    try {
      const authWallet = address;
      if (!authWallet) { setError("Wallet not connected"); setBusy(null); return; }
      const token = await getAuthToken(authWallet);
      if (!token) { setError("Auth failed"); setBusy(null); return; }
      const res = await fetch(`${API_URL}/equipment/unequip`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ zoneId, slot: item.equippedSlot, walletAddress: itemWallet }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Unequip failed"); setBusy(null); return; }
      setNotice(`Unequipped ${item.name}.`);
      void fetchInventory();
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  /* ── Filter + sort ────────────────────────────────────── */

  const filtered = filter === "all" ? items : items.filter((i) => i.category === filter);

  const sorted = React.useMemo(() => {
    const arr = [...filtered];
    // Equipped always first
    arr.sort((a, b) => {
      if (a.equipped && !b.equipped) return -1;
      if (!a.equipped && b.equipped) return 1;
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "rarity") return (RARITY_ORDER[a.rarity] ?? 5) - (RARITY_ORDER[b.rarity] ?? 5);
      if (sort === "quantity") return b.quantity - a.quantity;
      if (sort === "value") return b.recycleCopperValue - a.recycleCopperValue;
      return 0;
    });
    return arr;
  }, [filtered, sort]);

  const selectedItem = selected !== null ? items.find((i) => i.tokenId === selected) ?? null : null;

  /* ── Render ───────────────────────────────────────────── */

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ fontFamily: "monospace" }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />

      {/* Dialog */}
      <div
        className="relative border-4 border-black bg-[#0a0f1e] shadow-[6px_6px_0_0_#000] flex flex-col"
        style={{ width: "min(720px, 95vw)", maxHeight: "min(85vh, 700px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-[#29334d] bg-[#11182b] px-4 py-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[16px]">{"\uD83C\uDF92"}</span>
            <span className="text-[13px] font-bold text-[#f1f5ff]">Inventory</span>
            <span className="text-[10px] text-[#596a8a]">({items.length} items)</span>
            {counts.total > 0 && (
              <span className="flex items-center gap-1.5 ml-2 text-[9px] font-bold">
                {counts.sell > 0 && (
                  <span style={{ color: MARK_COLORS.sell }}>{counts.sell}S</span>
                )}
                {counts.auction > 0 && (
                  <span style={{ color: MARK_COLORS.auction }}>{counts.auction}A</span>
                )}
                {counts.destroy > 0 && (
                  <span style={{ color: MARK_COLORS.destroy }}>{counts.destroy}D</span>
                )}
              </span>
            )}
            <span className="text-[8px] text-[#596a8a] uppercase ml-2">right-click to mark</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-[11px] font-bold px-2 py-0.5 border border-[#29334d] text-[#6b7a9e] hover:text-[#f1f5ff] transition"
            style={{ background: "transparent", cursor: "pointer" }}
          >
            ESC
          </button>
        </div>

        {/* Notices */}
        {error && (
          <div className="border-b border-[#ff6b6b33] bg-[#1a0a0a] px-4 py-1.5 text-[10px] text-[#ff6b6b]">
            {error}
          </div>
        )}
        {notice && (
          <div className="border-b border-[#54f28b33] bg-[#09160d] px-4 py-1.5 text-[10px] text-[#54f28b]">
            {notice}
          </div>
        )}

        {/* Toolbar: categories + sort */}
        <div className="flex items-center gap-2 border-b border-[#1e2842] bg-[#0d1322] px-4 py-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => { setFilter(cat); setSelected(null); }}
              className={`px-2 py-0.5 text-[9px] uppercase tracking-wide border transition ${
                filter === cat
                  ? "border-[#ffcc00] bg-[#2a2210] text-[#ffcc00]"
                  : "border-[#29334d] bg-[#0a0f1e] text-[#6b7a9e] hover:text-[#9aa7cc]"
              }`}
              style={{ cursor: "pointer" }}
            >
              {cat === "all"
                ? `All (${items.length})`
                : `${CATEGORY_ICONS[cat] ?? ""} ${cat}`}
            </button>
          ))}
          <span className="ml-auto text-[8px] text-[#596a8a] uppercase">Sort:</span>
          {(["name", "rarity", "quantity", "value"] as SortMode[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-1.5 py-0.5 text-[8px] uppercase tracking-wide border transition ${
                sort === s
                  ? "border-[#5dadec] text-[#5dadec] bg-[#0d1a2e]"
                  : "border-[#1e2842] text-[#596a8a] hover:text-[#9aa7cc]"
              }`}
              style={{ cursor: "pointer" }}
            >
              {s}
            </button>
          ))}
          {counts.total > 0 && (
            <button
              onClick={() => setProcessOpen(true)}
              className="ml-2 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border-2 border-[#ffcc00] bg-[#2a2210] text-[#ffcc00] hover:bg-[#3d3218] transition"
              style={{ cursor: "pointer" }}
            >
              Process {counts.total}
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Item list */}
          <div className="flex-1 overflow-y-auto p-2" style={{ minHeight: 0 }}>
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <span className="text-[12px] text-[#596a8a] animate-pulse">Loading inventory...</span>
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <span className="text-[12px] text-[#596a8a]">
                  {items.length === 0 ? "No items yet." : "No items in this category."}
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1">
                {sorted.map((item) => {
                  const rc = RARITY_COLORS[item.rarity] ?? "#9aa7cc";
                  const isSelected = selected === item.tokenId;
                  const markKey = itemMarkKey(item.tokenId);
                  const mark = getMark(markKey);
                  const markColor = mark ? MARK_COLORS[mark] : null;
                  return (
                    <button
                      key={item.tokenId}
                      type="button"
                      onClick={() => setSelected(isSelected ? null : item.tokenId)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          markKey,
                          itemName: item.displayName ?? item.name,
                          tokenId: item.tokenId,
                        });
                      }}
                      className={`w-full text-left border-2 px-3 py-2 transition ${
                        isSelected
                          ? "bg-[#1a2240]"
                          : "bg-[#0c1222] hover:bg-[#131d35]"
                      }`}
                      style={{
                        borderColor: isSelected ? rc : item.equipped ? rc + "44" : "#1e2842",
                        borderLeftWidth: item.equipped ? 4 : 2,
                        borderLeftColor: item.equipped ? rc : undefined,
                        borderRightWidth: markColor ? 4 : 2,
                        borderRightColor: markColor ?? undefined,
                        cursor: "pointer",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] shrink-0">{CATEGORY_ICONS[item.category] ?? "\uD83D\uDCE6"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold truncate" style={{ color: rc }}>
                              {item.displayName ?? item.name}
                            </span>
                            {item.equipped && (
                              <span className="text-[7px] uppercase px-1 py-px border"
                                style={{ color: "#54f28b", borderColor: "#54f28b44", background: "#0a1a0e" }}>
                                EQ
                              </span>
                            )}
                            {mark && (
                              <span
                                className="text-[7px] uppercase px-1 py-px border font-bold"
                                style={{
                                  color: markColor!,
                                  borderColor: markColor! + "66",
                                  background: markColor! + "11",
                                }}
                                title={`Marked for ${mark}`}
                              >
                                {MARK_GLYPHS[mark]}
                              </span>
                            )}
                            {autoTradedTokenIds.has(item.tokenId) && (
                              <span
                                className="text-[7px] uppercase px-1 py-px border font-bold"
                                style={{
                                  color: "#5dadec",
                                  borderColor: "#5dadec66",
                                  background: "#5dadec11",
                                }}
                                title="Auto-trading rule active"
                              >
                                AUTO
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[8px] uppercase" style={{ color: rc + "99" }}>{item.rarity}</span>
                            <span className="text-[8px] text-[#9aa7cc]">x{item.quantity}</span>
                            {item.recycleCopperValue > 0 && (
                              <span className="text-[8px] text-[#54f28b]">{formatCopperString(item.recycleCopperValue)}</span>
                            )}
                            {item.equipSlot && !item.equipped && (
                              <span className="text-[7px] text-[#596a8a] uppercase">[{item.equipSlot}]</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div
            className="hidden sm:flex flex-col border-l border-[#1e2842] bg-[#0b1020]"
            style={{ width: 240, minHeight: 0 }}
          >
            {selectedItem ? (
              <ItemDetail
                item={selectedItem}
                zoneId={zoneId}
                busy={busy}
                onEquip={handleEquip}
                onUnequip={handleUnequip}
                onRecycle={handleRecycle}
                onAutoTrade={(it) => gameBus.emit("tradingRulesOpen", {
                  tokenId: it.tokenId,
                  itemName: it.displayName ?? it.name,
                })}
                hasAutoTradeRule={autoTradedTokenIds.has(selectedItem.tokenId)}
              />
            ) : (
              <div className="flex items-center justify-center flex-1 p-4">
                <span className="text-[10px] text-[#596a8a] text-center">Select an item to view details</span>
              </div>
            )}
          </div>
        </div>

        {/* Mobile detail — shows below list when item is selected on small screens */}
        {selectedItem && (
          <div className="sm:hidden border-t border-[#1e2842] bg-[#0b1020]">
            <ItemDetail
              item={selectedItem}
              zoneId={zoneId}
              busy={busy}
              onEquip={handleEquip}
              onUnequip={handleUnequip}
              onRecycle={handleRecycle}
              onAutoTrade={(it) => gameBus.emit("tradingRulesOpen", {
                tokenId: it.tokenId,
                itemName: it.displayName ?? it.name,
              })}
              hasAutoTradeRule={autoTradedTokenIds.has(selectedItem.tokenId)}
            />
          </div>
        )}
      </div>

      {/* Right-click context menu — floats over everything */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          itemName={contextMenu.itemName}
          currentMark={getMark(contextMenu.markKey)}
          hasAutoTrade={autoTradedTokenIds.has(contextMenu.tokenId)}
          onPick={(action) => {
            if (action === null) clearMark(contextMenu.markKey);
            else setMark(contextMenu.markKey, action);
            setContextMenu(null);
          }}
          onAutoTrade={() => {
            gameBus.emit("tradingRulesOpen", {
              tokenId: contextMenu.tokenId,
              itemName: contextMenu.itemName,
            });
            setContextMenu(null);
          }}
        />
      )}

      {/* Process Marks modal — fires the actual sell/auction/destroy calls */}
      {processOpen && itemWallet && address && (
        <ProcessMarksModal
          open={processOpen}
          onClose={() => setProcessOpen(false)}
          markedItems={markedItems}
          itemWallet={itemWallet}
          authWallet={address}
          zoneId={zoneId}
          onItemProcessed={(key, success) => {
            // Successful items: drop the mark so the inventory refresh below
            // doesn't re-show them as marked once the row disappears.
            if (success) clearMark(key);
          }}
          onAllComplete={() => {
            void fetchInventory();
          }}
        />
      )}
    </div>
  );
}

/* ── Right-click context menu ─────────────────────────────── */

function ContextMenu({
  x,
  y,
  itemName,
  currentMark,
  hasAutoTrade,
  onPick,
  onAutoTrade,
}: {
  x: number;
  y: number;
  itemName: string;
  currentMark: ItemMarkAction | undefined;
  hasAutoTrade: boolean;
  onPick: (action: ItemMarkAction | null) => void;
  onAutoTrade: () => void;
}): React.ReactElement {
  // Estimate menu size and clamp to viewport so the menu never spawns
  // off-screen. Exact size depends on font metrics so we use safe defaults.
  const W = 200;
  const H = (currentMark ? 156 : 124) + 32; // +32 for the auto-trade row
  const px = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1000) - W - 8);
  const py = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 800) - H - 8);

  // Stop propagation so the global mousedown handler doesn't dismiss the menu
  // before our buttons' onClick fires.
  return (
    <div
      className="fixed z-[201] border-2 border-black bg-[#0a0f1e] shadow-[4px_4px_0_0_#000]"
      style={{ left: px, top: py, width: W, fontFamily: "monospace" }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-b border-[#29334d] bg-[#11182b] px-2 py-1 text-[9px] uppercase tracking-wide text-[#9aa7cc] truncate" title={itemName}>
        {itemName}
      </div>
      {(["sell", "auction", "destroy"] as ItemMarkAction[]).map((action) => {
        const isActive = currentMark === action;
        const color = MARK_COLORS[action];
        return (
          <button
            key={action}
            type="button"
            onClick={() => onPick(action)}
            className="flex w-full items-center gap-2 px-2 py-2 sm:py-1.5 text-left text-[11px] sm:text-[10px] uppercase tracking-wide transition hover:bg-[#131d35]"
            style={{ color, cursor: "pointer", background: isActive ? "#11182b" : "transparent" }}
          >
            <span className="inline-block w-4 text-center font-bold" style={{ color }}>
              {MARK_GLYPHS[action]}
            </span>
            <span>Mark for {action}</span>
            {isActive && <span className="ml-auto text-[9px]">✓</span>}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAutoTrade}
        className="flex w-full items-center gap-2 border-t border-[#29334d] px-2 py-2 sm:py-1.5 text-left text-[11px] sm:text-[10px] uppercase tracking-wide transition hover:bg-[#131d35]"
        style={{ color: "#5dadec", cursor: "pointer" }}
        title="Open auto-trading rules with this item pre-filled"
      >
        <span className="inline-block w-4 text-center font-bold" style={{ color: "#5dadec" }}>
          T
        </span>
        <span>{hasAutoTrade ? "Edit auto-trade rule" : "Set auto-trade rule…"}</span>
        {hasAutoTrade && <span className="ml-auto text-[9px]">✓</span>}
      </button>
      {currentMark && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="flex w-full items-center gap-2 border-t border-[#29334d] px-2 py-1.5 text-left text-[10px] uppercase tracking-wide text-[#6b7a9e] hover:bg-[#131d35]"
          style={{ cursor: "pointer" }}
        >
          <span className="inline-block w-4 text-center">×</span>
          <span>Clear mark</span>
        </button>
      )}
    </div>
  );
}

/* ── Item Detail sub-component ────────────────────────────── */

function ItemDetail({
  item,
  zoneId,
  busy,
  onEquip,
  onUnequip,
  onRecycle,
  onAutoTrade,
  hasAutoTradeRule,
}: {
  item: InventoryItem;
  zoneId: string | null;
  busy: number | null;
  onEquip: (item: InventoryItem) => void;
  onUnequip: (item: InventoryItem) => void;
  onRecycle: (item: InventoryItem, qty: number) => void;
  onAutoTrade: (item: InventoryItem) => void;
  hasAutoTradeRule: boolean;
}): React.ReactElement {
  const rc = RARITY_COLORS[item.rarity] ?? "#9aa7cc";
  const durPct =
    item.maxDurability && item.maxDurability > 0
      ? Math.round(((item.durability ?? 0) / item.maxDurability) * 100)
      : null;
  const durColor = durPct === null ? null : durPct > 66 ? "#54f28b" : durPct > 33 ? "#ffcc00" : "#ff6b6b";
  const canEquip = !!item.equipSlot && !item.equipped && !!zoneId;
  const canUnequip = item.equipped && !!item.equippedSlot && !!zoneId;
  const canRecycle = item.recyclableQuantity > 0;
  const recycleValueTotal = item.recycleCopperValue * item.recyclableQuantity;
  const isBusy = busy === item.tokenId;

  return (
    <div className="flex flex-col p-3 gap-2 overflow-y-auto" style={{ minHeight: 0 }}>
      {/* Name + rarity */}
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[16px]">{CATEGORY_ICONS[item.category] ?? "\uD83D\uDCE6"}</span>
          <span className="text-[12px] font-bold" style={{ color: rc }}>{item.displayName ?? item.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[8px] uppercase tracking-wide border px-1 py-px"
            style={{ color: rc, borderColor: rc + "44", background: rc + "11" }}>
            {item.rarity}
          </span>
          <span className="text-[8px] text-[#596a8a] uppercase">{item.category}</span>
          {item.equipSlot && (
            <span className="text-[8px] text-[#596a8a] uppercase">Slot: {item.equipSlot}</span>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-[9px] text-[#7a84a8] leading-relaxed">{item.description}</p>

      {/* Stats row */}
      <div className="border border-[#1e2842] bg-[#0a0f1e] p-2 space-y-1">
        <div className="flex justify-between text-[9px]">
          <span className="text-[#596a8a]">Quantity</span>
          <span className="text-[#ffcc00] font-bold">{item.quantity}</span>
        </div>
        {item.equipped && (
          <div className="flex justify-between text-[9px]">
            <span className="text-[#596a8a]">Equipped</span>
            <span className="text-[#54f28b] font-bold">{item.equippedCount} in [{item.equippedSlot}]</span>
          </div>
        )}
        {item.recycleCopperValue > 0 && (
          <div className="flex justify-between text-[9px]">
            <span className="text-[#596a8a]">Sell value (each)</span>
            <span className="text-[#54f28b] font-bold">{formatCopperString(item.recycleCopperValue)}</span>
          </div>
        )}
        {canRecycle && item.recyclableQuantity > 1 && (
          <div className="flex justify-between text-[9px]">
            <span className="text-[#596a8a]">Sell all ({item.recyclableQuantity})</span>
            <span className="text-[#54f28b] font-bold">{formatCopperString(recycleValueTotal)}</span>
          </div>
        )}
        {durPct !== null && (
          <div className="space-y-0.5">
            <div className="flex justify-between text-[9px]">
              <span className="text-[#596a8a]">Durability</span>
              <span style={{ color: durColor ?? "#54f28b" }}>{item.durability}/{item.maxDurability}</span>
            </div>
            <div className="h-1.5 border border-black bg-[#0f1528] rounded-sm overflow-hidden">
              <div className="h-full rounded-sm" style={{ width: `${durPct}%`, backgroundColor: durColor ?? "#54f28b" }} />
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-1.5 mt-auto">
        {canEquip && (
          <button
            onClick={() => onEquip(item)}
            disabled={busy !== null}
            className="w-full border-2 border-[#54f28b66] bg-[#0a1a0e] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[#54f28b] hover:bg-[#54f28b22] transition disabled:opacity-40"
            style={{ cursor: "pointer" }}
          >
            {isBusy ? "EQUIPPING..." : `EQUIP \u2192 ${item.equipSlot?.toUpperCase()}`}
          </button>
        )}
        {canUnequip && (
          <button
            onClick={() => onUnequip(item)}
            disabled={busy !== null}
            className="w-full border-2 border-[#ff6b6b44] bg-[#1a0a0a] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[#ff6b6b] hover:bg-[#ff6b6b22] transition disabled:opacity-40"
            style={{ cursor: "pointer" }}
          >
            {isBusy ? "REMOVING..." : "UNEQUIP"}
          </button>
        )}
        {canRecycle && (
          <>
            <button
              onClick={() => onRecycle(item, 1)}
              disabled={busy !== null}
              className="w-full border-2 border-[#54f28b44] bg-[#09160d] px-3 py-2 sm:py-1.5 text-[11px] sm:text-[10px] uppercase tracking-wide text-[#54f28b] hover:bg-[#54f28b22] transition disabled:opacity-40"
              style={{ cursor: "pointer" }}
            >
              {isBusy ? "SELLING..." : `SELL 1 \u00B7 ${formatCopperString(item.recycleCopperValue)}`}
            </button>
            {item.recyclableQuantity > 1 && (
              <button
                onClick={() => onRecycle(item, item.recyclableQuantity)}
                disabled={busy !== null}
                className="w-full border-2 border-[#54f28b22] bg-[#08110b] px-3 py-2 sm:py-1.5 text-[11px] sm:text-[10px] uppercase tracking-wide text-[#8af7b0] hover:bg-[#54f28b18] transition disabled:opacity-40"
                style={{ cursor: "pointer" }}
              >
                {isBusy ? "SELLING..." : `SELL ALL (${item.recyclableQuantity}) \u00B7 ${formatCopperString(recycleValueTotal)}`}
              </button>
            )}
          </>
        )}
        <button
          onClick={() => onAutoTrade(item)}
          className="w-full border-2 border-[#5dadec66] bg-[#0a1424] px-3 py-2 sm:py-1.5 text-[11px] sm:text-[10px] uppercase tracking-wide text-[#5dadec] hover:bg-[#5dadec22] transition"
          style={{ cursor: "pointer" }}
          title="Open the auto-trading rules editor with this item pre-filled"
        >
          {hasAutoTradeRule ? "EDIT AUTO-TRADE RULE" : "AUTO-TRADE…"}
        </button>
      </div>
    </div>
  );
}
