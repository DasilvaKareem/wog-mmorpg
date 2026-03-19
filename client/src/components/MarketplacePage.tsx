import * as React from "react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../config.js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { SimpleCurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useWalletContext } from "@/context/WalletContext";
import { useWogNames } from "@/hooks/useWogNames";
import { getAuthToken } from "@/lib/agentAuth";
import { mppFetch } from "@/lib/mppClient";

// ── Types ──

interface MarketListing {
  auctionId: number;
  zoneId: string;
  seller: string;
  tokenId: number;
  itemName: string;
  itemDescription: string;
  itemCategory: string;
  equipSlot: string | null;
  armorSlot: string | null;
  statBonuses: Record<string, number>;
  maxDurability: number | null;
  quantity: number;
  startPrice: number;
  buyoutPrice: number | null;
  currentBid: number | null;
  highBidder: string | null;
  bidCount: number;
  endsAt: number;
  timeRemaining: number;
  status: string;
}

interface MarketStats {
  activeListings: number;
  totalSales: number;
  totalVolume: string;
  uniqueSellers: number;
  uniqueBidders: number;
}

interface DirectListing {
  listingId: string;
  sellerWallet: string;
  tokenId: number;
  quantity: number;
  instanceId?: string;
  priceUsd: number;
  priceGold?: number;
  status: string;
  createdAt: number;
  expiresAt: number;
  itemName?: string;
  itemDescription?: string;
  itemCategory?: string;
  quality?: string | null;
  bonusAffix?: string | null;
  statBonuses?: Record<string, number>;
  durability?: number | null;
  maxDurability?: number | null;
}

interface OwnedItem {
  tokenId: string;
  name: string;
  balance: string;
  category?: string;
  equipSlot?: string | null;
  statBonuses?: Record<string, number>;
}

interface MarketplacePageProps {
  onBack?: () => void;
}

// ── Constants ──

const CATEGORIES = [
  { value: "all", label: "All Items" },
  { value: "weapon", label: "Weapons" },
  { value: "armor", label: "Armor" },
  { value: "consumable", label: "Consumables" },
  { value: "material", label: "Materials" },
  { value: "tool", label: "Tools" },
];

