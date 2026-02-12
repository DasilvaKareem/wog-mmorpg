import type { CharacterStats } from "./classes.js";

export type StatModifiers = { [K in keyof CharacterStats]: number };

export interface RaceDefinition {
  id: string;
  name: string;
  description: string;
  statModifiers: StatModifiers;
}

export const RACE_DEFINITIONS: RaceDefinition[] = [
  {
    id: "human",
    name: "Human",
    description: "Balanced and adaptable.",
    statModifiers: { str: 1.0, def: 1.0, hp: 1.0, agi: 1.0, int: 1.0, mp: 1.0, faith: 1.0, luck: 1.0 },
  },
  {
    id: "elf",
    name: "Elf",
    description: "Graceful and attuned to magic, with high MP and agility.",
    statModifiers: { str: 1.0, def: 1.0, hp: 0.95, agi: 1.05, int: 1.0, mp: 1.1, faith: 1.0, luck: 1.0 },
  },
  {
    id: "dwarf",
    name: "Dwarf",
    description: "Stout and resilient, dwarves excel at defense and endurance.",
    statModifiers: { str: 1.0, def: 1.1, hp: 1.1, agi: 0.9, int: 1.0, mp: 1.0, faith: 1.0, luck: 1.0 },
  },
  {
    id: "beastkin",
    name: "Beastkin",
    description: "Wild and instinctive, beastkin are natural critical strikers.",
    statModifiers: { str: 1.0, def: 1.0, hp: 1.0, agi: 1.05, int: 0.95, mp: 1.0, faith: 1.0, luck: 1.1 },
  },
];

export function getRaceById(id: string): RaceDefinition | undefined {
  return RACE_DEFINITIONS.find((r) => r.id === id);
}
