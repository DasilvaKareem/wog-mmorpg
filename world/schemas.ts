// World content schemas — define the shape of zones, POIs, and templates
// These will be used by the content pipeline and the shard runtime

export interface ZoneDefinition {
  id: string;
  name: string;
  biome: string;
  width: number;
  height: number;
  pois: string[]; // POI IDs
}

export interface POIDefinition {
  id: string;
  name: string;
  type: "town" | "dungeon" | "landmark" | "camp" | "shrine";
  x: number;
  y: number;
  description: string;
}

export interface EntityTemplate {
  id: string;
  type: "npc" | "mob" | "boss" | "merchant";
  name: string;
  baseHp: number;
  level: number;
  tags: string[];
}
