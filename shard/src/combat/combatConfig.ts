// Combat tuning constants. Changing these affects all PvE/PvP damage and evasion math.

export const MIN_DAMAGE = 3;
export const FALLBACK_ATTACK = 15;

// Dodge — defender's AGI gives a chance to avoid all damage. Players only.
export const DODGE_CAP = 0.40;
export const DODGE_K = 200;
export const DODGE_SCALE = 0.55;

// Critical — attacker's LUCK multiplies damage on hit. Players only.
export const CRIT_CAP = 0.50;
export const CRIT_K = 250;
export const CRIT_SCALE = 0.60;
export const CRIT_MULTIPLIER = 1.75;

// Block — defender's DEF reduces incoming damage. Players only.
export const BLOCK_CAP = 0.50;
export const BLOCK_K = 200;
export const BLOCK_SCALE = 0.60;
export const BLOCK_REDUCTION = 0.50;

// Faith — heal multiplier and paladin/cleric holy damage bonus.
export const FAITH_HEAL_K = 300;
export const FAITH_HEAL_SCALE = 0.60;
export const FAITH_HOLY_COEFF = 0.15;
