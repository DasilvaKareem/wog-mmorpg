import * as React from "react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../config.js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useWalletContext } from "@/context/WalletContext";
import { useWogNames } from "@/hooks/useWogNames";
import { getAuthToken } from "@/lib/agentAuth";
import { mppFetch } from "@/lib/mppClient";

// ── Types ──

interface DirectListing {
  listingId: string;
  sellerWallet: string;
  tokenId: number;
  quantity: number;
  instanceId?: string;
  priceUsd: number;
  status: string;
  createdAt: number;
  expiresAt: number;
  itemName?: string;
  itemDescription?: string;
  itemCategory?: string;
  quality?: string | null;
  bonusAffix?: string | null;
  statBonuses?: Record<string, number>;
}

interface RentalListing {
  rentalId: string;
  ownerWallet: string;
  assetType: string;
  tokenId: number;
  instanceId?: string;
  durationSeconds: number;
  priceUsdCents: number;
  priceUsd: number;
  renewable: boolean;
  activeRentals: number;
  maxRentals: number;
  status: string;
  itemName?: string;
  itemCategory?: string;
  durationHours?: number;
}

interface RentalGrant {
  grantId: string;
  rentalId: string;
  renterWallet: string;
  ownerWallet: string;
  assetType: string;
  tokenId: number;
  instanceId?: string;
  startsAt: number;
  endsAt: number;
  status: string;
  renewCount: number;
  itemName?: string;
  timeLeftDisplay?: string;
  isExpiringSoon?: boolean;
}

interface OwnedItem {
  tokenId: string;
  name: string;
  balance: string;
  category?: string;
}

// ── Constants ──

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "weapon", label: "Weapons" },
  { value: "armor", label: "Armor" },
  { value: "consumable", label: "Consumables" },
  { value: "material", label: "Materials" },
];

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

