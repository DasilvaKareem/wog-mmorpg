import { createThirdwebClient } from "thirdweb";
import { API_URL } from "../config.js";
import { defineChain } from "thirdweb";
import { createWallet, type WalletId } from "thirdweb/wallets";
import { getAuthToken } from "./agentAuth";

const SKALE_CHAIN_ID = 1187947933;

const thirdwebClient = createThirdwebClient({
  clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID || "placeholder",
});

const skaleBase = defineChain({
  id: SKALE_CHAIN_ID,
  name: "SKALE Base",
  rpc: "https://skale-base.skalenodes.com/v1/base",
  nativeCurrency: {
    name: "Credits",
    symbol: "CREDIT",
    decimals: 18,
  },
  blockExplorers: [
    {
      name: "SKALE Explorer",
      url: "https://skale-base-explorer.skalenodes.com",
    },
  ],
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
    rarity?: string;
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

/** Supported external wallet types */
export type ExternalWalletType = "metamask" | "coinbase" | "walletconnect";

const WALLET_IDS: Record<ExternalWalletType, WalletId> = {
  metamask: "io.metamask",
  coinbase: "com.coinbase.wallet",
  walletconnect: "walletConnect",
};

export class WalletManager {
  private static instance: WalletManager;
  private _address: string | null = null;
  private _account: { address: string; signMessage: (args: { message: string }) => Promise<string> } | null = null;
  private _balance: WalletBalance | null = null;
  private _lastBalanceFetch: number = 0;
  private _balanceCacheDuration: number = 3000; // 3 seconds cache
  /** Custodial wallet that the agent uses for all on-chain actions (gold, items). */
  private _custodialAddress: string | null = null;
  private _custodialResolved = false;

  private constructor() {}

  private primeConnectedWallet(
    address: string,
    account: { address: string; signMessage: (args: { message: string }) => Promise<string> } | null
  ): void {
    this._address = address;
    this._account = account;
    this._custodialAddress = null;
    this._custodialResolved = false;
  }

  private registerConnectedWallet(address: string, forceBalance = false): void {
    void fetch(`${API_URL}/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }).catch(() => {});
    void this.fetchBalance(forceBalance).catch(() => {});
  }

  /** Sync an address obtained via social/in-app wallet into WalletManager state */
  async syncExternalAddress(address: string): Promise<void> {
    this.primeConnectedWallet(address, null);
    this.registerConnectedWallet(address, true);
  }

  /** Sync a connected wallet account so auth can sign challenges with it later. */
  async syncConnectedAccount(account: {
    address: string;
    signMessage: (args: { message: string }) => Promise<string>;
  }): Promise<void> {
    this.primeConnectedWallet(account.address, account);
    this.registerConnectedWallet(account.address, true);
  }

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

  get account(): { address: string; signMessage: (args: { message: string }) => Promise<string> } | null {
    return this._account;
  }

  get isConnected(): boolean {
    return this._address !== null;
  }

  get custodialAddress(): string | null {
    return this._custodialAddress;
  }

  async connect(walletType: ExternalWalletType = "walletconnect"): Promise<string> {
    const wallet = createWallet(WALLET_IDS[walletType]);
    const account = await Promise.race([
      wallet.connect({ client: thirdwebClient, chain: skaleBase }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Wallet connection timed out. Please try again.")), 30000)
      ),
    ]);

    this.primeConnectedWallet(account.address, account as any);
    this.registerConnectedWallet(account.address);

    return account.address;
  }

  disconnect(): void {
    this._address = null;
    this._account = null;
    this._balance = null;
    this._custodialAddress = null;
    this._custodialResolved = false;
  }

  /** Resolve the custodial wallet for the current user (cached after first call). */
  private async resolveCustodialAddress(): Promise<string | null> {
    if (this._custodialResolved) return this._custodialAddress;
    if (!this._address) return null;
    this._custodialResolved = true;
    try {
      const res = await fetch(`${API_URL}/agent/wallet/${this._address}`);
      if (res.ok) {
        const data = await res.json();
        this._custodialAddress = data.custodialWallet ?? null;
      }
    } catch {}
    return this._custodialAddress;
  }

  /** Force-set the custodial address (e.g. after agent deploy). */
  setCustodialAddress(address: string | null): void {
    this._custodialAddress = address;
    this._custodialResolved = true;
  }

  /** Returns the in-world wallet to follow: custodial if deployed, otherwise owner. */
  async getTrackedWalletAddress(): Promise<string | null> {
    if (!this._address) return null;
    const custodial = await this.resolveCustodialAddress();
    return custodial || this._address;
  }

  async fetchBalance(force = false): Promise<WalletBalance | null> {
    if (!this._address) return null;

    // Return cached balance if still fresh
    const now = Date.now();
    if (!force && this._balance && (now - this._lastBalanceFetch) < this._balanceCacheDuration) {
      return this._balance;
    }

    // Use custodial wallet for balance if agent is deployed — that's where gold + items live
    const custodial = await this.resolveCustodialAddress();
    const balanceAddress = custodial || this._address;

    const res = await fetch(`${API_URL}/wallet/${balanceAddress}/balance`);
    if (!res.ok) return null;

    this._balance = await res.json();
    this._lastBalanceFetch = now;
    return this._balance;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this._address) {
      const token = await getAuthToken(this._address);
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  async buyItem(tokenId: number, quantity: number): Promise<boolean> {
    if (!this._address) return false;

    const res = await fetch(`${API_URL}/shop/buy`, {
      method: "POST",
      headers: await this.authHeaders(),
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
    const res = await fetch(`${API_URL}/equipment/equip`, {
      method: "POST",
      headers: await this.authHeaders(),
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

    const res = await fetch(`${API_URL}/equipment/unequip`, {
      method: "POST",
      headers: await this.authHeaders(),
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
