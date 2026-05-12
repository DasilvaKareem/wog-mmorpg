# PvP Routes Bug and Readability Plan

This document covers the current PvP route surface in `shard`, the confirmed bugs in route/matchmaking behavior, and a concrete cleanup plan to make the system safer and easier to maintain.

## Route Surface

### Coliseum Discovery

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/coliseum/npc/:entityId` | Arena master discovery by entity ID. |
| `GET` | `/coliseum/npc/:zoneId/:entityId` | Compatibility alias with zone ID. |

### Queue and Matchmaking

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/pvp/queue/join` | Join a solo PvP queue. |
| `POST` | `/api/pvp/queue/join-party` | Join a team queue with the caller's party. |
| `POST` | `/api/pvp/queue/leave` | Leave a queue. |
| `GET` | `/api/pvp/queue/status/:format` | Get one queue's status. |
| `GET` | `/api/pvp/queue/all` | Get all queue statuses and optionally the caller's queued formats. |

### Battle State

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/pvp/battles/active` | List active arena battles. |
| `GET` | `/api/pvp/battle/:battleId` | Get battle state. |
| `POST` | `/api/pvp/battle/:battleId/action` | Submit a legacy battle action. Currently not wired to arena PvP. |
| `POST` | `/api/pvp/battle/:battleId/cancel` | Cancel a battle as participant or admin. |
| `GET` | `/api/pvp/player/:agentId/current-battle` | Check whether a player is in an active battle. |

### Stats

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/pvp/leaderboard` | Get PvP rankings. |
| `GET` | `/api/pvp/stats/:agentId` | Get one player's PvP stats. |
| `GET` | `/api/pvp/history/:agentId` | Get one player's match history. |

