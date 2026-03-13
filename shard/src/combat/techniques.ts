export type TechniqueType = "attack" | "buff" | "debuff" | "healing";
export type TargetType = "self" | "enemy" | "ally" | "area";

export interface TechniqueEffect {
  damageMultiplier?: number; // For attacks
  healAmount?: number; // For healing (% of max HP)
  statBonus?: Partial<Record<string, number>>; // For buffs (% increase)
  statReduction?: Partial<Record<string, number>>; // For debuffs (% decrease)
  duration?: number; // Duration in seconds for buffs/debuffs/DoTs
  dotDamage?: number; // Damage over time per tick
  shield?: number; // Shield/absorb amount (% of max HP)
  areaRadius?: number; // For area attacks
  maxTargets?: number; // For multi-target attacks
  knockback?: number; // Push target away from caster (world units)
  lunge?: number; // Dash caster toward target (world units)
}

/**
 * How the ability is delivered visually on the client.
 * - melee:      instant lunge toward target + burst at impact
 * - projectile: dot travels from caster to target, then burst
 * - area:       expanding ring at cast position + burst
 * - channel:    pulsed bursts at caster over duration
 * - undefined:  simple burst at target (buffs, debuffs, self-casts)
 */
export type AnimStyle = "melee" | "projectile" | "area" | "channel";

export interface TechniqueDefinition {
  id: string;
  name: string;
  description: string;
  className: string;
  levelRequired: number;
  copperCost: number; // Gold to learn from trainer
  essenceCost: number;
  cooldown: number; // seconds
  type: TechniqueType;
  targetType: TargetType;
  effects: TechniqueEffect;
  animStyle?: AnimStyle;
}

