import type { QuestCraftRecipeBook } from "./recipeBooks.js";

export const cookingRecipeBook: QuestCraftRecipeBook = {
  profession: "cooking",
  recipesEndpoint: "/cooking/recipes",
  craftEndpoint: "/cooking/cook",
  stationType: "campfire",
  stationField: "campfireId",
};
