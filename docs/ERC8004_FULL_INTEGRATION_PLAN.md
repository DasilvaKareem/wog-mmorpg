# ERC-8004 Full Integration Plan

## Objective

Replace the current mixed WoG trust system with a real ERC-8004-aligned trust layer for the app.

This plan assumes:

- no external users need backward compatibility
- no slow migration period is required
- we can make direct breaking changes across server, contracts, data model, and client
- wallet-based reputation will be removed as the canonical model

The target end state is:

- every playable WoG character/agent has an ERC-8004 identity
- trust data is keyed by `agentId`, not wallet address
- reputation writes are emitted from gameplay systems against `agentId`
- validation/verification claims exist for core WoG capabilities
- A2A/x402 metadata is bound to the ERC-8004 identity layer

---

## Current State Summary

### What exists now

- Custom WoG identity contract in [contracts/WoGIdentityRegistry.sol](contracts/WoGIdentityRegistry.sol)
- Custom WoG reputation contract in [contracts/WoGReputationRegistry.sol](contracts/WoGReputationRegistry.sol)
- External identity-registry client in [shard/src/blockchain/blockchain.ts](shard/src/blockchain/blockchain.ts)
- Local-first reputation system in [shard/src/economy/reputationManager.ts](shard/src/economy/reputationManager.ts)
- Fire-and-forget reputation bridge in [shard/src/economy/reputationChain.ts](shard/src/economy/reputationChain.ts)
- Wallet-keyed API routes in [shard/src/economy/reputationRoutes.ts](shard/src/economy/reputationRoutes.ts)
- Partial A2A identity exposure in [shard/src/agents/a2aRoutes.ts](shard/src/agents/a2aRoutes.ts)

### What is wrong with the current model

- reputation is keyed by wallet, not by agent identity
- one wallet can own multiple characters, but all their behavior collapses into one rep bucket
- the reputation store is local memory plus Redis, not chain-native
- the chain bridge derives a fake `identityId` from wallet address
- there is no real validation/verification registry integration
- identity, reputation, and A2A are not modeled as one coherent ERC-8004 system

---

## Product Decisions

### Decision 1: Direct cutover

We will directly replace the current wallet-based trust model.

We will not:

- preserve wallet-keyed reputation as a public API contract
- keep compatibility wrappers unless they are needed for temporary internal refactors during implementation
- support both wallet-based and agent-based reputation long term

### Decision 2: Agent identity is character identity

For WoG, the ERC-8004 agent identity will represent the playable character/agent instance.

This means:

- one WoG character NFT maps to one ERC-8004 `agentId`
- reputation belongs to the character/agent, not the owner wallet
- transferring ownership changes control of the same identity, not the history

### Decision 3: Chain-backed trust is canonical

The canonical trust model becomes on-chain ERC-8004 state.

We may still use:

- in-memory caches
- Redis mirrors
- precomputed read models

But these are derived views only, not the authoritative source of trust.

### Decision 4: WoG-specific metadata lives off-chain but is referenced on-chain

The identity registry stores the canonical pointer.

Metadata should include:

- character name
- class
- race
- level
- shard identifier
- A2A endpoint
- x402 endpoint if applicable
- capabilities
- ownership/controller wallet
- WoG-specific profile fields needed for discovery

### Decision 5: Minimum validation scope first

We will implement validation/verification, but start with a narrow WoG-native claim set.

Initial claims:

- `wog:a2a-enabled`
- `wog:x402-enabled`
- `wog:quest-capable`
- `wog:trade-capable`
- `wog:combat-capable`
- `wog:craft-capable`
- `wog:pvp-active`

---

## Target Architecture

## 1. Contracts

We will have three registries:

1. Identity Registry
2. Reputation Registry
3. Validation Registry

Expected responsibilities:

- Identity Registry
  - create/register agent identities
  - map `agentId` to metadata URI
  - expose owner/controller
  - optionally expose endpoint metadata or linked service URI

- Reputation Registry
  - update reputation by `agentId`
  - store per-category scores
  - support batched updates
  - support historical event emission

- Validation Registry
  - attach capability/claim proofs to `agentId`
  - expose claim status and expiry
  - allow WoG-authorized validators to publish claims

## 2. Server-side integration layer

Create a dedicated module:

`shard/src/erc8004/`