export const TECHNIQUES: TechniqueDefinition[] = [
  // WARRIOR
  { id: "warrior_heroic_strike", name: "Heroic Strike",
    description: "Powerful melee strike dealing 150% weapon damage",
    className: "warrior", levelRequired: 1, copperCost: 10, essenceCost: 15, cooldown: 6,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 1.5 } },
  { id: "warrior_shield_wall", name: "Shield Wall",
    description: "Increases defense by 50% for 10 seconds",
    className: "warrior", levelRequired: 3, copperCost: 30, essenceCost: 20, cooldown: 30,
    type: "buff", targetType: "self",
    effects: { statBonus: { def: 50 }, duration: 10 } },
  { id: "warrior_intimidating_shout", name: "Intimidating Shout",
    description: "Reduces enemy attack power by 30% for 8 seconds",
    className: "warrior", levelRequired: 6, copperCost: 60, essenceCost: 25, cooldown: 20,
    type: "debuff", targetType: "enemy", animStyle: "area",
    effects: { statReduction: { str: 30 }, duration: 8 } },
  { id: "warrior_battle_rage", name: "Battle Rage",
    description: "Increases strength by 40% for 12 seconds",
    className: "warrior", levelRequired: 9, copperCost: 90, essenceCost: 30, cooldown: 45,
    type: "buff", targetType: "self",
    effects: { statBonus: { str: 40 }, duration: 12 } },
  { id: "warrior_cleave", name: "Cleave",
    description: "Sweeping attack hitting up to 3 nearby enemies",
    className: "warrior", levelRequired: 12, copperCost: 120, essenceCost: 35, cooldown: 10,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 1.2, maxTargets: 3 } },

  // PALADIN
  { id: "paladin_holy_smite", name: "Holy Smite",
    description: "Melee strike dealing weapon + holy damage",
    className: "paladin", levelRequired: 1, copperCost: 10, essenceCost: 18, cooldown: 5,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 1.3 } },
  { id: "paladin_divine_shield", name: "Divine Shield",
    description: "Grants 80% damage reduction for 6 seconds",
    className: "paladin", levelRequired: 3, copperCost: 30, essenceCost: 40, cooldown: 60,
    type: "buff", targetType: "self",
    effects: { statBonus: { def: 80 }, duration: 6 } },
  { id: "paladin_lay_on_hands", name: "Lay on Hands",
    description: "Self-heal restoring 50% max HP",
    className: "paladin", levelRequired: 6, copperCost: 60, essenceCost: 50, cooldown: 120,
    type: "healing", targetType: "self",
    effects: { healAmount: 50 } },
  { id: "paladin_consecration", name: "Consecration",
    description: "Holy ground deals damage over time to enemies standing in it",
    className: "paladin", levelRequired: 9, copperCost: 90, essenceCost: 35, cooldown: 25,
    type: "debuff", targetType: "area", animStyle: "area",
    effects: { dotDamage: 10, duration: 8, areaRadius: 5 } },
  { id: "paladin_blessing_of_might", name: "Blessing of Might",
    description: "Increases strength by 25% for 15 seconds",
    className: "paladin", levelRequired: 12, copperCost: 120, essenceCost: 25, cooldown: 30,
    type: "buff", targetType: "self",
    effects: { statBonus: { str: 25 }, duration: 15 } },

  // ROGUE
  { id: "rogue_backstab", name: "Backstab",
    description: "High damage strike, 200% damage from behind",
    className: "rogue", levelRequired: 1, copperCost: 10, essenceCost: 20, cooldown: 8,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 2.0 } },
  { id: "rogue_stealth", name: "Stealth",
    description: "Become invisible, lasts until first attack",
    className: "rogue", levelRequired: 3, copperCost: 30, essenceCost: 30, cooldown: 40,
    type: "buff", targetType: "self",
    effects: { duration: 30 } },
  { id: "rogue_poison_blade", name: "Poison Blade",
    description: "Apply poison dealing damage over 12 seconds",
    className: "rogue", levelRequired: 6, copperCost: 60, essenceCost: 25, cooldown: 15,
    type: "debuff", targetType: "enemy", animStyle: "melee",
    effects: { dotDamage: 15, duration: 12 } },
  { id: "rogue_evasion", name: "Evasion",
    description: "Increase dodge chance by 60% for 8 seconds",
    className: "rogue", levelRequired: 9, copperCost: 90, essenceCost: 35, cooldown: 50,
    type: "buff", targetType: "self",
    effects: { statBonus: { agi: 60 }, duration: 8 } },
  { id: "rogue_shadow_strike", name: "Shadow Strike",
    description: "Teleport behind target and strike for 180% damage",
    className: "rogue", levelRequired: 12, copperCost: 120, essenceCost: 40, cooldown: 20,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 1.8 } },

  // RANGER
  { id: "ranger_aimed_shot", name: "Aimed Shot",
    description: "Precise ranged attack dealing 160% damage",
    className: "ranger", levelRequired: 1, copperCost: 10, essenceCost: 15, cooldown: 6,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 1.6 } },
  { id: "ranger_hunters_mark", name: "Hunter's Mark",
    description: "Mark target to take 25% more damage for 15 seconds",
    className: "ranger", levelRequired: 3, copperCost: 30, essenceCost: 20, cooldown: 25,
    type: "debuff", targetType: "enemy", animStyle: "projectile",
    effects: { statReduction: { def: 25 }, duration: 15 } },
  { id: "ranger_quick_shot", name: "Quick Shot",
    description: "Rapid fire dealing 80% damage, instant cast",
    className: "ranger", levelRequired: 6, copperCost: 60, essenceCost: 10, cooldown: 3,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 0.8 } },
  { id: "ranger_natures_blessing", name: "Nature's Blessing",
    description: "Heal 30% HP over 10 seconds",
    className: "ranger", levelRequired: 9, copperCost: 90, essenceCost: 30, cooldown: 40,
    type: "healing", targetType: "self",
    effects: { healAmount: 30, duration: 10 } },
  { id: "ranger_multi_shot", name: "Multi-Shot",
    description: "Fire arrows at up to 4 targets for 100% damage each",
    className: "ranger", levelRequired: 12, copperCost: 120, essenceCost: 40, cooldown: 15,
    type: "attack", targetType: "area", animStyle: "projectile",
    effects: { damageMultiplier: 1.0, maxTargets: 4 } },

  // MAGE
  { id: "mage_fireball", name: "Fireball",
    description: "Ranged fire damage projectile",
    className: "mage", levelRequired: 1, copperCost: 10, essenceCost: 20, cooldown: 4,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 1.4 } },
  { id: "mage_frost_armor", name: "Frost Armor",
    description: "Increases defense by 30%, slows attackers",
    className: "mage", levelRequired: 3, copperCost: 30, essenceCost: 25, cooldown: 30,
    type: "buff", targetType: "self",
    effects: { statBonus: { def: 30 }, duration: 20 } },
  { id: "mage_arcane_missiles", name: "Arcane Missiles",
    description: "5 magic projectiles, each dealing damage",
    className: "mage", levelRequired: 6, copperCost: 60, essenceCost: 35, cooldown: 10,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 1.8 } },
  { id: "mage_slow", name: "Slow",
    description: "Reduces enemy agility by 50% for 10 seconds",
    className: "mage", levelRequired: 9, copperCost: 90, essenceCost: 30, cooldown: 20,
    type: "debuff", targetType: "enemy", animStyle: "projectile",
    effects: { statReduction: { agi: 50 }, duration: 10 } },
  { id: "mage_flamestrike", name: "Flamestrike",
    description: "Area spell hitting all enemies in radius",
    className: "mage", levelRequired: 12, copperCost: 120, essenceCost: 50, cooldown: 25,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 1.5, areaRadius: 8 } },

  // CLERIC
  { id: "cleric_holy_light", name: "Holy Light",
    description: "Heal target for 40% max HP",
    className: "cleric", levelRequired: 1, copperCost: 10, essenceCost: 25, cooldown: 5,
    type: "healing", targetType: "ally", animStyle: "projectile",
    effects: { healAmount: 40 } },
  { id: "cleric_divine_protection", name: "Divine Protection",
    description: "Shield absorbing 35% max HP damage",
    className: "cleric", levelRequired: 3, copperCost: 30, essenceCost: 30, cooldown: 25,
    type: "buff", targetType: "self",
    effects: { shield: 35, duration: 15 } },
  { id: "cleric_smite", name: "Smite",
    description: "Holy damage, extra effective vs undead",
    className: "cleric", levelRequired: 6, copperCost: 60, essenceCost: 20, cooldown: 6,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 1.3 } },
  { id: "cleric_renew", name: "Renew",
    description: "Heal 45% HP over 12 seconds",
    className: "cleric", levelRequired: 9, copperCost: 90, essenceCost: 35, cooldown: 15,
    type: "healing", targetType: "ally", animStyle: "projectile",
    effects: { healAmount: 45, duration: 12 } },
  { id: "cleric_prayer_of_fortitude", name: "Prayer of Fortitude",
    description: "Increases max HP by 20% for 20 seconds",
    className: "cleric", levelRequired: 12, copperCost: 120, essenceCost: 40, cooldown: 60,
    type: "buff", targetType: "self",
    effects: { statBonus: { hp: 20 }, duration: 20 } },

  // WARLOCK
  { id: "warlock_shadow_bolt", name: "Shadow Bolt",
    description: "Dark magic projectile",
    className: "warlock", levelRequired: 1, copperCost: 10, essenceCost: 18, cooldown: 4,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 1.35 } },
  { id: "warlock_curse_of_weakness", name: "Curse of Weakness",
    description: "Reduces enemy strength by 35% for 12 seconds",
    className: "warlock", levelRequired: 3, copperCost: 30, essenceCost: 25, cooldown: 18,
    type: "debuff", targetType: "enemy", animStyle: "projectile",
    effects: { statReduction: { str: 35 }, duration: 12 } },
  { id: "warlock_drain_life", name: "Drain Life",
    description: "Deal damage and heal self for 50% of damage dealt",
    className: "warlock", levelRequired: 6, copperCost: 60, essenceCost: 30, cooldown: 12,
    type: "attack", targetType: "enemy", animStyle: "channel",
    effects: { damageMultiplier: 1.2, healAmount: 50 } },
  { id: "warlock_soul_shield", name: "Soul Shield",
    description: "Absorb 40% max HP damage using essence",
    className: "warlock", levelRequired: 9, copperCost: 90, essenceCost: 45, cooldown: 35,
    type: "buff", targetType: "self",
    effects: { shield: 40, duration: 10 } },
  { id: "warlock_corruption", name: "Corruption",
    description: "Strong damage over time curse, lasts 15 seconds",
    className: "warlock", levelRequired: 12, copperCost: 120, essenceCost: 35, cooldown: 20,
    type: "debuff", targetType: "enemy", animStyle: "projectile",
    effects: { dotDamage: 20, duration: 15 } },

  // MONK
  { id: "monk_palm_strike", name: "Palm Strike",
    description: "Quick unarmed strike dealing 130% damage",
    className: "monk", levelRequired: 1, copperCost: 10, essenceCost: 12, cooldown: 4,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 1.3 } },
  { id: "monk_inner_focus", name: "Inner Focus",
    description: "Increases critical hit chance by 30% for 10 seconds",
    className: "monk", levelRequired: 3, copperCost: 30, essenceCost: 20, cooldown: 30,
    type: "buff", targetType: "self",
    effects: { statBonus: { luck: 30 }, duration: 10 } },
  { id: "monk_disable", name: "Disable",
    description: "Reduces enemy agility by 40% for 8 seconds",
    className: "monk", levelRequired: 6, copperCost: 60, essenceCost: 18, cooldown: 15,
    type: "debuff", targetType: "enemy", animStyle: "melee",
    effects: { statReduction: { agi: 40 }, duration: 8 } },
  { id: "monk_chi_burst", name: "Chi Burst",
    description: "Energy blast dealing 170% damage",
    className: "monk", levelRequired: 9, copperCost: 90, essenceCost: 30, cooldown: 10,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 1.7 } },
  { id: "monk_meditation", name: "Meditation",
    description: "Channel to heal 60% HP over 6 seconds",
    className: "monk", levelRequired: 12, copperCost: 120, essenceCost: 0, cooldown: 45,
    type: "healing", targetType: "self", animStyle: "channel",
    effects: { healAmount: 60, duration: 6 } },

  // ═══════════════════════════════════════════════════════════════════
  // MID-LEVEL TECHNIQUES — Rank upgrades (R2/R3) + new abilities
  // ═══════════════════════════════════════════════════════════════════

  // ── WARRIOR R2/R3 + NEW ──
  { id: "warrior_heroic_strike_r2", name: "Heroic Strike R2",
    description: "Powerful melee strike dealing 210% weapon damage",
    className: "warrior", levelRequired: 14, copperCost: 300, essenceCost: 20, cooldown: 5,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 2.1, lunge: 8 } },
  { id: "warrior_battle_rage_r2", name: "Battle Rage R2",
    description: "Increases strength by 60% for 15 seconds",
    className: "warrior", levelRequired: 18, copperCost: 400, essenceCost: 35, cooldown: 40,
    type: "buff", targetType: "self",
    effects: { statBonus: { str: 60 }, duration: 15 } },
  { id: "warrior_cleave_r2", name: "Cleave R2",
    description: "Sweeping attack dealing 170% damage to up to 5 targets",
    className: "warrior", levelRequired: 20, copperCost: 450, essenceCost: 40, cooldown: 8,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 1.7, maxTargets: 5, knockback: 8 } },
  { id: "warrior_heroic_strike_r3", name: "Heroic Strike R3",
    description: "Devastating melee strike dealing 280% weapon damage",
    className: "warrior", levelRequired: 24, copperCost: 900, essenceCost: 25, cooldown: 5,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 2.8, knockback: 12, lunge: 10 } },
  { id: "warrior_rallying_cry", name: "Rallying Cry",
    description: "War cry granting +35% DEF for 12s and healing 15% HP",
    className: "warrior", levelRequired: 16, copperCost: 450, essenceCost: 30, cooldown: 35,
    type: "buff", targetType: "self",
    effects: { statBonus: { def: 35 }, duration: 12, healAmount: 15 } },
  { id: "warrior_rending_strike", name: "Rending Strike",
    description: "Strike for 140% damage and apply 18 damage DoT over 10s",
    className: "warrior", levelRequired: 22, copperCost: 500, essenceCost: 35, cooldown: 14,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 1.4, dotDamage: 18, duration: 10, lunge: 10 } },

  // ── PALADIN R2/R3 + NEW ──
  { id: "paladin_holy_smite_r2", name: "Holy Smite R2",
    description: "Holy melee strike dealing 185% weapon + holy damage",
    className: "paladin", levelRequired: 14, copperCost: 300, essenceCost: 22, cooldown: 4,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 1.85 } },
  { id: "paladin_consecration_r2", name: "Consecration R2",
    description: "Holy ground dealing 15 damage/tick over 10s in radius 7",
    className: "paladin", levelRequired: 18, copperCost: 400, essenceCost: 40, cooldown: 22,
    type: "debuff", targetType: "area", animStyle: "area",
    effects: { dotDamage: 15, duration: 10, areaRadius: 7 } },
  { id: "paladin_lay_on_hands_r2", name: "Lay on Hands R2",
    description: "Powerful self-heal restoring 75% max HP",
    className: "paladin", levelRequired: 20, copperCost: 500, essenceCost: 55, cooldown: 100,
    type: "healing", targetType: "self",
    effects: { healAmount: 75 } },
  { id: "paladin_holy_smite_r3", name: "Holy Smite R3",
    description: "Holy strike dealing 240% damage + 8 DoT over 6s",
    className: "paladin", levelRequired: 24, copperCost: 900, essenceCost: 28, cooldown: 4,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 2.4, dotDamage: 8, duration: 6, knockback: 8 } },
  { id: "paladin_judgment", name: "Judgment",
    description: "Ranged holy projectile dealing 160% damage and reducing target STR by 20% for 8s",
    className: "paladin", levelRequired: 16, copperCost: 450, essenceCost: 30, cooldown: 12,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 1.6, statReduction: { str: 20 }, duration: 8, knockback: 10 } },
  { id: "paladin_aura_of_resolve", name: "Aura of Resolve",
    description: "Shield absorbing 30% max HP + 25% DEF boost for 15s",
    className: "paladin", levelRequired: 22, copperCost: 550, essenceCost: 40, cooldown: 45,
    type: "buff", targetType: "self",
    effects: { shield: 30, statBonus: { def: 25 }, duration: 15 } },

  // ── ROGUE R2/R3 + NEW ──
  { id: "rogue_backstab_r2", name: "Backstab R2",
    description: "Devastating backstab dealing 280% damage",
    className: "rogue", levelRequired: 14, copperCost: 300, essenceCost: 25, cooldown: 7,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 2.8, lunge: 12 } },
  { id: "rogue_poison_blade_r2", name: "Poison Blade R2",
    description: "Enhanced poison dealing 22 damage over 15 seconds",
    className: "rogue", levelRequired: 18, copperCost: 400, essenceCost: 30, cooldown: 13,
    type: "debuff", targetType: "enemy", animStyle: "melee",
    effects: { dotDamage: 22, duration: 15 } },
  { id: "rogue_shadow_strike_r2", name: "Shadow Strike R2",
    description: "Teleport behind target and strike for 260% damage",
    className: "rogue", levelRequired: 20, copperCost: 450, essenceCost: 45, cooldown: 18,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 2.6, lunge: 16 } },
  { id: "rogue_backstab_r3", name: "Backstab R3",
    description: "Lethal backstab dealing 370% damage",
    className: "rogue", levelRequired: 24, copperCost: 950, essenceCost: 30, cooldown: 7,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 3.7, lunge: 14 } },
  { id: "rogue_smoke_bomb", name: "Smoke Bomb",
    description: "Cloud reducing enemy AGI by 45% in radius 6 for 10s",
    className: "rogue", levelRequired: 16, copperCost: 400, essenceCost: 28, cooldown: 25,
    type: "debuff", targetType: "area", animStyle: "area",
    effects: { statReduction: { agi: 45 }, duration: 10, areaRadius: 6 } },
  { id: "rogue_blade_flurry", name: "Blade Flurry",
    description: "Rapid slashes hitting up to 3 targets for 150% damage",
    className: "rogue", levelRequired: 22, copperCost: 500, essenceCost: 40, cooldown: 16,
    type: "attack", targetType: "area", animStyle: "melee",
    effects: { damageMultiplier: 1.5, maxTargets: 3, lunge: 8 } },

  // ── RANGER R2/R3 + NEW ──
  { id: "ranger_aimed_shot_r2", name: "Aimed Shot R2",
    description: "Precise ranged attack dealing 225% damage",
    className: "ranger", levelRequired: 14, copperCost: 300, essenceCost: 20, cooldown: 5,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 2.25 } },
  { id: "ranger_multi_shot_r2", name: "Multi-Shot R2",
    description: "Fire arrows at up to 6 targets for 140% damage each",
    className: "ranger", levelRequired: 18, copperCost: 400, essenceCost: 45, cooldown: 13,
    type: "attack", targetType: "area", animStyle: "projectile",
    effects: { damageMultiplier: 1.4, maxTargets: 6 } },
  { id: "ranger_hunters_mark_r2", name: "Hunter's Mark R2",
    description: "Mark target reducing DEF by 38% for 20 seconds",
    className: "ranger", levelRequired: 20, copperCost: 450, essenceCost: 25, cooldown: 22,
    type: "debuff", targetType: "enemy", animStyle: "projectile",
    effects: { statReduction: { def: 38 }, duration: 20 } },
  { id: "ranger_aimed_shot_r3", name: "Aimed Shot R3",
    description: "Master ranged attack dealing 295% damage",
    className: "ranger", levelRequired: 24, copperCost: 900, essenceCost: 25, cooldown: 5,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 2.95, knockback: 14 } },
  { id: "ranger_entangling_roots", name: "Entangling Roots",
    description: "Roots reducing AGI by 60% and dealing 12 DoT over 8s",
    className: "ranger", levelRequired: 16, copperCost: 450, essenceCost: 30, cooldown: 22,
    type: "debuff", targetType: "enemy", animStyle: "projectile",
    effects: { statReduction: { agi: 60 }, dotDamage: 12, duration: 8 } },
  { id: "ranger_volley", name: "Volley",
    description: "Rain of arrows dealing 120% damage in radius 10 to 8 targets",
    className: "ranger", levelRequired: 22, copperCost: 550, essenceCost: 45, cooldown: 18,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 1.2, areaRadius: 10, maxTargets: 8, knockback: 6 } },

  // ── MAGE R2/R3 + NEW ──
  { id: "mage_fireball_r2", name: "Fireball R2",
    description: "Enhanced fire projectile dealing 200% damage",
    className: "mage", levelRequired: 14, copperCost: 300, essenceCost: 25, cooldown: 3.5,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 2.0 } },
  { id: "mage_arcane_missiles_r2", name: "Arcane Missiles R2",
    description: "Upgraded arcane barrage dealing 260% damage",
    className: "mage", levelRequired: 18, copperCost: 400, essenceCost: 40, cooldown: 8,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 2.6 } },
  { id: "mage_flamestrike_r2", name: "Flamestrike R2",
    description: "Powerful area spell dealing 215% damage in radius 10",
    className: "mage", levelRequired: 20, copperCost: 500, essenceCost: 55, cooldown: 22,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 2.15, areaRadius: 10 } },
  { id: "mage_fireball_r3", name: "Fireball R3",
    description: "Master fireball dealing 260% damage + 12 DoT over 6s",
    className: "mage", levelRequired: 24, copperCost: 900, essenceCost: 30, cooldown: 3.5,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 2.6, dotDamage: 12, duration: 6, knockback: 10 } },
  { id: "mage_frost_nova", name: "Frost Nova",
    description: "AoE freeze reducing AGI by 55% in radius 7 for 8s",
    className: "mage", levelRequired: 16, copperCost: 400, essenceCost: 35, cooldown: 20,
    type: "debuff", targetType: "area", animStyle: "area",
    effects: { statReduction: { agi: 55 }, duration: 8, areaRadius: 7, knockback: 8 } },
  { id: "mage_mana_shield", name: "Mana Shield",
    description: "Arcane shield absorbing 45% max HP for 12s",
    className: "mage", levelRequired: 22, copperCost: 500, essenceCost: 50, cooldown: 40,
    type: "buff", targetType: "self",
    effects: { shield: 45, duration: 12 } },

  // ── CLERIC R2/R3 + NEW ──
  { id: "cleric_holy_light_r2", name: "Holy Light R2",
    description: "Heal target for 58% max HP",
    className: "cleric", levelRequired: 14, copperCost: 300, essenceCost: 30, cooldown: 4,
    type: "healing", targetType: "ally", animStyle: "projectile",
    effects: { healAmount: 58 } },
  { id: "cleric_renew_r2", name: "Renew R2",
    description: "Heal 65% HP over 14 seconds",
    className: "cleric", levelRequired: 18, copperCost: 400, essenceCost: 40, cooldown: 13,
    type: "healing", targetType: "ally", animStyle: "projectile",
    effects: { healAmount: 65, duration: 14 } },
  { id: "cleric_divine_protection_r2", name: "Divine Protection R2",
    description: "Shield absorbing 50% max HP for 18s",
    className: "cleric", levelRequired: 20, copperCost: 450, essenceCost: 35, cooldown: 22,
    type: "buff", targetType: "self",
    effects: { shield: 50, duration: 18 } },
  { id: "cleric_holy_light_r3", name: "Holy Light R3",
    description: "Powerful heal restoring 75% max HP",
    className: "cleric", levelRequired: 24, copperCost: 900, essenceCost: 35, cooldown: 4,
    type: "healing", targetType: "ally", animStyle: "projectile",
    effects: { healAmount: 75 } },
  { id: "cleric_holy_nova", name: "Holy Nova",
    description: "AoE burst dealing 120% damage to 4 targets in radius 6 + 25% self-heal",
    className: "cleric", levelRequired: 16, copperCost: 450, essenceCost: 40, cooldown: 18,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 1.2, maxTargets: 4, areaRadius: 6, healAmount: 25, knockback: 10 } },
  { id: "cleric_spirit_of_redemption", name: "Spirit of Redemption",
    description: "Emergency self-sustain: 40% HoT over 8s + 40% DEF",
    className: "cleric", levelRequired: 22, copperCost: 500, essenceCost: 45, cooldown: 50,
    type: "buff", targetType: "self",
    effects: { healAmount: 40, duration: 8, statBonus: { def: 40 } } },

  // ── WARLOCK R2/R3 + NEW ──
  { id: "warlock_shadow_bolt_r2", name: "Shadow Bolt R2",
    description: "Enhanced dark magic projectile dealing 190% damage",
    className: "warlock", levelRequired: 14, copperCost: 300, essenceCost: 22, cooldown: 3.5,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 1.9 } },
  { id: "warlock_corruption_r2", name: "Corruption R2",
    description: "Powerful curse dealing 28 damage over 18 seconds",
    className: "warlock", levelRequired: 18, copperCost: 400, essenceCost: 40, cooldown: 18,
    type: "debuff", targetType: "enemy", animStyle: "projectile",
    effects: { dotDamage: 28, duration: 18 } },
  { id: "warlock_drain_life_r2", name: "Drain Life R2",
    description: "Deal 170% damage and heal self for 60% of damage dealt",
    className: "warlock", levelRequired: 20, copperCost: 450, essenceCost: 35, cooldown: 10,
    type: "attack", targetType: "enemy", animStyle: "channel",
    effects: { damageMultiplier: 1.7, healAmount: 60 } },
  { id: "warlock_shadow_bolt_r3", name: "Shadow Bolt R3",
    description: "Master shadow bolt dealing 250% damage + -15% DEF for 6s",
    className: "warlock", levelRequired: 24, copperCost: 900, essenceCost: 28, cooldown: 3.5,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 2.5, statReduction: { def: 15 }, duration: 6, knockback: 8 } },
  { id: "warlock_howl_of_terror", name: "Howl of Terror",
    description: "AoE howl reducing STR and AGI by 30% in radius 7 for 10s",
    className: "warlock", levelRequired: 16, copperCost: 450, essenceCost: 35, cooldown: 25,
    type: "debuff", targetType: "area", animStyle: "area",
    effects: { statReduction: { str: 30, agi: 30 }, duration: 10, areaRadius: 7, knockback: 12 } },
  { id: "warlock_siphon_soul", name: "Siphon Soul",
    description: "Deal 150% damage and heal self for 35% max HP",
    className: "warlock", levelRequired: 22, copperCost: 550, essenceCost: 45, cooldown: 20,
    type: "attack", targetType: "enemy", animStyle: "channel",
    effects: { damageMultiplier: 1.5, healAmount: 35 } },

  // ── MONK R2/R3 + NEW ──
  { id: "monk_palm_strike_r2", name: "Palm Strike R2",
    description: "Enhanced unarmed strike dealing 185% damage",
    className: "monk", levelRequired: 14, copperCost: 300, essenceCost: 15, cooldown: 3.5,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 1.85, lunge: 6 } },
  { id: "monk_chi_burst_r2", name: "Chi Burst R2",
    description: "Powerful energy blast dealing 245% damage",
    className: "monk", levelRequired: 18, copperCost: 400, essenceCost: 35, cooldown: 8,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 2.45 } },
  { id: "monk_meditation_r2", name: "Meditation R2",
    description: "Deep channel healing 85% HP over 6 seconds",
    className: "monk", levelRequired: 20, copperCost: 450, essenceCost: 0, cooldown: 40,
    type: "healing", targetType: "self", animStyle: "channel",
    effects: { healAmount: 85, duration: 6 } },
  { id: "monk_chi_burst_r3", name: "Chi Burst R3",
    description: "Master energy blast dealing 310% damage",
    className: "monk", levelRequired: 24, copperCost: 950, essenceCost: 40, cooldown: 8,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 3.1, knockback: 10 } },
  { id: "monk_flying_kick", name: "Flying Kick",
    description: "Gap-closing kick dealing 160% damage and reducing AGI by 35% for 6s",
    className: "monk", levelRequired: 16, copperCost: 400, essenceCost: 22, cooldown: 14,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 1.6, statReduction: { agi: 35 }, duration: 6, lunge: 18, knockback: 14 } },
  { id: "monk_whirlwind_kick", name: "Whirlwind Kick",
    description: "Spinning kick hitting up to 4 targets for 140% damage",
    className: "monk", levelRequired: 22, copperCost: 500, essenceCost: 35, cooldown: 14,
    type: "attack", targetType: "area", animStyle: "melee",
    effects: { damageMultiplier: 1.4, maxTargets: 4, knockback: 10 } },
];

