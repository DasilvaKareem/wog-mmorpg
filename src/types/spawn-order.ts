import type { Vec2 } from "./zone.js";

export interface SpawnOrder {
  orderId: string;
  zoneId: string;
  templateId: string;
  position: Vec2;
  count: number;
}

export interface SpawnOrderResult {
  orderId: string;
  status: "accepted" | "rejected";
  reason?: string;
  instanceIds?: string[];
}
