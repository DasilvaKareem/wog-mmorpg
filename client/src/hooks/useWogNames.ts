import { useCallback, useEffect, useRef, useState } from "react";
import { resolveWogName, displayName } from "../lib/nameService.js";

/**
 * React hook that batch-resolves .wog names for a list of wallet addresses.
 * Returns a Map<lowercaseAddress, displayString> that updates as names resolve.
 *
 * Usage:
 *   const { dn } = useWogNames(addresses);
 *   <span>{dn("0xabc...")}</span>   // → "Zephyr.wog" or "0xabc...def0"
 */
export function useWogNames(addresses: string[]) {
  const [nameMap, setNameMap] = useState<Map<string, string | null>>(new Map());
  const inflightRef = useRef(new Set<string>());

  useEffect(() => {
    const toResolve = addresses.filter((a) => {
      if (!a) return false;
      const key = a.toLowerCase();
      return !nameMap.has(key) && !inflightRef.current.has(key);
    });

    if (toResolve.length === 0) return;

    for (const addr of toResolve) {
      const key = addr.toLowerCase();
      inflightRef.current.add(key);
      void resolveWogName(addr).then((name) => {
        inflightRef.current.delete(key);
        setNameMap((prev) => {
          const next = new Map(prev);
          next.set(key, name);
          return next;
        });
      });
    }
  }, [addresses, nameMap]);

  /** Display name helper: returns "Name.wog" or truncated address */
  const dn = useCallback(
    (address: string): string => {
      if (!address) return "";
      const wogName = nameMap.get(address.toLowerCase());
      return displayName(address, wogName);
    },
    [nameMap]
  );

  return { nameMap, dn };
}