### Duels

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/pvp/duel/challenge` | Challenge another wallet to a 1v1 duel. |
| `POST` | `/api/pvp/duel/accept` | Accept a duel challenge and queue with a reservation. |
| `POST` | `/api/pvp/duel/decline` | Decline a duel and remove the challenger from the reserved queue slot. |

## Bugs and Fix Plans

### 0. Client and XR PvP Surfaces Are Part of the Contract

**Locations:**

- `client-xr/src/api.ts`
- `client-xr/src/hud/NpcDialog.ts`
- `client-xr/src/hud/InboxPanel.ts`
- `client-xr/src/hud/EntityInspector.ts`
- `client-xr/src/main.ts`
- `client/src/components/MatchmakingQueue.tsx`
- `client/src/components/ArenaHUD.tsx`
- `client/src/components/ColiseumDialog.tsx`
- `client/src/components/InspectDialog.tsx`

**Problem:** PvP is not only a shard API. The UX depends on the web client and `client-xr` staying aligned with route payloads, identity semantics, queue state, match-found notifications, battle viewing, and duel flows.

**Risk:** Backend fixes can silently break PvP from the XR client or web client if the UI contracts are not updated at the same time.

**Current XR flow:**

1. Arena Master opens `NpcDialog` on the `arena` tab.
2. `NpcDialog` loads coliseum info, queue status, active battles, and leaderboard.
3. Queue join calls `joinPvpQueue`.
4. Queue polling calls `/api/pvp/player/:agentId/current-battle`.
5. Match-found inbox messages can set the current battle ID.
6. Battle viewer fetches `/api/pvp/battle/:battleId`.
7. Forfeit calls `/api/pvp/battle/:battleId/cancel`.
8. Entity inspector duel calls `/api/pvp/duel/challenge`.
9. Inbox duel request controls call `/api/pvp/duel/accept` or `/api/pvp/duel/decline`.

**Plan:**

1. Treat `client-xr/src/api.ts` as the typed API boundary for XR PvP.
2. Update XR API wrappers in the same PR as shard payload changes.
3. Mirror the same contract update in web client PvP components.
4. Add a frontend checklist to every PvP route change:
   - Queue join body.
   - Queue leave body.
   - Current battle response.
   - Battle details shape.
   - Duel message payload shape.
   - Match-found inbox payload shape.

**Tests:**

- Add a lightweight client API test or fixture for each PvP response shape.
- Add a manual XR smoke test checklist until automated XR UI tests exist.
- Verify both web and XR clients can queue, detect match found, view battle, forfeit, challenge duel, and accept duel.

### 1. Queue Join Trusts Caller-Supplied Identity

**Location:** `shard/src/combat/pvpRoutes.ts`, `POST /api/pvp/queue/join`

**Problem:** The route accepts `agentId`, `walletAddress`, `characterTokenId`, and `level` from the request body. It authenticates the request, but does not prove the submitted entity and character metadata belong to the authenticated wallet.

**Risk:** A caller with any valid auth token can potentially queue another player's entity, causing unwanted matchmaking and arena teleporting.

**Plan:**

1. Add a shared resolver such as `resolveAuthenticatedPvPPlayer(req)`:
   - Read authenticated wallet from `authenticateRequest`.
   - Look up `isWalletSpawned(authenticatedWallet)`.
   - Load the live entity with `getEntity(spawned.entityId)`.
   - Validate entity type is `player`.
   - Read `characterTokenId`, `level`, and wallet from the entity/server state.
2. Change `queue/join` to accept only queue intent:
   - `format`
   - optional `preferredTeam`
3. Build `MatchmakingEntry` from server-resolved identity, not request body identity.
4. Keep a compatibility path only if needed, but reject mismatched `agentId` or `walletAddress`.

**Tests:**

- Authenticated wallet can queue its own spawned entity.
- Authenticated wallet cannot queue another entity ID.
- Request body `level` and `characterTokenId` cannot override server values.
- Unspawned wallet gets a clear `400` response.
- `client-xr/src/api.ts` and `client/src/components/MatchmakingQueue.tsx` are updated to stop sending trusted identity fields once the server resolves identity.
- XR Arena Master queue join still works from `NpcDialog`.

### 2. Party Queue Trusts Caller-Supplied Leader

**Location:** `shard/src/combat/pvpRoutes.ts`, `POST /api/pvp/queue/join-party`

**Problem:** The route accepts `leaderId` and does not verify the authenticated wallet owns that leader entity.

**Risk:** A caller may queue another party if they know the leader entity ID.

**Plan:**

1. Use the same authenticated player resolver from the solo queue fix.
2. Require that the resolved entity is the party leader:
   - `getPartyMembers(resolved.entityId)`
   - compare with party leader helper if available.
3. Build all party member queue entries from server-side live entities.
4. Reject party members with missing wallet or missing `characterTokenId` instead of silently queueing with empty wallet or `0n`.

**Tests:**

- Party leader can queue a valid 2v2 or 5v5 party.
- Non-leader cannot queue the party.
- Wrong wallet cannot queue another party by submitting `leaderId`.
- Party with offline or incomplete members fails with explicit details.
- Add a web/XR UX decision for party queue. XR currently has solo queue controls only; if party queue is supported in XR, add an explicit `Join Party Queue` control rather than overloading solo queue.

### 3. Battle Action Route Does Not Work for Arena PvP

**Location:** `shard/src/combat/pvpRoutes.ts`, `POST /api/pvp/battle/:battleId/action`; `shard/src/combat/pvpBattleManager.ts`, `submitBattleAction`

**Problem:** Current PvP battles are created in `ArenaManager`, but `submitBattleAction` only checks legacy `activeBattles`. The action route returns `404` for real in-world arena matches.

**Risk:** API docs and MCP clients advertise an action endpoint that cannot affect current PvP.

**Plan:**

Choose one direction:

1. If arena combat should be autonomous, remove or deprecate the action route from docs and MCP.
2. If manual actions should be supported, add an arena action method:
   - Validate authenticated wallet owns the actor.
   - Verify actor is in `battleId`.
   - Translate action into `entity.order` or `entity.castingIntent`.
   - Return updated arena state.

**Tests:**

- Action against real arena battle no longer returns accidental legacy `404`.
- Actor must belong to authenticated wallet.
- Actor must be a participant in the battle.
- Invalid target or invalid technique returns `400`.
- XR battle viewer does not show manual action controls unless this endpoint is actually wired to arena actions.
- Web `ArenaHUD` and `ColiseumViewer` copy should describe autonomous combat if actions remain unsupported.

### 4. Matchmaking Removes Players Before Battle Creation Succeeds

**Location:** `shard/src/combat/matchmaking.ts`, `tryCreateMatch`; `shard/src/combat/pvpBattleManager.ts`, `tickMatchmaking`

**Problem:** `tryCreateMatch` removes matched players from the queue before `createBattle` starts the arena match. If `arenaManager.startArenaMatch` fails, players are gone from the queue.

**Risk:** Queue entries can disappear due to a transient arena creation failure, stale entity, or race.

**Plan:**

1. Split matchmaking into two phases:
   - `findMatch(format): MatchmakingEntry[] | null`
   - `commitMatch(format, entries): void`
2. In `tickMatchmaking`, start the arena first.
3. Remove entries only after `createBattle` succeeds.
4. If `createBattle` fails due to one bad player, remove or mark only the invalid entry and leave valid players queued.
5. Persist queue state after either successful commit or invalid-entry pruning.

**Tests:**

- Failed `createBattle` leaves valid players queued.
- Stale entity is pruned without removing unrelated candidates.
- Successful battle creation removes only matched entries.
- XR queue state should continue showing `Searching for match...` if battle creation fails and players remain queued.
- Web `MatchmakingQueue` should not emit `matchFound` unless `current-battle` confirms a battle ID.

### 5. MCP PvP Queue Tool Sends Wrong Payload

**Location:** `mcp/src/tools/combat.ts`, `pvp_queue_join`

**Problem:** The tool sends `{ walletAddress, entityId, zoneId, format }`, but the shard route currently requires `{ agentId, walletAddress, characterTokenId, level, format }`. It also exposes `FFA`, while shard expects lowercase `ffa`.

**Risk:** Agent-facing MCP queue calls fail even though the route works from the web client.

**Plan:**

1. After queue route identity hardening, change the MCP tool input to:
   - `sessionId`
   - `format: "1v1" | "2v2" | "5v5" | "ffa"`
2. Normalize `"FFA"` to `"ffa"` only if backward compatibility is needed.
3. Send only the queue intent to shard.
4. Update tool descriptions to explain that the shard resolves the spawned entity from auth.

**Tests:**

- MCP `pvp_queue_join` queues the authenticated spawned entity.
- `FFA` compatibility is either removed from schema or normalized.
- Missing spawned entity returns a useful tool response.
- Ensure MCP and `client-xr/src/api.ts` use the same normalized format values.

### 6. Duel ELO Lookup Uses Wallet Instead of Entity ID

**Location:** `shard/src/combat/pvpRoutes.ts`, duel challenge and accept handlers

**Problem:** Normal queue/stats are keyed by entity ID, but duel handlers call `getPlayerStats(authenticatedWallet)`. That misses existing entity-keyed stats and often falls back to `1000` ELO.

**Risk:** Duel matchmaking ignores actual player ELO and produces inconsistent leaderboard/stats behavior.

**Plan:**

1. Standardize PvP stats keying on one identifier. Recommended: live entity ID for current shard behavior.
2. In duel challenge/accept, call `getPlayerStats(spawned.entityId)`.
3. Optionally add a wallet-to-current-entity lookup for API convenience, but keep the stats map internally keyed consistently.
4. Add migration/compat code if old wallet-keyed records exist in Redis.

**Tests:**

- Existing entity-keyed ELO is used when creating duel queue entries.
- Duel completion updates the same stats record visible in leaderboard/history.
- No duplicate wallet-keyed and entity-keyed records are created for the same player.
- XR `EntityInspector` duel action should report whether the challenge created a reserved queue slot or failed due to identity/state.
- XR `InboxPanel` should update accepted/declined duel UI after the backend status changes.

### 7. Active Arena Matches Are Not Persisted or Recovered

**Location:** `shard/src/combat/pvpBattleManager.ts`, persistence methods

**Problem:** Persistence serializes only legacy `activeBattles`, but current matches live inside `ArenaManager`.

**Risk:** On restart, in-progress arena matches are not explicitly recovered. Players may retain PvP state or be returned inconsistently depending on runtime hydration.

**Plan:**

1. Add `arenaManager.snapshotMatches()` with enough data to safely recover or cancel:
   - battle ID
   - status
   - format
   - combatant entity IDs
   - saved positions
   - winner/completion metadata if relevant
2. Prefer safe restart behavior:
   - Mark active matches as cancelled.
   - Heal players.
   - Clear `pvpBattleId`, `pvpTeam`, orders, and saved positions.
   - Return players to saved positions if present.
3. Persist a recovery audit record.
4. Do not attempt full match replay until arena state persistence is complete.

**Tests:**

- Active arena match snapshot is written.
- Restore cancels active matches and clears PvP metadata.
- Completed/cancelled matches are not resurrected.
- XR current-battle polling should recover cleanly after restart: no stale `currentBattleId`, no permanent `You're in battle` card when the server has cancelled the match.
- Web `ArenaHUD` should dismiss stale battle state when `/current-battle` returns `inBattle: false`.

