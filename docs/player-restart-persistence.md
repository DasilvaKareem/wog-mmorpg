# Player Restart Persistence

## Problem

Deploys restart the shard process, which disconnects live players. The intended behavior after reconnect is:

- restore the player's saved zone and position
- restore in-progress quest state
- restore appearance and identity fields

Before this fix, the reconnect path already read from persisted character state, but the shutdown/logout snapshots did not include the full live player payload. That meant a restart could restore only a partial character snapshot.

## Fix

The shard now persists and restores these additional fields in the character save blob:

- `activeQuests`
- `pendingQuestApprovals`
- `characterTokenId`
- `agentId`
- `skinColor`
- `hairStyle`
- `eyeColor`
- `origin`
- `equipment`

This is applied to:

- graceful shutdown / periodic autosave
- explicit logout saves
- respawn restore via `POST /spawn`

## Verification

Manual Redis-backed restart test was run locally:

1. Start local Redis, Hardhat, and the shard with `REDIS_URL` set.
2. Authenticate a fresh wallet.
3. Spawn a player in `village-square`.
4. Accept `welcome_adventurer` so `activeQuests` is present only in live player state.
5. Stop the shard process.
6. Start the shard process again.
7. Spawn the same wallet/name again.

Observed result:

- `restored = true`
- same zone restored
- appearance fields restored
- `activeQuestCountBeforeRestart = 1`
- `activeQuestCountAfterRestart = 1`
- restored quest id: `welcome_adventurer`

## Operational Note

This fix does not make deploys seamless. A `pm2 restart` still disconnects live players because the shard process goes away. The fix ensures the player state is restored correctly when they reconnect after the restart.
