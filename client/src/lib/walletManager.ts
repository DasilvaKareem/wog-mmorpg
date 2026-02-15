import { createThirdwebClient } from "thirdweb";
import { API_URL } from "../config.js";
import { defineChain } from "thirdweb";
import { createWallet } from "thirdweb/wallets";

const SKALE_CHAIN_ID = 324705682;

const thirdwebClient = createThirdwebClient({
  clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID || "placeholder",
});

const skaleBaseSepolia = defineChain({
  id: SKALE_CHAIN_ID,
  name: "SKALE Base Sepolia Testnet",
  rpc: "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
  nativeCurrency: {
    name: "sFUEL",
    symbol: "sFUEL",
    decimals: 18,
  },
  blockExplorers: [
    {
      name: "SKALE Explorer",
      url: "https://base-sepolia-testnet.skalenodes.com",
    },
  ],
  testnet: true,
});

export interface WalletBalance {
  address: string;
  gold: string;
  onChainGold?: string;
  spentGold?: string;
  items: {
    tokenId: string;
    name: string;
    balance: string;
    category?: string;
    equipSlot?: string | null;
    armorSlot?: string | null;
    statBonuses?: Record<string, number>;
    maxDurability?: number | null;
  }[];
}

export type EquipmentSlot =
  | "weapon"
  | "chest"
  | "legs"
  | "boots"
  | "helm"
  | "shoulders"
  | "gloves"
  | "belt";

export class WalletManager {
  private static instance: WalletManager;
  private wallet = createWallet("io.metamask");
  private _address: string | null = null;
  private _balance: WalletBalance | null = null;
  private _lastBalanceFetch: number = 0;
  private _balanceCacheDuration: number = 3000; // 3 seconds cache

  private constructor() {}

  static getInstance(): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager();
    }
    return WalletManager.instance;
  }

  get address(): string | null {
    return this._address;
  }

  get balance(): WalletBalance | null {
    return this._balance;
  }

  get isConnected(): boolean {
    return this._address !== null;
  }

  async connect(): Promise<string> {
    const account = await this.wallet.connect({
      client: thirdwebClient,
      chain: skaleBaseSepolia,
    });

    this._address = account.address;

    await fetch("/wallet/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: this._address }),
    });

    await this.fetchBalance();
    return this._address;
  }

  async fetchBalance(force = false): Promise<WalletBalance | null> {
    if (!this._address) return null;

    // Return cached balance if still fresh
    const now = Date.now();
    if (!force && this._balance && (now - this._lastBalanceFetch) < this._balanceCacheDuration) {
      return this._balance;
    }

    const res = await fetch(`/wallet/${this._address}/balance`);
    if (!res.ok) return null;

    this._balance = await res.json();
    this._lastBalanceFetch = now;
    return this._balance;
  }

  async buyItem(tokenId: number, quantity: number): Promise<boolean> {
    if (!this._address) return false;

    const res = await fetch("/shop/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buyerAddress: this._address,
        tokenId,
        quantity,
      }),
    });

    if (!res.ok) return false;

    await this.fetchBalance(true); // Force refresh after purchase
    return true;
  }

  async equipItem(tokenId: number, zoneId: string): Promise<boolean> {
    if (!this._address) return false;

    console.log("[equipItem] Request:", { zoneId, tokenId, walletAddress: this._address });
    const res = await fetch("/equipment/equip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zoneId,
        tokenId,
        walletAddress: this._address,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[equipItem] Failed:", res.status, errorText);
      return false;
    }
    await this.fetchBalance(true); // Force refresh after equip
    return true;
  }

  async unequipSlot(slot: EquipmentSlot, zoneId: string): Promise<boolean> {
    if (!this._address) return false;

    const res = await fetch("/equipment/unequip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zoneId,
        slot,
        walletAddress: this._address,
      }),
    });

    if (!res.ok) return false;
    await this.fetchBalance(true); // Force refresh after unequip
    return true;
  }
}