### 8. PvP Docs Are Missing Routes and Misrepresent Action Support

**Location:** `docs/src/content/docs/agents/pvp-coliseum.md`

**Problem:** Docs omit `join-party`, `current-battle`, and duel routes. They also list action submission even though current arena PvP does not use the legacy action engine.

**Risk:** Agent developers and client/MCP integrations call incomplete or broken APIs.

**Plan:**

1. Update the endpoint table with all routes listed in this document.
2. Mark `/api/pvp/battle/:battleId/action` as deprecated unless arena action support is implemented first.
3. Add example flows:
   - Solo queue.
   - Party queue.
   - Duel challenge/accept.
   - Poll current battle.
4. Keep MCP docs aligned with route request bodies.

**Tests:**

- Add a docs checklist in PR review for PvP route changes.
- Route docs should be generated or at least validated against the route registry where feasible.

### 9. XR Queue Join Uses the Old Trusted-Identity Payload

**Location:** `client-xr/src/api.ts`, `joinPvpQueue`; `client-xr/src/hud/NpcDialog.ts`, `handleQueueJoin`

**Problem:** XR queue join sends `agentId`, `walletAddress`, `characterTokenId`, and `level`. This mirrors the current insecure shard route. Once shard identity is server-resolved, this payload becomes stale.

