export interface CharacterStats {
  str: number;
  def: number;
  hp: number;
  agi: number;
  int: number;
  mp: number;
  faith: number;
  luck: number;
  essence: number; // Mana for techniques
}

export interface ClassDefinition {
  id: string;
  name: string;
  description: string;
  baseStats: CharacterStats;
}

export const CLASS_DEFINITIONS: ClassDefinition[] = [
  {
    id: "warrior",
    name: "Warrior",
    description: "A frontline fighter with high strength and durability.",
    baseStats: { str: 55, def: 50, hp: 100, agi: 25, int: 10, mp: 15, faith: 15, luck: 30, essence: 80 },
  },
  {
    id: "paladin",
    name: "Paladin",
    description: "A holy knight who balances defense with divine faith.",
    baseStats: { str: 40, def: 50, hp: 100, agi: 15, int: 10, mp: 20, faith: 50, luck: 15, essence: 100 },
  },
  {
    id: "rogue",
    name: "Rogue",
    description: "A cunning striker who relies on agility and luck.",
    baseStats: { str: 30, def: 20, hp: 75, agi: 55, int: 10, mp: 10, faith: 10, luck: 90, essence: 70 },
  },
  {
    id: "ranger",
    name: "Ranger",
    description: "A versatile hunter skilled in ranged combat and evasion.",
    baseStats: { str: 30, def: 25, hp: 80, agi: 50, int: 25, mp: 15, faith: 15, luck: 60, essence: 90 },
  },
  {
    id: "mage",
    name: "Mage",
    description: "A master of arcane power with devastating magical attacks.",
    baseStats: { str: 10, def: 15, hp: 65, agi: 20, int: 60, mp: 60, faith: 20, luck: 50, essence: 150 },
  },
  {
    id: "cleric",
    name: "Cleric",
    description: "A divine healer who channels faith to protect allies.",
    baseStats: { str: 15, def: 30, hp: 90, agi: 15, int: 30, mp: 45, faith: 55, luck: 20, essence: 130 },
  },
  {
    id: "warlock",
    name: "Warlock",
    description: "A dark caster who trades stability for forbidden power.",
    baseStats: { str: 15, def: 15, hp: 70, agi: 20, int: 55, mp: 55, faith: 25, luck: 45, essence: 140 },
  },
  {
    id: "monk",
    name: "Monk",
    description: "A disciplined martial artist with swift strikes and high agility.",
    baseStats: { str: 45, def: 25, hp: 80, agi: 55, int: 10, mp: 10, faith: 15, luck: 60, essence: 85 },
  },
];

export function getClassById(id: string): ClassDefinition | undefined {
  return CLASS_DEFINITIONS.find((c) => c.id === id);
}