// Fallback lookup for dynamically generated techniques (e.g. essence techniques)
let fallbackLookup: ((id: string) => TechniqueDefinition | undefined) | null = null;

/**
 * Register a fallback lookup function for techniques not in the static catalog.
 * Used by essenceTechniqueGenerator to make procedural techniques work with combat.
 */
export function registerTechniqueFallbackLookup(
  fn: (id: string) => TechniqueDefinition | undefined,
): void {
  fallbackLookup = fn;
}

export function getTechniqueById(id: string): TechniqueDefinition | undefined {
  return TECHNIQUES.find((t) => t.id === id) ?? fallbackLookup?.(id);
}

export function getTechniquesByClass(className: string): TechniqueDefinition[] {
  return TECHNIQUES.filter((t) => t.className === className);
}

export function getLearnedTechniques(className: string, level: number): TechniqueDefinition[] {
  return TECHNIQUES.filter((t) => t.className === className && t.levelRequired <= level);
}

/**
 * For a ranked technique ID (e.g. "warrior_heroic_strike_r2"),
 * returns the ID of the previous rank that must already be known.
 * Returns null for base (R1) techniques or non-ranked abilities.
 */
export function getRequiredPreviousRank(techniqueId: string): string | null {
  const r3Match = techniqueId.match(/^(.+)_r3$/);
  if (r3Match) return `${r3Match[1]}_r2`;

  const r2Match = techniqueId.match(/^(.+)_r2$/);
  if (r2Match) return r2Match[1]; // base rank (R1)

  return null;
}

/**
 * For a ranked technique ID, returns the ID of the previous rank
 * that should be removed from learnedTechniques when upgrading.
 * Same as getRequiredPreviousRank — the rank being replaced.
 */
export function getPreviousRankId(techniqueId: string): string | null {
  return getRequiredPreviousRank(techniqueId);
}