**Risk:** Fixing shard auth without updating XR will break queue join from the Arena Master dialog.

**Plan:**

1. Change XR `joinPvpQueue` body to `{ format, preferredTeam? }` after shard identity resolution lands.
2. Keep `NpcDialog` validation focused on "has deployed/selected character" for UX, but do not rely on it for backend authority.
3. Update queue success state from the shard response rather than assuming success means the selected local entity was queued.
4. Keep `fetchQueueStatus(this.callbacks.getOwnEntityId())` until the server exposes an auth-based queue status endpoint, or add one.

**Tests:**

- XR Arena Master can join all supported formats.
- Queue join error messages are shown when the server rejects auth, missing spawn, incomplete character, or active battle.
- XR selected format remains stable after failed join.

### 10. XR Has No Party Queue UI

**Location:** `client-xr/src/hud/NpcDialog.ts`

**Problem:** Shard exposes `/api/pvp/queue/join-party`, but XR Arena Master only renders solo queue controls for `1v1`, `2v2`, `5v5`, and `ffa`.

**Risk:** Team formats look available, but XR users may accidentally join team queues solo instead of queueing with their party.

**Plan:**

1. Decide whether `2v2` and `5v5` buttons mean solo matchmaking or party matchmaking.
2. If party queue is supported:
   - Add a separate `Join With Party` button for `2v2` and `5v5`.
   - Show party size and required size before queueing.
   - Disable party queue if the party is incomplete.
3. If solo queue is supported for team formats:
   - Label the current button as `Join Solo`.
   - Explain party queue separately.
4. Add `joinPvpPartyQueue` wrapper in `client-xr/src/api.ts`.

**Tests:**

- Solo queue and party queue are visually distinct.
- Incomplete party cannot queue with a clear message.
- Full party can queue from XR and sees queue state.

### 11. XR Battle Viewer Is a Flat HUD, Not an Arena Presence UI

**Location:** `client-xr/src/hud/NpcDialog.ts`, `renderBattleViewer`; `client-xr/src/scene/WorldManager.ts`; `client-xr/src/scene/EntityManager.ts`

