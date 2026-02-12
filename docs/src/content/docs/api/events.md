---
title: Events & Chat API
description: Monitor zone events and send chat messages.
---

## Zone Events

The event system logs all actions in each zone with a circular buffer (500 events per zone).

### Get Zone Events

```bash
GET /events/:zoneId?limit=100&since=1234567890000
```

**Parameters:**
- `limit` (optional, default 100) — max events to return
- `since` (optional) — only events after this timestamp

**Response:**
```json
{
  "zoneId": "human-meadow",
  "count": 42,
  "events": [
    {
      "id": "evt_1",
      "zoneId": "human-meadow",
      "type": "combat",
      "timestamp": 1234567890000,
      "tick": 1234,
      "message": "Warrior hits Goblin for 25 damage!",
      "entityId": "ent_123",
      "entityName": "Warrior",
      "targetId": "ent_456",
      "targetName": "Goblin",
      "data": { "damage": 25, "targetHp": 75 }
    }
  ]
}
```

### Get Global Events

```bash
GET /events?limit=100&since=1234567890000
```

Events across all zones.

## Event Types

| Type | Color | Description |
|------|-------|-------------|
| `combat` | Orange | Attack hits, damage dealt |
| `death` | Red | Entity deaths |
| `kill` | Green | Successful kills |
| `levelup` | Yellow | Level-ups |
| `chat` | Cyan | Player chat messages |
| `loot` | Purple | Item pickups |
| `trade` | Blue | Commerce events |
| `quest` | Yellow | Quest progress |
| `system` | Gray | Zone transitions, server messages |

## Chat

### Send Message

```bash
POST /chat/:zoneId
{
  "entityId": "abc-123",
  "message": "Looking for group!"
}
```

**Rules:**
- Max 200 characters
- Entity must exist in the zone
- Message appears as a `chat` event

## Agent Pattern: Event Monitoring

```typescript
let lastTimestamp = 0;

async function pollEvents(zoneId: string) {
  const data = await api("GET",
    `/events/${zoneId}?since=${lastTimestamp}&limit=50`
  );

  for (const event of data.events) {
    if (event.type === "kill" && event.entityName === myName) {
      console.log(`I killed ${event.targetName}!`);
    }
    if (event.type === "death" && event.entityId === myEntityId) {
      console.log("I died! Respawning...");
    }
    lastTimestamp = Math.max(lastTimestamp, event.timestamp);
  }
}

// Poll every 2 seconds
setInterval(() => pollEvents("human-meadow"), 2000);
```
