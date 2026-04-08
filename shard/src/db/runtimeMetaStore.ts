import { isPostgresConfigured, postgresQuery } from "./postgres.js";

export interface PartyInviteRecord {
  id: string;
  fromEntityId: string;
  fromName: string;
  fromCustodialWallet: string;
  toCustodialWallet: string;
  partyId: string;
  createdAt: number;
}

export interface PromoCodeRecord {
  code: string;
  tier: string;
  maxUses: number;
  uses: number;
  goldBonus?: number;
}

function normWallet(value: string): string {
  return value.toLowerCase();
}

function normCode(value: string): string {
  return value.toUpperCase().trim();
}

export async function replacePartyInvites(
  wallet: string,
  invites: PartyInviteRecord[],
  ttlMs: number
): Promise<void> {
  if (!isPostgresConfigured()) return;
  const normalizedWallet = normWallet(wallet);
  await postgresQuery("delete from game.party_invites where to_custodial_wallet = $1", [normalizedWallet]);
  for (const invite of invites) {
    await postgresQuery(
      `insert into game.party_invites (
        invite_id, from_entity_id, from_name, from_custodial_wallet, to_custodial_wallet, party_id, created_at_ms, expires_at_ms, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [
        invite.id,
        invite.fromEntityId,
        invite.fromName,
        normWallet(invite.fromCustodialWallet),
        normalizedWallet,
        invite.partyId,
        invite.createdAt,
        invite.createdAt + ttlMs,
      ]
    );
  }
}

export async function listFreshPartyInvites(wallet: string, now: number): Promise<PartyInviteRecord[]> {
  if (!isPostgresConfigured()) return [];
  const normalizedWallet = normWallet(wallet);
  await postgresQuery("delete from game.party_invites where to_custodial_wallet = $1 and expires_at_ms <= $2", [
    normalizedWallet,
    now,
  ]);
  const { rows } = await postgresQuery<{
    invite_id: string;
    from_entity_id: string;
    from_name: string;
    from_custodial_wallet: string;
    to_custodial_wallet: string;
    party_id: string;
    created_at_ms: string;
  }>(
    `select invite_id, from_entity_id, from_name, from_custodial_wallet, to_custodial_wallet, party_id, created_at_ms::text
       from game.party_invites
      where to_custodial_wallet = $1
        and expires_at_ms > $2
      order by created_at_ms desc`,
    [normalizedWallet, now]
  );
  return rows.map((row) => ({
    id: row.invite_id,
    fromEntityId: row.from_entity_id,
    fromName: row.from_name,
    fromCustodialWallet: row.from_custodial_wallet,
    toCustodialWallet: row.to_custodial_wallet,
    partyId: row.party_id,
    createdAt: Number(row.created_at_ms),
  }));
}

export async function upsertPromoCode(record: PromoCodeRecord): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.promo_codes (code, tier, max_uses, uses, gold_bonus, updated_at)
     values ($1,$2,$3,$4,$5,now())
     on conflict (code) do update set
       tier = excluded.tier,
       max_uses = excluded.max_uses,
       uses = excluded.uses,
       gold_bonus = excluded.gold_bonus,
       updated_at = now()`,
    [normCode(record.code), record.tier, record.maxUses, record.uses, record.goldBonus ?? null]
  );
}

export async function getPromoCode(code: string): Promise<PromoCodeRecord | null> {
  if (!isPostgresConfigured()) return null;
  const { rows } = await postgresQuery<{
    code: string;
    tier: string;
    max_uses: number;
    uses: number;
    gold_bonus: number | null;
  }>(
    `select code, tier, max_uses, uses, gold_bonus
       from game.promo_codes
      where code = $1
      limit 1`,
    [normCode(code)]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    code: row.code,
    tier: row.tier,
    maxUses: row.max_uses,
    uses: row.uses,
    goldBonus: row.gold_bonus ?? undefined,
  };
}

export async function hasRedeemedPromoCode(code: string, wallet: string): Promise<boolean> {
  if (!isPostgresConfigured()) return false;
  const { rows } = await postgresQuery<{ redeemed_at_ms: string }>(
    `select redeemed_at_ms::text
       from game.promo_code_redemptions
      where code = $1 and wallet_address = $2
      limit 1`,
    [normCode(code), normWallet(wallet)]
  );
  return rows.length > 0;
}

export async function redeemPromoCode(code: string, wallet: string): Promise<PromoCodeRecord | null> {
  if (!isPostgresConfigured()) return null;
  const normalizedCode = normCode(code);
  const normalizedWallet = normWallet(wallet);
  const redeemedAt = Date.now();
  const { rows } = await postgresQuery<{
    code: string;
    tier: string;
    max_uses: number;
    uses: number;
    gold_bonus: number | null;
  }>(
    `
      with existing as (
        select code, tier, max_uses, uses, gold_bonus
          from game.promo_codes
         where code = $1
         for update
      ),
      ins as (
        insert into game.promo_code_redemptions (code, wallet_address, redeemed_at_ms, updated_at)
        select code, $2, $3, now()
          from existing
         where uses < max_uses
           and not exists (
           select 1
             from game.promo_code_redemptions
            where code = $1 and wallet_address = $2
         )
        returning code
      ),
      upd as (
        update game.promo_codes
           set uses = uses + 1, updated_at = now()
         where code = $1
           and exists (select 1 from ins)
           and uses < max_uses
        returning code, tier, max_uses, uses, gold_bonus
      )
      select code, tier, max_uses, uses, gold_bonus from upd
    `,
    [normalizedCode, normalizedWallet, redeemedAt]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    code: row.code,
    tier: row.tier,
    maxUses: row.max_uses,
    uses: row.uses,
    goldBonus: row.gold_bonus ?? undefined,
  };
}

export async function getGoldReservations(): Promise<Record<string, number>> {
  if (!isPostgresConfigured()) return {};
  const { rows } = await postgresQuery<{ wallet_address: string; reserved_amount: number }>(
    `select wallet_address, reserved_amount
       from game.gold_reservations
      where reserved_amount > 0`
  );
  return Object.fromEntries(rows.map((row) => [row.wallet_address, Number(row.reserved_amount)]));
}

export async function setGoldReservation(wallet: string, amount: number): Promise<void> {
  if (!isPostgresConfigured()) return;
  const normalizedWallet = normWallet(wallet);
  if (!Number.isFinite(amount) || amount <= 0) {
    await postgresQuery("delete from game.gold_reservations where wallet_address = $1", [normalizedWallet]);
    return;
  }
  await postgresQuery(
    `insert into game.gold_reservations (wallet_address, reserved_amount, updated_at)
     values ($1,$2,now())
     on conflict (wallet_address) do update set reserved_amount = excluded.reserved_amount, updated_at = now()`,
    [normalizedWallet, amount]
  );
}
