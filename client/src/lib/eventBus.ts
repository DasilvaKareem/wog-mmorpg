import type { Entity } from "@/types";

export interface GameEventMap {
  guildRegistrarClick: Entity;
  auctioneerClick: Entity;
  arenaMasterClick: Entity;
  entityInspect: { entityId: string; zoneId: string };
  inspectSelf: { zoneId: string; walletAddress: string };
  switchZone: { zoneId: string };
  zoneChanged: { zoneId: string };
  lockToPlayer: { walletAddress: string };
  /** Pan + lock camera to any entity by its zone entity ID */
  focusEntity: { entityId: string };
  /** Follow a player by wallet after switching to their zone */
  followPlayer: { zoneId: string; walletAddress: string };
  /** User clicked an NPC to send the agent there */
  agentGoToNpc: { entityId: string; zoneId: string; name: string; type: string; teachesProfession?: string; action?: string; questId?: string; questTitle?: string };
  /** User clicked an NPC that has no dedicated dialog — show info panel */
  npcInfoClick: Entity;
  /** User clicked a quest-giver NPC — open dialogue overlay */
  questNpcClick: Entity;
  /** Open the inbox panel */
  inboxOpen: void;
  /** Open the settings dialog */
  settingsOpen: void;
  /** Open the character dialog */
  characterOpen: void;
  /** Open the world map */
  mapOpen: void;
  /** Open the quest log */
  questLogOpen: void;
  /** Open the in-game inventory dialog */
  inventoryOpen: void;
  /** Character list changed and wallet-backed selectors should refetch */
  charactersChanged: { walletAddress: string };
  /** PvP match found — transition to arena */
  matchFound: { battleId: string; status: string };
  /** PvP battle ended — transition back to overworld */
  battleEnded: { battleId: string };
}

type GameEventKey = keyof GameEventMap;
type Handler<K extends GameEventKey> = (payload: GameEventMap[K]) => void;

class EventBus {
  private listeners = new Map<GameEventKey, Set<(payload: unknown) => void>>();

  on<K extends GameEventKey>(event: K, handler: Handler<K>): () => void {
    const set = this.listeners.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(handler as (payload: unknown) => void);
    this.listeners.set(event, set);
    return () => this.off(event, handler);
  }

  off<K extends GameEventKey>(event: K, handler: Handler<K>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler as (payload: unknown) => void);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  emit<K extends GameEventKey>(event: K, payload: GameEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(payload);
    }
  }
}

export const gameBus = new EventBus();
