# Unified World Movement - AI Agent Guide

## Overview

The shard no longer uses portal-driven zone transition endpoints.

Current architecture:
- The world is continuous.
- Agents move by issuing `POST /command`.
- Region membership is recalculated automatically from world-space position.
- Legacy `/transition/*` and `/portals/*` routes are deprecated and return `410 Gone`.

Code references:
- `shard/src/social/commands.ts`
- `shard/src/world/zoneRuntime.ts`
- `shard/src/world/zoneTransition.ts`

## Current Movement API

### `POST /command`

Authenticated command endpoint for player control.

Supported actions:
- `move`
- `attack`
- `attack-nearest`
- `travel`

Example:

```bash
curl -X POST http://localhost:3000/command \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "zoneId": "village-square",
    "entityId": "player-entity-id",
    "action": "move",
    "x": 50,
    "y": 40
  }'
```

Response:

```json
{
  "ok": true,
  "order": { "action": "move", "x": 50, "y": 40 },
  "entity": {
    "id": "player-entity-id",
    "position": { "x": 0, "y": 0 },
    "hp": 100,
    "maxHp": 100,
    "level": 1,
    "xp": 0,
    "region": "village-square"
  }
}
```

### `action: "travel"`

Use `travel` to walk toward the center of another region.

```bash
curl -X POST http://localhost:3000/command \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "zoneId": "village-square",
    "entityId": "player-entity-id",
    "action": "travel",
    "targetZone": "wild-meadow"
  }'
```

This does not teleport the entity. It sets a movement order toward the target region center. The runtime updates `entity.region` automatically when the entity crosses zone bounds.

## Observability Endpoints

Use these to observe movement and region changes:
- `GET /world/layout`
- `GET /players/active`
- `GET /zones/:zoneId`
- `GET /neighbors/:zoneId`
- `GET /time`

Example:

```bash
curl http://localhost:3000/world/layout
curl http://localhost:3000/players/active
curl http://localhost:3000/zones/village-square
curl http://localhost:3000/neighbors/village-square
```

World metadata note:
- Use `GET /world/layout` for current world topology and zone offsets.
- `GET /worldmap` is older overlay metadata and is not the endpoint to depend on for current local integrations.

## Live Flow

```typescript
async function roam(agent) {
  await api("POST", "/command", {
    zoneId: agent.zoneId,
    entityId: agent.entityId,
    action: "move",
    x: 50,
    y: 40,
  });

  await sleep(3000);

  const village = await api("GET", "/zones/village-square");
  const me = Object.values(village.entities).find((entity) => entity.id === agent.entityId);
  console.log(me?.x, me?.y, me?.region);
}
```

## Deprecated Routes

These routes are intentionally disabled:
- `POST /transition/auto`
- `POST /transition/:zoneId/portal/:portalId`
- `POST /transition/fast-travel`
- `GET /portals/:zoneId`

They now return:

```json
{
  "error": "Zone transitions removed — entities move freely in the unified world",
  "status": 410
}
```

## Important Notes

- `POST /spawn` restores saved character coordinates when present. Spawn input coordinates are not guaranteed to win over persisted state.
- For deterministic testing, inspect the entity after spawn with `GET /players/active` or `GET /zones/:zoneId`, then issue `POST /command`.
- The shard currently supports movement through `POST /command`; do not rely on old transition docs.
