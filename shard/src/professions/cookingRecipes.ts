export interface CookingRecipe {
  recipeId: string;
  name: string;
  outputTokenId: bigint;
  outputQuantity: number;
  requiredMaterials: Array<{ tokenId: bigint; quantity: number }>;
  requiredSkillLevel: number; // cooking skill level (1-300) needed to cook
  cookingTime: number; // seconds
  hpRestoration: number;
}

export const COOKING_RECIPES: CookingRecipe[] = [
  {
    recipeId: "cooked_meat",
    name: "Cooked Meat",
    outputTokenId: 81n,
    outputQuantity: 1,
    requiredMaterials: [{ tokenId: 1n, quantity: 1 }], // Raw Meat x1
    requiredSkillLevel: 1,
    cookingTime: 6,
    hpRestoration: 30,
  },
  {
    recipeId: "hearty_stew",
    name: "Hearty Stew",
    outputTokenId: 82n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 1n, quantity: 3 }, // Raw Meat x3
      { tokenId: 31n, quantity: 1 }, // Meadow Lily x1
    ],
    requiredSkillLevel: 15,
    cookingTime: 10,
    hpRestoration: 60,
  },
  {
    recipeId: "roasted_boar",
    name: "Roasted Boar",
    outputTokenId: 83n,
    outputQuantity: 1,
    requiredMaterials: [{ tokenId: 1n, quantity: 5 }], // Raw Meat x5
    requiredSkillLevel: 35,
    cookingTime: 16,
    hpRestoration: 100,
  },
  {
    recipeId: "bear_feast",
    name: "Bear Feast",
    outputTokenId: 84n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 1n, quantity: 8 }, // Raw Meat x8
      { tokenId: 35n, quantity: 2 }, // Lavender x2
    ],
    requiredSkillLevel: 60,
    cookingTime: 24,
    hpRestoration: 150,
  },
  {
    recipeId: "heros_banquet",
    name: "Hero's Banquet",
    outputTokenId: 85n,
    outputQuantity: 1,
    requiredMaterials: [
      { tokenId: 1n, quantity: 15 }, // Raw Meat x15
      { tokenId: 40n, quantity: 3 }, // Dragon's Breath x3
    ],
    requiredSkillLevel: 100,
    cookingTime: 40,
    hpRestoration: 250,
  },
];
