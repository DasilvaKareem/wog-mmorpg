import assert from "node:assert/strict";

import { LOOT_TABLES } from "../src/items/lootTables.js";
import { getItemByTokenId } from "../src/items/itemCatalog.js";
import { COOKING_RECIPES } from "../src/professions/cookingRecipes.js";

const mobDropSourcesByToken = new Map<string, string[]>();

for (const table of Object.values(LOOT_TABLES)) {
  for (const drop of table.autoDrops) {
    const tokenId = drop.tokenId.toString();
    const sources = mobDropSourcesByToken.get(tokenId) ?? [];
    sources.push(table.mobName);
    mobDropSourcesByToken.set(tokenId, sources);
  }
}

for (const recipe of COOKING_RECIPES) {
  const output = getItemByTokenId(recipe.outputTokenId);
  assert.ok(output, `${recipe.name} output token ${recipe.outputTokenId} is missing from item catalog`);
  assert.equal(output.category, "consumable", `${recipe.name} output should be a consumable`);

  for (const material of recipe.requiredMaterials) {
    const item = getItemByTokenId(material.tokenId);
    assert.ok(item, `${recipe.name} material token ${material.tokenId} is missing from item catalog`);
    assert.ok(material.quantity > 0, `${recipe.name} has invalid ${item.name} quantity`);

    const mobSources = mobDropSourcesByToken.get(material.tokenId.toString()) ?? [];
    assert.ok(
      mobSources.length > 0,
      `${recipe.name} requires ${item.name}, but no mob auto-drop table produces it`,
    );
  }
}

console.log("cookingEconomy.test.ts passed");
