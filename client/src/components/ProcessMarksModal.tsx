// Process Marks modal — fires the API calls for every right-click-marked
// item. Items are grouped by action; each fires sequentially so a failure
// in one doesn't take down the rest. Items that succeed have their mark
// cleared so the user can re-open the dialog and retry the failed ones
// without re-marking everything.
//
// Auction params are global rather than per-item by design — per-item
// editors balloon the UI. If a user wants different prices per item, they
// can process auctions one batch at a time.

import * as React from "react";
import { API_URL } from "@/config";
import { getAuthToken } from "@/lib/agentAuth";
import { formatCopperString } from "@/lib/currency";
import { gameBus } from "@/lib/eventBus";
import type { ItemMarkAction } from "@/context/ItemMarksContext";

export interface MarkedItemSummary {
  markKey: string;
  action: ItemMarkAction;
  tokenId: number;
  name: string;
  quantity: number;
  rarity: string;
  recycleCopperValue: number;
  equipped: boolean;
}

interface ProcessMarksModalProps {
  open: boolean;
  onClose: () => void;
  markedItems: MarkedItemSummary[];
  /** Wallet that holds the items (custodial if deployed). */
  itemWallet: string;
  /** Wallet used to authenticate (signs the JWT). */
  authWallet: string;
  zoneId: string | null;
  onItemProcessed: (markKey: string, success: boolean) => void;
  onAllComplete: () => void;
}

type ItemStatus = "pending" | "processing" | "success" | "failed";

interface ItemState {
  status: ItemStatus;
  error?: string;
}

const MARK_COLORS: Record<ItemMarkAction, string> = {
  sell: "#54f28b",
  auction: "#ffcc00",
  destroy: "#ff6b6b",
};

const DEFAULT_AUCTION_START_COPPER = 1000; // 10 GOLD
const DEFAULT_AUCTION_DURATION_MIN = 1440; // 24 hours
const DEFAULT_AUCTION_BUYOUT_COPPER = 0; // 0 = no buyout