Proposed files:

- `shard/src/erc8004/contracts.ts`
- `shard/src/erc8004/identity.ts`
- `shard/src/erc8004/reputation.ts`
- `shard/src/erc8004/validation.ts`
- `shard/src/erc8004/metadata.ts`
- `shard/src/erc8004/types.ts`
- `shard/src/erc8004/agentResolution.ts`

Responsibilities:

- isolate all registry ABIs and contract wiring
- expose typed methods to gameplay systems
- resolve WoG character context into `agentId`
- publish metadata and validation claims
- prevent ERC-8004 logic from being scattered across unrelated modules

## 3. Canonical key model

New canonical trust keys:

- `agentId` for identity, reputation, validation
- `characterTokenId` for WoG NFT ownership and character records
- wallet address only for ownership/control lookup

Required mappings:

- `characterTokenId -> agentId`
- `agentId -> characterTokenId`
- `wallet -> owned agentIds[]`
- `entityId -> characterTokenId`
- `entityId -> agentId`

## 4. Read model

Chain should be canonical, but gameplay/UI should not do raw chain reads everywhere.

We should maintain a server-side read model with:

- current reputation summary by `agentId`
- validation badges by `agentId`
- resolved identity metadata by `agentId`
- reverse indexes for character and wallet lookup

Suggested storage:

- Redis
- durable DB later if needed

The read model is refreshed by:

- successful local writes to chain
- background sync/indexing from chain events
- startup backfill where necessary

---

## Data Model Changes

## 1. Character data

Every persisted character record needs:

- `characterTokenId`
- `agentId`
- `identityRegisteredAt`
- `identityMetadataUri`
- `a2aEndpoint`
- optional `x402Endpoint`

Search areas likely affected:

- character mint path in [shard/src/blockchain/blockchain.ts](shard/src/blockchain/blockchain.ts)
- spawn and restore logic in [shard/src/world/spawnOrders.ts](shard/src/world/spawnOrders.ts)
- any persisted save model storing player identity

## 2. Reputation data

Remove wallet-keyed reputation assumptions.

Current model:

- `Map<string, ReputationScore>` keyed by lowercased wallet

Target model:

- `Map<string, ReputationScore>` or Redis hash keyed by stringified `agentId`

Current methods that must change:

- `ensureInitialized(walletAddress)`
- `getReputation(walletAddress)`
- `submitFeedback(walletAddress, ...)`
- `batchUpdateReputation(walletAddress, ...)`
- `getFeedbackHistory(walletAddress, ...)`
- `getTimeline(walletAddress, ...)`
- `updateCombatReputation(walletAddress, ...)`
- `updateEconomicReputation(walletAddress, ...)`

Target forms:

- `ensureInitialized(agentId)`
- `getReputation(agentId)`
- `submitFeedback(agentId, ...)`
- `batchUpdateReputation(agentId, ...)`
- `getFeedbackHistory(agentId, ...)`
- `getTimeline(agentId, ...)`
- `updateCombatReputation(agentId, ...)`
- `updateEconomicReputation(agentId, ...)`

## 3. API parameters

The following route families should be replaced:

- `/api/reputation/:walletAddress`
- `/api/reputation/:walletAddress/history`
- `/api/reputation/:walletAddress/timeline`

Target route families:

- `/api/agents/:agentId/reputation`
- `/api/agents/:agentId/reputation/history`
- `/api/agents/:agentId/reputation/timeline`
- `/api/agents/:agentId/identity`
- `/api/agents/:agentId/validations`

Optional helper routes:

- `/api/characters/:characterTokenId/agent`
- `/api/characters/:characterTokenId/reputation`

These helper routes should resolve to the canonical `agentId` view internally.

---

## Contract Strategy

## Option A: Adopt upstream ERC-8004 contracts directly

Pros:

- closer to the standard
- less long-term drift
- easier to align with external tooling

Cons:

- depends on actual implementation quality and fit
- may require adapter logic for WoG-specific needs

## Option B: Keep WoG contracts but rewrite them to align with ERC-8004 semantics

Pros:

- more control
- easier to tailor to WoG

Cons:

- more long-term maintenance
- higher risk of accidental non-standard behavior

## Recommended path

Use upstream ERC-8004 contract interfaces if we can verify them, but wrap them in WoG-controlled deployment and adapter code.

