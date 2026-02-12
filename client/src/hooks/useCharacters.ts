import * as React from "react";

import {
  createCharacter,
  fetchCharacters,
  fetchClasses,
  fetchRaces,
} from "@/ShardClient";
import type {
  CharacterCreateResponse,
  ClassInfo,
  OwnedCharacter,
  RaceInfo,
} from "@/types";

interface CreatePayload {
  walletAddress: string;
  name: string;
  race: string;
  className: string;
}

interface UseCharactersResult {
  classes: ClassInfo[];
  races: RaceInfo[];
  characters: OwnedCharacter[];
  loading: boolean;
  load: (walletAddress: string) => Promise<void>;
  create: (
    payload: CreatePayload
  ) => Promise<CharacterCreateResponse | { error: string }>;
}

export function useCharacters(): UseCharactersResult {
  const [classes, setClasses] = React.useState<ClassInfo[]>([]);
  const [races, setRaces] = React.useState<RaceInfo[]>([]);
  const [characters, setCharacters] = React.useState<OwnedCharacter[]>([]);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async (walletAddress: string) => {
    setLoading(true);
    try {
      const [nextClasses, nextRaces, nextCharacters] = await Promise.all([
        fetchClasses(),
        fetchRaces(),
        fetchCharacters(walletAddress),
      ]);
      setClasses(nextClasses);
      setRaces(nextRaces);
      setCharacters(nextCharacters);
    } finally {
      setLoading(false);
    }
  }, []);

  const create = React.useCallback(async (payload: CreatePayload) => {
    const result = await createCharacter(
      payload.walletAddress,
      payload.name,
      payload.race,
      payload.className
    );
    if ("ok" in result && result.ok) {
      setCharacters((prev) => [
        {
          tokenId: "pending",
          name: result.character.name,
          description: result.character.description,
          properties: {
            race: result.character.race,
            class: result.character.class,
            level: result.character.level,
            xp: result.character.xp,
            stats: result.character.stats,
          },
        },
        ...prev,
      ]);
    }
    return result;
  }, []);

  return { classes, races, characters, loading, load, create };
}
