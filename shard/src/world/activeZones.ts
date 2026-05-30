// Which zones the world tick should simulate this frame.
//
// Pure helper, kept out of zoneRuntime.ts so it can be unit-tested without
// loading the whole simulation module (redis, party/guild systems, etc.).

/**
 * The set of zones that are active given the regions players occupy and a
 * walkable-neighbor lookup. Each player's region is active, plus its walkable
 * neighbors (so a player walking toward a boundary keeps the destination zone
 * awake before they cross). Everything else is dormant.
 *
 * Neighbor expansion is deliberately NOT transitive — only zones that actually
 * hold a player expand their neighbors, so a zone two hops from any player stays
 * dormant. Repeated regions are deduped so multiple players in one zone are cheap.
 */
export function activeZoneSet(
  playerRegions: Iterable<string>,
  getNeighbors: (zone: string) => string[],
): Set<string> {
  const active = new Set<string>();
  const expanded = new Set<string>();
  for (const region of playerRegions) {
    if (!region || expanded.has(region)) continue;
    expanded.add(region);
    active.add(region);
    for (const neighbor of getNeighbors(region)) active.add(neighbor);
  }
  return active;
}
