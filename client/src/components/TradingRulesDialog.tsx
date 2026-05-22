/**
 * TradingRulesDialog — Per-agent auto-trading limit orders.
 *
 * Each rule is a passive "buy under X / sell over Y" rule the agent's loop
 * fires every ~10s when the global toggle is on.
 *
 * Self-mounted: opens in response to the `tradingRulesOpen` gameBus event so
 * both the agent chat panel and the inventory dialog can trigger it.
 */
import * as React from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { API_URL } from "@/config";
import { gameBus } from "@/lib/eventBus";
import { useWalletContext } from "@/context/WalletContext";
import { getAuthToken } from "@/lib/agentAuth";

interface TradingRule {
  id: string;
  tokenId: number;
  itemName?: string;
  maxBuy?: number;
  minSell?: number;
  maxQty?: number;
  budget?: number;
  spent?: number;
  listDurationDays?: number;
  venue: "auction" | "direct" | "both";
  enabled: boolean;
  createdAt: number;
  lastFiredAt?: number;
}

interface InventoryItem {
  tokenId: number;
  name: string;
  quantity: number;
  equippedCount: number;
}

const VENUE_OPTIONS: TradingRule["venue"][] = ["auction", "direct", "both"];
const DURATION_OPTIONS = [1, 3, 7, 14, 30];

function emptyDraft(): Partial<TradingRule> {
  return {
    tokenId: 0,
    itemName: "",
    maxBuy: undefined,
    minSell: undefined,
    maxQty: undefined,
    budget: undefined,
    listDurationDays: 7,
    venue: "auction",
    enabled: true,
  };
}