const SORT_OPTIONS = [
  { value: "ending-soon", label: "Ending Soon" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: Low" },
  { value: "price-desc", label: "Price: High" },
];

const CATEGORY_ICONS: Record<string, string> = {
  weapon: ">>",
  armor: "[]",
  consumable: "++",
  material: "**",
  tool: "//",
  all: "##",
};

const RARITY_COLORS: Record<string, string> = {
  common: "#9aa7cc",
  uncommon: "#54f28b",
  rare: "#5dadec",
  epic: "#b48efa",
  legendary: "#ffcc00",
};

// ── Helpers ──

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTimeLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTimeRemaining(endsAt: number): string {
  const seconds = Math.max(0, Math.floor(endsAt - Date.now() / 1000));
  if (seconds <= 0) return "Ended";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function formatStatBonuses(bonuses: Record<string, number>): string {
  return Object.entries(bonuses)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k.toUpperCase()}`)
    .join(", ");
}

// ── Component ──

export function MarketplacePage({ onBack }: MarketplacePageProps): React.ReactElement {
  const navigate = useNavigate();
  const goBack = onBack ?? (() => navigate("/"));
  const { address, balance, isConnected, connect, loading: walletLoading, refreshBalance } = useWalletContext(); // connect/walletLoading used in sell/bids tabs
  const { notify } = useToast();

  // State
  const [activeTab, setActiveTab] = React.useState("browse");
  const [listings, setListings] = React.useState<MarketListing[]>([]);
  const [myListings, setMyListings] = React.useState<MarketListing[]>([]);
  const [myBids, setMyBids] = React.useState<MarketListing[]>([]);
  const [stats, setStats] = React.useState<MarketStats | null>(null);
  const [loadingListings, setLoadingListings] = React.useState(false);

  // ── USD Direct Market state ──
  const [usdListings, setUsdListings] = React.useState<DirectListing[]>([]);
  const [loadingUsd, setLoadingUsd] = React.useState(false);
  const [usdProcessingId, setUsdProcessingId] = React.useState<string | null>(null);
  const [usdCategory, setUsdCategory] = React.useState("all");
  const [usdSearch, setUsdSearch] = React.useState("");

  // USD sell form
  const [usdSellTokenId, setUsdSellTokenId] = React.useState("");
  const [usdSellQuantity, setUsdSellQuantity] = React.useState("1");
  const [usdSellPrice, setUsdSellPrice] = React.useState("");
  const [usdSelling, setUsdSelling] = React.useState(false);

  const sellerAddresses = React.useMemo(
    () => [
      ...listings.map((l) => l.seller),
      ...myListings.map((l) => l.seller),
      ...myBids.map((l) => l.seller),
      ...usdListings.map((l) => l.sellerWallet),
    ],
    [listings, myListings, myBids, usdListings]
  );
  const { dn } = useWogNames(sellerAddresses);

  // Filters
  const [category, setCategory] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState("ending-soon");

  // Bid tracking
  const [bidAmounts, setBidAmounts] = React.useState<Record<number, number>>({});
  const [processingId, setProcessingId] = React.useState<number | null>(null);

  // Sell form
  const [sellTokenId, setSellTokenId] = React.useState("");
  const [sellQuantity, setSellQuantity] = React.useState("1");
  const [sellStartPrice, setSellStartPrice] = React.useState(0);
  const [sellBuyoutPrice, setSellBuyoutPrice] = React.useState(0);
  const [sellDuration, setSellDuration] = React.useState("60");
  const [sellZone, setSellZone] = React.useState("village-square");
  const [selling, setSelling] = React.useState(false);

  // Detail view
  const [selectedListing, setSelectedListing] = React.useState<MarketListing | null>(null);

  // ── Data fetching ──

  const fetchListings = React.useCallback(async () => {
    setLoadingListings(true);
    try {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (search) params.set("search", search);
      params.set("sort", sort);

      const res = await fetch(`${API_URL}/marketplace/listings?${params}`);
      if (res.ok) {
        const data = await res.json();
        setListings(data.listings ?? []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingListings(false);
    }
  }, [category, search, sort]);

  const fetchMyListings = React.useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${API_URL}/marketplace/my-listings/${address}`);
      if (res.ok) {
        const data = await res.json();
        setMyListings(data.listings ?? []);
      }
    } catch {}
  }, [address]);

  const fetchMyBids = React.useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${API_URL}/marketplace/my-bids/${address}`);
      if (res.ok) {
        const data = await res.json();
        setMyBids(data.listings ?? []);
      }
    } catch {}
  }, [address]);

  const fetchStats = React.useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/marketplace/stats`);
      if (res.ok) {
        setStats(await res.json());
      }
    } catch {}
  }, []);

  // ── USD Direct Market data fetching ──

  const fetchUsdListings = React.useCallback(async () => {
    setLoadingUsd(true);
    try {
      const params = new URLSearchParams();
      if (usdCategory !== "all") params.set("category", usdCategory);
      if (usdSearch) params.set("search", usdSearch);
      params.set("sort", "newest");
      const res = await fetch(`${API_URL}/marketplace/direct/listings?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUsdListings(data.listings ?? []);
      }
    } catch {} finally {
      setLoadingUsd(false);
    }
  }, [usdCategory, usdSearch]);

  const handleUsdBuy = async (listing: DirectListing) => {
    if (!address || !isConnected) return;
    setUsdProcessingId(listing.listingId);
    try {
      const token = await getAuthToken(address);
      if (!token) { notify("Authentication failed", "error"); return; }
      // mppFetch auto-handles the 402 Tempo challenge:
      // 1st call → 402 → mppx signs USDC payment from wallet → replays with credential
      // 2nd call → 200 → purchase settled
      const res = await mppFetch(`${API_URL}/marketplace/direct/listings/${listing.listingId}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet: address }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "sold") notify("Purchase complete!", "success");
        else notify("Purchase initiated", "success");
        void fetchUsdListings();
        void refreshBalance();
      } else {
        const err = await res.json().catch(() => ({ error: "Purchase failed" }));
        notify(err.error || "Purchase failed", "error");
      }
    } catch (e: any) {
      // mppx throws if user rejects payment or insufficient USDC
      const msg = e?.message ?? "Purchase failed";
      if (msg.includes("rejected") || msg.includes("denied")) {
        notify("Payment cancelled", "error");
      } else if (msg.includes("insufficient") || msg.includes("balance")) {
        notify("Insufficient USDC balance — fund your wallet first", "error");
      } else {
        notify(msg, "error");
      }
    }
    finally { setUsdProcessingId(null); }
  };

  const handleUsdSell = async () => {
    if (!address || !usdSellTokenId || !usdSellPrice) return;
    const priceUsdCents = Math.round(parseFloat(usdSellPrice) * 100);
    if (priceUsdCents <= 0) { notify("Price must be > $0", "error"); return; }
    setUsdSelling(true);
    try {
      const token = await getAuthToken(address);
      if (!token) { notify("Authentication failed", "error"); return; }
      const res = await fetch(`${API_URL}/marketplace/direct/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          wallet: address,
          tokenId: parseInt(usdSellTokenId),
          quantity: parseInt(usdSellQuantity) || 1,
          priceUsd: priceUsdCents,
        }),
      });
      if (res.ok) {
        notify("Listed for sale! Item escrowed.", "success");
        setUsdSellTokenId(""); setUsdSellQuantity("1"); setUsdSellPrice("");
        void fetchUsdListings();
      } else {
        const err = await res.json();
        notify(err.error || "Listing failed", "error");
      }
    } catch { notify("Listing failed", "error"); }
    finally { setUsdSelling(false); }
  };

  const handleUsdCancel = async (listingId: string) => {
    if (!address) return;
    setUsdProcessingId(listingId);
    try {
      const token = await getAuthToken(address);
      if (!token) { notify("Authentication failed", "error"); return; }
      const res = await fetch(`${API_URL}/marketplace/direct/listings/${listingId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet: address }),
      });
      if (res.ok) {
        notify("Listing cancelled, items returned", "success");
        void fetchUsdListings();
      } else {
        const err = await res.json();
        notify(err.error || "Cancel failed", "error");
      }
    } catch { notify("Cancel failed", "error"); }
    finally { setUsdProcessingId(null); }
  };

  // Fetch balance on mount so wallet header shows correctly
  React.useEffect(() => {
    if (address) void refreshBalance();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial load + polling
  React.useEffect(() => {
    void fetchListings();
    void fetchStats();
    void fetchUsdListings();
  }, [fetchListings, fetchStats, fetchUsdListings]);

  React.useEffect(() => {
    if (address) {
      void fetchMyListings();
      void fetchMyBids();
    }
  }, [address, fetchMyListings, fetchMyBids]);

  // Poll every 10s
  React.useEffect(() => {
    const interval = setInterval(() => {
      void fetchListings();
      void fetchUsdListings();
      if (address) {
        void fetchMyListings();
        void fetchMyBids();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchListings, fetchUsdListings, fetchMyListings, fetchMyBids, address]);

  // Timer tick
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Actions ──

  const handleBid = async (listing: MarketListing) => {
    const amount = bidAmounts[listing.auctionId] ?? 0;
    if (!amount || !address) return;

    setProcessingId(listing.auctionId);
    try {
      const res = await fetch(`${API_URL}/auctionhouse/${listing.zoneId}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auctionId: listing.auctionId,
          bidder: address,
          bidderAddress: address,
          amount,
          bidAmount: amount,
        }),
      });

      if (res.ok) {
        notify("Bid placed successfully!", "success");
        setBidAmounts((prev) => ({ ...prev, [listing.auctionId]: 0 }));
        void fetchListings();
        void refreshBalance();
      } else {
        const err = await res.json();
        notify(err.error || "Bid failed", "error");
      }
    } catch {
      notify("Bid failed", "error");
    } finally {
      setProcessingId(null);
    }
  };

  const handleBuyout = async (listing: MarketListing) => {
    if (!address || !listing.buyoutPrice) return;

    setProcessingId(listing.auctionId);
    try {
      const res = await fetch(`${API_URL}/auctionhouse/${listing.zoneId}/buyout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auctionId: listing.auctionId,
          buyer: address,
          buyerAddress: address,
        }),
      });

      if (res.ok) {
        notify(`Bought for ${listing.buyoutPrice} GOLD!`, "success");
        void fetchListings();
        void refreshBalance();
      } else {
        const err = await res.json();
        notify(err.error || "Buyout failed", "error");
      }
    } catch {
      notify("Buyout failed", "error");
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = async (listing: MarketListing) => {
    if (!address) return;

    setProcessingId(listing.auctionId);
    try {
      const res = await fetch(`${API_URL}/auctionhouse/${listing.zoneId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auctionId: listing.auctionId,
          seller: address,
          sellerAddress: address,
        }),
      });

      if (res.ok) {
        notify("Listing cancelled", "success");
        void fetchListings();
        void fetchMyListings();
      } else {
        const err = await res.json();
        notify(err.error || "Cancel failed", "error");
      }
    } catch {
      notify("Cancel failed", "error");
    } finally {
      setProcessingId(null);
    }
  };

  const handleSell = async () => {
    if (!address || !sellTokenId || !sellStartPrice) return;

    setSelling(true);
    try {
      const res = await fetch(`${API_URL}/auctionhouse/${sellZone}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seller: address,
          sellerAddress: address,
          tokenId: parseInt(sellTokenId),
          quantity: parseInt(sellQuantity) || 1,
          startPrice: sellStartPrice,
          durationMinutes: parseInt(sellDuration),
          buyoutPrice: sellBuyoutPrice || undefined,
        }),
      });

      if (res.ok) {
        notify("Item listed for sale!", "success");
        setSellTokenId("");
        setSellQuantity("1");
        setSellStartPrice(0);
        setSellBuyoutPrice(0);
        setActiveTab("browse");
        void fetchListings();
        void fetchMyListings();
      } else {
        const err = await res.json();
        notify(err.error || "Listing failed", "error");
      }
    } catch {
      notify("Listing failed", "error");
    } finally {
      setSelling(false);
    }
  };

  // ── Owned items for sell tab ──
  const ownedItems: OwnedItem[] = balance?.items ?? [];

  // Refresh balance when entering sell or real-money tab
  React.useEffect(() => {
    if ((activeTab === "sell" || activeTab === "real-money") && address) {
      void refreshBalance();
    }
  }, [activeTab, address, refreshBalance]);

  // Derive item metadata from token ID selection
  const selectedItem = React.useMemo(
    () => ownedItems.find((item) => item.tokenId === sellTokenId),
    [ownedItems, sellTokenId]
  );

  // ── Render ──

  return (
    <div className="relative flex min-h-full w-full flex-col overflow-y-auto overflow-x-hidden pt-24">
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)",
        }}
      />

      {/* ── HEADER ── */}
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 pt-4 pb-2">
        <button
          onClick={goBack}
          className="border-2 border-[#6b7394] bg-[#1b2236] px-3 py-1.5 text-[9px] uppercase tracking-wide text-[#e8eeff] transition hover:bg-[#252d45]"
        >
          {"<< Back"}
        </button>
        <div>
          <h1
            className="text-[14px] uppercase tracking-widest text-[#ffcc00]"
            style={{ textShadow: "3px 3px 0 #000" }}
          >
            NFT Marketplace
          </h1>
          <p className="text-[8px] text-[#9aa7cc]">
            Buy, sell, and trade items across all zones
          </p>
        </div>
        {isConnected && balance && (
          <div className="ml-auto border-2 border-[#29334d] bg-[#0a0f1a] px-3 py-1.5 text-[9px]">
            <CurrencyDisplay amount={balance.gold} size="sm" />
          </div>
        )}
      </div>

      {/* ── STATS BAR ── */}
      {stats && (
        <div className="border-b-2 border-[#29334d] bg-[#0a0f1a]">
          <div className="mx-auto flex max-w-6xl items-center justify-center gap-6 px-4 py-2">
            {[
              { label: "Active Listings", value: stats.activeListings.toString(), color: "#54f28b" },
              { label: "Total Sales", value: stats.totalSales.toString(), color: "#ffcc00" },
              { label: "Sellers", value: stats.uniqueSellers.toString(), color: "#9ab9ff" },
              { label: "Bidders", value: stats.uniqueBidders.toString(), color: "#ff4d6d" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <span
                  className="text-[11px] font-bold"
                  style={{ color: s.color, textShadow: "1px 1px 0 #000" }}
                >
                  {s.value}
                </span>
                <span className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6 grid w-full grid-cols-5 bg-[#1a2340]">
            <TabsTrigger value="browse">Browse Market</TabsTrigger>
            <TabsTrigger value="sell">
              Sell Item
            </TabsTrigger>
            <TabsTrigger value="my-listings">
              My Listings {myListings.length > 0 && `(${myListings.length})`}
            </TabsTrigger>
            <TabsTrigger value="my-bids">
              My Bids {myBids.length > 0 && `(${myBids.length})`}
            </TabsTrigger>
            <TabsTrigger value="real-money" className="text-[#54f28b]">
              $ Real Money
            </TabsTrigger>
          </TabsList>

          {/* ════════════════════ BROWSE TAB ════════════════════ */}
          <TabsContent value="browse">
            {/* Detail overlay */}
            {selectedListing && (
              <ListingDetail
                listing={selectedListing}
                address={address}
                isConnected={isConnected}
                dn={dn}
                bidAmount={bidAmounts[selectedListing.auctionId] ?? 0}
                onBidAmountChange={(amount) =>
                  setBidAmounts((prev) => ({ ...prev, [selectedListing.auctionId]: amount }))
                }
                onBid={() => handleBid(selectedListing)}
                onBuyout={() => handleBuyout(selectedListing)}
                onClose={() => setSelectedListing(null)}
                processing={processingId === selectedListing.auctionId}
              />
            )}

            {/* Filters */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {/* Search */}
              <Input
                type="text"
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-56 border-2 border-[#29334d] bg-[#0a0f1a] text-[9px] text-[#f1f5ff]"
              />

              {/* Categories */}
              <div className="flex gap-1">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    className={`border-2 border-black px-2 py-1 text-[8px] uppercase tracking-wide transition ${
                      category === cat.value
                        ? "bg-[#ffcc00] text-black shadow-[2px_2px_0_0_#000]"
                        : "bg-[#2b3656] text-[#d6deff] hover:bg-[#33426b]"
                    }`}
                    onClick={() => setCategory(cat.value)}
                  >
                    <span className="mr-1">{CATEGORY_ICONS[cat.value] ?? ""}</span>
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Sort */}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="h-8 border-2 border-black bg-[#2b3656] px-2 text-[8px] uppercase tracking-wide text-[#d6deff] shadow-[2px_2px_0_0_#000]"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Listing Grid */}
            {loadingListings && listings.length === 0 ? (
              <div className="text-center text-[9px] text-[#9aa7cc]">
                Loading marketplace...
              </div>
            ) : listings.length === 0 ? (
              <div className="border-4 border-black bg-[#11192d] p-12 text-center shadow-[6px_6px_0_0_#000]">
                <p className="text-[12px] text-[#9aa7cc]">No listings found</p>
                <p className="mt-2 text-[9px] text-[#565f89]">
                  {search || category !== "all"
                    ? "Try adjusting your filters"
                    : "Be the first to list an item for sale!"}
                </p>
                {isConnected && (
                  <Button
                    className="mt-4"
                    size="sm"
                    onClick={() => setActiveTab("sell")}
                  >
                    List an Item
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map((listing) => (
                  <ListingCard
                    key={listing.auctionId}
                    listing={listing}
                    address={address}
                    isConnected={isConnected}
                    dn={dn}
                    onSelect={() => setSelectedListing(listing)}
                    onBuyout={() => handleBuyout(listing)}
                    processing={processingId === listing.auctionId}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ════════════════════ SELL TAB ════════════════════ */}
          <TabsContent value="sell">
            {!isConnected ? (
              <div className="border-4 border-black bg-[#11192d] p-12 text-center shadow-[6px_6px_0_0_#000]">
                <p className="text-[11px] text-[#9aa7cc]">
                  Connect your wallet to list items for sale
                </p>
                <Button
                  className="mt-4"
                  onClick={() => void connect()}
                  disabled={walletLoading}
                >
                  {walletLoading ? "Connecting..." : "Connect Wallet"}
                </Button>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Inventory */}
                <Card>
                  <CardHeader>
                    <CardTitle>Your Inventory</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ownedItems.length === 0 ? (
                      <p className="text-[9px] text-[#9aa7cc]">No items in your wallet</p>
                    ) : (
                      <div className="max-h-[400px] overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[8px]">Item</TableHead>
                              <TableHead className="text-[8px]">ID</TableHead>
                              <TableHead className="text-[8px]">Qty</TableHead>
                              <TableHead className="text-[8px]">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {ownedItems
                              .filter((item) => parseInt(item.balance) > 0)
                              .map((item) => (
                                <TableRow
                                  key={item.tokenId}
                                  className={
                                    sellTokenId === item.tokenId
                                      ? "bg-[#1a2e1a]"
                                      : ""
                                  }
                                >
                                  <TableCell>
                                    <div>
                                      <span className="text-[9px] font-semibold text-[#00ff88]">
                                        {item.name}
                                      </span>
                                      {item.category && (
                                        <Badge
                                          variant="secondary"
                                          className="ml-2"
                                        >
                                          {item.category}
                                        </Badge>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="font-mono text-[8px] text-[#565f89]">
                                    #{item.tokenId}
                                  </TableCell>
                                  <TableCell className="text-[9px]">
                                    x{item.balance}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      size="sm"
                                      className="h-6 px-2 text-[8px]"
                                      onClick={() => {
                                        setSellTokenId(item.tokenId);
                                        setSellQuantity("1");
                                      }}
                                    >
                                      {sellTokenId === item.tokenId ? "Selected" : "Sell"}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Sell Form */}
                <Card>
                  <CardHeader>
                    <CardTitle>Create Listing</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                          Selected Item
                        </label>
                        {selectedItem ? (
                          <div className="border-2 border-[#54f28b] bg-[#0a1a0d] p-2">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-[10px] font-bold text-[#54f28b]">
                                  {selectedItem.name}
                                </p>
                                <div className="mt-0.5 flex items-center gap-2">
                                  <span className="font-mono text-[7px] text-[#565f89]">
                                    Token #{selectedItem.tokenId}
                                  </span>
                                  {selectedItem.category && (
                                    <Badge variant="secondary" className="text-[6px]">
                                      {selectedItem.category}
                                    </Badge>
                                  )}
                                </div>
                                {selectedItem.statBonuses && Object.keys(selectedItem.statBonuses).length > 0 && (
                                  <p className="mt-0.5 text-[7px] text-[#9ab9ff]">
                                    {formatStatBonuses(selectedItem.statBonuses)}
                                  </p>
                                )}
                              </div>
                              <button
                                className="ml-2 border border-[#6b7394] bg-[#1b2236] px-2 py-0.5 text-[7px] text-[#9aa7cc] hover:bg-[#252d45]"
                                onClick={() => { setSellTokenId(""); setSellQuantity("1"); }}
                              >
                                clear
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="border-2 border-dashed border-[#29334d] bg-[#0a0f1a] p-3 text-center">
                            <p className="text-[8px] text-[#565f89]">
                              ← Click <span className="text-[#ffcc00]">Sell</span> on an item in your inventory
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                          Quantity
                          {selectedItem && (
                            <span className="ml-1 text-[#565f89]">
                              (max: {selectedItem.balance})
                            </span>
                          )}
                        </label>
                        <Input
                          type="number"
                          value={sellQuantity}
                          onChange={(e) => setSellQuantity(e.target.value)}
                          min="1"
                          max={selectedItem ? selectedItem.balance : undefined}
                          className="h-8 border-2 border-[#29334d] bg-[#0a0f1a] text-[9px] text-[#f1f5ff]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                          Starting Price (GOLD)
                        </label>
                        <SimpleCurrencyInput
                          value={sellStartPrice}
                          onChange={setSellStartPrice}
                          min={0.0001}
                          size="sm"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                          Buyout Price (optional)
                        </label>
                        <SimpleCurrencyInput
                          value={sellBuyoutPrice}
                          onChange={setSellBuyoutPrice}
                          min={0}
                          size="sm"
                        />
                        <p className="text-[7px] text-[#565f89]">
                          Set a buyout price for instant purchase
                        </p>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                          Duration
                        </label>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { label: "30m", value: "30" },
                            { label: "1h", value: "60" },
                            { label: "2h", value: "120" },
                            { label: "6h", value: "360" },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              className={`border-2 border-black p-1.5 text-[9px] font-bold shadow-[2px_2px_0_0_#000] transition ${
                                sellDuration === opt.value
                                  ? "bg-[#ffcc00] text-black"
                                  : "bg-[#2b3656] text-[#9aa7cc] hover:bg-[#3a4870]"
                              }`}
                              onClick={() => setSellDuration(opt.value)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                          Listing Zone
                        </label>
                        <div className="grid grid-cols-3 gap-1">
                          {[
                            { label: "Village", value: "village-square", color: "#54f28b" },
                            { label: "Wilds", value: "wild-meadow", color: "#ffcc00" },
                            { label: "Forest", value: "dark-forest", color: "#ff4d6d" },
                          ].map((z) => (
                            <button
                              key={z.value}
                              className={`border-2 border-black p-1.5 text-[9px] font-bold shadow-[2px_2px_0_0_#000] transition ${
                                sellZone === z.value
                                  ? "text-black"
                                  : "bg-[#2b3656] text-[#9aa7cc] hover:bg-[#3a4870]"
                              }`}
                              style={
                                sellZone === z.value
                                  ? { backgroundColor: z.color }
                                  : undefined
                              }
                              onClick={() => setSellZone(z.value)}
                            >
                              {z.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <Button
                        className="h-9 w-full text-[10px] font-bold uppercase"
                        onClick={handleSell}
                        disabled={selling || !sellTokenId || !sellStartPrice}
                      >
                        {selling ? "Listing..." : "List for Sale"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* ════════════════════ MY LISTINGS TAB ════════════════════ */}
          <TabsContent value="my-listings">
            {!isConnected ? (
              <div className="border-4 border-black bg-[#11192d] p-12 text-center shadow-[6px_6px_0_0_#000]">
                <p className="text-[11px] text-[#9aa7cc]">
                  Connect your wallet to manage your listings
                </p>
                <Button
                  className="mt-4"
                  onClick={() => void connect()}
                  disabled={walletLoading}
                >
                  Connect Wallet
                </Button>
              </div>
            ) : myListings.length === 0 ? (
              <div className="border-4 border-black bg-[#11192d] p-12 text-center shadow-[6px_6px_0_0_#000]">
                <p className="text-[11px] text-[#9aa7cc]">
                  You have no active listings
                </p>
                <Button
                  className="mt-4"
                  size="sm"
                  onClick={() => setActiveTab("sell")}
                >
                  List an Item
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[8px]">Item</TableHead>
                    <TableHead className="text-[8px]">Zone</TableHead>
                    <TableHead className="text-[8px]">Current Bid</TableHead>
                    <TableHead className="text-[8px]">Buyout</TableHead>
                    <TableHead className="text-[8px]">Time Left</TableHead>
                    <TableHead className="text-[8px]">Status</TableHead>
                    <TableHead className="text-[8px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myListings.map((listing) => {
                    const isActive = listing.status === "active";
                    return (
                      <TableRow key={listing.auctionId}>
                        <TableCell>
                          <div>
                            <span className="text-[9px] font-semibold text-[#00ff88]">
                              {listing.itemName}
                            </span>
                            <div className="text-[8px] text-[#9aa7cc]">
                              x{listing.quantity}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-[8px] text-[#9aa7cc]">
                          {listing.zoneId}
                        </TableCell>
                        <TableCell>
                          {listing.currentBid ? (
                            <CurrencyDisplay amount={listing.currentBid} size="sm" />
                          ) : (
                            <CurrencyDisplay amount={listing.startPrice} size="sm" />
                          )}
                        </TableCell>
                        <TableCell>
                          {listing.buyoutPrice ? (
                            <CurrencyDisplay amount={listing.buyoutPrice} size="sm" />
                          ) : (
                            <span className="text-[8px] text-[#9aa7cc]">--</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`text-[9px] font-bold ${
                              listing.timeRemaining < 300
                                ? "text-[#ff4d6d]"
                                : "text-[#f1f5ff]"
                            }`}
                          >
                            {formatTimeRemaining(listing.endsAt)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={isActive ? "success" : "secondary"}>
                            {listing.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {isActive && !listing.highBidder ? (
                            <Button
                              size="sm"
                              variant="danger"
                              className="h-6 px-2 text-[8px]"
                              onClick={() => handleCancel(listing)}
                              disabled={processingId === listing.auctionId}
                            >
                              Cancel
                            </Button>
                          ) : isActive ? (
                            <Badge variant="default">Has Bids</Badge>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ════════════════════ MY BIDS TAB ════════════════════ */}
          <TabsContent value="my-bids">
            {!isConnected ? (
              <div className="border-4 border-black bg-[#11192d] p-12 text-center shadow-[6px_6px_0_0_#000]">
                <p className="text-[11px] text-[#9aa7cc]">
                  Connect your wallet to see your bids
                </p>
                <Button
                  className="mt-4"
                  onClick={() => void connect()}
                  disabled={walletLoading}
                >
                  Connect Wallet
                </Button>
              </div>
            ) : myBids.length === 0 ? (
              <div className="border-4 border-black bg-[#11192d] p-12 text-center shadow-[6px_6px_0_0_#000]">
                <p className="text-[11px] text-[#9aa7cc]">
                  You have no active bids
                </p>
                <Button
                  className="mt-4"
                  size="sm"
                  onClick={() => setActiveTab("browse")}
                >
                  Browse Market
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[8px]">Item</TableHead>
                    <TableHead className="text-[8px]">Zone</TableHead>
                    <TableHead className="text-[8px]">Your Bid</TableHead>
                    <TableHead className="text-[8px]">Buyout</TableHead>
                    <TableHead className="text-[8px]">Seller</TableHead>
                    <TableHead className="text-[8px]">Time Left</TableHead>
                    <TableHead className="text-[8px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myBids.map((listing) => (
                    <TableRow key={listing.auctionId}>
                      <TableCell>
                        <div>
                          <span className="text-[9px] font-semibold text-[#00ff88]">
                            {listing.itemName}
                          </span>
                          <div className="text-[8px] text-[#9aa7cc]">
                            x{listing.quantity}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-[8px] text-[#9aa7cc]">
                        {listing.zoneId}
                      </TableCell>
                      <TableCell>
                        <CurrencyDisplay
                          amount={listing.currentBid ?? listing.startPrice}
                          size="sm"
                        />
                      </TableCell>
                      <TableCell>
                        {listing.buyoutPrice ? (
                          <CurrencyDisplay amount={listing.buyoutPrice} size="sm" />
                        ) : (
                          <span className="text-[8px] text-[#9aa7cc]">--</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[8px] text-[#9aa7cc]">
                        {dn(listing.seller)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-[9px] font-bold ${
                            listing.timeRemaining < 300
                              ? "text-[#ff4d6d]"
                              : "text-[#f1f5ff]"
                          }`}
                        >
                          {formatTimeRemaining(listing.endsAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">Winning</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ════════════════════ REAL MONEY TAB ════════════════════ */}
          <TabsContent value="real-money">
            {/* Wallet Balance + Info Bar */}
            <div className="mb-4 flex items-center justify-between border-2 border-[#29334d] bg-[#0d1526] p-3">
              <p className="text-[9px] text-[#9aa7cc]">
                Buy and sell items for <span className="font-bold text-[#54f28b]">real USD</span> via Tempo payments.
              </p>
              {isConnected && (
                <UsdcWalletBalance address={address!} />
              )}
            </div>

            {/* USD Filters */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Input
                type="text"
                placeholder="Search items..."
                value={usdSearch}
                onChange={(e) => setUsdSearch(e.target.value)}
                className="h-8 w-56 border-2 border-[#29334d] bg-[#0a0f1a] text-[9px] text-[#f1f5ff]"
              />
              <div className="flex gap-1">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    className={`border-2 border-black px-2 py-1 text-[8px] uppercase tracking-wide transition ${
                      usdCategory === cat.value
                        ? "bg-[#54f28b] text-black shadow-[2px_2px_0_0_#000]"
                        : "bg-[#2b3656] text-[#d6deff] hover:bg-[#33426b]"
                    }`}
                    onClick={() => setUsdCategory(cat.value)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* USD Listings (2 cols) */}
              <div className="lg:col-span-2">
                <h3
                  className="mb-3 text-[11px] uppercase tracking-wide text-[#ffcc00]"
                  style={{ textShadow: "2px 2px 0 #000" }}
                >
                  Items for Sale (USD)
                </h3>
                {loadingUsd && usdListings.length === 0 ? (
                  <div className="text-center text-[9px] text-[#9aa7cc]">Loading...</div>
                ) : usdListings.length === 0 ? (
                  <div className="border-4 border-black bg-[#11192d] p-8 text-center shadow-[6px_6px_0_0_#000]">
                    <p className="text-[10px] text-[#9aa7cc]">No USD listings yet</p>
                    <p className="mt-1 text-[8px] text-[#565f89]">
                      List an item from your inventory to sell for real money
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {usdListings.map((listing) => {
                      const isMine = address && listing.sellerWallet.toLowerCase() === address.toLowerCase();
                      return (
                        <Card key={listing.listingId}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <CardTitle
                                className="text-[10px]"
                                style={{
                                  color: listing.quality
                                    ? RARITY_COLORS[listing.quality] ?? "#00ff88"
                                    : "#00ff88",
                                }}
                              >
                                {listing.itemName || `Token #${listing.tokenId}`}
                              </CardTitle>
                              {listing.itemCategory && (
                                <Badge variant="secondary">{listing.itemCategory}</Badge>
                              )}
                            </div>
                            <p className="text-[8px] text-[#9aa7cc]">
                              Qty: {listing.quantity}
                              {listing.bonusAffix && ` | ${listing.bonusAffix}`}
                              {listing.statBonuses && Object.keys(listing.statBonuses).length > 0 &&
                                ` | ${formatStatBonuses(listing.statBonuses)}`}
                            </p>
                          </CardHeader>
                          <CardContent>
                            <div className="mb-2 flex items-center justify-between">
                              <div>
                                <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Price</p>
                                <p className="text-[12px] font-bold text-[#54f28b]" style={{ textShadow: "1px 1px 0 #000" }}>
                                  {formatUsd(listing.priceUsd)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Expires</p>
                                <p className="text-[9px] text-[#f1f5ff]">{formatTimeLeft(listing.expiresAt)}</p>
                              </div>
                            </div>
                            <div className="mb-2 flex items-center gap-2">
                              <span className="font-mono text-[7px] text-[#565f89]">
                                {dn(listing.sellerWallet)}
                              </span>
                              {isMine && <Badge variant="success" className="text-[6px]">You</Badge>}
                            </div>
                            {isMine ? (
                              <Button
                                size="sm"
                                variant="danger"
                                className="h-7 w-full text-[8px]"
                                onClick={() => handleUsdCancel(listing.listingId)}
                                disabled={usdProcessingId === listing.listingId}
                              >
                                {usdProcessingId === listing.listingId ? "Cancelling..." : "Cancel Listing"}
                              </Button>
                            ) : isConnected ? (
                              <Button
                                size="sm"
                                className="h-7 w-full text-[9px] font-bold"
                                onClick={() => handleUsdBuy(listing)}
                                disabled={usdProcessingId === listing.listingId}
                              >
                                {usdProcessingId === listing.listingId
                                  ? "Processing..."
                                  : `Buy for ${formatUsd(listing.priceUsd)}`}
                              </Button>
                            ) : null}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* USD Sell Form (1 col) */}
              <div>
                <h3
                  className="mb-3 text-[11px] uppercase tracking-wide text-[#ffcc00]"
                  style={{ textShadow: "2px 2px 0 #000" }}
                >
                  Sell for USD
                </h3>
                {!isConnected ? (
                  <Card>
                    <CardContent className="py-6 text-center">
                      <p className="text-[9px] text-[#9aa7cc]">Connect wallet to sell items</p>
                      <Button className="mt-3" size="sm" onClick={() => void connect()} disabled={walletLoading}>
                        Connect Wallet
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="space-y-3 pt-4">
                      {/* Item picker */}
                      {ownedItems.length > 0 && (
                        <div className="space-y-1">
                          <label className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Select Item</label>
                          <div className="max-h-36 overflow-y-auto">
                            {ownedItems
                              .filter((i) => parseInt(i.balance) > 0)
                              .map((item) => (
                                <button
                                  key={item.tokenId}
                                  className={`mb-1 w-full border-2 p-1.5 text-left text-[8px] transition ${
                                    usdSellTokenId === item.tokenId
                                      ? "border-[#54f28b] bg-[#0a1a0d]"
                                      : "border-[#29334d] bg-[#0a0f1a] hover:bg-[#1a2340]"
                                  }`}
                                  onClick={() => { setUsdSellTokenId(item.tokenId); setUsdSellQuantity("1"); }}
                                >
                                  <span className="font-semibold text-[#00ff88]">{item.name}</span>
                                  <span className="ml-2 text-[#9aa7cc]">x{item.balance}</span>
                                </button>
                              ))}
                          </div>
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Quantity</label>
                        <Input
                          type="number"
                          value={usdSellQuantity}
                          onChange={(e) => setUsdSellQuantity(e.target.value)}
                          min="1"
                          className="h-7 border-2 border-[#29334d] bg-[#0a0f1a] text-[9px] text-[#f1f5ff]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Price (USD)</label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-[#54f28b]">$</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            placeholder="0.00"
                            value={usdSellPrice}
                            onChange={(e) => setUsdSellPrice(e.target.value)}
                            className="h-7 border-2 border-[#29334d] bg-[#0a0f1a] pl-6 text-[9px] text-[#f1f5ff]"
                          />
                        </div>
                      </div>

                      <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2 text-[7px] text-[#565f89]">
                        Items are burned into escrow. Unsold items return after 7 days.
                      </div>

                      <Button
                        className="h-8 w-full text-[9px] font-bold uppercase"
                        onClick={handleUsdSell}
                        disabled={usdSelling || !usdSellTokenId || !usdSellPrice}
                      >
                        {usdSelling ? "Listing..." : "List for USD"}
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* ── FOOTER ── */}
      <footer className="border-t-4 border-black bg-[#0d1526] px-4 py-4 text-center">
        <p className="text-[8px] text-[#565f89]">
          World of Geneva NFT Marketplace -- Powered by SKALE L2 -- Zero Gas Fees
        </p>
      </footer>
    </div>
  );
}

// ── Sub-components ──

function UsdcWalletBalance({ address }: { address: string }): React.ReactElement {
  const [bal, setBal] = React.useState<string | null>(null);

  React.useEffect(() => {
    const usdcContract = import.meta.env.VITE_MPP_CURRENCY_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    const rpcUrl = import.meta.env.VITE_MPP_RPC_URL || "https://sepolia.base.org";
    const data = "0x70a08231" + address.slice(2).padStart(64, "0");
    fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: usdcContract, data }, "latest"] }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.result && res.result !== "0x") {
          setBal((Number(BigInt(res.result)) / 1e6).toFixed(2));
        } else {
          setBal("0.00");
        }
      })
      .catch(() => setBal(null));
  }, [address]);

  if (bal === null) return <></>;

  return (
    <div className="border-2 border-[#54f28b] bg-[#0a1a0d] px-3 py-1 shadow-[2px_2px_0_0_#000]">
      <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Wallet </span>
      <span className="text-[10px] font-bold text-[#54f28b]">${bal}</span>
      <span className="text-[8px] text-[#9aa7cc]"> USDC</span>
    </div>
  );
}

function ListingCard({
  listing,
  address,
  isConnected,
  dn,
  onSelect,
  onBuyout,
  processing,
}: {
  listing: MarketListing;
  address: string | null;
  isConnected: boolean;
  dn: (addr: string) => string;
  onSelect: () => void;
  onBuyout: () => void;
  processing: boolean;
}): React.ReactElement {
  const isUrgent = listing.endsAt - Date.now() / 1000 < 300;
  const isMine = address && listing.seller.toLowerCase() === address.toLowerCase();

  return (
    <Card className="cursor-pointer transition hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_#000]">
      <div onClick={onSelect}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[10px]">{listing.itemName}</CardTitle>
            <Badge
              variant={
                listing.itemCategory === "weapon"
                  ? "danger"
                  : listing.itemCategory === "armor"
                    ? "default"
                    : "secondary"
              }
            >
              {listing.itemCategory}
            </Badge>
          </div>
          <p className="text-[8px] text-[#9aa7cc]">{listing.itemDescription}</p>
        </CardHeader>

        <CardContent>
          {/* Stats */}
          {Object.keys(listing.statBonuses).length > 0 && (
            <div className="mb-2 border-2 border-[#29334d] bg-[#0a0f1a] px-2 py-1">
              <p className="text-[8px] text-[#9ab9ff]">
                {formatStatBonuses(listing.statBonuses)}
              </p>
            </div>
          )}

          {/* Price section */}
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">
                {listing.currentBid ? "Current Bid" : "Starting Price"}
              </p>
              <CurrencyDisplay
                amount={listing.currentBid ?? listing.startPrice}
                size="sm"
              />
            </div>
            {listing.buyoutPrice && (
              <div className="text-right">
                <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">
                  Buyout
                </p>
                <CurrencyDisplay amount={listing.buyoutPrice} size="sm" />
              </div>
            )}
          </div>

          {/* Bottom row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[7px] text-[#565f89]">
                {dn(listing.seller)}
              </span>
              {isMine && (
                <Badge variant="success" className="text-[6px]">
                  You
                </Badge>
              )}
            </div>
            <span
              className={`text-[9px] font-bold ${
                isUrgent ? "text-[#ff4d6d]" : "text-[#f1f5ff]"
              }`}
            >
              {formatTimeRemaining(listing.endsAt)}
            </span>
          </div>
        </CardContent>
      </div>

      {/* Buyout button */}
      {listing.buyoutPrice && isConnected && !isMine && (
        <div className="border-t-2 border-[#2e3853] px-3 py-2">
          <Button
            size="sm"
            className="h-7 w-full text-[9px]"
            onClick={(e) => {
              e.stopPropagation();
              onBuyout();
            }}
            disabled={processing}
          >
            {processing ? "Processing..." : `Buy Now`}
          </Button>
        </div>
      )}
    </Card>
  );
}

function ListingDetail({
  listing,
  address,
  isConnected,
  dn,
  bidAmount,
  onBidAmountChange,
  onBid,
  onBuyout,
  onClose,
  processing,
}: {
  listing: MarketListing;
  address: string | null;
  isConnected: boolean;
  dn: (addr: string) => string;
  bidAmount: number;
  onBidAmountChange: (amount: number) => void;
  onBid: () => void;
  onBuyout: () => void;
  onClose: () => void;
  processing: boolean;
}): React.ReactElement {
  const isUrgent = listing.endsAt - Date.now() / 1000 < 300;
  const isMine = address && listing.seller.toLowerCase() === address.toLowerCase();
  const minBid = listing.currentBid ? listing.currentBid + 1 : listing.startPrice;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.8)_0px,rgba(0,0,0,0.8)_2px,rgba(0,0,0,0.74)_2px,rgba(0,0,0,0.74)_4px)]"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 w-full max-w-lg border-4 border-black bg-[linear-gradient(180deg,#18213a,#0a1021)] p-0 text-[#edf2ff] shadow-[8px_8px_0_0_#000]">
        {/* Header */}
        <div className="border-b-2 border-[#2d3651] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] uppercase tracking-wide text-[#ffdd57]" style={{ textShadow: "2px 2px 0 #000" }}>
              {listing.itemName}
            </h2>
            <button
              onClick={onClose}
              className="border-2 border-[#6b7394] bg-[#1b2236] px-2 py-1 text-[8px] text-[#e8eeff] hover:bg-[#252d45]"
            >
              X
            </button>
          </div>
          <p className="mt-1 text-[9px] text-[#9aa7cc]">{listing.itemDescription}</p>
        </div>

        {/* Body */}
        <div className="space-y-3 p-4">
          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2">
              <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Category</p>
              <Badge
                variant={
                  listing.itemCategory === "weapon"
                    ? "danger"
                    : listing.itemCategory === "armor"
                      ? "default"
                      : "secondary"
                }
              >
                {listing.itemCategory}
              </Badge>
            </div>
            <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2">
              <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Quantity</p>
              <p className="text-[10px] font-bold text-[#f1f5ff]">x{listing.quantity}</p>
            </div>
            <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2">
              <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Zone</p>
              <p className="text-[10px] font-bold text-[#f1f5ff]">{listing.zoneId}</p>
            </div>
            <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2">
              <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Seller</p>
              <p className="font-mono text-[9px] text-[#f1f5ff]">
                {dn(listing.seller)}
                {isMine && <span className="ml-1 text-[#54f28b]">(You)</span>}
              </p>
            </div>
          </div>

          {/* Stats */}
          {Object.keys(listing.statBonuses).length > 0 && (
            <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2">
              <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Stats</p>
              <p className="text-[10px] font-bold text-[#9ab9ff]">
                {formatStatBonuses(listing.statBonuses)}
              </p>
              {listing.maxDurability && (
                <p className="text-[8px] text-[#9aa7cc]">
                  Durability: {listing.maxDurability}
                </p>
              )}
            </div>
          )}

          {/* Price & Timer */}
          <div className="grid grid-cols-3 gap-3">
            <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2">
              <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">
                {listing.currentBid ? "Current Bid" : "Start Price"}
              </p>
              <CurrencyDisplay
                amount={listing.currentBid ?? listing.startPrice}
                size="sm"
              />
            </div>
            {listing.buyoutPrice && (
              <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2">
                <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">
                  Buyout
                </p>
                <CurrencyDisplay amount={listing.buyoutPrice} size="sm" />
              </div>
            )}
            <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2">
              <p className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">
                Time Left
              </p>
              <p
                className={`text-[10px] font-bold ${
                  isUrgent ? "text-[#ff4d6d]" : "text-[#f1f5ff]"
                }`}
              >
                {formatTimeRemaining(listing.endsAt)}
              </p>
            </div>
          </div>

          {/* Actions */}
          {isConnected && !isMine && (
            <div className="space-y-2 border-t-2 border-[#2d3651] pt-3">
              {/* Bid */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">
                    Your Bid (min: {minBid} GOLD)
                  </label>
                  <SimpleCurrencyInput
                    value={bidAmount}
                    onChange={onBidAmountChange}
                    min={minBid}
                    size="sm"
                  />
                </div>
                <Button
                  size="sm"
                  className="h-8 px-4 text-[9px]"
                  onClick={onBid}
                  disabled={processing || !bidAmount || bidAmount < minBid}
                >
                  {processing ? "..." : "Place Bid"}
                </Button>
              </div>

              {/* Buyout */}
              {listing.buyoutPrice && (
                <Button
                  className="h-9 w-full text-[10px] font-bold"
                  onClick={onBuyout}
                  disabled={processing}
                >
                  {processing ? "Processing..." : `Buy Now for ${listing.buyoutPrice} GOLD`}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