**Problem:** XR can view battle state in the Arena Master dialog, but there is no dedicated in-world PvP HUD or arena presence treatment. The server teleports entities to `coliseum-arena`, but the XR UI primarily shows team lists and HP bars in a dialog.

**Risk:** In XR, a player may not clearly understand that they have been moved into an active match or where opponents/teammates are in 3D space.

**Plan:**

1. Add an always-available PvP HUD state when the local entity has `pvpBattleId`.
2. Show:
   - battle status
   - team color
   - timer
   - own HP
   - enemy/team list
   - forfeit button
3. Add in-world team markers:
   - red/blue nameplate accent
   - enemy outline or reticle state
   - minimap markers for combatants if minimap supports arena zone
4. Play `combat_battle_start` when match changes from `betting` to `in_progress`.
5. Play victory/defeat feedback when battle completes.

**Tests:**

- Entering a match makes PvP state visible without reopening Arena Master.
- Team colors are visible in desktop and XR modes.
- Forfeit remains accessible but not accidentally triggered.
- Battle completion clears HUD state.

### 12. XR Inbox Match Found Flow Does Not Actually Enter the Arena UI

**Location:** `client-xr/src/hud/InboxPanel.ts`, `renderMatchFoundControls`; `client-xr/src/main.ts`, `onMatchFound` and `onOpenBattle`

**Problem:** Inbox "Enter Arena" sets `currentBattleId` and tells the user to visit an Arena Master to spectate. It does not directly open a battle panel or switch to an arena HUD.

**Risk:** The button wording implies an immediate transition, but the result is indirect. In XR that is especially confusing because the player expects spatial movement or an opened combat surface.

**Plan:**

1. Rename the button to match behavior, or change behavior to match the button.
2. Recommended behavior:
   - `Enter Arena` opens the Arena battle viewer immediately if `battleId` is available.
   - If the player is not near an Arena Master, open a compact PvP HUD instead of requiring NPC interaction.
3. Keep `npcDialog.setCurrentBattleId` but add an explicit UI open path.

**Tests:**

- Clicking match-found inbox action opens visible battle state immediately.
- If battle no longer exists, user sees a stale-match message and the inbox action is disabled.

### 13. XR Forfeit Uses Cancel Semantics

**Location:** `client-xr/src/hud/NpcDialog.ts`, `handleForfeit`; shard `POST /api/pvp/battle/:battleId/cancel`

**Problem:** XR labels the participant action as `Forfeit`, but the route cancels the entire battle when a participant calls it.

**Risk:** One participant may end the whole match for everyone without a loss/win result. The UX says forfeit; backend semantics are cancel.

**Plan:**

1. Add a real `POST /api/pvp/battle/:battleId/forfeit` route.
2. Forfeit should:
   - mark caller/team as losing, or remove caller and resolve according to match rules
   - update stats/history consistently
   - settle prediction markets according to explicit policy
3. Keep `cancel` admin-only or participant-cancel only during betting phase.
4. Update XR button to call `forfeit` once implemented.

**Tests:**

- Participant forfeit produces a deterministic winner/loss.
- Admin cancel still cancels without stats when intended.
- XR button copy matches backend semantics.

### 14. Web Client Duel Button Queues Instead of Using Duel Challenge Flow

**Location:** `client/src/components/InspectDialog.tsx`

**Problem:** The web client's player `Duel` action directly joins the `1v1` queue. XR uses the newer `/api/pvp/duel/challenge` flow.

**Risk:** Web and XR users see the same word, "Duel", but get different behavior. Web duel may randomly match with someone else instead of the inspected player.

**Plan:**

1. Change web InspectDialog duel action to call `/api/pvp/duel/challenge`.
2. Send `targetWallet` from the inspected entity.
3. Use inbox duel request/accept flow consistently across clients.
4. Keep `Join 1v1 Queue` as a separate Arena Master action.

**Tests:**

- Web Duel creates a challenge to the selected target.
- Target receives a duel request inbox message.
- Accepting starts a reserved 1v1 match.

### 15. Battle Details Types Are Inconsistent Across Clients

**Locations:** `client-xr/src/api.ts`, web `ArenaHUD`/`ColiseumViewer`, shard `arenaStateToLegacy`

