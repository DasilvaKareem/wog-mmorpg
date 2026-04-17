import { createThirdwebClient, defineChain } from "thirdweb";
import { inAppWallet } from "thirdweb/wallets";
import { preAuthenticate } from "thirdweb/wallets/in-app";
import { CANDIDATE_BASES, toUrl } from "./api.js";
const ADDRESS_KEY = "wog:xr:wallet-address";
const LEGACY_TOKEN_KEY = "wog:agent:jwt";
const LEGACY_EXPIRY_KEY = "wog:agent:jwt:expiry";

export type SocialStrategy = "google" | "discord" | "x" | "telegram" | "farcaster";

const thirdwebClient = createThirdwebClient({
  clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID || "placeholder",
});

const skaleChain = defineChain({
  id: 1187947933,
  rpc: "https://skale-base.skalenodes.com/v1/base",
});

const sharedInAppWallet = inAppWallet();

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function walletKey(walletAddress: string): string {
  return `wog:agent:jwt:${walletAddress.toLowerCase()}`;
}

function expiryKey(walletAddress: string): string {
  return `wog:agent:jwt:expiry:${walletAddress.toLowerCase()}`;
}

export function getCachedToken(walletAddress: string): string | null {
  try {
    const expiry = Number(localStorage.getItem(expiryKey(walletAddress)) ?? "0");
    if (Date.now() > expiry - 300_000) {
      localStorage.removeItem(walletKey(walletAddress));
      localStorage.removeItem(expiryKey(walletAddress));
      return null;
    }
    const token = localStorage.getItem(walletKey(walletAddress));
    if (token) return token;

    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_EXPIRY_KEY);
    return null;
  } catch {
    return null;
  }
}

function cacheToken(walletAddress: string, token: string): void {
  try {
    localStorage.setItem(walletKey(walletAddress), token);
    localStorage.setItem(expiryKey(walletAddress), String(Date.now() + 23 * 3_600_000));
  } catch {
    // Ignore storage failures.
  }
}

export function clearCachedToken(walletAddress?: string): void {
  try {
    if (walletAddress) {
      localStorage.removeItem(walletKey(walletAddress));
      localStorage.removeItem(expiryKey(walletAddress));
    } else {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("wog:agent:jwt:")) keysToRemove.push(key);
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(LEGACY_EXPIRY_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

async function registerWallet(address: string): Promise<void> {
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetch(toUrl(base, "/wallet/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (res.ok) return;
    } catch {
      // Try next candidate base.
    }
  }
}

async function rememberAddress(address: string): Promise<void> {
  try {
    localStorage.setItem(ADDRESS_KEY, address);
  } catch {
    // Ignore storage failures.
  }
  await registerWallet(address);
}

export async function getAuthToken(walletAddress: string): Promise<string | null> {
  const cached = getCachedToken(walletAddress);
  if (cached) return cached;

  const signWithExternalWallet = async (message: string): Promise<string | null> => {
    const provider = window.ethereum;
    if (!provider) return null;

    let accounts: string[] = [];
    try {
      accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    } catch {
      return null;
    }
    const account = accounts.find((entry) => entry?.toLowerCase() === walletAddress.toLowerCase());
    if (!account) return null;

    try {
      const signature = await provider.request({
        method: "personal_sign",
        params: [message, account],
      });
      return typeof signature === "string" ? signature : null;
    } catch {
      try {
        const signature = await provider.request({
          method: "eth_sign",
          params: [account, message],
        });
        return typeof signature === "string" ? signature : null;
      } catch {
        return null;
      }
    }
  };

  for (const base of CANDIDATE_BASES) {
    try {
      const challengeRes = await fetch(toUrl(base, `/auth/challenge?wallet=${walletAddress}`));
      if (!challengeRes.ok) continue;
      const { message, timestamp } = await challengeRes.json();

      let signature: string | null = null;
      const inAppAccount = sharedInAppWallet.getAccount?.() ?? null;
      if (inAppAccount && inAppAccount.address.toLowerCase() === walletAddress.toLowerCase()) {
        signature = await inAppAccount.signMessage({ message });
      } else {
        signature = await signWithExternalWallet(message);
      }
      if (!signature) continue;

      const verifyRes = await fetch(toUrl(base, "/auth/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, signature, timestamp }),
      });
      if (!verifyRes.ok) continue;

      const { token } = await verifyRes.json();
      if (token) cacheToken(walletAddress, token);
      return token ?? null;
    } catch {
      // Try next candidate base.
    }
  }
  return null;
}

class XRAuth {
  private address: string | null = null;

  getAddress(): string | null {
    return this.address;
  }

  async autoConnect(): Promise<string | null> {
    try {
      await sharedInAppWallet.autoConnect({ client: thirdwebClient });
      const account = await sharedInAppWallet.getAccount();
      if (!account) {
        this.address = null;
        return null;
      }
      this.address = account.address;
      await rememberAddress(account.address);
      return account.address;
    } catch {
      this.address = null;
      return null;
    }
  }

  async connectSocial(strategy: SocialStrategy): Promise<string> {
    const account = await sharedInAppWallet.connect({
      client: thirdwebClient,
      chain: skaleChain,
      strategy,
    });
    this.address = account.address;
    await rememberAddress(account.address);
    await getAuthToken(account.address);
    return account.address;
  }

  async connectWallet(): Promise<string> {
    const provider = window.ethereum;
    if (!provider) throw new Error("No injected wallet found. Install MetaMask or another browser wallet.");

    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts?.[0];
    if (!address) throw new Error("No wallet account available.");

    this.address = address;
    await rememberAddress(address);
    await getAuthToken(address);
    return address;
  }

  async sendEmailCode(email: string): Promise<void> {
    await preAuthenticate({
      client: thirdwebClient,
      strategy: "email",
      email: email.trim(),
    });
  }

  async verifyEmailCode(email: string, verificationCode: string): Promise<string> {
    const account = await sharedInAppWallet.connect({
      client: thirdwebClient,
      chain: skaleChain,
      strategy: "email",
      email: email.trim(),
      verificationCode: verificationCode.trim(),
    });
    this.address = account.address;
    await rememberAddress(account.address);
    await getAuthToken(account.address);
    return account.address;
  }

  async disconnect(): Promise<void> {
    clearCachedToken(this.address ?? undefined);
    this.address = null;
    try {
      localStorage.removeItem(ADDRESS_KEY);
    } catch {
      // Ignore storage failures.
    }
    try {
      await sharedInAppWallet.disconnect();
    } catch {
      // Ignore disconnect failures.
    }
  }
}

export const xrAuth = new XRAuth();
