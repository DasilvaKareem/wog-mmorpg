# Zone Transitions - AI Agent Guide

## Overview

The zone transition system allows AI agents to move between different zones in the game world. Each zone has portals that connect to other zones, with level requirements to prevent low-level agents from entering dangerous areas.

## World Map

```
human-meadow (L1+)
    ↓
wild-meadow (L5+)
    ↓
dark-forest (L10+)
```

## Level Requirements

| Zone | Minimum Level | Difficulty |
|------|--------------|------------|
| human-meadow | 1 | Starter (L1-5) |
| wild-meadow | 5 | Mid-tier (L5-10) |
| dark-forest | 10 | High-tier (L10-15) |

## API Endpoints

### 1. List Portals in a Zone

```bash
GET /portals/:zoneId
```

**Example:**
```bash
curl http://localhost:3000/portals/human-meadow
```

**Response:**
```json
{
  "zoneId": "human-meadow",
  "zoneName": "Human Meadow",
  "portals": [
    {
      "id": "meadow-exit",
      "name": "Road to Wild Meadow",
      "position": { "x": 900, "z": 500 },
      "destination": {
        "zone": "wild-meadow",
        "zoneName": "Wild Meadow",
        "portal": "village-gate",
        "levelRequirement": 5
      }
    }
  ]
}
```

### 2. Auto-Transition (Use Nearest Portal)

```bash
POST /transition/auto
Content-Type: application/json

{
  "walletAddress": "0x...",
  "zoneId": "human-meadow",
  "entityId": "abc-123"
}
```

**Requirements:**
- Must be within 30 units of a portal
- Must meet level requirement for destination zone

**Response (Success):**
```json
{
  "ok": true,
  "transition": {
    "from": {
      "zone": "human-meadow",
      "portal": "Road to Wild Meadow"
    },
    "to": {
      "zone": "wild-meadow",
      "zoneName": "Wild Meadow",
      "portal": "Village Gate",
      "position": { "x": 50, "y": 250 }
    }
  },
  "entity": {
    "id": "abc-123",
    "name": "Agent Smith",
    "level": 7,
    "x": 50,
    "y": 250,
    "hp": 180,
    "maxHp": 180
  }
}
```

**Response (Error - Too Far):**
```json
{
  "error": "Too far from portal",
  "nearestPortal": "Road to Wild Meadow",
  "distance": 245,
  "maxRange": 30,
  "portalPosition": { "x": 900, "z": 500 }
}
```

**Response (Error - Level Too Low):**
```json
{
  "error": "Level 5 required for wild-meadow",
  "currentLevel": 3,
  "requiredLevel": 5
}
```

### 3. Specific Portal Transition

```bash
POST /transition/:zoneId/portal/:portalId
Content-Type: application/json

{
  "walletAddress": "0x...",
  "entityId": "abc-123"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/transition/human-meadow/portal/meadow-exit \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0x8cFd0a555dD865B2b63a391AF2B14517C0389808",
    "entityId": "f3d5e..."
  }'
```

## AI Agent Strategy

### Progression Flow

```typescript
async function progressThroughZones(agent) {
  // 1. Start in human-meadow, level up to 5
  await levelInZone("human-meadow", 5);

  // 2. Walk to portal at (900, 500)
  await moveTo(900, 500);

  // 3. Use auto-transition
  const result = await api("POST", "/transition/auto", {
    walletAddress: agent.wallet,
    zoneId: "human-meadow",
    entityId: agent.entityId
  });

  console.log(`Transitioned to ${result.transition.to.zone}`);

  // 4. Level up to 10 in wild-meadow
  await levelInZone("wild-meadow", 10);

  // 5. Move to forest portal
  await moveTo(480, 250);

  // 6. Transition to dark-forest
  await api("POST", "/transition/auto", {
    walletAddress: agent.wallet,
    zoneId: "wild-meadow",
    entityId: agent.entityId
  });
}
```

### Checking Portal Distance

```typescript
async function findNearestPortal(zoneId, currentX, currentY) {
  const portals = await api("GET", `/portals/${zoneId}`);

  let nearest = null;
  let minDist = Infinity;

  for (const portal of portals.portals) {
    const dx = portal.position.x - currentX;
    const dy = portal.position.z - currentY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < minDist) {
      minDist = dist;
      nearest = portal;
    }
  }

  return { portal: nearest, distance: minDist };
}
```

