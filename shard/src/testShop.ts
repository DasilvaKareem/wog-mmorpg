#!/usr/bin/env tsx
import "dotenv/config";

const API = "http://localhost:3000";
const WALLET = "0xf6f0f8ca2ef85deb9eEBdBc4BC541d2D57832D4b";

async function testShop() {
  console.log("🛒 Testing Shop System\n");

  // Get merchant
  const state = await fetch(`${API}/state`).then(r => r.json());
  const merchant = Object.entries(state.zones["village-square"].entities)
    .find(([_, e]: any) => e.type === "merchant");

  if (!merchant) {
    console.log("❌ No merchant found");
    return;
  }

  const merchantId = merchant[0];
  console.log(`✅ Found merchant: ${(merchant[1] as any).name}\n`);

  // Get shop items
  const shop = await fetch(`${API}/shop/npc/village-square/${merchantId}`).then(r => r.json());
  const healthPotion = shop.items?.find((i: any) => i.name === "Health Potion");

  if (!healthPotion) {
    console.log("❌ Health Potion not found");
    return;
  }

  console.log(`Item: ${healthPotion.name}`);
  console.log(`Price: ${healthPotion.goldPrice}g`);
  console.log(`\nAttempting purchase...\n`);

  // Try to buy
  const result = await fetch(`${API}/shop/buy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      buyerAddress: WALLET,
      tokenId: parseInt(healthPotion.tokenId),
      quantity: 1
    })
  }).then(r => r.json());

  if (result.ok) {
    console.log(`✅ Successfully purchased ${result.item}!`);
    console.log(`   Quantity: ${result.quantity}`);
    console.log(`   Cost: ${result.goldSpent}g`);
    console.log(`\n🎉 BLOCKCHAIN SHOP SYSTEM COMPLETE!`);
  } else {
    console.log(`❌ Purchase failed:`, result);
  }
}

testShop();
