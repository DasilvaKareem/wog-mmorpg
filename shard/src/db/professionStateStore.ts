import { postgresQuery, withPostgresClient } from "./postgres.js";

export interface ProfessionStateRecord {
  walletAddress: string;
  professionId: string;
  learnedAt: string;
  skillXp: number;
  skillLevel: number;
  actionCount: number;
  updatedAt: string;
}

function normalizeWallet(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

export async function replaceProfessionStateForWallet(params: {
  walletAddress: string;
  professions: string[];
  skills: Record<string, { xp: number; level: number; actions: number }>;
}): Promise<void> {
  const walletAddress = normalizeWallet(params.walletAddress);
  const professions = Array.from(new Set(params.professions.map((profession) => profession.trim()).filter(Boolean)));

  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(`delete from game.profession_state where wallet_address = $1`, [walletAddress]);
      for (const professionId of professions) {
        const skill = params.skills[professionId] ?? { xp: 0, level: 1, actions: 0 };
        await client.query(
          `
            insert into game.profession_state (
              wallet_address,
              profession_id,
              skill_xp,
              skill_level,
              action_count,
              updated_at
            ) values ($1, $2, $3, $4, $5, now())
            on conflict (wallet_address, profession_id) do update
            set
              skill_xp = excluded.skill_xp,
              skill_level = excluded.skill_level,
              action_count = excluded.action_count,
              updated_at = now()
          `,
          [
            walletAddress,
            professionId,
            Math.max(0, Number(skill.xp ?? 0) || 0),
            Math.max(1, Number(skill.level ?? 1) || 1),
            Math.max(0, Number(skill.actions ?? 0) || 0),
          ]
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

export async function listProfessionStateForWallet(walletAddress: string): Promise<ProfessionStateRecord[]> {
  const { rows } = await postgresQuery<{
    wallet_address: string;
    profession_id: string;
    learned_at: string;
    skill_xp: number;
    skill_level: number;
    action_count: number;
    updated_at: string;
  }>(
    `
      select
        wallet_address,
        profession_id,
        learned_at::text as learned_at,
        skill_xp,
        skill_level,
        action_count,
        updated_at::text as updated_at
      from game.profession_state
      where wallet_address = $1
      order by profession_id asc
    `,
    [normalizeWallet(walletAddress)]
  );

  return rows.map((row) => ({
    walletAddress: row.wallet_address,
    professionId: row.profession_id,
    learnedAt: row.learned_at,
    skillXp: Number(row.skill_xp ?? 0) || 0,
    skillLevel: Number(row.skill_level ?? 1) || 1,
    actionCount: Number(row.action_count ?? 0) || 0,
    updatedAt: row.updated_at,
  }));
}
