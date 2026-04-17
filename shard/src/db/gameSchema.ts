import { postgresQuery, withPostgresClient } from "./postgres.js";

export async function ensureGameSchema(): Promise<void> {
  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(`
        create schema if not exists game;

        create table if not exists game.characters (
          character_id bigserial primary key,
          wallet_address text not null,
          normalized_name text not null,
          character_name text not null,
          class_id text not null,
          race_id text not null,
          level integer not null default 1,
          xp integer not null default 0,
          zone_id text not null default 'village-square',
          calling text,
          gender text,
          skin_color text,
          hair_style text,
          eye_color text,
          origin text,
          snapshot_json jsonb not null default '{}'::jsonb,
          updated_at timestamptz not null default now(),
          unique (wallet_address, normalized_name, class_id)
        );

        create index if not exists idx_characters_wallet
          on game.characters (wallet_address);

        create index if not exists idx_characters_zone
          on game.characters (zone_id);

        create table if not exists game.character_identity_state (
          character_id bigint primary key references game.characters(character_id) on delete cascade,
          character_token_id text,
          agent_id text,
          agent_registration_tx_hash text,
          chain_registration_status text,
          chain_registration_last_error text,
          publish_status text not null default 'pending',
          publish_tx_hash text,
          published_at timestamptz,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_character_identity_token
          on game.character_identity_state (character_token_id);

        create index if not exists idx_character_identity_agent
          on game.character_identity_state (agent_id);

        create table if not exists game.wallet_links (
          owner_wallet text primary key,
          custodial_wallet text,
          entity_id text,
          last_zone_id text,
          character_name text,
          agent_id text,
          character_token_id text,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.character_projections (
          wallet_address text not null,
          normalized_name text not null,
          character_name text not null,
          class_id text not null,
          race_id text not null,
          level integer not null default 1,
          xp integer not null default 0,
          character_token_id text,
          agent_id text,
          agent_registration_tx_hash text,
          chain_registration_status text,
          chain_registration_last_error text,
          zone_id text not null default 'village-square',
          calling text,
          gender text,
          skin_color text,
          hair_style text,
          eye_color text,
          origin text,
          snapshot_json jsonb not null default '{}'::jsonb,
          source text not null default 'redis-sync',
          updated_at timestamptz not null default now(),
          primary key (wallet_address, normalized_name, class_id)
        );

        create index if not exists idx_character_projections_wallet
          on game.character_projections (wallet_address);

        create index if not exists idx_character_projections_token
          on game.character_projections (character_token_id);

        create index if not exists idx_character_projections_agent
          on game.character_projections (agent_id);

        create table if not exists game.character_name_claims (
          normalized_name text primary key,
          character_name text not null,
          wallet_address text not null,
          class_id text not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_character_name_claims_wallet
          on game.character_name_claims (wallet_address);

        -- Repair ghost rows from early bootstrap paths that wrote empty class_id.
        -- For each (wallet, normalized_name) with an empty-class_id row:
        --   1. If snapshot_json stored a classId, backfill it.
        --   2. Otherwise, if a sibling row has a non-empty class_id, drop the ghost.
        do $$
        declare
          r record;
        begin
          for r in
            select wallet_address, normalized_name, snapshot_json->>'classId' as snapshot_class
            from game.character_projections
            where (class_id is null or class_id = '')
              and coalesce(snapshot_json->>'classId', '') <> ''
          loop
            update game.character_projections
            set class_id = r.snapshot_class
            where wallet_address = r.wallet_address
              and normalized_name = r.normalized_name
              and (class_id is null or class_id = '')
              and not exists (
                select 1 from game.character_projections p2
                where p2.wallet_address = r.wallet_address
                  and p2.normalized_name = r.normalized_name
                  and p2.class_id = r.snapshot_class
              );
          end loop;
        exception
          when unique_violation then null;
        end $$;

        delete from game.character_projections p
        where (p.class_id is null or p.class_id = '')
          and exists (
            select 1 from game.character_projections sibling
            where sibling.wallet_address = p.wallet_address
              and sibling.normalized_name = p.normalized_name
              and sibling.class_id is not null
              and sibling.class_id <> ''
          );

        delete from game.characters c
        where (c.class_id is null or c.class_id = '')
          and exists (
            select 1 from game.characters sibling
            where sibling.wallet_address = c.wallet_address
              and sibling.normalized_name = c.normalized_name
              and sibling.class_id is not null
              and sibling.class_id <> ''
          );

        do $$
        begin
          alter table game.character_projections
            add constraint character_projections_class_id_nonempty
            check (class_id is not null and class_id <> '') not valid;
        exception
          when duplicate_object then null;
        end $$;

        do $$
        begin
          alter table game.characters
            add constraint characters_class_id_nonempty
            check (class_id is not null and class_id <> '') not valid;
        exception
          when duplicate_object then null;
        end $$;

        create table if not exists game.live_sessions (
          wallet_address text primary key,
          entity_id text,
          zone_id text not null,
          session_state jsonb not null default '{}'::jsonb,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.outbox_events (
          event_id uuid primary key,
          topic text not null,
          aggregate_type text not null,
          aggregate_key text not null,
          payload_json jsonb not null,
          status text not null default 'pending',
          available_at timestamptz not null default now(),
          attempt_count integer not null default 0,
          last_error text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          published_at timestamptz
        );

        create index if not exists idx_outbox_status_available
          on game.outbox_events (status, available_at);

        create index if not exists idx_outbox_aggregate
          on game.outbox_events (aggregate_type, aggregate_key);

        create table if not exists game.chain_operations (
          operation_id uuid primary key,
          intent_id uuid,
          type text not null,
          subject text not null,
          payload_json jsonb not null,
          status text not null,
          attempt_count integer not null default 0,
          next_attempt_at timestamptz not null default now(),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          last_attempt_at timestamptz,
          completed_at timestamptz,
          tx_hash text,
          last_error text
        );

        create index if not exists idx_chain_operations_due
          on game.chain_operations (status, next_attempt_at);

        create index if not exists idx_chain_operations_type_subject
          on game.chain_operations (type, subject, updated_at desc);

        create table if not exists game.chain_write_intents (
          intent_id uuid primary key,
          type text not null,
          aggregate_type text not null,
          aggregate_key text not null,
          wallet_address text,
          payload_json jsonb not null,
          priority integer not null default 100,
          status text not null default 'pending',
          available_at timestamptz not null default now(),
          claimed_at timestamptz,
          claim_owner text,
          last_submitted_at timestamptz,
          confirmed_at timestamptz,
          attempt_count integer not null default 0,
          tx_hash text,
          last_error text,
          superseded_by uuid,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        drop index if exists game.idx_chain_write_intents_active_aggregate;
        create unique index idx_chain_write_intents_active_aggregate
          on game.chain_write_intents (type, aggregate_key)
          where status in ('pending', 'retryable', 'processing', 'waiting_funds');

        create index if not exists idx_chain_write_intents_due
          on game.chain_write_intents (status, available_at, priority, created_at);

        create index if not exists idx_chain_write_intents_wallet
          on game.chain_write_intents (wallet_address, updated_at desc);

        create table if not exists game.chain_tx_attempts (
          attempt_id uuid primary key,
          intent_id uuid not null references game.chain_write_intents(intent_id) on delete cascade,
          signer_address text,
          rpc_provider text,
          queue_label text,
          nonce bigint,
          tx_hash text,
          status text not null,
          error_code text,
          error_message text,
          gas_limit text,
          gas_price text,
          max_fee_per_gas text,
          max_priority_fee_per_gas text,
          created_at timestamptz not null default now(),
          submitted_at timestamptz,
          confirmed_at timestamptz
        );

        create index if not exists idx_chain_tx_attempts_intent_created
          on game.chain_tx_attempts (intent_id, created_at desc);

        do $$
        begin
          if not exists (
            select 1
            from information_schema.constraint_column_usage
            where table_schema = 'game'
              and table_name = 'chain_operations'
              and constraint_name = 'chain_operations_intent_id_fkey'
          ) then
            alter table game.chain_operations
              add constraint chain_operations_intent_id_fkey
              foreign key (intent_id) references game.chain_write_intents(intent_id) on delete set null;
          end if;
        exception
          when duplicate_object then null;
        end $$;

        create table if not exists game.profession_state (
          wallet_address text not null,
          profession_id text not null,
          learned_at timestamptz not null default now(),
          skill_xp integer not null default 0,
          skill_level integer not null default 1,
          action_count integer not null default 0,
          updated_at timestamptz not null default now(),
          primary key (wallet_address, profession_id)
        );

        create index if not exists idx_profession_state_wallet
          on game.profession_state (wallet_address);

        create table if not exists game.character_equipment (
          wallet_address text not null,
          normalized_name text not null,
          slot_id text not null,
          item_state_json jsonb not null,
          updated_at timestamptz not null default now(),
          primary key (wallet_address, normalized_name, slot_id)
        );

        create index if not exists idx_character_equipment_wallet
          on game.character_equipment (wallet_address);

        create table if not exists game.parties (
          party_id text primary key,
          leader_wallet text not null,
          member_wallets_json jsonb not null,
          zone_id text not null,
          created_at timestamptz not null,
          share_xp boolean not null default true,
          share_gold boolean not null default true,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.party_wallet_memberships (
          wallet_address text primary key,
          party_id text not null references game.parties(party_id) on delete cascade,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_party_wallet_memberships_party
          on game.party_wallet_memberships (party_id);

        create table if not exists game.direct_listings (
          listing_id uuid primary key,
          seller_wallet text not null,
          asset_type text not null,
          token_id integer not null,
          quantity integer not null,
          instance_id text,
          price_usd integer not null,
          price_gold integer,
          status text not null,
          operation_id text,
          escrow_burn_tx text,
          created_at_ms bigint not null,
          expires_at_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_direct_listings_status_expires
          on game.direct_listings (status, expires_at_ms);

        create index if not exists idx_direct_listings_seller
          on game.direct_listings (seller_wallet, created_at_ms desc);

        create table if not exists game.plot_state (
          plot_id text primary key,
          zone_id text not null,
          x integer not null,
          y integer not null,
          owner_wallet text,
          owner_name text,
          claimed_at_ms bigint,
          building_type text,
          building_stage integer not null default 0,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_plot_state_owner
          on game.plot_state (owner_wallet);

        create index if not exists idx_plot_state_zone
          on game.plot_state (zone_id);

        create table if not exists game.item_token_mappings (
          game_token_id bigint primary key,
          chain_token_id bigint not null unique,
          item_name text not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.crafted_item_instances (
          instance_id uuid primary key,
          owner_wallet text not null,
          base_token_id integer not null,
          instance_json jsonb not null,
          crafted_at_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_crafted_item_instances_owner
          on game.crafted_item_instances (owner_wallet, crafted_at_ms desc);

        create table if not exists game.friend_edges (
          wallet_address text not null,
          friend_wallet text not null,
          added_at_ms bigint not null,
          updated_at timestamptz not null default now(),
          primary key (wallet_address, friend_wallet)
        );

        create index if not exists idx_friend_edges_wallet
          on game.friend_edges (wallet_address, added_at_ms desc);

        create table if not exists game.friend_requests (
          request_id uuid primary key,
          from_wallet text not null,
          from_name text not null,
          to_wallet text not null,
          created_at_ms bigint not null,
          expires_at_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_friend_requests_to_wallet
          on game.friend_requests (to_wallet, created_at_ms desc);

        create table if not exists game.auction_projections (
          auction_id bigint primary key,
          zone_id text not null,
          seller_wallet text not null,
          token_id integer not null,
          quantity integer not null,
          start_price numeric not null,
          buyout_price numeric not null,
          end_time integer not null,
          high_bidder text not null,
          high_bidder_agent_id text,
          high_bid numeric not null,
          status integer not null,
          extension_count integer not null default 0,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_auction_projections_zone_status
          on game.auction_projections (zone_id, status, end_time);

        create table if not exists game.guilds (
          guild_id bigint primary key,
          name text not null,
          description text not null,
          founder_wallet text not null,
          treasury numeric not null default 0,
          level integer not null default 1,
          reputation integer not null default 0,
          status integer not null default 0,
          created_at_sec integer not null,
          member_count integer not null default 0,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.guild_memberships (
          guild_id bigint not null references game.guilds(guild_id) on delete cascade,
          member_wallet text not null,
          rank integer not null,
          joined_at_sec integer not null,
          contributed_gold numeric not null default 0,
          updated_at timestamptz not null default now(),
          primary key (guild_id, member_wallet)
        );

        create index if not exists idx_guild_memberships_member
          on game.guild_memberships (member_wallet);

        create table if not exists game.guild_proposals (
          proposal_id bigint primary key,
          guild_id bigint not null references game.guilds(guild_id) on delete cascade,
          proposer_wallet text not null,
          proposal_type integer not null,
          description text not null,
          created_at_sec integer not null,
          voting_ends_at_sec integer not null,
          yes_votes integer not null default 0,
          no_votes integer not null default 0,
          status integer not null default 0,
          target_address text not null,
          target_amount numeric not null default 0,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_guild_proposals_guild
          on game.guild_proposals (guild_id, created_at_sec desc);

        create table if not exists game.web_push_subscriptions (
          wallet_address text primary key,
          subscription_json jsonb not null,
          created_at_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.telegram_wallet_links (
          wallet_address text primary key,
          chat_id text not null,
          last_summary_at_ms bigint,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.marketplace_operations (
          operation_id uuid primary key,
          operation_json jsonb not null,
          owner_wallet text not null,
          status text not null,
          updated_at_ms bigint not null,
          created_at timestamptz not null default now()
        );

        create index if not exists idx_marketplace_operations_wallet
          on game.marketplace_operations (owner_wallet, updated_at_ms desc);

        create index if not exists idx_marketplace_operations_status
          on game.marketplace_operations (status, updated_at_ms desc);

        create table if not exists game.marketplace_pending_payments (
          payment_id uuid primary key,
          wallet_address text not null,
          payload_json jsonb not null,
          expires_at_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_marketplace_pending_payments_wallet
          on game.marketplace_pending_payments (wallet_address, expires_at_ms desc);

        create table if not exists game.gold_pending_payments (
          payment_id uuid primary key,
          wallet_address text not null,
          payload_json jsonb not null,
          expires_at_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.rental_listings (
          rental_id uuid primary key,
          owner_wallet text not null,
          status text not null,
          asset_type text not null,
          token_id integer not null,
          payload_json jsonb not null,
          created_at_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_rental_listings_owner
          on game.rental_listings (owner_wallet, created_at_ms desc);

        create index if not exists idx_rental_listings_status
          on game.rental_listings (status, created_at_ms desc);

        create table if not exists game.rental_grants (
          grant_id uuid primary key,
          rental_id uuid not null references game.rental_listings(rental_id) on delete cascade,
          renter_wallet text not null,
          owner_wallet text not null,
          token_id integer not null,
          status text not null,
          ends_at_ms bigint not null,
          payload_json jsonb not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_rental_grants_renter
          on game.rental_grants (renter_wallet, status, ends_at_ms desc);

        create index if not exists idx_rental_grants_token
          on game.rental_grants (token_id, status, ends_at_ms desc);

        create table if not exists game.character_rental_entities (
          grant_id uuid primary key references game.rental_grants(grant_id) on delete cascade,
          entity_id text not null,
          payload_json jsonb not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.diary_entries (
          entry_id uuid primary key,
          wallet_address text not null,
          timestamp_ms bigint not null,
          payload_json jsonb not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_diary_entries_wallet_ts
          on game.diary_entries (wallet_address, timestamp_ms desc);

        create table if not exists game.reputation_scores (
          agent_id text primary key,
          payload_json jsonb not null,
          last_updated_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.reputation_feedback (
          feedback_id bigserial primary key,
          agent_id text not null,
          payload_json jsonb not null,
          timestamp_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_reputation_feedback_agent_ts
          on game.reputation_feedback (agent_id, timestamp_ms desc);

        create table if not exists game.custodial_wallets (
          wallet_address text primary key,
          encrypted_private_key text not null,
          created_at_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.wallet_runtime_state (
          state_key text primary key,
          payload_json jsonb not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.wallet_registration_state (
          wallet_address text primary key,
          status_json jsonb not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.character_bootstrap_jobs (
          job_key text primary key,
          wallet_address text not null,
          character_name text not null,
          status text not null,
          next_attempt_at_ms bigint not null,
          payload_json jsonb not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_character_bootstrap_jobs_status_next
          on game.character_bootstrap_jobs (status, next_attempt_at_ms);

        create table if not exists game.agent_inbox_messages (
          message_id text primary key,
          wallet_address text not null,
          acked boolean not null default false,
          ts_ms bigint not null,
          payload_json jsonb not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_agent_inbox_wallet_acked_ts
          on game.agent_inbox_messages (wallet_address, acked, ts_ms desc);

        create table if not exists game.agent_inbox_history (
          message_id text primary key,
          wallet_address text not null,
          ts_ms bigint not null,
          payload_json jsonb not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_agent_inbox_history_wallet_ts
          on game.agent_inbox_history (wallet_address, ts_ms desc);

        create table if not exists game.merchant_states (
          merchant_id text primary key,
          zone_id text not null,
          npc_name text not null,
          wallet_address text not null,
          payload_json jsonb not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_merchant_states_zone
          on game.merchant_states (zone_id);

        create table if not exists game.party_invites (
          invite_id text primary key,
          from_entity_id text not null,
          from_name text not null,
          from_custodial_wallet text not null,
          to_custodial_wallet text not null,
          party_id text not null,
          created_at_ms bigint not null,
          expires_at_ms bigint not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_party_invites_target
          on game.party_invites (to_custodial_wallet, expires_at_ms desc);

        create table if not exists game.promo_codes (
          code text primary key,
          tier text not null,
          max_uses integer not null,
          uses integer not null default 0,
          gold_bonus integer,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.promo_code_redemptions (
          code text not null references game.promo_codes(code) on delete cascade,
          wallet_address text not null,
          redeemed_at_ms bigint not null,
          updated_at timestamptz not null default now(),
          primary key (code, wallet_address)
        );

        create index if not exists idx_promo_code_redemptions_wallet
          on game.promo_code_redemptions (wallet_address, redeemed_at_ms desc);

        create table if not exists game.gold_reservations (
          wallet_address text primary key,
          reserved_amount double precision not null default 0,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.gold_spend_totals (
          wallet_address text primary key,
          spent_amount double precision not null default 0,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.wallet_gold_balances (
          wallet_address text primary key,
          balance double precision not null default 0,
          updated_at timestamptz not null default now()
        );

        create table if not exists game.wallet_item_balances (
          wallet_address text not null,
          token_id bigint not null,
          quantity bigint not null default 0,
          updated_at timestamptz not null default now(),
          primary key (wallet_address, token_id)
        );

        create index if not exists idx_wallet_item_balances_wallet
          on game.wallet_item_balances (wallet_address);

        create table if not exists game.wallet_names (
          wallet_address text primary key,
          name text not null,
          normalized_name text not null unique,
          updated_at timestamptz not null default now()
        );

        alter table game.wallet_names
          add column if not exists chain_registered_at timestamptz;
      `);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

export async function getGameSchemaHealth(): Promise<{
  characterCount: number;
  identityStateCount: number;
  walletLinkCount: number;
  characterProjectionCount: number;
  outboxCount: number;
  chainOperationCount: number;
  professionStateCount: number;
  equipmentStateCount: number;
  partyCount: number;
  listingCount: number;
  plotStateCount: number;
  itemTokenMappingCount: number;
  craftedItemInstanceCount: number;
  friendEdgeCount: number;
  friendRequestCount: number;
  auctionProjectionCount: number;
  guildCount: number;
  guildMembershipCount: number;
  guildProposalCount: number;
  webPushSubscriptionCount: number;
  telegramLinkCount: number;
  marketplaceOperationCount: number;
  marketplacePendingPaymentCount: number;
  goldPendingPaymentCount: number;
  rentalListingCount: number;
  rentalGrantCount: number;
  characterRentalEntityCount: number;
  diaryEntryCount: number;
  reputationScoreCount: number;
  reputationFeedbackCount: number;
  custodialWalletCount: number;
  walletRuntimeStateCount: number;
  walletRegistrationStateCount: number;
  characterBootstrapJobCount: number;
  agentInboxMessageCount: number;
  agentInboxHistoryCount: number;
  merchantStateCount: number;
  partyInviteCount: number;
  promoCodeCount: number;
  promoCodeRedemptionCount: number;
  goldReservationCount: number;
  goldSpendTotalCount: number;
  walletGoldBalanceCount: number;
  walletItemBalanceCount: number;
  walletNameCount: number;
}> {
  const [
    { rows: characterRows },
    { rows: identityRows },
    { rows: walletRows },
    { rows: projectionRows },
    { rows: outboxRows },
    { rows: chainOpRows },
    { rows: professionRows },
    { rows: equipmentRows },
    { rows: partyRows },
    { rows: listingRows },
    { rows: plotRows },
    { rows: tokenMappingRows },
    { rows: itemInstanceRows },
    { rows: friendEdgeRows },
    { rows: friendRequestRows },
    { rows: auctionRows },
    { rows: guildRows },
    { rows: guildMembershipRows },
    { rows: guildProposalRows },
    { rows: webPushRows },
    { rows: telegramRows },
    { rows: marketplaceOpRows },
    { rows: marketplacePaymentRows },
    { rows: goldPaymentRows },
    { rows: rentalListingRows },
    { rows: rentalGrantRows },
    { rows: rentalEntityRows },
    { rows: diaryRows },
    { rows: reputationScoreRows },
    { rows: reputationFeedbackRows },
    { rows: custodialWalletRows },
    { rows: walletRuntimeRows },
    { rows: walletRegistrationRows },
    { rows: bootstrapJobRows },
    { rows: inboxRows },
    { rows: inboxHistoryRows },
    { rows: merchantRows },
    { rows: partyInviteRows },
    { rows: promoRows },
    { rows: promoRedemptionRows },
    { rows: goldReservationRows },
    { rows: goldSpendRows },
    { rows: walletGoldRows },
    { rows: walletItemRows },
    { rows: walletNameRows },
  ] = await Promise.all([
    postgresQuery<{ count: string }>("select count(*)::text as count from game.characters"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.character_identity_state"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.wallet_links"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.character_projections"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.outbox_events"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.chain_operations"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.profession_state"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.character_equipment"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.parties"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.direct_listings"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.plot_state"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.item_token_mappings"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.crafted_item_instances"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.friend_edges"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.friend_requests"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.auction_projections"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.guilds"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.guild_memberships"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.guild_proposals"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.web_push_subscriptions"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.telegram_wallet_links"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.marketplace_operations"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.marketplace_pending_payments"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.gold_pending_payments"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.rental_listings"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.rental_grants"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.character_rental_entities"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.diary_entries"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.reputation_scores"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.reputation_feedback"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.custodial_wallets"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.wallet_runtime_state"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.wallet_registration_state"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.character_bootstrap_jobs"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.agent_inbox_messages"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.agent_inbox_history"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.merchant_states"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.party_invites"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.promo_codes"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.promo_code_redemptions"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.gold_reservations"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.gold_spend_totals"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.wallet_gold_balances"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.wallet_item_balances"),
    postgresQuery<{ count: string }>("select count(*)::text as count from game.wallet_names"),
  ]);

  return {
    characterCount: Number(characterRows[0]?.count ?? "0"),
    identityStateCount: Number(identityRows[0]?.count ?? "0"),
    walletLinkCount: Number(walletRows[0]?.count ?? "0"),
    characterProjectionCount: Number(projectionRows[0]?.count ?? "0"),
    outboxCount: Number(outboxRows[0]?.count ?? "0"),
    chainOperationCount: Number(chainOpRows[0]?.count ?? "0"),
    professionStateCount: Number(professionRows[0]?.count ?? "0"),
    equipmentStateCount: Number(equipmentRows[0]?.count ?? "0"),
    partyCount: Number(partyRows[0]?.count ?? "0"),
    listingCount: Number(listingRows[0]?.count ?? "0"),
    plotStateCount: Number(plotRows[0]?.count ?? "0"),
    itemTokenMappingCount: Number(tokenMappingRows[0]?.count ?? "0"),
    craftedItemInstanceCount: Number(itemInstanceRows[0]?.count ?? "0"),
    friendEdgeCount: Number(friendEdgeRows[0]?.count ?? "0"),
    friendRequestCount: Number(friendRequestRows[0]?.count ?? "0"),
    auctionProjectionCount: Number(auctionRows[0]?.count ?? "0"),
    guildCount: Number(guildRows[0]?.count ?? "0"),
    guildMembershipCount: Number(guildMembershipRows[0]?.count ?? "0"),
    guildProposalCount: Number(guildProposalRows[0]?.count ?? "0"),
    webPushSubscriptionCount: Number(webPushRows[0]?.count ?? "0"),
    telegramLinkCount: Number(telegramRows[0]?.count ?? "0"),
    marketplaceOperationCount: Number(marketplaceOpRows[0]?.count ?? "0"),
    marketplacePendingPaymentCount: Number(marketplacePaymentRows[0]?.count ?? "0"),
    goldPendingPaymentCount: Number(goldPaymentRows[0]?.count ?? "0"),
    rentalListingCount: Number(rentalListingRows[0]?.count ?? "0"),
    rentalGrantCount: Number(rentalGrantRows[0]?.count ?? "0"),
    characterRentalEntityCount: Number(rentalEntityRows[0]?.count ?? "0"),
    diaryEntryCount: Number(diaryRows[0]?.count ?? "0"),
    reputationScoreCount: Number(reputationScoreRows[0]?.count ?? "0"),
    reputationFeedbackCount: Number(reputationFeedbackRows[0]?.count ?? "0"),
    custodialWalletCount: Number(custodialWalletRows[0]?.count ?? "0"),
    walletRuntimeStateCount: Number(walletRuntimeRows[0]?.count ?? "0"),
    walletRegistrationStateCount: Number(walletRegistrationRows[0]?.count ?? "0"),
    characterBootstrapJobCount: Number(bootstrapJobRows[0]?.count ?? "0"),
    agentInboxMessageCount: Number(inboxRows[0]?.count ?? "0"),
    agentInboxHistoryCount: Number(inboxHistoryRows[0]?.count ?? "0"),
    merchantStateCount: Number(merchantRows[0]?.count ?? "0"),
    partyInviteCount: Number(partyInviteRows[0]?.count ?? "0"),
    promoCodeCount: Number(promoRows[0]?.count ?? "0"),
    promoCodeRedemptionCount: Number(promoRedemptionRows[0]?.count ?? "0"),
    goldReservationCount: Number(goldReservationRows[0]?.count ?? "0"),
    goldSpendTotalCount: Number(goldSpendRows[0]?.count ?? "0"),
    walletGoldBalanceCount: Number(walletGoldRows[0]?.count ?? "0"),
    walletItemBalanceCount: Number(walletItemRows[0]?.count ?? "0"),
    walletNameCount: Number(walletNameRows[0]?.count ?? "0"),
  };
}