export function ProcessMarksModal({
  open,
  onClose,
  markedItems,
  itemWallet,
  authWallet,
  zoneId,
  onItemProcessed,
  onAllComplete,
}: ProcessMarksModalProps): React.ReactElement | null {
  const sellItems = markedItems.filter((m) => m.action === "sell");
  const auctionItems = markedItems.filter((m) => m.action === "auction");
  const destroyItems = markedItems.filter((m) => m.action === "destroy");

  const [destroyConfirm, setDestroyConfirm] = React.useState("");
  const [auctionStart, setAuctionStart] = React.useState(DEFAULT_AUCTION_START_COPPER);
  const [auctionDuration, setAuctionDuration] = React.useState(DEFAULT_AUCTION_DURATION_MIN);
  const [auctionBuyout, setAuctionBuyout] = React.useState(DEFAULT_AUCTION_BUYOUT_COPPER);
  const [processing, setProcessing] = React.useState(false);
  const [completed, setCompleted] = React.useState(false);
  const [globalError, setGlobalError] = React.useState<string | null>(null);
  const [itemStates, setItemStates] = React.useState<Record<string, ItemState>>({});

  // Reset transient state every time the modal opens fresh.
  React.useEffect(() => {
    if (!open) return;
    setDestroyConfirm("");
    setProcessing(false);
    setCompleted(false);
    setGlobalError(null);
    setItemStates({});
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !processing) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, processing, onClose]);

  if (!open) return null;

  const destroyArmed = destroyItems.length === 0 || destroyConfirm === "DESTROY";
  const auctionValid = auctionItems.length === 0 || (
    auctionStart > 0
    && auctionDuration >= 1
    && (auctionBuyout === 0 || auctionBuyout > auctionStart)
  );
  const submitEnabled = !processing && !completed && destroyArmed && auctionValid;

  async function process() {
    if (!submitEnabled) return;
    setProcessing(true);
    setGlobalError(null);

    const token = await getAuthToken(authWallet);
    if (!token) {
      setGlobalError("Auth failed — could not get session token.");
      setProcessing(false);
      return;
    }

    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    const updateItem = (key: string, patch: ItemState) =>
      setItemStates((prev) => ({ ...prev, [key]: patch }));

    // ── Sell group ─────────────────────────────────────────────────
    // Each item re-queries /shop/sell-nearest with its own tokenId because
    // different merchants buy different items. The resolved merchantEntityId
    // is then passed to /shop/sell.
    for (const m of sellItems) {
      updateItem(m.markKey, { status: "processing" });
      try {
        const nearestRes = await fetch(`${API_URL}/shop/sell-nearest`, {
          method: "POST",
          headers,
          body: JSON.stringify({ sellerAddress: itemWallet, tokenId: m.tokenId, quantity: m.quantity }),
        });
        const nearest = await nearestRes.json();
        if (!nearestRes.ok) {
          updateItem(m.markKey, { status: "failed", error: nearest.error ?? "No merchant" });
          onItemProcessed(m.markKey, false);
          continue;
        }

        const sellRes = await fetch(`${API_URL}/shop/sell`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            sellerAddress: itemWallet,
            merchantEntityId: nearest.merchantEntityId,
            tokenId: m.tokenId,
            quantity: m.quantity,
          }),
        });
        const sellData = await sellRes.json();
        if (!sellRes.ok) {
          updateItem(m.markKey, { status: "failed", error: sellData.error ?? "Sell failed" });
          onItemProcessed(m.markKey, false);
          continue;
        }
        const payoutCopper = (sellData.totalPayout as number | undefined) ?? 0;
        if (payoutCopper > 0) gameBus.emit("goldGained", { copper: payoutCopper, source: "sell" });
        updateItem(m.markKey, { status: "success" });
        onItemProcessed(m.markKey, true);
      } catch {
        updateItem(m.markKey, { status: "failed", error: "Network error" });
        onItemProcessed(m.markKey, false);
      }
    }

    // ── Auction group ─────────────────────────────────────────────
    if (auctionItems.length > 0 && !zoneId) {
      for (const m of auctionItems) {
        updateItem(m.markKey, { status: "failed", error: "No zone — open the auction house in a zone" });
        onItemProcessed(m.markKey, false);
      }
    } else {
      for (const m of auctionItems) {
        updateItem(m.markKey, { status: "processing" });
        try {
          const res = await fetch(`${API_URL}/auctionhouse/${zoneId}/create`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              sellerAddress: itemWallet,
              tokenId: m.tokenId,
              quantity: m.quantity,
              startPrice: auctionStart,
              durationMinutes: auctionDuration,
              buyoutPrice: auctionBuyout > 0 ? auctionBuyout : undefined,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            updateItem(m.markKey, { status: "failed", error: data.error ?? "Auction failed" });
            onItemProcessed(m.markKey, false);
            continue;
          }
          updateItem(m.markKey, { status: "success" });
          onItemProcessed(m.markKey, true);
        } catch {
          updateItem(m.markKey, { status: "failed", error: "Network error" });
          onItemProcessed(m.markKey, false);
        }
      }
    }

    // ── Destroy group ─────────────────────────────────────────────
    for (const m of destroyItems) {
      updateItem(m.markKey, { status: "processing" });
      try {
        const res = await fetch(`${API_URL}/inventory/destroy`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            sellerAddress: itemWallet,
            tokenId: m.tokenId,
            quantity: m.quantity,
            confirm: "DESTROY",
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          updateItem(m.markKey, { status: "failed", error: data.error ?? "Destroy failed" });
          onItemProcessed(m.markKey, false);
          continue;
        }
        updateItem(m.markKey, { status: "success" });
        onItemProcessed(m.markKey, true);
      } catch {
        updateItem(m.markKey, { status: "failed", error: "Network error" });
        onItemProcessed(m.markKey, false);
      }
    }

    setProcessing(false);
    setCompleted(true);
    onAllComplete();
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center" style={{ fontFamily: "monospace" }}>
      <div className="absolute inset-0 bg-black/70" onClick={() => !processing && onClose()} />
      <div
        className="relative border-4 border-black bg-[#0a0f1e] shadow-[6px_6px_0_0_#000] flex flex-col"
        style={{ width: "min(560px, 95vw)", maxHeight: "min(85vh, 720px)" }}
      >
        <div className="flex items-center justify-between border-b-2 border-[#29334d] bg-[#11182b] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-[#f1f5ff]">Process Marks</span>
            <span className="text-[10px] text-[#596a8a]">({markedItems.length} items)</span>
          </div>
          <button
            onClick={onClose}
            disabled={processing}
            className="text-[11px] font-bold px-2 py-0.5 border border-[#29334d] text-[#6b7a9e] hover:text-[#f1f5ff] transition disabled:opacity-40"
            style={{ background: "transparent", cursor: processing ? "not-allowed" : "pointer" }}
          >
            {completed ? "DONE" : "ESC"}
          </button>
        </div>

        {globalError && (
          <div className="border-b border-[#ff6b6b33] bg-[#1a0a0a] px-4 py-1.5 text-[10px] text-[#ff6b6b]">
            {globalError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ minHeight: 0 }}>
          {sellItems.length > 0 && (
            <Group
              title={`Sell to nearest merchant (${sellItems.length})`}
              color={MARK_COLORS.sell}
              items={sellItems}
              itemStates={itemStates}
              info={zoneId
                ? "Each item is sold to the closest merchant in your zone that buys it."
                : "Warning: you have no current zone — sell will fail."}
            />
          )}

          {auctionItems.length > 0 && (
            <Group
              title={`Send to auction house (${auctionItems.length})`}
              color={MARK_COLORS.auction}
              items={auctionItems}
              itemStates={itemStates}
              info={zoneId
                ? `Listed in ${zoneId} — these settings apply to every auction below.`
                : "Warning: you have no current zone — auctions need a zone context."}
            >
              <div className="grid grid-cols-3 gap-2 text-[9px]">
                <label className="flex flex-col gap-0.5">
                  <span className="uppercase text-[#596a8a]">Start price (copper)</span>
                  <input
                    type="number"
                    min={1}
                    value={auctionStart}
                    onChange={(e) => setAuctionStart(Math.max(1, parseInt(e.target.value, 10) || 0))}
                    disabled={processing}
                    className="border border-[#29334d] bg-[#0c1222] px-2 py-1 text-[11px] text-[#f1f5ff]"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="uppercase text-[#596a8a]">Duration (minutes)</span>
                  <input
                    type="number"
                    min={1}
                    value={auctionDuration}
                    onChange={(e) => setAuctionDuration(Math.max(1, parseInt(e.target.value, 10) || 0))}
                    disabled={processing}
                    className="border border-[#29334d] bg-[#0c1222] px-2 py-1 text-[11px] text-[#f1f5ff]"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="uppercase text-[#596a8a]">Buyout (0 = none)</span>
                  <input
                    type="number"
                    min={0}
                    value={auctionBuyout}
                    onChange={(e) => setAuctionBuyout(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    disabled={processing}
                    className="border border-[#29334d] bg-[#0c1222] px-2 py-1 text-[11px] text-[#f1f5ff]"
                  />
                </label>
              </div>
              {!auctionValid && (
                <div className="text-[9px] text-[#ff6b6b]">
                  Buyout (if set) must be greater than start price.
                </div>
              )}
            </Group>
          )}

          {destroyItems.length > 0 && (
            <Group
              title={`Destroy permanently (${destroyItems.length})`}
              color={MARK_COLORS.destroy}
              items={destroyItems}
              itemStates={itemStates}
              info="These items are burned with no reward. Type DESTROY below to confirm."
            >
              <input
                type="text"
                value={destroyConfirm}
                onChange={(e) => setDestroyConfirm(e.target.value.toUpperCase())}
                disabled={processing}
                placeholder='Type "DESTROY" to enable'
                className="w-full border border-[#ff6b6b66] bg-[#1a0a0a] px-2 py-1 text-[11px] text-[#ff6b6b] placeholder:text-[#ff6b6b66]"
              />
            </Group>
          )}

          {markedItems.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <span className="text-[11px] text-[#596a8a]">No marked items.</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t-2 border-[#29334d] bg-[#11182b] px-4 py-2.5">
          <button
            onClick={onClose}
            disabled={processing}
            className="px-3 py-1 text-[10px] uppercase tracking-wide border border-[#29334d] text-[#6b7a9e] hover:text-[#f1f5ff] transition disabled:opacity-40"
            style={{ background: "transparent", cursor: processing ? "not-allowed" : "pointer" }}
          >
            {completed ? "Close" : "Cancel"}
          </button>
          {!completed && (
            <button
              onClick={() => void process()}
              disabled={!submitEnabled}
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide border-2 border-[#ffcc00] bg-[#2a2210] text-[#ffcc00] hover:bg-[#3d3218] transition disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ cursor: submitEnabled ? "pointer" : "not-allowed" }}
            >
              {processing ? "Processing..." : `Process ${markedItems.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({
  title,
  color,
  items,
  itemStates,
  info,
  children,
}: {
  title: string;
  color: string;
  items: MarkedItemSummary[];
  itemStates: Record<string, ItemState>;
  info?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="border-2" style={{ borderColor: color + "44" }}>
      <div
        className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-b"
        style={{ color, borderColor: color + "44", background: color + "11" }}
      >
        {title}
      </div>
      {info && (
        <div className="px-3 py-1.5 text-[9px] text-[#9aa7cc] bg-[#0c1222]">
          {info}
        </div>
      )}
      {children && <div className="px-3 py-2 bg-[#0c1222] space-y-2">{children}</div>}
      <ul className="divide-y divide-[#1e2842]">
        {items.map((m) => {
          const state = itemStates[m.markKey];
          return (
            <li key={m.markKey} className="flex items-center gap-2 px-3 py-1.5 text-[10px]">
              <span className="flex-1 truncate text-[#f1f5ff]">
                {m.name}
                <span className="text-[#596a8a]"> ×{m.quantity}</span>
                {m.equipped && (
                  <span className="ml-1 text-[8px] text-[#ff6b6b] uppercase">[equipped — will fail]</span>
                )}
              </span>
              {m.action === "sell" && m.recycleCopperValue > 0 && (
                <span className="text-[9px] text-[#54f28b]">~{formatCopperString(m.recycleCopperValue * m.quantity)}</span>
              )}
              <StatusGlyph state={state} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusGlyph({ state }: { state: ItemState | undefined }): React.ReactElement {
  if (!state || state.status === "pending") {
    return <span className="w-4 text-center text-[#596a8a]">·</span>;
  }
  if (state.status === "processing") {
    return <span className="w-4 text-center text-[#9aa7cc] animate-pulse">…</span>;
  }
  if (state.status === "success") {
    return <span className="w-4 text-center text-[#54f28b]">✓</span>;
  }
  return (
    <span className="w-4 text-center text-[#ff6b6b]" title={state.error}>
      ✗
    </span>
  );
}
