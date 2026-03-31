import * as React from "react";
import { useActiveWallet, useConnectModal, useDisconnect } from "thirdweb/react";

import {
  fetchCharactersWithLive,
  fetchProfessions,
  type WalletCharacterProgress,
  type ProfessionsResponse,
} from "@/ShardClient";
import { gameBus } from "@/lib/eventBus";
import { WalletManager, type EquipmentSlot, type WalletBalance, type ExternalWalletType } from "@/lib/walletManager";
import { skaleChain, thirdwebClient, sharedInAppWallet } from "@/lib/inAppWalletClient";
import { clearCachedToken } from "@/lib/agentAuth";
import { trackSessionStarted } from "@/lib/analytics";
import type { OwnedCharacter } from "@/types";

interface WalletContextValue {
  address: string | null;
  balance: WalletBalance | null;
  isConnected: boolean;
  loading: boolean;
  characterProgress: WalletCharacterProgress | null;
  characterLoading: boolean;
  /** All owned character NFTs for this wallet */
  characters: OwnedCharacter[];
  /** Token ID of the user-selected character (null = auto-pick highest level) */
  selectedCharacterTokenId: string | null;
  /** Name of the currently deployed agent character (null if no agent running) */
  deployedCharacterName: string | null;
  /** Select a character by token ID to display in the wallet panel */
  selectCharacter: (tokenId: string | null) => void;
  professions: ProfessionsResponse | null;
  professionsLoading: boolean;
  connect: (walletType?: ExternalWalletType) => Promise<void>;
  disconnect: () => void;
  syncAddress: (address: string) => Promise<void>;
  refreshBalance: () => Promise<void>;
  refreshCharacterProgress: (force?: boolean) => Promise<void>;
  refreshProfessions: () => Promise<void>;
  buyItem: (tokenId: number, quantity: number) => Promise<boolean>;
  equipItem: (tokenId: number) => Promise<boolean>;
  unequipSlot: (slot: EquipmentSlot) => Promise<boolean>;
}

const WalletContext = React.createContext<WalletContextValue | null>(null);