If upstream code is incomplete or unstable:

- implement WoG contracts that follow the expected ERC-8004 semantics closely
- keep registry ABIs stable behind `shard/src/erc8004/`

---

## Workstreams

## Workstream 1: Finalize target interfaces

### Goals

- lock down the actual contract ABIs/interfaces
- define WoG metadata schema
- define validation claim names
- define reputation category mapping

### Tasks

1. Review the ERC-8004 EIP and any available reference contracts.
2. Decide whether `agentId` is:
   - identity NFT token ID
   - `bytes32` external deterministic ID
3. Define WoG metadata schema version `wog-agent-metadata-v1`.
4. Define reputation categories and their exact on-chain mapping.
5. Define validation claim schema and issuer rules.

### Deliverables

- ABI list
- metadata JSON schema
- validation claim list
- category mapping table

## Workstream 2: Build the ERC-8004 integration layer

### Goals

- centralize all ERC-8004 interactions
- stop calling mixed registry logic from random files

### Tasks

1. Create `shard/src/erc8004/types.ts`
   - shared types for identity, reputation, validation, metadata
2. Create `shard/src/erc8004/contracts.ts`
   - provider setup
   - contract instances
   - env var validation
3. Create `shard/src/erc8004/identity.ts`
   - register identity
   - get identity
   - update metadata
   - update endpoint
4. Create `shard/src/erc8004/reputation.ts`
   - initialize score
   - submit single update
   - batch update
   - read summary
5. Create `shard/src/erc8004/validation.ts`
   - publish claim
   - revoke claim if needed
   - get validations
6. Create `shard/src/erc8004/agentResolution.ts`
   - resolve `entityId -> agentId`
   - resolve `characterTokenId -> agentId`
   - resolve `wallet + characterTokenId -> agentId`

### Deliverables

- new `erc8004` module
- no direct registry ABI logic outside this module except deployment scripts

## Workstream 3: Replace identity registration flow

### Goals

- character creation must result in real ERC-8004 identity
- `agentId` must be stored and retrievable everywhere

### Current touch points

- [shard/src/blockchain/blockchain.ts](shard/src/blockchain/blockchain.ts)
- [shard/src/economy/x402Deployment.ts](shard/src/economy/x402Deployment.ts)
- [shard/src/world/spawnOrders.ts](shard/src/world/spawnOrders.ts)

### Tasks

1. Remove the current partial `registerIdentity()` implementation from the generic blockchain module.
2. Reimplement registration inside `shard/src/erc8004/identity.ts`.
3. After character mint, register identity and persist `agentId`.
4. Ensure restored/saved characters retain `agentId`.
5. Add endpoint update logic so A2A URL is written to metadata or registry.
6. Update any runtime entity model to carry `agentId`.

### Deliverables

- every character entity can answer `agentId`
- no new character exists without identity registration

## Workstream 4: Rewrite reputation core

### Goals

- remove wallet-based reputation logic
- make `agentId` the only meaningful trust key

### Current touch points

- [shard/src/economy/reputationManager.ts](shard/src/economy/reputationManager.ts)
- [shard/src/economy/reputationChain.ts](shard/src/economy/reputationChain.ts)

### Tasks

1. Replace wallet-keyed internal store with agent-keyed store.
2. Remove `walletToIdentityId()` logic entirely.
3. Rename manager methods to accept `agentId`.
4. Make the manager a thin domain wrapper over ERC-8004 reputation, not an independent trust system.
5. Keep Redis only as:
   - cache
   - timeline read model
   - query optimization
6. Ensure read methods can hydrate from chain if cache is cold.

### Deliverables

- canonical reputation keyed by `agentId`
- no chain writes based on wallet-derived fake IDs

## Workstream 5: Rewrite gameplay write hooks

### Goals

- all reputation updates must flow from gameplay context to `agentId`

### Current write paths to change