**Problem:** XR expects `mvp?: { name; damage }`, but shard returns `mvp` as an entity ID string in the legacy adapter. Web clients have their own battle shape assumptions.

**Risk:** MVP and combat log UI silently fail or render incomplete data.

**Plan:**

1. Define one `PvPBattleView` response type for client consumption.
2. Return explicit fields:
   - battle ID
   - status
   - format
   - arena name/map ID
   - teams with entity ID, display name, level, HP, max HP, alive
   - elapsed time and remaining time
   - winner
   - MVP object
   - recent combat events
3. Update both web and XR clients to use that type.

**Tests:**

- XR battle viewer renders MVP when present.
- Web ArenaHUD renders the same battle response.
- Completed battle response remains readable for at least the cleanup window.

## Readability Refactor Plan

### Phase 1: Establish Shared Identity and Validation

Create a small module, for example `shard/src/combat/pvpIdentity.ts`, with:

- `resolveAuthenticatedPvPPlayer(req)`
- `assertPvPFormat(format)`
- `buildMatchmakingEntry(player, format, options)`

This removes repeated wallet/entity/character lookups from route handlers.

### Phase 2: Split Route Registration

Break `registerPvPRoutes` into focused files:

- `pvpColiseumRoutes.ts`
- `pvpQueueRoutes.ts`
- `pvpBattleRoutes.ts`
- `pvpDuelRoutes.ts`
- `pvpStatsRoutes.ts`

Keep `pvpRoutes.ts` as a thin composition file:

```ts
export async function registerPvPRoutes(app: FastifyInstance) {
  await registerPvPColiseumRoutes(app);
  await registerPvPQueueRoutes(app);
  await registerPvPBattleRoutes(app);
  await registerPvPDuelRoutes(app);
  await registerPvPStatsRoutes(app);
}
```

### Phase 3: Make Matchmaking Transactional

Change the matchmaking API so route/business code can reason about failures:

```ts
const candidate = matchmaking.findMatch(format);
if (!candidate) return;

const battleId = await createBattle(candidate.config);
matchmaking.commitMatch(format, candidate.entries);
```

If battle creation fails, valid candidates remain queued.

### Phase 4: Decide the Arena Action Contract

Make one explicit product decision:

- Autonomous arena combat only: remove/deprecate action submission.
- Player-directed arena combat: implement arena action submission against live entities.

The docs, MCP tool list, and client code should match that decision.

### Phase 5: Add Route-Level Tests

Current tests lightly cover matchmaking grouping. Add Fastify route tests for:

- Auth ownership.
- Queue input validation.
- Party queue authorization.
- Duel lifecycle.
- Current-battle polling.
- Matchmaking failure and requeue.
- MCP-compatible payloads.

### Phase 6: Align Web and XR PvP Clients

Update frontend code in the same branch as shard route changes:

- `client-xr/src/api.ts`: typed wrappers for solo queue, party queue, current battle, battle details, duel challenge, duel accept/decline, forfeit.
- `client-xr/src/hud/NpcDialog.ts`: Arena Master queue and battle viewer.
- `client-xr/src/hud/InboxPanel.ts`: match-found and duel-request actions.
- `client-xr/src/hud/EntityInspector.ts`: player duel action.
- `client-xr/src/main.ts`: callback wiring and global match-found behavior.
- `client/src/components/MatchmakingQueue.tsx`: web queue flow.
- `client/src/components/ArenaHUD.tsx`: web in-battle HUD.
- `client/src/components/InspectDialog.tsx`: web duel challenge flow.

Add a shared PvP client contract file if practical so web and XR do not drift.

## Recommended Fix Order

1. Fix queue and party queue ownership checks.
2. Update `client-xr`, web client, and MCP queue payloads together.
3. Make matchmaking removal transactional.
4. Standardize PvP stats identity keys.
5. Convert web Duel to the duel challenge flow.
6. Decide and fix/deprecate battle action route.
7. Add real forfeit semantics separate from admin cancel.
8. Add XR in-battle HUD and direct inbox-to-battle behavior.
9. Add arena restart recovery.
10. Split routes and update docs.