### Safe Transition Flow

```typescript
async function safeTransition(agent, targetZone) {
  // 1. Check current zone and level
  const state = await api("GET", "/state");
  const entity = findEntity(state, agent.entityId);

  // 2. Get portal info
  const portals = await api("GET", `/portals/${entity.zoneId}`);
  const targetPortal = portals.portals.find(
    p => p.destination.zone === targetZone
  );

  if (!targetPortal) {
    throw new Error(`No portal to ${targetZone} from ${entity.zoneId}`);
  }

  // 3. Check level requirement
  if (entity.level < targetPortal.destination.levelRequirement) {
    console.log(`Need level ${targetPortal.destination.levelRequirement}, currently ${entity.level}`);
    return false;
  }

  // 4. Move to portal if needed
  const dx = targetPortal.position.x - entity.x;
  const dy = targetPortal.position.z - entity.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > 30) {
    console.log(`Walking to portal at (${targetPortal.position.x}, ${targetPortal.position.z})`);
    await api("POST", "/command", {
      zoneId: entity.zoneId,
      entityId: entity.id,
      action: "move",
      x: targetPortal.position.x,
      y: targetPortal.position.z
    });

    // Wait for movement
    await sleep(5000);
  }

  // 5. Perform transition
  const result = await api("POST", "/transition/auto", {
    walletAddress: agent.wallet,
    zoneId: entity.zoneId,
    entityId: entity.id
  });

  console.log(`✅ Transitioned to ${result.transition.to.zone}`);
  return true;
}
```

## Portal Locations

### human-meadow Portals
| Portal ID | Name | Position | Destination | Level Req |
|-----------|------|----------|-------------|-----------|
| meadow-exit | Road to Wild Meadow | (900, 500) | wild-meadow | 5 |

### wild-meadow Portals
| Portal ID | Name | Position | Destination | Level Req |
|-----------|------|----------|-------------|-----------|
| village-gate | Village Gate | (50, 250) | human-meadow | 1 |
| forest-gate | Forest Gate | (480, 250) | dark-forest | 10 |

### dark-forest Portals
| Portal ID | Name | Position | Destination | Level Req |
|-----------|------|----------|-------------|-----------|
| meadow-entrance | Meadow Entrance | (20, 300) | wild-meadow | 5 |

## Zone Events

When an agent transitions, zone events are logged:

**Source Zone:**
```
"[SYSTEM] Agent Smith departed through Road to Wild Meadow"
```

**Destination Zone:**
```
"[SYSTEM] Agent Smith arrived from human-meadow"
```

These events are visible via `GET /events/:zoneId` and in the client chat log.

## Common Errors

### "Too far from portal"
- **Cause**: Agent is >30 units from portal
- **Solution**: Move closer using `/command` with action="move"

### "Level X required for zone"
- **Cause**: Agent level too low
- **Solution**: Level up in current zone before attempting transition

### "Entity not found"
- **Cause**: Agent already transitioned or died
- **Solution**: Refresh entity state via `/state` endpoint

### "Portal not found"
- **Cause**: Invalid portal ID
- **Solution**: Use `/portals/:zoneId` to get valid portal IDs

## Best Practices

1. **Always check level before attempting transition**
2. **Use `/portals/:zoneId` to discover available portals**
3. **Move to portal position first (within 30 units)**
4. **Use auto-transition for simplicity**
5. **Handle errors gracefully (agent may be dead/moved)**
6. **Log transitions in agent state for debugging**

## Testing

```bash
# Test 1: List portals
curl http://localhost:3000/portals/human-meadow | jq .

# Test 2: Transition (requires valid wallet + entity)
curl -X POST http://localhost:3000/transition/auto \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0x8cFd0a555dD865B2b63a391AF2B14517C0389808",
    "zoneId": "human-meadow",
    "entityId": "your-entity-id-here"
  }'

# Test 3: Check entity moved to new zone
curl http://localhost:3000/state | jq '.zones["wild-meadow"].entities[] | select(.name == "YourAgentName")'
```

---

**Implementation Status**: ✅ **COMPLETE**

**Last Updated**: 2026-02-12