- [shard/src/combat/pvpReputationIntegration.ts](shard/src/combat/pvpReputationIntegration.ts)
- [shard/src/economy/auctionHouseTick.ts](shard/src/economy/auctionHouseTick.ts)
- [shard/src/social/questSystem.ts](shard/src/social/questSystem.ts)
- [shard/src/agents/agentBehaviors.ts](shard/src/agents/agentBehaviors.ts)
- [shard/src/professions/crafting.ts](shard/src/professions/crafting.ts)
- [shard/src/professions/alchemy.ts](shard/src/professions/alchemy.ts)
- [shard/src/professions/leatherworking.ts](shard/src/professions/leatherworking.ts)
- [shard/src/professions/jewelcrafting.ts](shard/src/professions/jewelcrafting.ts)
- [shard/src/professions/enchanting.ts](shard/src/professions/enchanting.ts)
- [shard/src/professions/cooking.ts](shard/src/professions/cooking.ts)

### Tasks

1. Add agent resolution in each gameplay path.
2. Ensure the acting entity carries `agentId` at runtime.
3. Replace all `submitFeedback(walletAddress, ...)` calls with `submitFeedback(agentId, ...)`.
4. Replace PvP helpers to use `agentId`.
5. Replace economic reputation helpers to use `agentId`.
6. Define failure behavior:
   - if `agentId` is missing, treat it as a hard bug
   - log loudly
   - optionally block trust-affecting actions from writing until fixed

### Deliverables

- no gameplay reputation write path depends on wallet address

## Workstream 6: Add validation registry usage

### Goals

- use the third ERC-8004 registry in a way that matters for WoG

### Tasks

1. Publish `wog:a2a-enabled` when an A2A endpoint is live.
2. Publish `wog:x402-enabled` when the agent is deployed with x402 support.
3. Publish capability claims based on class/system access if appropriate.
4. Publish achievement-style validations for major milestones.
5. Decide issuer policy:
   - WoG server signer
   - admin signer
   - specific subsystem signers

### Deliverables

- at least one real validation path used by the app

## Workstream 7: Rewrite A2A and discovery around ERC-8004 identity

### Goals

- A2A identity should be backed by on-chain agent identity, not just wallet endpoints

### Current touch points

- [shard/src/agents/a2aRoutes.ts](shard/src/agents/a2aRoutes.ts)
- [shard/src/blockchain/blockchain.ts](shard/src/blockchain/blockchain.ts)

### Tasks

1. Change route generation to include `agentId` in the model.
2. Resolve `/a2a/resolve/:agentId` from the canonical identity registry.
3. Add metadata-backed capability output.
4. Include validation badges and reputation summary in agent card responses where appropriate.
5. Stop treating wallet address alone as the public agent key.

### Deliverables

- agent cards are identity-backed and standard-aligned

## Workstream 8: Rewrite server APIs

### Goals

- make public APIs agent-centric

### Current touch points

- [shard/src/economy/reputationRoutes.ts](shard/src/economy/reputationRoutes.ts)
- related client consumers

### Tasks

1. Delete wallet-based reputation route definitions.
2. Add `agentId`-based routes.
3. Add identity and validation endpoints.
4. Add helper routes for character-to-agent resolution if needed.
5. Update auth/admin write routes to accept `agentId`.

### Deliverables

- clean agent-based trust API surface

## Workstream 9: Rewrite clients

### Goals

- client UI should consume `agentId`-based trust APIs

### Current client touch points

- [client/src/components/InspectDialog.tsx](client/src/components/InspectDialog.tsx)
- [client/src/components/ChampionsPage.tsx](client/src/components/ChampionsPage.tsx)
- [client/src/components/ReputationPanel.tsx](client/src/components/ReputationPanel.tsx)
- any other views that surface trust data

### Tasks

1. Ensure inspected entities expose `agentId`.
2. Change fetches from wallet routes to agent routes.
3. Update pages that use `custodialWallet` as rep key.
4. Fix `ReputationPanel` to use canonical agent resolution instead of inconsistent token/wallet assumptions.
5. Add validation display badges where useful.

### Deliverables

- UI trust displays are agent-based and coherent

## Workstream 10: Remove legacy code and docs

### Goals

- leave no mixed trust model behind

### Tasks

1. Delete obsolete wallet-keyed code paths.
2. Remove the fake wallet-to-identity derivation.
3. Remove outdated docs claiming wallet/token-based flows that no longer exist.
4. Rewrite docs to describe:
   - agent identity
   - reputation by `agentId`
   - validation claims
   - A2A linkage

### Deliverables

- single coherent trust architecture

---

## Implementation Order

## Phase 0: Specification lock

Duration: short, but mandatory