function pickPrimaryCharacterProgress(
  characters: OwnedCharacter[]
): WalletCharacterProgress | null {
  if (characters.length === 0) return null;

  const [primary] = [...characters].sort((left, right) => {
    if (right.properties.level !== left.properties.level) {
      return right.properties.level - left.properties.level;
    }
    if (right.properties.xp !== left.properties.xp) {
      return right.properties.xp - left.properties.xp;
    }
    return Number(left.tokenId) - Number(right.tokenId);
  });

  const maxHp = Math.max(1, primary.properties.stats.hp ?? 1);

  return {
    name: primary.name,
    level: primary.properties.level ?? 1,
    xp: primary.properties.xp ?? 0,
    hp: maxHp, // NFT fallback has no live HP — show as full (max)
    maxHp,
    characterTokenId: primary.characterTokenId ?? primary.tokenId,
    source: "nft",
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const walletManager = React.useMemo(() => WalletManager.getInstance(), []);
  const activeWallet = useActiveWallet();
  const { connect: openConnectModal } = useConnectModal();
  const { disconnect: disconnectActiveWallet } = useDisconnect();
  const [address, setAddress] = React.useState<string | null>(walletManager.address);
  const [balance, setBalance] = React.useState<WalletBalance | null>(walletManager.balance);
  const [loading, setLoading] = React.useState(true); // true until auto-connect attempt completes
  const [zoneId, setZoneId] = React.useState("village-square");
  const [characterProgress, setCharacterProgress] = React.useState<WalletCharacterProgress | null>(null);
  const [characterLoading, setCharacterLoading] = React.useState(false);
  const [characters, setCharacters] = React.useState<OwnedCharacter[]>([]);
  const [selectedCharacterTokenId, setSelectedCharacterTokenId] = React.useState<string | null>(null);
  const [deployedCharacterName, setDeployedCharacterName] = React.useState<string | null>(null);
  const [professions, setProfessions] = React.useState<ProfessionsResponse | null>(null);
  const [professionsLoading, setProfessionsLoading] = React.useState(false);
  const lastCharacterFetchRef = React.useRef<number>(0);
  const characterCacheDuration = 3000; // 3 seconds

  const refreshBalance = React.useCallback(async () => {
    const nextBalance = await walletManager.fetchBalance();
    setAddress(walletManager.address);
    setBalance(nextBalance);
  }, [walletManager]);

  const refreshCharacterProgress = React.useCallback(async (force = false) => {
    if (!walletManager.address) {
      setCharacterProgress(null);
      setCharacters([]);
      setDeployedCharacterName(null);
      return;
    }

    // Check cache - skip if data is fresh and not forced
    const now = Date.now();
    if (!force && (now - lastCharacterFetchRef.current) < characterCacheDuration) {
      return;
    }

    // Only show loading spinner on first fetch — background refreshes update silently
    const isFirstFetch = !characterProgress && characters.length === 0;
    if (isFirstFetch) setCharacterLoading(true);
    try {
      // Single API call returns both NFT characters and live entity data
      const { characters: ownedCharacters, liveEntity: liveCharacterGlobal, deployedCharacterName: deployed } =
        await fetchCharactersWithLive(walletManager.address);

      // Always store all characters for the selector
      setCharacters(ownedCharacters);
      setDeployedCharacterName(deployed);

      // If a live agent exists in any zone, show that
      if (liveCharacterGlobal) {
        const liveTokenId =
          liveCharacterGlobal.characterTokenId ??
          ownedCharacters.find((character) => {
            const baseName = character.name.replace(/\s+the\s+\w+$/i, "").trim();
            const liveBaseName = liveCharacterGlobal.name.replace(/\s+the\s+\w+$/i, "").trim();
            return character.tokenId === liveCharacterGlobal.characterTokenId || baseName === liveBaseName || character.name === liveCharacterGlobal.name;
          })?.tokenId ??
          null;
        if (liveTokenId && selectedCharacterTokenId !== liveTokenId) {
          setSelectedCharacterTokenId(liveTokenId);
        }
        setCharacterProgress(liveCharacterGlobal);
        lastCharacterFetchRef.current = now;
        return;
      }

      // If user has manually selected a character, show that one
      if (selectedCharacterTokenId) {
        const selected = ownedCharacters.find((c) => c.tokenId === selectedCharacterTokenId);
        if (selected) {
          setCharacterProgress({
            name: selected.name,
            level: selected.properties.level,
            xp: selected.properties.xp,
            hp: selected.properties.stats.hp,
            maxHp: selected.properties.stats.hp,
            characterTokenId: selected.characterTokenId ?? selected.tokenId,
            source: "nft",
          });
          lastCharacterFetchRef.current = now;
          return;
        }
      }

      // Default: pick highest-level character
      setCharacterProgress(pickPrimaryCharacterProgress(ownedCharacters));
      lastCharacterFetchRef.current = now;
    } finally {
      setCharacterLoading(false);
    }
  }, [walletManager, zoneId, characterCacheDuration, selectedCharacterTokenId]);

  const refreshProfessions = React.useCallback(async () => {
    if (!walletManager.address) {
      setProfessions(null);
      return;
    }

    setProfessionsLoading(true);
    try {
      const professionsData = await fetchProfessions(walletManager.address);
      setProfessions(professionsData);
    } finally {
      setProfessionsLoading(false);
    }
  }, [walletManager]);

  const selectCharacter = React.useCallback((tokenId: string | null) => {
    setSelectedCharacterTokenId(tokenId);
    // Force an immediate refresh so the display updates
    lastCharacterFetchRef.current = 0;
  }, []);

  // When selection changes, re-derive characterProgress from cached characters
  React.useEffect(() => {
    if (characters.length === 0) return;
    if (characterProgress?.source === "live") return;

    if (selectedCharacterTokenId) {
      const selected = characters.find((c) => c.tokenId === selectedCharacterTokenId);
      if (selected) {
        setCharacterProgress({
          name: selected.name,
          level: selected.properties.level,
          xp: selected.properties.xp,
          hp: selected.properties.stats.hp,
          maxHp: selected.properties.stats.hp,
          characterTokenId: selected.characterTokenId ?? selected.tokenId,
          source: "nft",
        });
        return;
      }
    }
    // Fall back to auto-pick
    setCharacterProgress(pickPrimaryCharacterProgress(characters));
  }, [selectedCharacterTokenId, characters]);

  const connect = React.useCallback(async (walletType?: ExternalWalletType) => {
    setLoading(true);
    try {
      if (!walletType || walletType === "walletconnect") {
        let wallet;
        try {
          wallet = await openConnectModal({
            client: thirdwebClient,
            chain: skaleChain,
            showAllWallets: true,
            size: "wide",
            appMetadata: {
              name: "World of Geneva",
              url: typeof window !== "undefined" ? window.location.origin : undefined,
            },
          });
        } catch {
          return;
        }

        const account = wallet.getAccount();
        if (!account) {
          throw new Error("Wallet connected but no account was returned.");
        }
        await walletManager.syncConnectedAccount(account as any);
      } else {
        await walletManager.connect(walletType);
      }
      setAddress(walletManager.address);
      setBalance(walletManager.balance);
    } finally {
      setLoading(false);
    }
    // Load character + professions in background — don't block the UI
    void Promise.all([refreshCharacterProgress(), refreshProfessions()]);
  }, [walletManager, refreshCharacterProgress, refreshProfessions]);

  const disconnect = React.useCallback(() => {
    // Clear all cached JWT tokens (not just current address) to prevent
    // stale auth leaking across wallet switches
    clearCachedToken();
    walletManager.disconnect();
    if (activeWallet) {
      try {
        disconnectActiveWallet(activeWallet);
      } catch {}
    }
    // Destroy the thirdweb in-app wallet session so autoConnect won't
    // restore the old user on next page load / new wallet connection
    sharedInAppWallet.disconnect().catch(() => {});
    setAddress(null);
    setBalance(null);
    setCharacterProgress(null);
    setCharacters([]);
    setDeployedCharacterName(null);
    setSelectedCharacterTokenId(null);
    setProfessions(null);
  }, [activeWallet, disconnectActiveWallet, walletManager]);

  const syncAddress = React.useCallback(async (addr: string) => {
    setLoading(true);
    try {
      await walletManager.syncExternalAddress(addr);
      setAddress(walletManager.address);
      setBalance(walletManager.balance);
    } finally {
      setLoading(false);
    }
    // Load character + professions in background — don't block the UI
    void Promise.all([refreshCharacterProgress(), refreshProfessions()]);
  }, [walletManager, refreshCharacterProgress, refreshProfessions]);

  const buyItem = React.useCallback(
    async (tokenId: number, quantity: number) => {
      const ok = await walletManager.buyItem(tokenId, quantity);
      setBalance(walletManager.balance);
      return ok;
    },
    [walletManager]
  );

  const equipItem = React.useCallback(
    async (tokenId: number) => {
      const ok = await walletManager.equipItem(tokenId, zoneId);
      setBalance(walletManager.balance);
      await refreshCharacterProgress(true); // Force refresh
      return ok;
    },
    [walletManager, zoneId, refreshCharacterProgress]
  );

  const unequipSlot = React.useCallback(
    async (slot: EquipmentSlot) => {
      const ok = await walletManager.unequipSlot(slot, zoneId);
      setBalance(walletManager.balance);
      await refreshCharacterProgress(true); // Force refresh
      return ok;
    },
    [walletManager, zoneId, refreshCharacterProgress]
  );

  // Auto-connect on mount: restore a previously authenticated in-app wallet session
  React.useEffect(() => {
    let cancelled = false;
    async function tryAutoConnect() {
      try {
        // 8s timeout — if thirdweb session restore hangs, don't block the UI forever
        const account = await Promise.race([
          sharedInAppWallet.autoConnect({ client: thirdwebClient }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
        ]);
        if (cancelled) return;
        await walletManager.syncExternalAddress(account.address);
        if (cancelled) return;
        setAddress(walletManager.address);
        setBalance(walletManager.balance);
        trackSessionStarted(account.address);
      } catch {
        // No saved session or timeout — stay disconnected, which is fine
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void tryAutoConnect();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const unsubscribe = gameBus.on("zoneChanged", ({ zoneId: nextZoneId }) => {
      setZoneId(nextZoneId);
      lastCharacterFetchRef.current = 0;
    });
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    const unsubscribe = gameBus.on("charactersChanged", ({ walletAddress }) => {
      if (!address || walletAddress.toLowerCase() !== address.toLowerCase()) return;
      lastCharacterFetchRef.current = 0;
      void refreshCharacterProgress(true);
    });
    return unsubscribe;
  }, [address, refreshCharacterProgress]);

  React.useEffect(() => {
    if (!address) {
      setCharacterProgress(null);
      setCharacters([]);
      setDeployedCharacterName(null);
      setSelectedCharacterTokenId(null);
      setProfessions(null);
      return;
    }

    void refreshCharacterProgress();
    void refreshProfessions();

    // Poll less frequently (15s) - the wallet manager now caches responses for 3s
    // so rapid UI updates won't cause excessive API calls
    const interval = window.setInterval(() => {
      void refreshBalance();
      void refreshCharacterProgress();
      void refreshProfessions();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [address, refreshBalance, refreshCharacterProgress, refreshProfessions]);

  const value = React.useMemo(
    () => ({
      address,
      balance,
      isConnected: Boolean(address),
      loading,
      characterProgress,
      characterLoading,
      characters,
      selectedCharacterTokenId,
      deployedCharacterName,
      selectCharacter,
      professions,
      professionsLoading,
      connect,
      disconnect,
      syncAddress,
      refreshBalance,
      refreshCharacterProgress,
      refreshProfessions,
      buyItem,
      equipItem,
      unequipSlot,
    }),
    [
      address,
      balance,
      loading,
      characterProgress,
      characterLoading,
      characters,
      selectedCharacterTokenId,
      deployedCharacterName,
      selectCharacter,
      professions,
      professionsLoading,
      connect,
      disconnect,
      syncAddress,
      refreshBalance,
      refreshCharacterProgress,
      refreshProfessions,
      buyItem,
      equipItem,
      unequipSlot,
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletContext(): WalletContextValue {
  const context = React.useContext(WalletContext);
  if (!context) {
    throw new Error("useWalletContext must be used inside WalletProvider");
  }
  return context;
}
