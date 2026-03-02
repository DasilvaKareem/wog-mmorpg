import * as React from "react";

import {
  fetchCharactersWithLive,
  fetchWalletCharacterInZone,
  fetchProfessions,
  type WalletCharacterProgress,
  type ProfessionsResponse,
} from "@/ShardClient";
import { gameBus } from "@/lib/eventBus";
import { WalletManager, type EquipmentSlot, type WalletBalance, type ExternalWalletType } from "@/lib/walletManager";
import { thirdwebClient, sharedInAppWallet } from "@/lib/inAppWalletClient";
import { clearCachedToken } from "@/lib/agentAuth";
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

// Matches shard/src/leveling.ts statScale() — quadratic growth
function statScale(level: number): number {
  const l = Math.max(1, level) - 1;
  return 1 + l * 0.04 + l * l * 0.001;
}

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

  const level = primary.properties.level ?? 1;
  // NFT stats.hp is the level-1 base — scale to current level using quadratic formula
  const maxHp = Math.max(1, Math.round((primary.properties.stats.hp ?? 1) * statScale(level)));

  return {
    name: primary.name,
    level,
    xp: primary.properties.xp ?? 0,
    hp: maxHp, // NFT characters have no live HP — show as full (max)
    maxHp,
    source: "nft",
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const walletManager = React.useMemo(() => WalletManager.getInstance(), []);
  const [address, setAddress] = React.useState<string | null>(walletManager.address);
  const [balance, setBalance] = React.useState<WalletBalance | null>(walletManager.balance);
  const [loading, setLoading] = React.useState(true); // true until auto-connect attempt completes
  const [zoneId, setZoneId] = React.useState("village-square");
  const [characterProgress, setCharacterProgress] = React.useState<WalletCharacterProgress | null>(null);
  const [characterLoading, setCharacterLoading] = React.useState(false);
  const [characters, setCharacters] = React.useState<OwnedCharacter[]>([]);
  const [selectedCharacterTokenId, setSelectedCharacterTokenId] = React.useState<string | null>(null);
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
      return;
    }

    // Check cache - skip if data is fresh and not forced
    const now = Date.now();
    if (!force && (now - lastCharacterFetchRef.current) < characterCacheDuration) {
      return;
    }

    setCharacterLoading(true);
    try {
      // Single API call returns both NFT characters and live entity data
      const [liveCharacter, { characters: ownedCharacters, liveEntity: liveCharacterGlobal }] = await Promise.all([
        fetchWalletCharacterInZone(walletManager.address, zoneId),
        fetchCharactersWithLive(walletManager.address),
      ]);

      // Always store all characters for the selector
      setCharacters(ownedCharacters);

      // If a live agent is in the current zone, show that
      if (liveCharacter) {
        setCharacterProgress(liveCharacter);
        lastCharacterFetchRef.current = now;
        return;
      }

      // If a live agent exists in any zone, show that
      if (liveCharacterGlobal) {
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

    if (selectedCharacterTokenId) {
      const selected = characters.find((c) => c.tokenId === selectedCharacterTokenId);
      if (selected) {
        setCharacterProgress({
          name: selected.name,
          level: selected.properties.level,
          xp: selected.properties.xp,
          hp: selected.properties.stats.hp,
          maxHp: selected.properties.stats.hp,
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
      await walletManager.connect(walletType);
      setAddress(walletManager.address);
      setBalance(walletManager.balance);
    } finally {
      setLoading(false);
    }
    // Load character + professions in background — don't block the UI
    void Promise.all([refreshCharacterProgress(), refreshProfessions()]);
  }, [walletManager, refreshCharacterProgress, refreshProfessions]);

  const disconnect = React.useCallback(() => {
    const currentAddress = walletManager.address;
    if (currentAddress) clearCachedToken(currentAddress);
    walletManager.disconnect();
    setAddress(null);
    setBalance(null);
    setCharacterProgress(null);
    setCharacters([]);
  }, [walletManager]);

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
    });
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    if (!address) {
      setCharacterProgress(null);
      setCharacters([]);
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
