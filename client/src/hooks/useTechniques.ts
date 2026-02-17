import * as React from "react";
import { API_URL } from "@/config";

export interface TechniqueInfo {
  id: string;
  name: string;
  description: string;
  className: string;
  levelRequired: number;
  essenceCost: number;
  cooldown: number;
  type: string;
  targetType: string;
  effects: Record<string, unknown>;
}

let cached: TechniqueInfo[] | null = null;
let fetching: Promise<TechniqueInfo[]> | null = null;

async function load(): Promise<TechniqueInfo[]> {
  if (cached) return cached;
  if (fetching) return fetching;
  fetching = fetch(`${API_URL}/techniques/catalog`)
    .then((r) => (r.ok ? r.json() : []))
    .then((data: TechniqueInfo[]) => {
      cached = data;
      return data;
    })
    .catch(() => [] as TechniqueInfo[]);
  return fetching;
}

export function useTechniques(): {
  techniques: TechniqueInfo[];
  getTechnique: (id: string) => TechniqueInfo | undefined;
} {
  const [techniques, setTechniques] = React.useState<TechniqueInfo[]>(cached ?? []);

  React.useEffect(() => {
    if (cached) {
      setTechniques(cached);
      return;
    }
    void load().then(setTechniques);
  }, []);

  const getTechnique = React.useCallback(
    (id: string) => techniques.find((t) => t.id === id),
    [techniques],
  );

  return { techniques, getTechnique };
}
