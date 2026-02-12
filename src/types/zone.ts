export interface Vec2 {
  x: number;
  z: number;
}

// --- POI Types ---

export type POIType = "landmark" | "spawn-point" | "portal" | "structure" | "road-node";

export interface PortalData {
  destinationZone: string;
  destinationPoi: string;
  bidirectional: boolean;
}

export type StructureKind = "house" | "shop" | "tavern" | "temple" | "barracks";

export interface StructureData {
  kind: StructureKind;
  capacity: number;
  services: string[];
  npcs: string[];
}

export interface POI {
  id: string;
  name: string;
  type: POIType;
  position: Vec2;
  radius: number;
  tags: string[];
  portal?: PortalData;
  structure?: StructureData;
}

// --- Roads ---

export interface Road {
  id: string;
  name: string;
  nodes: string[];   // ordered POI ids
}

// --- Zone ---

export interface ZoneBudget {
  maxPopulation: number;
  maxThreat: number;
}

export interface Zone {
  id: string;
  name: string;
  bounds: { min: Vec2; max: Vec2 };
  budget: ZoneBudget;
  pois: POI[];
  roads: Road[];
}

// --- World ---

export interface ZoneConnection {
  from: string;
  to: string;
  portal: string;   // portal POI id that links them
}

export interface WorldMap {
  zones: string[];
  connections: ZoneConnection[];
}
