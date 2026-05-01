import { alchemyRecipeBook } from "./alchemy.js";
import { blacksmithingRecipeBook } from "./blacksmithing.js";
import { cookingRecipeBook } from "./cooking.js";
import { jewelcraftingRecipeBook } from "./jewelcrafting.js";
import { leatherworkingRecipeBook } from "./leatherworking.js";

export type CraftProfession =
  | "blacksmithing"
  | "alchemy"
  | "cooking"
  | "leatherworking"
  | "jewelcrafting";

export interface QuestCraftRecipeBook {
  profession: CraftProfession;
  recipesEndpoint: string;
  craftEndpoint: string;
  stationType: string;
  stationField: string;
}

export const QUEST_CRAFT_RECIPE_BOOKS: readonly QuestCraftRecipeBook[] = [
  blacksmithingRecipeBook,
  alchemyRecipeBook,
  cookingRecipeBook,
  leatherworkingRecipeBook,
  jewelcraftingRecipeBook,
] as const;

export function getRecipeOutputName(recipe: any): string {
  return String(recipe.output?.name ?? recipe.name ?? "");
}

export function getRecipeMaterials(recipe: any): Array<{ tokenId: number; quantity: number; name: string }> {
  const materials = recipe.materials ?? recipe.requiredMaterials ?? [];
  return materials.map((m: any) => ({
    tokenId: Number(m.tokenId),
    quantity: Number(m.quantity ?? 0),
    name: String(m.name ?? m.itemName ?? ""),
  }));
}