export function TradingRulesDialog(): React.ReactElement {
  const { address } = useWalletContext();
  const walletAddress = address ?? null;

  const [open, setOpen] = React.useState(false);
  const [token, setToken] = React.useState<string | null>(null);
  const [rules, setRules] = React.useState<TradingRule[]>([]);
  const [tradingEnabled, setTradingEnabled] = React.useState(false);
  const [inventory, setInventory] = React.useState<InventoryItem[]>([]);
  const [draft, setDraft] = React.useState<Partial<TradingRule>>(emptyDraft());
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onOpenChange = setOpen;

  // Open in response to the gameBus event from chat panel / inventory bag.
  // Optionally pre-fill the draft when an item is passed in.
  React.useEffect(() => {
    return gameBus.on("tradingRulesOpen", (payload) => {
      setOpen(true);
      setError(null);
      if (payload?.tokenId) {
        setEditingId(null);
        setDraft({
          ...emptyDraft(),
          tokenId: payload.tokenId,
          itemName: payload.itemName,
        });
      }
    });
  }, []);

  // Resolve auth token for the current wallet whenever it changes.
  React.useEffect(() => {
    let cancelled = false;
    if (!walletAddress) { setToken(null); return; }
    void (async () => {
      const t = await getAuthToken(walletAddress).catch(() => null);
      if (!cancelled) setToken(t);
    })();
    return () => { cancelled = true; };
  }, [walletAddress]);

  // ── Data fetch ────────────────────────────────────────────────────────
  const refresh = React.useCallback(async () => {
    if (!walletAddress || !token) return;
    setLoading(true);
    setError(null);
    try {
      const [rulesRes, invRes] = await Promise.all([
        fetch(`${API_URL}/agent/trading-rules/${walletAddress}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/inventory/${walletAddress}`),
      ]);
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(data.rules ?? []);
        setTradingEnabled(data.tradingEnabled === true);
      }
      if (invRes.ok) {
        const data = await invRes.json();
        setInventory(data.items ?? []);
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [walletAddress, token]);

  React.useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // ── Actions ──────────────────────────────────────────────────────────
  const saveRule = async () => {
    if (!walletAddress || !token) return;
    if (!draft.tokenId || draft.tokenId <= 0) {
      setError("Pick an item first");
      return;
    }
    if (draft.maxBuy == null && draft.minSell == null) {
      setError("Set at least one of maxBuy or minSell");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Partial<TradingRule> = {
        ...draft,
        ...(editingId ? { id: editingId } : {}),
      };
      const res = await fetch(`${API_URL}/agent/trading-rules/${walletAddress}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setRules(data.rules ?? []);
      setDraft(emptyDraft());
      setEditingId(null);
      gameBus.emit("tradingRulesChanged", undefined);
    } catch (err: any) {
      setError(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (id: string) => {
    if (!walletAddress || !token) return;
    try {
      const res = await fetch(`${API_URL}/agent/trading-rules/${walletAddress}/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setRules(data.rules ?? []);
      gameBus.emit("tradingRulesChanged", undefined);
    } catch (err: any) {
      setError(err?.message ?? "Delete failed");
    }
  };

  const toggleRule = async (rule: TradingRule) => {
    if (!walletAddress || !token) return;
    try {
      const res = await fetch(`${API_URL}/agent/trading-rules/${walletAddress}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
      });
      const data = await res.json();
      if (res.ok) gameBus.emit("tradingRulesChanged", undefined);
      if (res.ok) setRules(data.rules ?? []);
    } catch { /* ignore */ }
  };

  const toggleGlobal = async (enabled: boolean) => {
    if (!walletAddress || !token) return;
    try {
      const res = await fetch(`${API_URL}/agent/trading-rules/${walletAddress}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) setTradingEnabled(enabled);
    } catch { /* ignore */ }
  };

  const startEdit = (rule: TradingRule) => {
    setEditingId(rule.id);
    setDraft({ ...rule });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
  };

  // ── Render ───────────────────────────────────────────────────────────
  const itemPickerSource: Array<{ tokenId: number; name: string; have: number }> = React.useMemo(() => {
    const merged = new Map<number, { tokenId: number; name: string; have: number }>();
    // Owned items first
    for (const inv of inventory) {
      merged.set(inv.tokenId, { tokenId: inv.tokenId, name: inv.name, have: inv.quantity });
    }
    // Items already in rules (so user can edit even if they no longer hold any)
    for (const r of rules) {
      if (!merged.has(r.tokenId)) {
        merged.set(r.tokenId, { tokenId: r.tokenId, name: r.itemName ?? `Token #${r.tokenId}`, have: 0 });
      }
    }
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory, rules]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto border-4 border-[#29334d] bg-[#11182b] p-0 text-[#f1f5ff]">
        <DialogHeader className="border-b-2 border-[#29334d] bg-[#1a2340] p-3 sm:p-4">
          <DialogTitle className="font-mono text-sm sm:text-sm text-[#00ff88]">Auto-Trading Rules</DialogTitle>
          <DialogDescription className="font-mono text-[11px] sm:text-[9px] text-[#9aa7cc]">
            Limit orders your agent fires while it plays. Buy under X, sell over Y.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 p-3 sm:space-y-4 sm:p-4">
          {/* Global toggle */}
          <div className="flex items-center justify-between gap-3 border-2 border-[#29334d] bg-[#0a0f1a] p-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] sm:text-[10px] font-bold uppercase tracking-widest text-[#f1f5ff]">
                Auto-trader
              </div>
              <div className="text-[10px] sm:text-[8px] text-[#9aa7cc]">
                When ON, agent evaluates rules every ~10s independently of focus.
              </div>
            </div>
            <button
              type="button"
              onClick={() => toggleGlobal(!tradingEnabled)}
              className={`shrink-0 border-2 border-black px-5 py-2.5 sm:px-4 sm:py-1.5 text-[12px] sm:text-[9px] font-bold uppercase tracking-widest shadow-[2px_2px_0_0_#000] transition ${
                tradingEnabled
                  ? "bg-[#54f28b] text-black"
                  : "bg-[#2b3656] text-[#9aa7cc] hover:bg-[#3a4870]"
              }`}
            >
              {tradingEnabled ? "ON" : "OFF"}
            </button>
          </div>

          {error && (
            <div className="border-2 border-[#ff4d6d] bg-[#1a0a14] p-2 text-[11px] sm:text-[9px] text-[#ff4d6d]">
              {error}
            </div>
          )}

          {/* Rule editor */}
          <div className="space-y-2.5 border-2 border-[#29334d] bg-[#0a0f1a] p-3">
            <div className="text-[12px] sm:text-[10px] font-bold uppercase tracking-widest text-[#00ff88]">
              {editingId ? "Edit rule" : "New rule"}
            </div>

            {/* Item picker */}
            <div className="space-y-1">
              <label className="block text-[10px] sm:text-[8px] text-[#9aa7cc]">Item</label>
              <select
                value={draft.tokenId ?? 0}
                onChange={(e) => {
                  const tid = parseInt(e.target.value);
                  const match = itemPickerSource.find((i) => i.tokenId === tid);
                  setDraft({ ...draft, tokenId: tid, itemName: match?.name });
                }}
                className="h-10 sm:h-7 w-full border-2 border-[#29334d] bg-[#11182b] px-2 text-[12px] sm:text-[9px] text-[#f1f5ff]"
              >
                <option value={0}>— pick an item —</option>
                {itemPickerSource.map((i) => (
                  <option key={i.tokenId} value={i.tokenId}>
                    {i.name} (#{i.tokenId}) {i.have > 0 ? `· have ${i.have}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-[10px] sm:text-[8px] text-[#9aa7cc]">Max buy / unit (GOLD)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  min="0"
                  placeholder="leave blank to disable buying"
                  value={draft.maxBuy ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, maxBuy: e.target.value ? Number(e.target.value) : undefined })
                  }
                  className="h-10 sm:h-7 w-full border-2 border-[#29334d] bg-[#11182b] px-2 text-[12px] sm:text-[9px] text-[#f1f5ff]"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] sm:text-[8px] text-[#9aa7cc]">Min sell / unit (GOLD)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  min="0"
                  placeholder="leave blank to disable selling"
                  value={draft.minSell ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, minSell: e.target.value ? Number(e.target.value) : undefined })
                  }
                  className="h-10 sm:h-7 w-full border-2 border-[#29334d] bg-[#11182b] px-2 text-[12px] sm:text-[9px] text-[#f1f5ff]"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] sm:text-[8px] text-[#9aa7cc]">Max hold qty</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="cap on holdings"
                  value={draft.maxQty ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, maxQty: e.target.value ? Number(e.target.value) : undefined })
                  }
                  className="h-10 sm:h-7 w-full border-2 border-[#29334d] bg-[#11182b] px-2 text-[12px] sm:text-[9px] text-[#f1f5ff]"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] sm:text-[8px] text-[#9aa7cc]">Buy budget (GOLD)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="total spend cap"
                  value={draft.budget ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, budget: e.target.value ? Number(e.target.value) : undefined })
                  }
                  className="h-10 sm:h-7 w-full border-2 border-[#29334d] bg-[#11182b] px-2 text-[12px] sm:text-[9px] text-[#f1f5ff]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-[10px] sm:text-[8px] text-[#9aa7cc]">Sell list duration</label>
                <select
                  value={draft.listDurationDays ?? 7}
                  onChange={(e) =>
                    setDraft({ ...draft, listDurationDays: parseInt(e.target.value) })
                  }
                  className="h-10 sm:h-7 w-full border-2 border-[#29334d] bg-[#11182b] px-2 text-[12px] sm:text-[9px] text-[#f1f5ff]"
                >
                  {DURATION_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} day{d > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] sm:text-[8px] text-[#9aa7cc]">Venue</label>
                <select
                  value={draft.venue ?? "auction"}
                  onChange={(e) =>
                    setDraft({ ...draft, venue: e.target.value as TradingRule["venue"] })
                  }
                  className="h-10 sm:h-7 w-full border-2 border-[#29334d] bg-[#11182b] px-2 text-[12px] sm:text-[9px] text-[#f1f5ff]"
                >
                  {VENUE_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                      {v === "direct" ? " (coming soon)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={saveRule}
                disabled={saving}
                className="border-2 border-black bg-[#54f28b] px-5 py-2.5 sm:px-4 sm:py-1.5 text-[12px] sm:text-[9px] font-bold uppercase tracking-widest text-black shadow-[2px_2px_0_0_#000] hover:translate-x-px hover:translate-y-px hover:shadow-none disabled:opacity-50"
              >
                {saving ? "Saving…" : editingId ? "Update rule" : "Add rule"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="border-2 border-black bg-[#2b3656] px-5 py-2.5 sm:px-4 sm:py-1.5 text-[12px] sm:text-[9px] font-bold uppercase tracking-widest text-[#9aa7cc] shadow-[2px_2px_0_0_#000] hover:bg-[#3a4870]"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Rule list */}
          <div className="space-y-2">
            <div className="text-[12px] sm:text-[10px] font-bold uppercase tracking-widest text-[#9aa7cc]">
              Active rules ({rules.length})
            </div>
            {loading && rules.length === 0 ? (
              <div className="text-center text-[11px] sm:text-[9px] text-[#9aa7cc]">Loading…</div>
            ) : rules.length === 0 ? (
              <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-4 text-center text-[11px] sm:text-[9px] text-[#565f89]">
                No rules yet. Add one above to start auto-trading.
              </div>
            ) : (
              rules.map((rule) => {
                const remainingBudget = rule.budget != null
                  ? Math.max(0, rule.budget - (rule.spent ?? 0))
                  : null;
                return (
                  <div
                    key={rule.id}
                    className={`border-2 p-2.5 sm:p-2 ${
                      rule.enabled ? "border-[#29334d] bg-[#0a0f1a]" : "border-[#2b3656] bg-[#070a12] opacity-60"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 text-[12px] sm:text-[10px] font-bold text-[#00ff88]">
                        {rule.itemName ?? `Token #${rule.tokenId}`}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleRule(rule)}
                          className={`min-w-[44px] border border-black px-2.5 py-1.5 sm:py-0.5 text-[11px] sm:text-[8px] font-bold uppercase ${
                            rule.enabled
                              ? "bg-[#54f28b] text-black"
                              : "bg-[#2b3656] text-[#9aa7cc]"
                          }`}
                        >
                          {rule.enabled ? "on" : "off"}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(rule)}
                          className="min-w-[44px] border border-black bg-[#2b3656] px-2.5 py-1.5 sm:py-0.5 text-[11px] sm:text-[8px] font-bold uppercase text-[#9aa7cc] hover:bg-[#3a4870]"
                        >
                          edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRule(rule.id)}
                          aria-label="Delete rule"
                          className="min-w-[44px] border border-black bg-[#ff4d6d] px-2.5 py-1.5 sm:py-0.5 text-[11px] sm:text-[8px] font-bold uppercase text-black hover:bg-[#ff6b8a]"
                        >
                          x
                        </button>
                      </div>
                    </div>
                    <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[11px] sm:text-[8px] text-[#9aa7cc] sm:grid-cols-2">
                      {rule.maxBuy != null && (
                        <div>
                          Buy ≤ <span className="text-[#ffcc00]">{rule.maxBuy} GOLD</span>
                        </div>
                      )}
                      {rule.minSell != null && (
                        <div>
                          Sell ≥ <span className="text-[#ffcc00]">{rule.minSell} GOLD</span>
                        </div>
                      )}
                      {rule.maxQty != null && <div>Hold cap: {rule.maxQty}</div>}
                      {rule.budget != null && (
                        <div>
                          Budget: {(rule.spent ?? 0).toFixed(4)} / {rule.budget.toFixed(4)}
                          {remainingBudget != null && remainingBudget <= 0 && (
                            <span className="ml-1 text-[#ff4d6d]">[depleted]</span>
                          )}
                        </div>
                      )}
                      <div>Venue: {rule.venue}</div>
                      <div>List dur: {rule.listDurationDays ?? 7}d</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