Tasks:

- finalize contract interfaces
- finalize metadata schema
- finalize claim vocabulary
- finalize env vars and deployment assumptions

Exit criteria:

- no unresolved questions about `agentId` format
- no unresolved questions about contract ownership/authorized writers

## Phase 1: Contracts and deployment

Tasks:

- deploy identity registry
- deploy reputation registry
- deploy validation registry
- store addresses in env/config
- write deploy scripts
- verify contracts on target explorer if possible

Exit criteria:

- all three addresses available in runtime
- contract wrapper module compiles and reads/writes successfully

## Phase 2: Identity cutover

Tasks:

- register identity on character creation
- persist `agentId`
- make runtime entities carry `agentId`
- rewrite A2A resolution to use canonical identity

Exit criteria:

- every new character has `agentId`
- every active player entity has `agentId`

## Phase 3: Reputation cutover

Tasks:

- rewrite manager and chain adapter to `agentId`
- change all gameplay reputation writes
- replace wallet-based API routes
- update UI consumers

Exit criteria:

- zero reputation writes keyed by wallet
- zero server routes keyed by wallet for reputation

## Phase 4: Validation integration

Tasks:

- publish baseline capability claims
- add read endpoints
- surface in UI

Exit criteria:

- at least one real claim is published and queryable

## Phase 5: Cleanup and docs

Tasks:

- remove legacy code
- update docs
- update tests
- backfill data if needed

Exit criteria:

- no legacy trust code remains

---

## Detailed File-Level Change Plan

## Contracts

### `contracts/WoGIdentityRegistry.sol`

Options:

- replace entirely with upstream-aligned identity registry
- or refactor to support the chosen ERC-8004 semantics

Expected changes:

- align identifier model with final `agentId`
- ensure metadata and endpoint update semantics match target interface
- ensure event model is sufficient for index/read-model building

### `contracts/WoGReputationRegistry.sol`

Expected changes:

- ensure identity reference is canonical `agentId`
- align category handling with server enum
- emit events for indexing and history
- support batched updates cleanly

### New contract likely needed

- `contracts/WoGValidationRegistry.sol`

Expected responsibilities:

- publish and query validation claims
- manage authorized validators
- emit claim events

## Server

### `shard/src/blockchain/blockchain.ts`

Expected changes:

- remove ERC-8004-specific logic from this generic blockchain file
- move identity registry ABI/client code into `shard/src/erc8004/`
- keep only character mint and generic blockchain concerns here

### `shard/src/economy/reputationManager.ts`

Expected changes:

- rewrite public API to accept `agentId`
- remove wallet-centric storage and Redis keys
- reduce responsibility to orchestration and read model

### `shard/src/economy/reputationChain.ts`

Expected changes:

- rename or replace with `shard/src/erc8004/reputation.ts`
- remove wallet-derived fake ID conversion
- write only against real `agentId`

### `shard/src/economy/reputationRoutes.ts`

Expected changes:

- replace wallet route params with `agentId`
- add identity and validation endpoints or move them to a new `agentRoutes.ts`

### `shard/src/agents/a2aRoutes.ts`

Expected changes:

- resolve and emit identity-backed agent cards
- avoid using wallet as the sole public identity
- include canonical endpoint and validation summaries

### `shard/src/world/spawnOrders.ts`

Expected changes:

- initialize/load trust state by `agentId`
- ensure restored entities regain `agentId`

### `shard/src/economy/x402Deployment.ts`

Expected changes:

- after agent deployment, ensure identity registration
- publish `wog:x402-enabled` validation
- persist `agentId`

## Client

### `client/src/components/InspectDialog.tsx`

Expected changes:

- fetch reputation by `agentId`
- display validation badges if available

### `client/src/components/ChampionsPage.tsx`

Expected changes:

- query reputation/timeline/history by `agentId`
- stop relying on custodial wallet as trust identifier

### `client/src/components/ReputationPanel.tsx`

Expected changes:

- use canonical agent resolution
- fix current mismatch between token ID and wallet-based endpoints

---

## Testing Plan

## 1. Contract tests

Need tests for:

- identity registration
- metadata update
- endpoint update
- reputation init
- single update
- batch update
- validation publish/query
- authorization checks

## 2. Server integration tests

Need tests for:

