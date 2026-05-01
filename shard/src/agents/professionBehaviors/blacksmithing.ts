import type { QuestCraftRecipeBook } from "./recipeBooks.js";

export const blacksmithingRecipeBook: QuestCraftRecipeBook = {
  profession: "blacksmithing",
  recipesEndpoint: "/crafting/recipes",
  craftEndpoint: "/crafting/forge",
  stationType: "forge",
  stationField: "forgeId",
};
