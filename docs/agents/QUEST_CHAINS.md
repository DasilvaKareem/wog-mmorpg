# Quest Chain System - Complete Progression

## Overview
Players must complete quests in order to unlock new quests. The quest chain spans all 3 zones, creating a natural progression through the game world.

## Quest Flow Diagram

```
HUMAN MEADOW (Guard Captain Marcus)
├─ 1. Rat Extermination (L1) [STARTER - No prerequisite]
│   └─ 2. Wolf Hunter (L2)
│       └─ 3. Boar Bounty (L2)
│           └─ 4. Goblin Menace (L3)
│               └─ 5. Slime Cleanup (L3)
│                   └─ 6. Bandit Problem (L4)
│                       └─ 7. The Alpha Threat (L5) ──┐
│                                                      │
WILD MEADOW (Ranger Thornwood)                        │
├─ 1. Bear Necessities (L6) ◄─────────────────────────┘
│   └─ 2. Arachnophobia (L7)
│       └─ 3. Outlaw Justice (L8)
│           └─ 4. Nature's Corruption (L9)
│               └─ 5. The Pack Leader (L10)
│                   └─ 6. Wilderness Survival (Challenge) ──┐
│                                                            │
DARK FOREST (Priestess Selene)                              │
├─ 1. Shadows in the Dark (L11) ◄───────────────────────────┘
│   └─ 2. Cult Cleansing (L12)
│       └─ 3. Undead Purge (L13)
│           └─ 4. Troll Slayer (L14)
│               └─ 5. Golem Breaker (L15)
│                   └─ 6. The Necromancer's End (L16 BOSS)
│                       └─ 7. Master of the Dark Forest (ULTIMATE)
```

## Zone Transitions

### Human Meadow → Wild Meadow
**Gate Quest:** "The Alpha Threat"
- Completing this quest unlocks "Bear Necessities" in Wild Meadow
- Represents player mastery of starter zone

### Wild Meadow → Dark Forest
**Gate Quest:** "Wilderness Survival"
- Completing this quest unlocks "Shadows in the Dark" in Dark Forest
- Represents readiness for endgame content

## Quest Chain Mechanics

### Quest Availability
- Players can only see quests they are eligible for (prerequisites met)
- `GET /quests/:zoneId/:npcId?playerId=X` - Returns filtered quest list
- Without playerId param, returns all quests (for debugging)

### Quest Acceptance
- `POST /quests/accept` - Validates prerequisites before acceptance
- Returns error if prerequisite quest not completed
- Prevents accepting already active or completed quests

### Quest Completion
- `POST /quests/complete` - Awards rewards and adds quest to completedQuests[]
- Completed quests unlock dependent quests automatically
- completedQuests array persists on player entity

## Quest Statistics

| Zone | Quests | Level Range | Total Gold | Total XP |
|------|--------|-------------|------------|----------|
| Human Meadow | 7 | 1-5 | 525g | 1,050 XP |
| Wild Meadow | 6 | 6-10 | 1,175g | 2,350 XP |
| Dark Forest | 7 | 11-16 | 3,675g | 7,350 XP |
| **TOTAL** | **20** | **1-16** | **5,375g** | **10,750 XP** |

## Implementation Details

### Data Structures

**Quest Interface:**
```typescript
interface Quest {
  id: string;
  title: string;
  description: string;
  npcId: string;
  prerequisiteQuestId?: string; // NEW - Quest chain field
  objective: { type: "kill"; targetMobType: string; targetMobName?: string; count: number };
  rewards: { gold: number; xp: number };
}
```

**Entity Fields:**
```typescript
interface Entity {
  // ... other fields
  activeQuests?: Array<{ questId: string; progress: number; startedAt: number }>;
  completedQuests?: string[]; // NEW - Tracks completed quest IDs
}
```

### Helper Functions

- `isQuestAvailable(quest, completedQuestIds)` - Checks if prerequisites met
- `getAvailableQuestsForPlayer(npcName, completedQuestIds, activeQuestIds)` - Filters quest list
- Quest completion automatically adds questId to completedQuests[]

## Testing the Chain

```bash
# Get all quests (shows prerequisites)
curl "http://localhost:3000/quests/human-meadow/NPC_ID"

# Get available quests for specific player (filtered)
curl "http://localhost:3000/quests/human-meadow/NPC_ID?playerId=PLAYER_ID"

# Accept quest (validates prerequisites)
curl -X POST http://localhost:3000/quests/accept \
  -H "Content-Type: application/json" \
  -d '{"zoneId":"human-meadow","playerId":"PLAYER_ID","questId":"rat_extermination"}'

# Complete quest (unlocks next quest)
curl -X POST http://localhost:3000/quests/complete \
  -H "Content-Type: application/json" \
  -d '{"zoneId":"human-meadow","playerId":"PLAYER_ID","questId":"rat_extermination","npcId":"NPC_ID"}'
```

## AI Agent Integration

AI agents should:
1. Query available quests from quest givers
2. Accept the available quest (only one will be unlocked at a time initially)
3. Hunt the required mobs
4. Return to quest giver to complete
5. Repeat - new quest will be unlocked

This creates a natural progression loop for AI players to follow through the game world.