- character mint -> identity registration -> `agentId` persistence
- spawn/restore retains `agentId`
- quest completion writes rep to correct `agentId`
- PvP writes rep to correct `agentId`
- crafting writes rep to correct `agentId`
- A2A resolve works by `agentId`
- validation endpoints return expected claims

## 3. API tests

Need tests for:

- `/api/agents/:agentId/reputation`
- `/api/agents/:agentId/reputation/history`
- `/api/agents/:agentId/reputation/timeline`
- `/api/agents/:agentId/identity`
- `/api/agents/:agentId/validations`

## 4. UI tests

Need tests for:

- inspect dialog displays agent-based reputation
- champions page loads rep/timeline/history by `agentId`
- reputation panel resolves and renders properly

## 5. Regression tests

Need tests for:

- one wallet owning multiple characters with distinct reputations
- ownership transfer preserving agent reputation history
- missing `agentId` causing explicit failures rather than silent wallet fallback

---

## Data Backfill and Reset Strategy

Because we are doing a direct cutover, we should not spend effort preserving ambiguous wallet reputation if it degrades correctness.

Recommended policy:

- keep character save data
- assign new `agentId` to each existing character
- reset or selectively remap reputation only if we can do it unambiguously

Suggested choices:

- if a wallet owns exactly one character, old wallet reputation can be mapped to that new `agentId`
- if a wallet owns multiple characters, do not split one wallet score across them automatically
- prefer resetting ambiguous records to neutral defaults over inventing false trust history

This should be documented clearly in release notes.

---

## Risks

## Technical risks

- uncertain final upstream ERC-8004 contract shapes
- complex propagation of `agentId` through gameplay systems
- potential save/load gaps where entity context lacks `agentId`
- potential client breakage if API changes are incomplete

## Product risks

- resetting ambiguous legacy reputation may upset expectations
- trust/rank views may change significantly after the cutover

## Operational risks

- failed identity registration during mint/deploy
- inconsistent state if character mint succeeds but identity registration fails
- on-chain indexing lag affecting UI freshness

## Mitigations

- make identity registration a first-class required step
- persist `agentId` transactionally with character records wherever possible
- add startup audits for characters missing `agentId`
- add explicit health checks for ERC-8004 contract availability

---

## Current Status

This section tracks the actual implementation state of the repo relative to this plan.

### Completed in code

- `agentId` is now persisted in character save data and carried on live player entities.
- character minting/deployment now returns and stores identity registration results instead of dropping the on-chain `agentId`
- the shard has a dedicated `shard/src/erc8004/` layer for:
  - identity wrappers
  - reputation chain wrappers
  - validation wrappers
  - wallet-to-agent resolution
- reputation storage and APIs were cut over from wallet-keyed to agent-keyed semantics
- major gameplay write paths now submit reputation against `agentId`
- UI consumers were updated to read reputation from `/api/agents/:agentId/...`
- missing identity and validation API surfaces were added:
  - `/api/agents/:agentId/identity`
  - `/api/agents/:agentId/validations`
- primary ERC-8004 docs were updated to match the new route shapes and identity model
- `DEV=true` local integration now auto-loads Hardhat deployment addresses from [hardhat/deployments/localhost.json](hardhat/deployments/localhost.json) via [devLocalContracts.ts](shard/src/config/devLocalContracts.ts), overriding stale zero-address or mainnet-style env values during local shard boot
- local mock prerequisite game contracts were added for full Hardhat integration testing:
  - [WoGMockGold.sol](hardhat/contracts/WoGMockGold.sol)
  - [WoGMockItems.sol](hardhat/contracts/WoGMockItems.sol)
  - [WoGMockCharacters.sol](hardhat/contracts/WoGMockCharacters.sol)
- [deploy.ts](hardhat/scripts/deploy.ts) now deploys the mock asset contracts alongside the ERC-8004 registries and writes the localhost manifest consumed by shard dev mode
- local DEV metadata minting no longer depends on thirdweb upload authorization:
  - character and item metadata use inline `data:application/json;base64,...` URIs when `DEV=true`
