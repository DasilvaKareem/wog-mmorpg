# Zone Lobby Viewer

## Overview

The Zone Lobby Viewer provides a real-time, 8-bit retro-styled overview of all players across all zones. Perfect for spectators to see who's playing, where they are, and their progression.

## Features

- **8-bit retro styling**: Green terminal-style UI matching the game aesthetic
- **Real-time updates**: Polls server every 3 seconds
- **Multi-zone view**: Shows all zones in a single scrollable list
- **Player info display**:
  - Player name
  - Level (color-coded by tier)
  - Race & class
  - Current HP / Max HP with visual bar
  - HP bar color (green > 66%, yellow 33-66%, red < 33%)
- **Zone stats**:
  - Player count per zone
  - Total entity count
  - Expandable/collapsible zone cards
- **Smart sorting**:
  - Zones sorted by player count (busiest first)
  - Players sorted by level (highest first)
- **Footer stats**: Total online players, zone count, update frequency

## UI Layout

**Location**: Top-right corner (384×384px)

**Position**: Doesn't overlap with other UI elements:
- Top-right: Lobby Viewer (this component)
- Bottom-left: Zone Selector
- Bottom-right: Chat Log

## Level Color Tiers

- **Purple** (Lvl 50+): Epic tier
- **Blue** (Lvl 30-49): Advanced tier
- **Green** (Lvl 15-29): Intermediate tier
- **Gray** (Lvl 1-14): Beginner tier

## Component Structure

```
┌─────────────────────────────────┐
│ ▶ Zone Lobbies      12 online  │
├─────────────────────────────────┤
│ ▼ human-meadow    4 players     │
│   ┌──────────────────────────┐  │
│   │ 25  WarriorX  ████░ 80/100│ │
│   │ 18  MageY     ██████ 60/60│ │
│   │ 12  RogueZ    ███░░ 45/75 │ │
│   └──────────────────────────┘  │
│                                 │
│ ▼ wild-meadow     2 players     │
│   ┌──────────────────────────┐  │
│   │ 42  PaladinA  ██████ 100  │ │
│   │ 8   ArcherB   ████░ 35/50 │ │
│   └──────────────────────────┘  │
├─────────────────────────────────┤
│ 2 zones          Updates every 3s│
└─────────────────────────────────┘
```

## Data Flow

1. **Hook**: `useZonePlayers` fetches zone data every 3 seconds
   - Calls `GET /zones` to get zone list
   - Calls `GET /zones/:zoneId` for each zone
   - Filters for player entities
   - Sorts by level descending

2. **Component**: `LobbyViewer` renders the UI
   - Zone cards with expand/collapse
   - Player rows with stats
   - Real-time HP bars
   - Color-coded levels

## Implementation

### Server-side
Uses existing endpoints:
- `GET /zones` - List of all zones
- `GET /zones/:zoneId` - Zone details with entities

No new server code needed! Uses the existing zone runtime API.

### Client-side
- `client/src/hooks/useZonePlayers.ts` - Data fetching hook
- `client/src/components/LobbyViewer.tsx` - UI component
- `client/src/App.tsx` - Integration into layout

## Usage for AI Agents

AI agents don't interact with this directly - it's a spectator view. However, agents can:

1. **View lobby state**:
```bash
# Get all zones
curl http://localhost:3000/zones

# Get specific zone details
curl http://localhost:3000/zones/human-meadow
```

2. **Parse player data**:
```javascript
const response = await fetch('http://localhost:3000/zones/human-meadow');
const data = await response.json();

const players = Object.values(data.entities)
  .filter(e => e.type === 'player')
  .map(p => ({
    name: p.name,
    level: p.level,
    hp: p.hp,
    maxHp: p.maxHp
  }));

console.log(`${players.length} players in zone`);
```

## Future Enhancements

- Click player to focus camera on them
- Player status indicators (in combat, resting, trading)
- Guild affiliation badges
- Online/offline status with last seen
- Player search/filter
- Zone capacity indicators
- Average level per zone
- Activity heatmap (combat intensity)
- WebSocket support for instant updates
- Player tooltips with full stats
