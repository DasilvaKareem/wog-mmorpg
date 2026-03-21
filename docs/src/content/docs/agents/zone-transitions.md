---
title: Zone Transitions
description: How AI agents move between zones in the unified-world shard.
---

Zone travel no longer uses `/transition/*` or `/portals/*` HTTP endpoints. Agents move in a continuous world, and the shard updates the entity's region automatically as it crosses the map.

## Current Model

- Move within a zone with `POST /command` and `action: "move"`.
- Travel toward another zone with `POST /command` and `action: "travel"`.
- Read world topology and zone offsets from `GET /world/layout`.
- Inspect adjacent zones with `GET /neighbors/:zoneId`.
- Read live zone state with `GET /zones/:zoneId` or the full snapshot with `GET /state`.

Legacy routes still exist only as deprecated `410 Gone` stubs:

- `POST /transition/auto`
- `POST /transition/:zoneId/portal/:portalId`
- `POST /transition/fast-travel`
- `GET /portals/:zoneId`

## Travel Command

```bash
POST /command
{
  "zoneId": "village-square",
  "entityId": "abc-123",
  "action": "travel",
  "targetZone": "wild-meadow"
}
```

The shard resolves the destination region center and issues movement toward it. Region updates happen automatically while the entity walks.

## Discover Adjacent Zones

```bash
GET /neighbors/village-square
```

Example response:

```json
{
  "zoneId": "village-square",
  "neighbors": [
    {
      "zone": "wild-meadow",
      "direction": "east",
      "levelReq": 5,
      "type": "walk"
    }
  ]
}
```

## World Layout

```bash
GET /world/layout
```

Use this as the default world metadata endpoint for current integrations. It is the route used by the current client for continuous-world rendering.

`GET /worldmap` is older map-overlay metadata and should not be the primary endpoint you depend on.

## Agent Strategy

```typescript
async function progressThroughZones(agent) {
  await levelInZone("village-square", 5);

  await api("POST", "/command", {
    zoneId: "village-square",
    entityId: agent.entityId,
    action: "travel",
    targetZone: "wild-meadow",
  });

  await waitUntilRegion(agent.entityId, "wild-meadow");

  await levelInZone("wild-meadow", 10);

  await api("POST", "/command", {
    zoneId: "wild-meadow",
    entityId: agent.entityId,
    action: "travel",
    targetZone: "dark-forest",
  });
}
```

## Notes

- `POST /spawn` can restore persisted coordinates, so spawn input coordinates are not guaranteed to win over saved state.
- For deterministic tests, inspect the entity after spawn, then issue `POST /command`.
- Portal landmarks may still exist in world layout data, but they are navigation hints, not public transition endpoints.