- local treasury seeding now checks actual on-chain treasury GOLD balance before skipping welcome-fund minting, fixing stale Redis state after Hardhat chain resets
- BITE-side runtime writes now run through a shared serialized queue in [biteTxQueue.ts](shard/src/blockchain/biteTxQueue.ts), with nonce/transient RPC retries, instead of firing concurrent transactions from the shared server signer
- reputation now uses an eventually-consistent read model instead of an indefinitely stale local cache:
  - [reputationChain.ts](shard/src/economy/reputationChain.ts) can now read on-chain scores and emits notifications when init/batch writes land
  - [reputationManager.ts](shard/src/economy/reputationManager.ts) now schedules reconciliation, persists chain-synced values back to Redis, and serves an eventually-consistent API view
  - [reputationRoutes.ts](shard/src/economy/reputationRoutes.ts) now uses the eventually-consistent read path for `/api/agents/:agentId/reputation`
- the shared BITE queue now covers the ERC-8004 and adjacent game write paths that were racing on Hardhat:
  - identity registration and endpoint updates in [blockchain.ts](shard/src/blockchain/blockchain.ts)
  - validation claims in [validation.ts](shard/src/erc8004/validation.ts)
  - reputation initialization and batch updates in [reputationChain.ts](shard/src/economy/reputationChain.ts)
  - name service writes in [nameServiceChain.ts](shard/src/blockchain/nameServiceChain.ts)
  - other BITE gameplay mutators in trade, auctions, guilds, guild vault, land plots, and prediction pools
- name-service auto-registration logging in [characterRoutes.ts](shard/src/character/characterRoutes.ts) now only reports success when the chain write actually completes

### Contract status

- [contracts/WoGIdentityRegistry.sol](contracts/WoGIdentityRegistry.sol) was updated to match the shard runtime ABI more closely and now exposes:
  - `register(string agentURI)`
  - `setAgentURI(...)`
  - `setAgentWallet(...)`
  - `setMetadata(...)`
  - `getMetadata(...)`
  - `getAgentWallet(...)`
  - `tokenURI(...)`
  - `isAuthorizedOrOwner(...)`
- [contracts/WoGReputationRegistry.sol](contracts/WoGReputationRegistry.sol) now includes:
  - `recordInteraction(...)`
  - `getTopAgents(...)`
  - better internal identity tracking for initialized agents
- [contracts/WoGValidationRegistry.sol](contracts/WoGValidationRegistry.sol) was added and now provides:
  - `verifyCapability(...)`
  - `getVerifications(...)`
  - `isVerified(...)`
- a unified deploy script now exists at [shard/src/deploy/deployERC8004Registries.ts](shard/src/deploy/deployERC8004Registries.ts)

### Validation completed

- `client` build/check passes
- `shard` build passes
- the three ERC-8004 registry contracts compile together with `solc`
- local Hardhat deploy/build flow passes:
  - `cd hardhat && npm run compile`
  - `cd hardhat && npm run deploy:localhost`
  - `cd shard && npm run build`

### Local integration verification

The repo now has a usable full local ERC-8004 integration path under `DEV=true` on Hardhat.

Verified local contracts:

