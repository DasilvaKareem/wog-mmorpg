import * as React from "react";

import {
  fetchCharacters,
  fetchWalletCharacterInZone,
  fetchProfessions,
  type WalletCharacterProgress,
  type ProfessionsResponse,
} from "@/ShardClient";
import { gameBus } from "@/lib/eventBus";
import { WalletManager, type EquipmentSlot, type WalletBalance } from "@/lib/walletManager";
import { thirdwebClient, sharedInAppWallet } from "@/lib/inAppWalletClient";
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
  connect: () => Promise<void>;
  syncAddress: (address: string) => Promise<void>;
  refreshBalance: () => Promise<void>;
  refreshCharacterProgress: () => Promise<void>;
  refreshProfessions: () => Promise<void>;
  buyItem: (tokenId: number, quantity: number) => Promise<boolean>;
  equipItem: (tokenId: number) => Promise<boolean>;
  unequipSlot: (slot: EquipmentSlot) => Promise<boolean>;
}

const WalletContext = React.createContext<WalletContextValue | null>(null);

function pickPrimaryCharacterProgress(
  characters: Awaited<ReturnType<typeof fetchCharacters>>
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

  return {
    name: primary.name,
    level: primary.properties.level,
    xp: primary.properties.xp,
    hp: primary.properties.stats.hp,
    maxHp: primary.properties.stats.hp,
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
      const [liveCharacter, ownedCharacters] = await Promise.all([
        fetchWalletCharacterInZone(walletManager.address, zoneId),
        fetchCharacters(walletManager.address),
      ]);

      // Always store all characters for the selector
      setCharacters(ownedCharacters);

      // If a live agent is in the zone, show that
      if (liveCharacter) {
        setCharacterProgress(liveCharacter);
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

  const connect = React.useCallback(async () => {
    setLoading(true);
    try {
      await walletManager.connect();
      setAddress(walletManager.address);
      setBalance(walletManager.balance);
    } finally {
      setLoading(false);
    }
    // Load character + professions in background — don't block the UI
    void Promise.all([refreshCharacterProgress(), refreshProfessions()]);
  }, [walletManager, refreshCharacterProgress, refreshProfessions]);

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