function formatStatBonuses(bonuses: Record<string, number>): string {
  return Object.entries(bonuses)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k.toUpperCase()}`)
    .join(", ");
}

// ── Component ──

export function RealMoneyMarketPage(): React.ReactElement {
  const navigate = useNavigate();
  const { address, balance, isConnected, connect, loading: walletLoading, refreshBalance, characters } = useWalletContext();
  const { notify } = useToast();

  const [activeTab, setActiveTab] = React.useState("items");

  // ── Items state ──
  const [usdListings, setUsdListings] = React.useState<DirectListing[]>([]);
  const [loadingUsd, setLoadingUsd] = React.useState(false);
  const [usdProcessingId, setUsdProcessingId] = React.useState<string | null>(null);
  const [usdCategory, setUsdCategory] = React.useState("all");
  const [usdSearch, setUsdSearch] = React.useState("");
  const [usdSellTokenId, setUsdSellTokenId] = React.useState("");
  const [usdSellQuantity, setUsdSellQuantity] = React.useState("1");
  const [usdSellPrice, setUsdSellPrice] = React.useState("");
  const [usdSelling, setUsdSelling] = React.useState(false);

  // ── Character rental state ──
  const [rentalListings, setRentalListings] = React.useState<RentalListing[]>([]);
  const [myGrants, setMyGrants] = React.useState<RentalGrant[]>([]);
  const [loadingRentals, setLoadingRentals] = React.useState(false);
  const [rentalProcessingId, setRentalProcessingId] = React.useState<string | null>(null);
  const [rentPrice, setRentPrice] = React.useState("");
  const [rentDuration, setRentDuration] = React.useState("3600");
  const [rentCharName, setRentCharName] = React.useState("");
  const [listingRental, setListingRental] = React.useState(false);

  const ownedItems: OwnedItem[] = (balance?.items as any) ?? [];

  const allAddresses = React.useMemo(
    () => [
      ...usdListings.map((l) => l.sellerWallet),
      ...rentalListings.map((l) => l.ownerWallet),
    ],
    [usdListings, rentalListings]
  );
  const { dn } = useWogNames(allAddresses);

  // ── Data fetching ──

  const fetchUsdListings = React.useCallback(async () => {
    setLoadingUsd(true);
    try {
      const params = new URLSearchParams();
      if (usdCategory !== "all") params.set("category", usdCategory);
      if (usdSearch) params.set("search", usdSearch);
      params.set("sort", "newest");
      const res = await fetch(`${API_URL}/marketplace/direct/listings?${params}`);
      if (res.ok) setUsdListings((await res.json()).listings ?? []);
    } catch {} finally { setLoadingUsd(false); }
  }, [usdCategory, usdSearch]);

  const fetchRentalListings = React.useCallback(async () => {
    setLoadingRentals(true);
    try {
      const res = await fetch(`${API_URL}/rentals/listings`);
      if (res.ok) {
        const data = await res.json();
        setRentalListings((data.listings ?? []).filter((l: RentalListing) => l.assetType === "character"));
      }
    } catch {} finally { setLoadingRentals(false); }
  }, []);

  const fetchMyGrants = React.useCallback(async () => {
    if (!address) return;
    try {
      const token = await getAuthToken(address);
      if (!token) return;
      const res = await fetch(`${API_URL}/rentals/my-rentals`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setMyGrants((await res.json()).grants ?? []);
    } catch {}
  }, [address]);

  React.useEffect(() => {
    void fetchUsdListings();
    void fetchRentalListings();
    void fetchMyGrants();
  }, [fetchUsdListings, fetchRentalListings, fetchMyGrants]);

  React.useEffect(() => {
    const interval = setInterval(() => {
      void fetchUsdListings();
      void fetchRentalListings();
      void fetchMyGrants();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchUsdListings, fetchRentalListings, fetchMyGrants]);

  React.useEffect(() => {
    if ((activeTab === "items" || activeTab === "characters") && address) void refreshBalance();
  }, [activeTab, address, refreshBalance]);

  // Timer tick
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── Item actions ──

  const handleUsdBuy = async (listing: DirectListing) => {
    if (!address || !isConnected) return;
    setUsdProcessingId(listing.listingId);
    try {
      const token = await getAuthToken(address);
      if (!token) { notify("Authentication failed", "error"); return; }
      const res = await mppFetch(`${API_URL}/marketplace/direct/listings/${listing.listingId}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet: address }),
      });
      if (res.ok) {
        const data = await res.json();
        notify(data.status === "sold" ? "Purchase complete!" : "Purchase initiated", "success");
        void fetchUsdListings(); void refreshBalance();
      } else {
        const err = await res.json().catch(() => ({ error: "Purchase failed" }));
        notify(err.error || "Purchase failed", "error");
      }
    } catch (e: any) {
      const msg = e?.message ?? "Purchase failed";
      if (msg.includes("rejected") || msg.includes("denied")) notify("Payment cancelled", "error");
      else if (msg.includes("insufficient") || msg.includes("balance")) notify("Insufficient USDC balance", "error");
      else notify(msg, "error");
    } finally { setUsdProcessingId(null); }
  };

  const handleUsdSell = async () => {
    if (!address || !usdSellTokenId || !usdSellPrice) return;
    const cents = Math.round(parseFloat(usdSellPrice) * 100);
    if (cents <= 0) { notify("Price must be > $0", "error"); return; }
    setUsdSelling(true);
    try {
      const token = await getAuthToken(address);
      if (!token) { notify("Auth failed", "error"); return; }
      const res = await fetch(`${API_URL}/marketplace/direct/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet: address, tokenId: parseInt(usdSellTokenId), quantity: parseInt(usdSellQuantity) || 1, priceUsd: cents }),
      });
      if (res.ok) {
        notify("Listed for sale!", "success");
        setUsdSellTokenId(""); setUsdSellQuantity("1"); setUsdSellPrice("");
        void fetchUsdListings();
      } else { notify((await res.json()).error || "Failed", "error"); }
    } catch { notify("Failed", "error"); } finally { setUsdSelling(false); }
  };

  const handleUsdCancel = async (listingId: string) => {
    if (!address) return;
    setUsdProcessingId(listingId);
    try {
      const token = await getAuthToken(address);
      if (!token) return;
      const res = await fetch(`${API_URL}/marketplace/direct/listings/${listingId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet: address }),
      });
      if (res.ok) { notify("Cancelled, items returned", "success"); void fetchUsdListings(); }
      else { notify((await res.json()).error || "Failed", "error"); }
    } catch { notify("Failed", "error"); } finally { setUsdProcessingId(null); }
  };

  // ── Character rental actions ──

  const handleRentCharacter = async (rental: RentalListing) => {
    if (!address || !isConnected) return;
    setRentalProcessingId(rental.rentalId);
    try {
      const token = await getAuthToken(address);
      if (!token) { notify("Auth failed", "error"); return; }
      const res = await mppFetch(`${API_URL}/rentals/listings/${rental.rentalId}/rent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet: address, usageMode: "full" }),
      });
      if (res.ok) {
        notify("Character rented! Go to your party to activate.", "success");
        void fetchRentalListings(); void fetchMyGrants();
      } else {
        const err = await res.json().catch(() => ({ error: "Rental failed" }));
        notify(err.error || "Rental failed", "error");
      }
    } catch (e: any) { notify(e?.message ?? "Rental failed", "error"); }
    finally { setRentalProcessingId(null); }
  };

  const handleListCharacterForRent = async () => {
    if (!address || !rentCharName || !rentPrice) return;
    const cents = Math.round(parseFloat(rentPrice) * 100);
    if (cents <= 0) { notify("Price must be > $0", "error"); return; }
    setListingRental(true);
    try {
      const token = await getAuthToken(address);
      if (!token) { notify("Auth failed", "error"); return; }
      const res = await fetch(`${API_URL}/rentals/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          wallet: address,
          assetType: "character",
          tokenId: 0, // Characters use instanceId for name
          instanceId: rentCharName,
          durationSeconds: parseInt(rentDuration),
          priceUsdCents: cents,
          renewable: true,
        }),
      });
      if (res.ok) {
        notify("Character listed for rent!", "success");
        setRentCharName(""); setRentPrice("");
        void fetchRentalListings();
      } else { notify((await res.json()).error || "Failed", "error"); }
    } catch { notify("Failed", "error"); } finally { setListingRental(false); }
  };

  const handleActivateGrant = async (grant: RentalGrant) => {
    if (!address) return;
    setRentalProcessingId(grant.grantId);
    try {
      const token = await getAuthToken(address);
      if (!token) return;
      // Need renter's entity ID and zone — get from character progress
      const charRes = await fetch(`${API_URL}/character/${address}`, { headers: { Authorization: `Bearer ${token}` } });
      const charData = charRes.ok ? await charRes.json() : null;
      const liveEntity = charData?.liveEntity;
      if (!liveEntity) { notify("Deploy your character first before activating a rental", "error"); return; }
      const res = await fetch(`${API_URL}/rentals/grants/${grant.grantId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet: address, entityId: liveEntity.id, zoneId: liveEntity.region || "village-square" }),
      });
      if (res.ok) {
        notify("Character spawned and added to your party!", "success");
        void fetchMyGrants();
      } else { notify((await res.json()).error || "Activation failed", "error"); }
    } catch { notify("Activation failed", "error"); } finally { setRentalProcessingId(null); }
  };

  // ── Render ──

  return (
    <div className="relative flex min-h-full w-full flex-col overflow-y-auto overflow-x-hidden pt-24">
      {/* Scanline */}
      <div className="pointer-events-none fixed inset-0 z-50" style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)" }} />

      {/* Header */}
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 pt-4 pb-2">
        <button onClick={() => navigate("/")} className="border-2 border-[#6b7394] bg-[#1b2236] px-3 py-1.5 text-[9px] uppercase tracking-wide text-[#e8eeff] transition hover:bg-[#252d45]">
          {"<< Back"}
        </button>
        <div>
          <h1 className="text-[14px] uppercase tracking-widest text-[#54f28b]" style={{ textShadow: "3px 3px 0 #000" }}>
            Real Money Market
          </h1>
          <p className="text-[8px] text-[#9aa7cc]">Buy, sell, and rent with USD via Tempo payments</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => navigate("/marketplace")} className="border-2 border-[#ffcc00]/40 bg-[#2a2210] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#ffcc00] transition hover:bg-[#3d3218]">
            Gold Market
          </button>
          {isConnected && <UsdcWalletBalance address={address!} />}
        </div>
      </div>

      {/* Main */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6 grid w-full grid-cols-3 bg-[#1a2340]">
            <TabsTrigger value="items">Items</TabsTrigger>
            <TabsTrigger value="characters">Characters</TabsTrigger>
            <TabsTrigger value="my-rentals">
              My Rentals {myGrants.length > 0 && `(${myGrants.length})`}
            </TabsTrigger>
          </TabsList>

          {/* ═══ ITEMS TAB ═══ */}
          <TabsContent value="items">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Input type="text" placeholder="Search items..." value={usdSearch} onChange={(e) => setUsdSearch(e.target.value)} className="h-8 w-56 border-2 border-[#29334d] bg-[#0a0f1a] text-[9px] text-[#f1f5ff] focus:bg-[#0a0f1a] focus:text-[#f1f5ff]" />
              <div className="flex gap-1">
                {CATEGORIES.map((cat) => (
                  <button key={cat.value} className={`border-2 border-black px-2 py-1 text-[8px] uppercase tracking-wide transition ${usdCategory === cat.value ? "bg-[#54f28b] text-black shadow-[2px_2px_0_0_#000]" : "bg-[#2b3656] text-[#d6deff] hover:bg-[#33426b]"}`} onClick={() => setUsdCategory(cat.value)}>
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                {loadingUsd && usdListings.length === 0 ? (
                  <div className="text-center text-[9px] text-[#9aa7cc]">Loading...</div>
                ) : usdListings.length === 0 ? (
                  <div className="border-4 border-black bg-[#11192d] p-8 text-center shadow-[6px_6px_0_0_#000]">
                    <p className="text-[10px] text-[#9aa7cc]">No USD listings yet</p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {usdListings.map((listing) => {
                      const isMine = address && listing.sellerWallet.toLowerCase() === address.toLowerCase();
                      return (
                        <Card key={listing.listingId}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-[10px]" style={{ color: listing.quality ? RARITY_COLORS[listing.quality] ?? "#00ff88" : "#00ff88" }}>
                                {listing.itemName || `Token #${listing.tokenId}`}
                              </CardTitle>
                              {listing.itemCategory && <Badge variant="secondary">{listing.itemCategory}</Badge>}
                            </div>
                            <p className="text-[8px] text-[#9aa7cc]">
                              Qty: {listing.quantity}
                              {listing.statBonuses && Object.keys(listing.statBonuses).length > 0 && ` | ${formatStatBonuses(listing.statBonuses)}`}
                            </p>
                          </CardHeader>
                          <CardContent>
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-[12px] font-bold text-[#54f28b]" style={{ textShadow: "1px 1px 0 #000" }}>{formatUsd(listing.priceUsd)}</p>
                              <p className="text-[8px] text-[#9aa7cc]">{formatTimeLeft(listing.expiresAt)}</p>
                            </div>
                            <div className="mb-2"><span className="font-mono text-[7px] text-[#565f89]">{dn(listing.sellerWallet)}</span>{isMine && <Badge variant="success" className="ml-1 text-[6px]">You</Badge>}</div>
                            {isMine ? (
                              <Button size="sm" variant="danger" className="h-7 w-full text-[8px]" onClick={() => handleUsdCancel(listing.listingId)} disabled={usdProcessingId === listing.listingId}>
                                {usdProcessingId === listing.listingId ? "..." : "Cancel"}
                              </Button>
                            ) : isConnected ? (
                              <Button size="sm" className="h-7 w-full text-[9px] font-bold" onClick={() => handleUsdBuy(listing)} disabled={usdProcessingId === listing.listingId}>
                                {usdProcessingId === listing.listingId ? "..." : `Buy ${formatUsd(listing.priceUsd)}`}
                              </Button>
                            ) : null}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* Sell form */}
              <div>
                <h3 className="mb-3 text-[11px] uppercase tracking-wide text-[#ffcc00]" style={{ textShadow: "2px 2px 0 #000" }}>Sell for USD</h3>
                {!isConnected ? (
                  <Card><CardContent className="py-6 text-center"><p className="text-[9px] text-[#9aa7cc]">Connect wallet to sell</p><Button className="mt-3" size="sm" onClick={() => void connect()} disabled={walletLoading}>Connect</Button></CardContent></Card>
                ) : (
                  <Card><CardContent className="space-y-3 pt-4">
                    {ownedItems.length > 0 && (
                      <div className="max-h-36 overflow-y-auto">
                        {ownedItems.filter((i) => parseInt(i.balance) > 0).map((item) => (
                          <button key={item.tokenId} className={`mb-1 w-full border-2 p-1.5 text-left text-[8px] transition ${usdSellTokenId === item.tokenId ? "border-[#54f28b] bg-[#0a1a0d]" : "border-[#29334d] bg-[#0a0f1a] hover:bg-[#1a2340]"}`} onClick={() => { setUsdSellTokenId(item.tokenId); setUsdSellQuantity("1"); }}>
                            <span className="font-semibold text-[#00ff88]">{item.name}</span><span className="ml-2 text-[#9aa7cc]">x{item.balance}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <Input type="number" value={usdSellQuantity} onChange={(e) => setUsdSellQuantity(e.target.value)} min="1" placeholder="Qty" className="h-7 border-2 border-[#29334d] bg-[#0a0f1a] text-[9px] text-[#f1f5ff] focus:bg-[#0a0f1a] focus:text-[#f1f5ff]" />
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-[#54f28b]">$</span>
                      <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={usdSellPrice} onChange={(e) => setUsdSellPrice(e.target.value)} className="h-7 border-2 border-[#29334d] bg-[#0a0f1a] pl-6 text-[9px] text-[#f1f5ff] focus:bg-[#0a0f1a] focus:text-[#f1f5ff]" />
                    </div>
                    <Button className="h-8 w-full text-[9px] font-bold uppercase" onClick={handleUsdSell} disabled={usdSelling || !usdSellTokenId || !usdSellPrice}>{usdSelling ? "Listing..." : "List for USD"}</Button>
                  </CardContent></Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ═══ CHARACTERS TAB ═══ */}
          <TabsContent value="characters">
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Available for rent */}
              <div className="lg:col-span-2">
                <h3 className="mb-3 text-[11px] uppercase tracking-wide text-[#ffcc00]" style={{ textShadow: "2px 2px 0 #000" }}>Champions for Rent</h3>
                {loadingRentals && rentalListings.length === 0 ? (
                  <div className="text-center text-[9px] text-[#9aa7cc]">Loading...</div>
                ) : rentalListings.length === 0 ? (
                  <div className="border-4 border-black bg-[#11192d] p-8 text-center shadow-[6px_6px_0_0_#000]">
                    <p className="text-[10px] text-[#9aa7cc]">No characters for rent yet</p>
                    <p className="mt-1 text-[8px] text-[#565f89]">List your champion to earn USD while you're offline</p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {rentalListings.map((rental) => {
                      const isMine = address && rental.ownerWallet.toLowerCase() === address.toLowerCase();
                      const hours = rental.durationHours ?? Math.round(rental.durationSeconds / 3600);
                      return (
                        <Card key={rental.rentalId}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-[10px] text-[#ffcc00]">
                                {rental.instanceId || rental.itemName || "Champion"}
                              </CardTitle>
                              <Badge variant="default">{hours}h rental</Badge>
                            </div>
                            <p className="text-[8px] text-[#9aa7cc]">
                              {rental.renewable && "Renewable"} | {rental.activeRentals} active
                              {rental.maxRentals > 0 && ` / ${rental.maxRentals} max`}
                            </p>
                          </CardHeader>
                          <CardContent>
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-[12px] font-bold text-[#54f28b]" style={{ textShadow: "1px 1px 0 #000" }}>
                                {formatUsd(rental.priceUsd ?? rental.priceUsdCents)}
                              </p>
                              <span className="font-mono text-[7px] text-[#565f89]">{dn(rental.ownerWallet)}</span>
                            </div>
                            {isMine ? (
                              <Badge variant="success" className="w-full justify-center">Your Listing</Badge>
                            ) : isConnected ? (
                              <Button size="sm" className="h-7 w-full text-[9px] font-bold" onClick={() => handleRentCharacter(rental)} disabled={rentalProcessingId === rental.rentalId}>
                                {rentalProcessingId === rental.rentalId ? "..." : `Rent for ${formatUsd(rental.priceUsd ?? rental.priceUsdCents)}`}
                              </Button>
                            ) : null}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* List your character */}
              <div>
                <h3 className="mb-3 text-[11px] uppercase tracking-wide text-[#ffcc00]" style={{ textShadow: "2px 2px 0 #000" }}>List Your Champion</h3>
                {!isConnected ? (
                  <Card><CardContent className="py-6 text-center"><p className="text-[9px] text-[#9aa7cc]">Connect wallet</p><Button className="mt-3" size="sm" onClick={() => void connect()}>Connect</Button></CardContent></Card>
                ) : (
                  <Card><CardContent className="space-y-3 pt-4">
                    <div className="space-y-1">
                      <label className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Select Character</label>
                      <div className="max-h-36 overflow-y-auto">
                        {characters.length > 0 ? characters.map((char) => {
                          const equip = char.properties.equipment;
                          const equipNames = equip ? Object.entries(equip).map(([slot, e]) => `${slot}`).join(", ") : "";
                          return (
                            <button key={char.tokenId} className={`mb-1 w-full border-2 p-2 text-left text-[8px] transition ${rentCharName === char.name ? "border-[#ffcc00] bg-[#2a2210]" : "border-[#29334d] bg-[#0a0f1a] hover:bg-[#1a2340]"}`} onClick={() => setRentCharName(char.name)}>
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-[#ffcc00]">{char.name}</span>
                                <Badge variant="default">L{char.properties.level}</Badge>
                              </div>
                              <div className="mt-0.5 text-[7px] text-[#9aa7cc]">
                                {char.properties.race} {char.properties.class}
                                {char.properties.stats && ` | HP:${char.properties.stats.hp ?? "?"} STR:${char.properties.stats.str ?? "?"} INT:${char.properties.stats.int ?? "?"}`}
                              </div>
                              {equipNames && (
                                <div className="mt-0.5 text-[7px] text-[#565f89]">
                                  Equipped: {equipNames}
                                </div>
                              )}
                            </button>
                          );
                        }) : (
                          <p className="text-[8px] text-[#565f89]">No characters found</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[7px] uppercase tracking-wide text-[#9aa7cc]">Duration</label>
                      <div className="grid grid-cols-3 gap-1">
                        {[{ label: "1h", value: "3600" }, { label: "6h", value: "21600" }, { label: "24h", value: "86400" }].map((opt) => (
                          <button key={opt.value} className={`border-2 border-black p-1.5 text-[9px] font-bold shadow-[2px_2px_0_0_#000] transition ${rentDuration === opt.value ? "bg-[#ffcc00] text-black" : "bg-[#2b3656] text-[#9aa7cc] hover:bg-[#3a4870]"}`} onClick={() => setRentDuration(opt.value)}>{opt.label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-[#54f28b]">$</span>
                      <Input type="number" step="0.01" min="0.01" placeholder="Rental price" value={rentPrice} onChange={(e) => setRentPrice(e.target.value)} className="h-7 border-2 border-[#29334d] bg-[#0a0f1a] pl-6 text-[9px] text-[#f1f5ff] focus:bg-[#0a0f1a] focus:text-[#f1f5ff]" />
                    </div>
                    <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2 text-[7px] text-[#565f89]">
                      Your character fights alongside the renter. XP and kills earned persist to your save. You cannot control the character during the rental.
                    </div>
                    <Button className="h-8 w-full text-[9px] font-bold uppercase" onClick={handleListCharacterForRent} disabled={listingRental || !rentCharName || !rentPrice}>{listingRental ? "Listing..." : "List for Rent"}</Button>
                  </CardContent></Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ═══ MY RENTALS TAB ═══ */}
          <TabsContent value="my-rentals">
            {!isConnected ? (
              <div className="border-4 border-black bg-[#11192d] p-12 text-center shadow-[6px_6px_0_0_#000]">
                <p className="text-[9px] text-[#9aa7cc]">Connect wallet to see your rentals</p>
              </div>
            ) : myGrants.length === 0 ? (
              <div className="border-4 border-black bg-[#11192d] p-12 text-center shadow-[6px_6px_0_0_#000]">
                <p className="text-[10px] text-[#9aa7cc]">No active rentals</p>
                <Button className="mt-4" size="sm" onClick={() => setActiveTab("characters")}>Browse Champions</Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {myGrants.map((grant) => (
                  <Card key={grant.grantId}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-[10px] text-[#ffcc00]">{grant.instanceId || grant.itemName || "Champion"}</CardTitle>
                        <Badge variant={grant.isExpiringSoon ? "danger" : "success"}>{grant.timeLeftDisplay ?? formatTimeLeft(grant.endsAt)}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-2 text-[8px] text-[#9aa7cc]">
                        Owner: {dn(grant.ownerWallet)} | Renews: {grant.renewCount}x
                      </div>
                      <Button size="sm" className="h-7 w-full text-[9px] font-bold" onClick={() => handleActivateGrant(grant)} disabled={rentalProcessingId === grant.grantId}>
                        {rentalProcessingId === grant.grantId ? "..." : "Activate (Spawn + Party)"}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t-4 border-black bg-[#0d1526] px-4 py-4 text-center">
        <p className="text-[8px] text-[#565f89]">World of Geneva Real Money Market -- Powered by Tempo/MPP -- USD Payments</p>
      </footer>
    </div>
  );
}

// ── Sub-components ──

function UsdcWalletBalance({ address }: { address: string }): React.ReactElement {
  const [bal, setBal] = React.useState<string | null>(null);
  const [showFund, setShowFund] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const usdcContract = import.meta.env.VITE_MPP_CURRENCY_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    const rpcUrl = import.meta.env.VITE_MPP_RPC_URL || "https://sepolia.base.org";
    const data = "0x70a08231" + address.slice(2).padStart(64, "0");
    fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: usdcContract, data }, "latest"] }) })
      .then((r) => r.json())
      .then((res) => { setBal(res.result && res.result !== "0x" ? (Number(BigInt(res.result)) / 1e6).toFixed(2) : "0.00"); })
      .catch(() => setBal(null));
  }, [address]);

  const handleCopy = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleAddTempoNetwork = () => {
    const w = window as any;
    if (!w.ethereum) return;
    w.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x1079", // 4217
        chainName: "Tempo Mainnet",
        nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
        rpcUrls: ["https://rpc.tempo.xyz"],
        blockExplorerUrls: ["https://explore.tempo.xyz"],
      }],
    }).catch(() => {});
  };

  if (bal === null) return <></>;

  return (
    <>
      <button
        onClick={() => setShowFund(true)}
        className="border-2 border-[#54f28b] bg-[#0a1a0d] px-3 py-1 shadow-[2px_2px_0_0_#000] transition hover:bg-[#1a2a1a] cursor-pointer"
      >
        <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Wallet </span>
        <span className="text-[10px] font-bold text-[#54f28b]">${bal}</span>
        <span className="text-[8px] text-[#9aa7cc]"> USDC</span>
      </button>

      {showFund && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/70" onClick={() => setShowFund(false)} type="button" aria-label="Close" />
          <div className="relative z-10 w-full max-w-md border-4 border-black bg-[#11182b] p-0 text-[#f1f5ff] shadow-[8px_8px_0_0_#000]">
            <div className="border-b-2 border-[#29334d] bg-[#1a2340] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[12px] uppercase tracking-wide text-[#54f28b]" style={{ textShadow: "2px 2px 0 #000" }}>
                  Add Funds
                </h2>
                <button onClick={() => setShowFund(false)} className="border-2 border-[#6b7394] bg-[#1b2236] px-2 py-1 text-[8px] text-[#e8eeff] hover:bg-[#252d45]">X</button>
              </div>
            </div>

            <div className="space-y-4 p-4">
              {/* Current balance */}
              <div className="border-2 border-[#54f28b] bg-[#0a1a0d] p-3 text-center">
                <p className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Current Balance</p>
                <p className="text-[16px] font-bold text-[#54f28b]" style={{ textShadow: "2px 2px 0 #000" }}>${bal} USDC</p>
              </div>

              {/* Your address */}
              <div className="space-y-1">
                <p className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Your Wallet Address</p>
                <div className="flex items-center gap-1">
                  <div className="flex-1 border-2 border-[#29334d] bg-[#0a0f1a] p-2 font-mono text-[8px] text-[#f1f5ff] break-all">
                    {address}
                  </div>
                  <button onClick={handleCopy} className="border-2 border-[#29334d] bg-[#1a2340] px-2 py-2 text-[8px] text-[#9aa7cc] hover:bg-[#252d45]">
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Instructions */}
              <div className="space-y-2">
                <p className="text-[9px] font-bold text-[#ffcc00]">How to add funds:</p>
                <div className="space-y-1 text-[8px] text-[#9aa7cc]">
                  <p>1. Open your Tempo wallet or any EVM wallet</p>
                  <p>2. Add the Tempo network (button below)</p>
                  <p>3. Send USDC to the address above</p>
                  <p>4. Funds appear instantly for marketplace purchases</p>
                </div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleAddTempoNetwork}
                  className="border-2 border-black bg-[#54f28b] p-2 text-[9px] font-bold text-black shadow-[2px_2px_0_0_#000] transition hover:bg-[#6fff9e]"
                >
                  Add Tempo Network
                </button>
                <a
                  href="https://tempo.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-2 border-black bg-[#2b3656] p-2 text-center text-[9px] font-bold text-[#f1f5ff] shadow-[2px_2px_0_0_#000] transition hover:bg-[#3a4870]"
                >
                  Get Tempo Wallet
                </a>
              </div>

              <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-2 text-[7px] text-[#565f89]">
                Tempo uses USDC for all payments. Your game wallet address works on both SKALE (for gameplay) and Tempo (for marketplace purchases).
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
