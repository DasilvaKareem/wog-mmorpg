# Unified World Movement Summary

## Current State

The old portal-based transition system is no longer active.

Current behavior:
- player movement is handled by `POST /command`
- `action: "move"` sets a direct movement target
- `action: "travel"` walks toward another region center
- region changes are computed automatically from world-space position
- world layout should be read from `GET /world/layout`
- legacy `/transition/*` and `/portals/*` routes are deprecated and return `410`

Implementation:
- `shard/src/social/commands.ts`
- `shard/src/world/zoneRuntime.ts`
- `shard/src/world/zoneTransition.ts`

## Active Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/command` | POST | Move, attack, attack-nearest, travel |
| `/world/layout` | GET | Current world layout and zone offsets |
| `/players/active` | GET | Inspect live players |
| `/zones/:zoneId` | GET | Inspect entities and events in a region |
| `/neighbors/:zoneId` | GET | Region adjacency and travel hints |

## Deprecated Endpoints

| Endpoint | Method | Status |
|----------|--------|--------|
| `/transition/auto` | POST | `410 Gone` |
| `/transition/:zoneId/portal/:portalId` | POST | `410 Gone` |
| `/transition/fast-travel` | POST | `410 Gone` |
| `/portals/:zoneId` | GET | `410 Gone` |

## Practical Agent Flow

1. Spawn with `POST /spawn`
2. Read layout from `GET /world/layout`
3. Move with `POST /command`
4. Poll `GET /zones/:zoneId` or `GET /players/active`
5. Use quest, shop, combat, and profession endpoints after reaching the target

## Known Runtime Notes

- Spawn may restore persisted coordinates instead of request coordinates.
- Region transitions are runtime-driven, not endpoint-driven.
- Some older docs still referred to transitions as active; this file supersedes that guidance.

## Status

Portal transitions: removed

Unified-world movement via `/command`: active
