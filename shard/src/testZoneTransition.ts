import "dotenv/config";

const API_URL = "http://localhost:3000";

async function api(method: string, endpoint: string, body?: any) {
  const url = `${API_URL}${endpoint}`;
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  };

  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`${method} ${endpoint} failed: ${JSON.stringify(err)}`);
  }
  return res.json();
}

async function main() {
  console.log("\n🌍 Zone Transition System Test\n");
  console.log("=".repeat(60));

  // Test 1: List portals in all zones
  console.log("\n1️⃣  Listing portals in all zones...\n");

  for (const zoneId of ["human-meadow", "wild-meadow", "dark-forest"]) {
    const portals = await api("GET", `/portals/${zoneId}`);
    console.log(`📍 ${portals.zoneName} (${zoneId})`);
    if (portals.portals.length === 0) {
      console.log("   No portals in this zone");
    } else {
      for (const portal of portals.portals) {
        console.log(`   • ${portal.name} → ${portal.destination.zoneName} (L${portal.destination.levelRequirement}+)`);
        console.log(`     Position: (${portal.position.x}, ${portal.position.z})`);
      }
    }
    console.log("");
  }

  // Test 2: Spawn a test agent
  console.log("\n2️⃣  Spawning test agent in human-meadow...\n");

  const testWallet = process.env.AGENT_WALLET_ADDRESS;
  if (!testWallet) {
    console.error("❌ AGENT_WALLET_ADDRESS not set in .env");
    return;
  }

  // Generate a fake JWT token for testing (bypassing auth for now)
  // In production, this would come from POST /auth/login
  const testToken = "test-token"; // You'd need a real token

  const spawn = await api("POST", "/spawn", {
    zoneId: "human-meadow",
    type: "player",
    name: "Zone Transition Tester",
    x: 850, // Near portal at (900, 500)
    y: 480,
    walletAddress: testWallet,
    level: 10, // High enough for all zones
    hp: 200,
  });

  const entityId = spawn.spawned.id;
  console.log(`✅ Spawned "${spawn.spawned.name}" (ID: ${entityId})`);
  console.log(`   Position: (${spawn.spawned.x}, ${spawn.spawned.y})`);
  console.log(`   Level: ${spawn.spawned.level}`);

  // Test 3: Check distance to portal
  console.log("\n3️⃣  Checking distance to portal...\n");

  const portals = await api("GET", "/portals/human-meadow");
  const meadowExit = portals.portals[0];
  const dx = meadowExit.position.x - spawn.spawned.x;
  const dy = meadowExit.position.z - spawn.spawned.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  console.log(`📏 Distance to "${meadowExit.name}": ${Math.round(dist)} units`);
  if (dist > 30) {
    console.log(`   ⚠️  Too far! Moving closer...`);

    await api("POST", "/command", {
      zoneId: "human-meadow",
      entityId,
      action: "move",
      x: meadowExit.position.x,
      y: meadowExit.position.z,
    });

    console.log(`   ✅ Moved to portal position`);
  } else {
    console.log(`   ✅ Within range (30 units)`);
  }

  // Wait a moment for movement
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test 4: Perform transition
  console.log("\n4️⃣  Attempting zone transition...\n");

  try {
    const result = await api("POST", "/transition/auto", {
      walletAddress: testWallet,
      zoneId: "human-meadow",
      entityId,
    });

    console.log(`✅ Transition successful!`);
    console.log(`   From: ${result.transition.from.zone} → ${result.transition.to.zone}`);
    console.log(`   Portal: ${result.transition.from.portal}`);
    console.log(`   New Position: (${result.entity.x}, ${result.entity.y})`);
    console.log(`   HP: ${result.entity.hp}/${result.entity.maxHp}`);

    // Test 5: Verify entity in new zone
    console.log("\n5️⃣  Verifying entity in new zone...\n");

    const state = await api("GET", "/state");
    const wildMeadowZone = state.zones["wild-meadow"];
    const foundEntity = Object.values(wildMeadowZone.entities).find(
      (e: any) => e.id === entityId
    );

    if (foundEntity) {
      console.log(`✅ Entity confirmed in wild-meadow!`);
      console.log(`   Position: (${(foundEntity as any).x}, ${(foundEntity as any).y})`);
    } else {
      console.log(`❌ Entity not found in wild-meadow`);
    }

    // Test 6: Transition to dark-forest
    console.log("\n6️⃣  Transitioning to dark-forest...\n");

    // Move to forest gate
    const wildPortals = await api("GET", "/portals/wild-meadow");
    const forestGate = wildPortals.portals.find((p: any) => p.destination.zone === "dark-forest");

    if (forestGate) {
      console.log(`   Moving to ${forestGate.name}...`);

      await api("POST", "/command", {
        zoneId: "wild-meadow",
        entityId,
        action: "move",
        x: forestGate.position.x,
        y: forestGate.position.z,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const result2 = await api("POST", "/transition/auto", {
        walletAddress: testWallet,
        zoneId: "wild-meadow",
        entityId,
      });

      console.log(`   ✅ Arrived in ${result2.transition.to.zoneName}!`);
      console.log(`   Position: (${result2.entity.x}, ${result2.entity.y})`);
    }

    // Test 7: Return to human-meadow
    console.log("\n7️⃣  Returning to human-meadow...\n");

    // Go back through portals
    const darkPortals = await api("GET", "/portals/dark-forest");
    const meadowEntrance = darkPortals.portals[0];

    await api("POST", "/command", {
      zoneId: "dark-forest",
      entityId,
      action: "move",
      x: meadowEntrance.position.x,
      y: meadowEntrance.position.z,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Back to wild-meadow
    await api("POST", "/transition/auto", {
      walletAddress: testWallet,
      zoneId: "dark-forest",
      entityId,
    });

    // Then to human-meadow
    await api("POST", "/command", {
      zoneId: "wild-meadow",
      entityId,
      action: "move",
      x: 50,
      y: 250,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const finalResult = await api("POST", "/transition/auto", {
      walletAddress: testWallet,
      zoneId: "wild-meadow",
      entityId,
    });

    console.log(`   ✅ Back in ${finalResult.transition.to.zoneName}!`);

    console.log("\n✅ All zone transition tests passed!\n");
    console.log("=".repeat(60));
  } catch (err: any) {
    console.error("\n❌ Transition failed:", err.message);
  }

  // Cleanup
  console.log("\n🧹 Cleaning up test entity...\n");
  await api("DELETE", `/spawn/human-meadow/${entityId}`);
  console.log("✅ Test complete!");
}

main().catch(console.error);
