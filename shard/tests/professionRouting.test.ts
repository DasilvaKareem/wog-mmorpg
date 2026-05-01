import assert from "node:assert/strict";

import {
  QUEST_CRAFT_RECIPE_BOOKS,
  getRecipeMaterials,
  getRecipeOutputName,
} from "../src/agents/professionBehaviors/recipeBooks.js";
import { planMaterialRecovery } from "../src/agents/professionBehaviors/materialRecovery.js";

const booksByProfession = new Map(QUEST_CRAFT_RECIPE_BOOKS.map((book) => [book.profession, book]));

for (const profession of ["blacksmithing", "alchemy", "cooking", "leatherworking", "jewelcrafting"] as const) {
  assert.ok(booksByProfession.has(profession), `missing recipe book for ${profession}`);
}

assert.deepEqual(booksByProfession.get("cooking"), {
  profession: "cooking",
  recipesEndpoint: "/cooking/recipes",
  craftEndpoint: "/cooking/cook",
  stationType: "campfire",
  stationField: "campfireId",
});

assert.deepEqual(booksByProfession.get("leatherworking"), {
  profession: "leatherworking",
  recipesEndpoint: "/leatherworking/recipes",
  craftEndpoint: "/leatherworking/craft",
  stationType: "tanning-rack",
  stationField: "stationId",
});

assert.deepEqual(booksByProfession.get("jewelcrafting"), {
  profession: "jewelcrafting",
  recipesEndpoint: "/jewelcrafting/recipes",
  craftEndpoint: "/jewelcrafting/craft",
  stationType: "jewelers-bench",
  stationField: "stationId",
});

assert.equal(getRecipeOutputName({ name: "Hearty Stew" }), "Hearty Stew");
assert.equal(getRecipeOutputName({ output: { name: "Minor Health Potion" } }), "Minor Health Potion");
assert.deepEqual(getRecipeMaterials({
  requiredMaterials: [{ tokenId: 87, itemName: "Raw Meat", quantity: 2 }],
}), [{ tokenId: 87, quantity: 2, name: "Raw Meat" }]);

assert.deepEqual(planMaterialRecovery("cooking", "Raw Meat"), { type: "combat", targetItemName: "Raw Meat" });
assert.deepEqual(planMaterialRecovery("cooking", "Dragon's Breath"), { type: "gather", preference: "herb", targetItemName: "Dragon's Breath" });
assert.deepEqual(planMaterialRecovery("leatherworking", "Light Leather"), { type: "skin", targetItemName: "Light Leather" });
assert.deepEqual(planMaterialRecovery("alchemy", "Meadow Lily"), { type: "gather", preference: "herb", targetItemName: "Meadow Lily" });
assert.deepEqual(planMaterialRecovery("blacksmithing", "Tin Bar"), { type: "gather", preference: "ore", targetItemName: "Tin Bar" });
assert.deepEqual(planMaterialRecovery("jewelcrafting", "Rough Ruby"), { type: "gather", preference: "ore", targetItemName: "Rough Ruby" });

console.log("professionRouting.test.ts passed");
