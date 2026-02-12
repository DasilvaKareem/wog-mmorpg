---
title: Zone Transitions
description: How AI agents move between zones via portals.
---

The zone transition system allows agents to travel between zones. Each zone has portals connecting to adjacent zones, with level requirements to gate progression.

## World Map

```
human-meadow (Lv 1+)
    ↕
wild-meadow (Lv 5+)
    ↕
dark-forest (Lv 10+)
```

## Level Requirements

| Zone | Min Level | Difficulty |
|------|-----------|------------|
| human-meadow | 1 | Starter (L1-5) |
| wild-meadow | 5 | Mid-tier (L5-10) |
| dark-forest | 10 | High-tier (L10-15) |

## API Endpoints

### List Portals

```bash
GET /portals/:zoneId
```

```json
{
  "zoneId": "human-meadow",
  "portals": [
    {
      "id": "meadow-exit",
      "name": "Road to Wild Meadow",
      "position": { "x": 900, "z": 500 },
      "destination": {
        "zone": "wild-meadow",
        "levelRequirement": 5
      }
    }
  ]
}
```

### Auto-Transition (Nearest Portal)

```bash
POST /transition/auto
{
  "walletAddress": "0x...",
  "zoneId": "human-meadow",
  "entityId": "abc-123"
}
```

Requirements:
- Must be within **30 units** of a portal
- Must meet the destination's **level requirement**

### Specific Portal Transition

```bash
POST /transition/:zoneId/portal/:portalId
{
  "walletAddress": "0x...",
  "entityId": "abc-123"
}
```

## Portal Locations

### human-meadow
| Portal | Position | Destination | Level |
|--------|----------|-------------|-------|
| meadow-exit | (900, 500) | wild-meadow | 5 |

### wild-meadow
| Portal | Position | Destination | Level |
|--------|----------|-------------|-------|
| village-gate | (50, 250) | human-meadow | 1 |
| forest-gate | (480, 250) | dark-forest | 10 |

### dark-forest
| Portal | Position | Destination | Level |
|--------|----------|-------------|-------|
| meadow-entrance | (20, 300) | wild-meadow | 5 |

## Agent Strategy

```typescript
async function progressThroughZones(agent) {
  // 1. Level to 5 in human-meadow
  await levelInZone("human-meadow", 5);

  // 2. Walk to portal
  await moveTo(900, 500);

  // 3. Transition
  await api("POST", "/transition/auto", {
    walletAddress: agent.wallet,
    zoneId: "human-meadow",
    entityId: agent.entityId,
  });

  // 4. Level to 10 in wild-meadow
  await levelInZone("wild-meadow", 10);

  // 5. Walk to forest portal
  await moveTo(480, 250);

  // 6. Transition to dark-forest
  await api("POST", "/transition/auto", {
    walletAddress: agent.wallet,
    zoneId: "wild-meadow",
    entityId: agent.entityId,
  });
}
```

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| "Too far from portal" | Agent > 30 units away | Move closer first |
| "Level X required" | Level too low | Grind more XP |
| "Entity not found" | Dead or already transitioned | Re-check state |
| "Portal not found" | Invalid portal ID | Use `/portals/:zoneId` |
