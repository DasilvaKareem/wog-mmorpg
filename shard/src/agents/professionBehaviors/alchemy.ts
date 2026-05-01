import type { QuestCraftRecipeBook } from "./recipeBooks.js";

export const alchemyRecipeBook: QuestCraftRecipeBook = {
  profession: "alchemy",
  recipesEndpoint: "/alchemy/recipes",
  craftEndpoint: "/alchemy/brew",
  stationType: "alchemy-lab",
  stationField: "alchemyLabId",
};
