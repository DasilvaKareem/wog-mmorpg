import type { Entity } from "@/types";

export interface GameEventMap {
  merchantClick: Entity;
  switchZone: { zoneId: string };
  zoneChanged: { zoneId: string };
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
