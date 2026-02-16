import * as React from "react";
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

interface OwnedItem {
  tokenId: string;
  name: string;
  balance: string;
  category?: string;
  equipSlot?: string | null;
  statBonuses?: Record<string, number>;
}

interface MarketplacePageProps {
  onBack: () => void;
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

// ── Helpers ──

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
  const { address, balance, isConnected, connect, loading: walletLoading, refreshBalance } = useWalletContext();
  const { notify } = useToast();

  // State
  const [activeTab, setActiveTab] = React.useState("browse");
  const [listings, setListings] = React.useState<MarketListing[]>([]);
  const [myListings, setMyListings] = React.useState<MarketListing[]>([]);
  const [myBids, setMyBids] = React.useState<MarketListing[]>([]);
  const [stats, setStats] = React.useState<MarketStats | null>(null);
  const [loadingListings, setLoadingListings] = React.useState(false);

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

  // Initial load + polling
  React.useEffect(() => {
    void fetchListings();
    void fetchStats();
  }, [fetchListings, fetchStats]);

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
      if (address) {
        void fetchMyListings();
        void fetchMyBids();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchListings, fetchMyListings, fetchMyBids, address]);

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

  // ── Render ──

  return (
    <div className="relative flex min-h-full w-full flex-col overflow-y-auto overflow-x-hidden">
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)",
        }}
      />

      {/* ── HEADER ── */}
      <header className="sticky top-0 z-40 border-b-4 border-black bg-[#0d1526] shadow-[0_4px_0_0_#000]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
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
          </div>

          <div className="flex items-center gap-3">
            {isConnected && balance ? (
              <div className="flex items-center gap-3">
                <div className="border-2 border-[#29334d] bg-[#0a0f1a] px-3 py-1.5 text-[9px]">
                  <CurrencyDisplay amount={balance.gold} size="sm" />
                </div>
                <div className="border-2 border-[#54f28b] bg-[#112a1b] px-3 py-1.5 text-[8px] text-[#54f28b]">
                  {truncateAddress(address!)}
                </div>
              </div>
            ) : (
              <Button
                onClick={() => void connect()}
                disabled={walletLoading}
                size="sm"
              >
                {walletLoading ? "Connecting..." : "Connect Wallet"}
              </Button>
            )}
          </div>
        </div>
      </header>

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
          <TabsList className="mb-6 grid w-full grid-cols-4 bg-[#1a2340]">
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
          </TabsList>

          {/* ════════════════════ BROWSE TAB ════════════════════ */}
          <TabsContent value="browse">
            {/* Detail overlay */}
            {selectedListing && (
              <ListingDetail
                listing={selectedListing}
                address={address}
                isConnected={isConnected}
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
                              <TableHead className="text-[8px]">Qty</TableHead>
                              <TableHead className="text-[8px]">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {ownedItems
                              .filter((item) => parseInt(item.balance) > 0)
                              .map((item) => (
                                <TableRow key={item.tokenId}>
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
                                      Sell
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
                          Item Token ID
                        </label>
                        <Input
                          type="number"
                          placeholder="Select from inventory or enter token ID..."
                          value={sellTokenId}
                          onChange={(e) => setSellTokenId(e.target.value)}
                          className="h-8 border-2 border-[#29334d] bg-[#0a0f1a] text-[9px] text-[#f1f5ff]"
                        />
                        {sellTokenId && (
                          <p className="text-[8px] text-[#54f28b]">
                            Selected: Token #{sellTokenId}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                          Quantity
                        </label>
                        <Input
                          type="number"
                          value={sellQuantity}
                          onChange={(e) => setSellQuantity(e.target.value)}
                          min="1"
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
                        {truncateAddress(listing.seller)}
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

function ListingCard({
  listing,
  address,
  isConnected,
  onSelect,
  onBuyout,
  processing,
}: {
  listing: MarketListing;
  address: string | null;
  isConnected: boolean;
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
                {truncateAddress(listing.seller)}
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
                {truncateAddress(listing.seller)}
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
