import * as React from "react";
import { API_URL } from "../config.js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { SimpleCurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useGameBridge } from "@/hooks/useGameBridge";
import { useWallet } from "@/hooks/useWallet";
import type { Entity } from "@/types";

interface Auction {
  auctionId: string;
  tokenId: number;
  itemName?: string;
  quantity: number;
  seller: string;
  startPrice: number;
  currentBid: number;
  highBidder: string | null;
  buyoutPrice?: number;
  endsAt: number;
  status: string;
  bidCount: number;
}

interface NpcInfo {
  npcId: string;
  npcName: string;
  zoneId: string;
  description: string;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimeRemaining(endsAt: number): string {
  const seconds = Math.max(0, Math.floor(endsAt - Date.now() / 1000));
  if (seconds <= 0) return "Ended";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function AuctionHouseDialog(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [npcInfo, setNpcInfo] = React.useState<NpcInfo | null>(null);
  const [zoneId, setZoneId] = React.useState("human-meadow");
  const [auctions, setAuctions] = React.useState<Auction[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("browse");

  // Create form
  const [createTokenId, setCreateTokenId] = React.useState("");
  const [createQuantity, setCreateQuantity] = React.useState("1");
  const [createStartPrice, setCreateStartPrice] = React.useState(0);
  const [createDuration, setCreateDuration] = React.useState("60");
  const [createBuyoutPrice, setCreateBuyoutPrice] = React.useState(0);
  const [creating, setCreating] = React.useState(false);

  // Bid tracking
  const [bidAmounts, setBidAmounts] = React.useState<Record<string, number>>({});
  const [biddingId, setBiddingId] = React.useState<string | null>(null);

  const { address, isConnected } = useWallet();
  const { notify } = useToast();

  useGameBridge("zoneChanged", ({ zoneId: nextZoneId }) => {
    setZoneId(nextZoneId);
  });

  useGameBridge("auctioneerClick", (entity: Entity) => {
    if (entity.type !== "auctioneer") return;
    setOpen(true);
    setActiveTab("browse");
    void loadNpcInfo(zoneId, entity.id);
    void loadAuctions(zoneId);
  });

  const loadNpcInfo = React.useCallback(async (zone: string, entityId: string) => {
    try {
      const res = await fetch(`${API_URL}/auctionhouse/npc/${zone}/${entityId}`);
      if (res.ok) {
        const data = await res.json();
        setNpcInfo(data);
      }
    } catch {
      // Ignore
    }
  }, []);

  const loadAuctions = React.useCallback(async (zone: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auctionhouse/${zone}/auctions?status=active`);
      if (res.ok) {
        const data = await res.json();
        setAuctions(data.auctions ?? data ?? []);
      } else {
        setAuctions([]);
      }
    } catch {
      setAuctions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll while open
  React.useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => loadAuctions(zoneId), 5000);
    return () => clearInterval(interval);
  }, [open, zoneId, loadAuctions]);

  // Re-render timer every second
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [open]);

  const handleBid = async (auction: Auction) => {
    const amount = bidAmounts[auction.auctionId] ?? 0;
    if (!amount || !address) return;

    setBiddingId(auction.auctionId);
    try {
      const res = await fetch(`${API_URL}/auctionhouse/${zoneId}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auctionId: auction.auctionId,
          bidder: address,
          amount,
        }),
      });

      if (res.ok) {
        notify(`Bid placed successfully`, "success");
        setBidAmounts((prev) => ({ ...prev, [auction.auctionId]: 0 }));
        void loadAuctions(zoneId);
      } else {
        const err = await res.json();
        notify(err.error || "Bid failed", "error");
      }
    } catch {
      notify("Bid failed", "error");
    } finally {
      setBiddingId(null);
    }
  };

  const handleBuyout = async (auction: Auction) => {
    if (!address || !auction.buyoutPrice) return;

    setBiddingId(auction.auctionId);
    try {
      const res = await fetch(`${API_URL}/auctionhouse/${zoneId}/buyout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auctionId: auction.auctionId,
          buyer: address,
        }),
      });

      if (res.ok) {
        notify(`Bought out for ${auction.buyoutPrice} GOLD`, "success");
        void loadAuctions(zoneId);
      } else {
        const err = await res.json();
        notify(err.error || "Buyout failed", "error");
      }
    } catch {
      notify("Buyout failed", "error");
    } finally {
      setBiddingId(null);
    }
  };

  const handleCancel = async (auctionId: string) => {
    if (!address) return;

    try {
      const res = await fetch(`${API_URL}/auctionhouse/${zoneId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId, seller: address }),
      });

      if (res.ok) {
        notify("Auction cancelled", "success");
        void loadAuctions(zoneId);
      } else {
        const err = await res.json();
        notify(err.error || "Cancel failed", "error");
      }
    } catch {
      notify("Cancel failed", "error");
    }
  };

  const handleCreate = async () => {
    if (!address || !createTokenId || !createStartPrice) return;

    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/auctionhouse/${zoneId}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seller: address,
          tokenId: parseInt(createTokenId),
          quantity: parseInt(createQuantity) || 1,
          startPrice: createStartPrice,
          durationMinutes: parseInt(createDuration),
          buyoutPrice: createBuyoutPrice || undefined,
        }),
      });

      if (res.ok) {
        notify("Auction created", "success");
        setCreateTokenId("");
        setCreateQuantity("1");
        setCreateStartPrice(0);
        setCreateBuyoutPrice(0);
        setActiveTab("browse");
        void loadAuctions(zoneId);
      } else {
        const err = await res.json();
        notify(err.error || "Create failed", "error");
      }
    } catch {
      notify("Create failed", "error");
    } finally {
      setCreating(false);
    }
  };

  const myAuctions = auctions.filter(
    (a) => address && a.seller.toLowerCase() === address.toLowerCase()
  );
  const myBids = auctions.filter(
    (a) => address && a.highBidder?.toLowerCase() === address.toLowerCase()
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto border-4 border-[#29334d] bg-[#11182b] p-0 text-[#f1f5ff]">
        <DialogHeader className="border-b-2 border-[#29334d] bg-[#1a2340] p-4">
          <DialogTitle className="font-mono text-sm text-[#00ff88]">
            {npcInfo ? `${npcInfo.npcName} - Auction House` : "Auction House"}
          </DialogTitle>
          <DialogDescription className="font-mono text-[9px] text-[#9aa7cc]">
            Browse, bid, and list items for auction in {zoneId}
          </DialogDescription>
        </DialogHeader>

        <div className="p-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4 bg-[#1a2340]">
              <TabsTrigger value="browse">Browse</TabsTrigger>
              <TabsTrigger value="create">Create</TabsTrigger>
              <TabsTrigger value="my-auctions">
                Mine {myAuctions.length > 0 && `(${myAuctions.length})`}
              </TabsTrigger>
              <TabsTrigger value="my-bids">
                Bids {myBids.length > 0 && `(${myBids.length})`}
              </TabsTrigger>
            </TabsList>

            {/* Browse Tab */}
            <TabsContent value="browse" className="mt-4">
              {loading && auctions.length === 0 ? (
                <div className="text-center text-[9px] text-[#9aa7cc]">Loading auctions...</div>
              ) : auctions.length === 0 ? (
                <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-6 text-center">
                  <p className="text-[9px] text-[#9aa7cc]">No active auctions</p>
                  <p className="mt-1 text-[8px] text-[#565f89]">
                    Be the first to list an item
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[8px]">Item</TableHead>
                      <TableHead className="text-[8px]">Seller</TableHead>
                      <TableHead className="text-[8px]">Current Bid</TableHead>
                      <TableHead className="text-[8px]">Buyout</TableHead>
                      <TableHead className="text-[8px]">Time Left</TableHead>
                      <TableHead className="text-[8px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auctions.map((auction) => {
                      const timeLeft = formatTimeRemaining(auction.endsAt);
                      const isUrgent = auction.endsAt - Date.now() / 1000 < 300;

                      return (
                        <TableRow key={auction.auctionId}>
                          <TableCell className="text-[9px]">
                            <div>
                              <div className="font-semibold text-[#00ff88]">
                                {auction.itemName || `Token #${auction.tokenId}`}
                              </div>
                              <div className="text-[8px] text-[#9aa7cc]">
                                Qty: {auction.quantity} | {auction.bidCount} bids
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-[8px] text-[#9aa7cc]">
                            {truncateAddress(auction.seller)}
                          </TableCell>
                          <TableCell className="text-[9px]">
                            <CurrencyDisplay
                              amount={auction.currentBid > 0 ? auction.currentBid : auction.startPrice}
                              size="sm"
                            />
                          </TableCell>
                          <TableCell className="text-[9px]">
                            {auction.buyoutPrice ? (
                              <CurrencyDisplay amount={auction.buyoutPrice} size="sm" />
                            ) : (
                              <span className="text-[#9aa7cc]">--</span>
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-[9px] font-bold ${isUrgent ? "text-[#ff4d6d]" : "text-[#f1f5ff]"}`}
                          >
                            {timeLeft}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <SimpleCurrencyInput
                                value={bidAmounts[auction.auctionId] ?? 0}
                                onChange={(amount) =>
                                  setBidAmounts((prev) => ({
                                    ...prev,
                                    [auction.auctionId]: amount,
                                  }))
                                }
                                min={auction.currentBid > 0 ? auction.currentBid + 1 : auction.startPrice}
                                size="sm"
                                className="w-24"
                              />
                              <Button
                                size="sm"
                                className="h-6 px-2 text-[8px]"
                                onClick={() => handleBid(auction)}
                                disabled={!isConnected || biddingId === auction.auctionId}
                              >
                                Bid
                              </Button>
                              {auction.buyoutPrice && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-[8px]"
                                  onClick={() => handleBuyout(auction)}
                                  disabled={!isConnected || biddingId === auction.auctionId}
                                >
                                  Buy
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {/* Create Tab */}
            <TabsContent value="create" className="mt-4">
              <div className="mx-auto max-w-md space-y-3">
                <div className="space-y-1">
                  <label className="text-[8px] text-[#9aa7cc]">Token ID</label>
                  <Input
                    type="number"
                    placeholder="Item token ID..."
                    value={createTokenId}
                    onChange={(e) => setCreateTokenId(e.target.value)}
                    className="h-7 border-2 border-[#29334d] bg-[#0a0f1a] text-[9px] text-[#f1f5ff]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] text-[#9aa7cc]">Quantity</label>
                  <Input
                    type="number"
                    value={createQuantity}
                    onChange={(e) => setCreateQuantity(e.target.value)}
                    min="1"
                    className="h-7 border-2 border-[#29334d] bg-[#0a0f1a] text-[9px] text-[#f1f5ff]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] text-[#9aa7cc]">Starting Price</label>
                  <SimpleCurrencyInput
                    value={createStartPrice}
                    onChange={setCreateStartPrice}
                    min={0.0001}
                    size="sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] text-[#9aa7cc]">Duration</label>
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      { label: "30 min", value: "30" },
                      { label: "1 hour", value: "60" },
                      { label: "2 hours", value: "120" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        className={`border-2 border-black p-1.5 text-[9px] font-bold shadow-[2px_2px_0_0_#000] transition ${
                          createDuration === opt.value
                            ? "bg-[#ffcc00] text-black"
                            : "bg-[#2b3656] text-[#9aa7cc] hover:bg-[#3a4870]"
                        }`}
                        onClick={() => setCreateDuration(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] text-[#9aa7cc]">Buyout Price (optional)</label>
                  <SimpleCurrencyInput
                    value={createBuyoutPrice}
                    onChange={setCreateBuyoutPrice}
                    min={0}
                    size="sm"
                  />
                </div>

                <Button
                  className="h-8 w-full text-[9px] font-bold uppercase"
                  onClick={handleCreate}
                  disabled={!isConnected || creating || !createTokenId || !createStartPrice}
                >
                  {!isConnected
                    ? "Connect Wallet"
                    : creating
                      ? "Creating..."
                      : "Create Auction"}
                </Button>
              </div>
            </TabsContent>

            {/* My Auctions Tab */}
            <TabsContent value="my-auctions" className="mt-4">
              {!isConnected ? (
                <div className="text-center text-[9px] text-[#9aa7cc]">
                  Connect wallet to see your auctions
                </div>
              ) : myAuctions.length === 0 ? (
                <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-6 text-center">
                  <p className="text-[9px] text-[#9aa7cc]">You have no active auctions</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[8px]">Item</TableHead>
                      <TableHead className="text-[8px]">Current Bid</TableHead>
                      <TableHead className="text-[8px]">Bids</TableHead>
                      <TableHead className="text-[8px]">Time Left</TableHead>
                      <TableHead className="text-[8px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {myAuctions.map((auction) => (
                      <TableRow key={auction.auctionId}>
                        <TableCell className="text-[9px] font-semibold text-[#00ff88]">
                          {auction.itemName || `Token #${auction.tokenId}`}
                        </TableCell>
                        <TableCell className="text-[9px] font-bold text-[#ffcc00]">
                          {auction.currentBid > 0
                            ? `${auction.currentBid} GOLD`
                            : `${auction.startPrice} GOLD`}
                        </TableCell>
                        <TableCell className="text-[9px] text-[#f1f5ff]">
                          {auction.bidCount}
                        </TableCell>
                        <TableCell className="text-[9px] text-[#f1f5ff]">
                          {formatTimeRemaining(auction.endsAt)}
                        </TableCell>
                        <TableCell>
                          {auction.bidCount === 0 ? (
                            <Button
                              size="sm"
                              variant="danger"
                              className="h-6 px-2 text-[8px]"
                              onClick={() => handleCancel(auction.auctionId)}
                            >
                              Cancel
                            </Button>
                          ) : (
                            <Badge variant="secondary">Has Bids</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {/* My Bids Tab */}
            <TabsContent value="my-bids" className="mt-4">
              {!isConnected ? (
                <div className="text-center text-[9px] text-[#9aa7cc]">
                  Connect wallet to see your bids
                </div>
              ) : myBids.length === 0 ? (
                <div className="border-2 border-[#29334d] bg-[#0a0f1a] p-6 text-center">
                  <p className="text-[9px] text-[#9aa7cc]">You have no active bids</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[8px]">Item</TableHead>
                      <TableHead className="text-[8px]">Your Bid</TableHead>
                      <TableHead className="text-[8px]">Seller</TableHead>
                      <TableHead className="text-[8px]">Time Left</TableHead>
                      <TableHead className="text-[8px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {myBids.map((auction) => (
                      <TableRow key={auction.auctionId}>
                        <TableCell className="text-[9px] font-semibold text-[#00ff88]">
                          {auction.itemName || `Token #${auction.tokenId}`}
                        </TableCell>
                        <TableCell className="text-[9px] font-bold text-[#ffcc00]">
                          {auction.currentBid} GOLD
                        </TableCell>
                        <TableCell className="font-mono text-[8px] text-[#9aa7cc]">
                          {truncateAddress(auction.seller)}
                        </TableCell>
                        <TableCell className="text-[9px] text-[#f1f5ff]">
                          {formatTimeRemaining(auction.endsAt)}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