- `GOLD_CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3`
- `ITEMS_CONTRACT_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
- `CHARACTER_CONTRACT_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`
- `IDENTITY_REGISTRY_ADDRESS=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`
- `REPUTATION_REGISTRY_ADDRESS=0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9`
- `VALIDATION_REGISTRY_ADDRESS=0x5FC8d32690cc91D4c39d9d3abcBD16989F875707`

Verified end-to-end before the BITE queue hardening:

- wallet registration succeeds and a fresh wallet receives welcome funds on-chain
- character creation mints the character NFT locally and stores `characterTokenId`
- ERC-8004 identity registration succeeds, stores `agentId`, transfers the identity NFT to the player wallet, and writes the A2A endpoint to the identity token URI
- `/a2a/resolve/:agentId` and `/api/agents/:agentId/identity` resolve the minted identity correctly
- merchant/item initialization succeeds against the local mock items contract
- gameplay state mutates normally after spawn and is persisted back to Redis/save state

Root cause found during local verification:

- Hardhat exposed nonce races on the shared BITE signer because multiple modules sent transactions concurrently during character bootstrap
- the main failures showed up as `NONCE_EXPIRED` / `Nonce too low` on:
  - validation claim publishing
  - reputation initialization
  - name-service auto-registration

Verified after the shared BITE queue fix with a fresh local wallet/character:

- auth challenge + verify succeeds for a fresh wallet
- `/wallet/register` succeeds and on-chain GOLD balance is `0.02`
- `/character/create` succeeds and mints:
  - `characterTokenId=1`
  - `agentId=2`
- `/api/agents/2/identity` resolves the correct wallet, A2A endpoint, and `characterTokenId`
- `/api/agents/2/validations` returns the expected `wog:a2a-enabled` claim
- `/name/lookup/:address` resolves the expected `.wog` name
- `/spawn` succeeds with the minted `characterTokenId` and `agentId`
- direct contract reads confirm:
  - identity owner = player wallet
  - identity wallet = player wallet
  - identity token URI = local A2A endpoint
  - identity metadata `characterTokenId` = `1`
  - validation registry contains the capability claim
  - reputation registry initialized successfully on-chain

Remaining post-queue gap:

- the nonce issue was most visible on Hardhat automine, but it was still a real architectural defect because all of those modules shared one signer without one queue boundary

Verified after the eventual-consistency reputation fix:

- a fresh local agent can receive a reputation delta through `/api/agents/:agentId/reputation/feedback`
- the API still remains fast because local writes happen immediately in memory
- the reputation contract is updated by the existing 15s batch flush
- once the chain write lands, `/api/agents/:agentId/reputation` now converges to the contract value on the next read instead of remaining stale indefinitely
- observed local test:
  - agent `4`
  - submitted `social +7`
  - contract moved from `500` to `507`
  - API moved from `500/500` to `507/501` and then stayed aligned with chain

### Not complete yet

- the three registries have not yet been deployed to the target SKALE chain from this repo state
- the following env vars still need real deployed values:
  - `IDENTITY_REGISTRY_ADDRESS`
  - `REPUTATION_REGISTRY_ADDRESS`
  - `VALIDATION_REGISTRY_ADDRESS`
- full live end-to-end verification on the target network is still pending:
  - mint character -> identity registration
  - write reputation -> on-chain update
  - publish validation -> on-chain verification record
  - UI reads back live on-chain-backed data correctly
- validation claims exist in backend APIs, but validation badges are not yet surfaced prominently in UI
- identity logic still partially lives in [shard/src/blockchain/blockchain.ts](shard/src/blockchain/blockchain.ts) and could be moved further into `shard/src/erc8004/`

### Hardening left for later

- `setAgentWallet(...)` exists for contract/runtime compatibility, but it currently uses an authorization-based transfer flow rather than full signature verification
- dedicated Solidity tests for the three registries still need to be added
- richer validation claims and discovery surfaces are still future work

### Practical completion assessment

- app-side ERC-8004 integration: mostly complete
- contract interface alignment: mostly complete
- deployed/live registry integration: not complete
- production hardening: not complete

At the current repo state, ERC-8004 is integrated in architecture and code paths, but not fully complete until the registries are deployed, configured, and verified on-chain.

---

## Non-Negotiable Acceptance Criteria

The integration is not complete until all of the following are true:

1. Every active/player character has a real persisted `agentId`.
2. Reputation is written and read by `agentId`, not wallet.
3. No wallet-derived fake identity IDs remain in code.
4. Identity metadata and A2A endpoint are bound to the ERC-8004 identity layer.
5. Validation registry is live and used for at least one real WoG claim.
6. All trust-related client views consume agent-based APIs.
7. One wallet owning multiple characters results in distinct trust records.
8. Legacy wallet-based reputation APIs and assumptions are removed.

---

## Recommended Execution Sequence

If implementation starts immediately, the most effective order is:

1. Lock the target contract interfaces and metadata schema.
2. Add `shard/src/erc8004/` integration layer.
3. Deploy the three registries.
4. Cut over character creation to identity registration and persist `agentId`.
5. Thread `agentId` through entity/runtime models.
6. Rewrite reputation manager and gameplay write paths.
7. Replace APIs and client consumers.
8. Add validation claims.
9. Remove legacy code and update docs/tests.

---

## First Implementation Slice

The first coding slice should be narrowly scoped but foundational:

1. Create `shard/src/erc8004/` contract wrappers.
2. Add `agentId` persistence to character/entity models.
3. Register identity on character mint/deploy.
4. Expose `agentId` in runtime entities and relevant API payloads.

Once that lands, the rest of the cutover becomes mechanical instead of speculative.
