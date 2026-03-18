export type TechniqueType = "attack" | "buff" | "debuff" | "healing";
export type TargetType = "self" | "enemy" | "ally" | "area" | "party";

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

  // ═══════════════════════════════════════════════════════════════════
  // HIGH-LEVEL TECHNIQUES — L30-40 (Moondancer Glade / Felsrock Citadel / Lake Lumina)
  // Gap closers, stuns, invulnerability, and absolute madness
  // ═══════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════
  // MOONDANCER GLADE (L30) — R4 upgrades + 1 new ability per class
  // ══════════════════════════════════════════════════════════════

  // ── WARRIOR L30 ──
  { id: "warrior_heroic_strike_r4", name: "Heroic Strike R4",
    description: "Earth-shattering strike dealing 370% damage, lunging forward and sending the target flying",
    className: "warrior", levelRequired: 30, copperCost: 1800, essenceCost: 30, cooldown: 4,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 3.7, knockback: 16, lunge: 14 } },
  { id: "warrior_titans_charge", name: "Titan's Charge",
    description: "Hurtle across the battlefield and slam into the target, dealing 220% damage and crippling their agility by 90% for 6s",
    className: "warrior", levelRequired: 30, copperCost: 2200, essenceCost: 50, cooldown: 25,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 2.2, lunge: 28, knockback: 18, statReduction: { agi: 90 }, duration: 6 } },

  // ── PALADIN L30 ──
  { id: "paladin_holy_smite_r4", name: "Holy Smite R4",
    description: "Divine wrath dealing 320% damage with holy fire DoT burning 18 damage over 8s",
    className: "paladin", levelRequired: 30, copperCost: 1800, essenceCost: 32, cooldown: 3.5,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 3.2, dotDamage: 18, duration: 8, knockback: 14 } },
  { id: "paladin_divine_bulwark", name: "Divine Bulwark",
    description: "Become an immovable fortress — absorb shield equal to 100% max HP and +100% DEF for 8s. NOTHING gets through.",
    className: "paladin", levelRequired: 30, copperCost: 2500, essenceCost: 60, cooldown: 90,
    type: "buff", targetType: "self",
    effects: { shield: 100, statBonus: { def: 100 }, duration: 8 } },

  // ── ROGUE L30 ──
  { id: "rogue_backstab_r4", name: "Backstab R4",
    description: "Lethal precision strike dealing a devastating 480% damage with a vicious lunge",
    className: "rogue", levelRequired: 30, copperCost: 1900, essenceCost: 35, cooldown: 6,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 4.8, lunge: 18 } },
  { id: "rogue_shadowstep_ambush", name: "Shadowstep Ambush",
    description: "Teleport through the shadows to your target, striking for 260% damage and crippling them — -70% AGI for 8s",
    className: "rogue", levelRequired: 30, copperCost: 2200, essenceCost: 50, cooldown: 22,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 2.6, lunge: 32, statReduction: { agi: 70 }, duration: 8 } },

  // ── RANGER L30 ──
  { id: "ranger_aimed_shot_r4", name: "Aimed Shot R4",
    description: "Master marksman's shot dealing 385% damage with devastating knockback",
    className: "ranger", levelRequired: 30, copperCost: 1800, essenceCost: 30, cooldown: 4.5,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 3.85, knockback: 20 } },
  { id: "ranger_sky_piercer", name: "Sky Piercer",
    description: "Channel the heavens into a single arrow — 300% damage and shred -55% DEF for 12s",
    className: "ranger", levelRequired: 30, copperCost: 2200, essenceCost: 45, cooldown: 20,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 3.0, statReduction: { def: 55 }, duration: 12 } },

  // ── MAGE L30 ──
  { id: "mage_fireball_r4", name: "Fireball R4",
    description: "Inferno-class fireball dealing 340% damage, setting the target ablaze for 20 DoT over 8s",
    className: "mage", levelRequired: 30, copperCost: 1800, essenceCost: 35, cooldown: 3,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 3.4, dotDamage: 20, duration: 8, knockback: 14 } },
  { id: "mage_glacial_prison", name: "Glacial Prison",
    description: "Encase all enemies in ice — AoE radius 10, -95% AGI and -60% STR for 10s. They're NOT moving.",
    className: "mage", levelRequired: 30, copperCost: 2400, essenceCost: 55, cooldown: 35,
    type: "debuff", targetType: "area", animStyle: "area",
    effects: { statReduction: { agi: 95, str: 60 }, duration: 10, areaRadius: 10 } },

  // ── CLERIC L30 ──
  { id: "cleric_holy_light_r4", name: "Holy Light R4",
    description: "Blinding divine radiance restoring 92% max HP in an instant",
    className: "cleric", levelRequired: 30, copperCost: 1800, essenceCost: 40, cooldown: 3.5,
    type: "healing", targetType: "ally", animStyle: "projectile",
    effects: { healAmount: 92 } },
  { id: "cleric_guardian_angel", name: "Guardian Angel",
    description: "Summon a guardian angel — shield absorbing 80% max HP + 55% DEF boost for 15s",
    className: "cleric", levelRequired: 30, copperCost: 2400, essenceCost: 55, cooldown: 50,
    type: "buff", targetType: "self",
    effects: { shield: 80, statBonus: { def: 55 }, duration: 15 } },

  // ── WARLOCK L30 ──
  { id: "warlock_shadow_bolt_r4", name: "Shadow Bolt R4",
    description: "Abyssal bolt dealing 330% damage, corroding -30% DEF for 8s",
    className: "warlock", levelRequired: 30, copperCost: 1800, essenceCost: 32, cooldown: 3,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 3.3, statReduction: { def: 30 }, duration: 8, knockback: 12 } },
  { id: "warlock_demonic_grasp", name: "Demonic Grasp",
    description: "Dark tendrils seize the target — 200% damage, 35 DoT over 12s, and -50% AGI. There is no escape.",
    className: "warlock", levelRequired: 30, copperCost: 2300, essenceCost: 55, cooldown: 28,
    type: "attack", targetType: "enemy", animStyle: "channel",
    effects: { damageMultiplier: 2.0, dotDamage: 35, duration: 12, statReduction: { agi: 50 } } },

  // ── MONK L30 ──
  { id: "monk_chi_burst_r4", name: "Chi Burst R4",
    description: "Concentrated ki explosion dealing 410% damage with devastating knockback",
    className: "monk", levelRequired: 30, copperCost: 1900, essenceCost: 45, cooldown: 7,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 4.1, knockback: 16 } },
  { id: "monk_hundred_fists", name: "Hundred Fists",
    description: "Unleash a flurry of 100 rapid punches — lunge 22 units, 360% damage, shred -55% DEF for 8s",
    className: "monk", levelRequired: 30, copperCost: 2200, essenceCost: 50, cooldown: 22,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 3.6, lunge: 22, statReduction: { def: 55 }, duration: 8 } },

  // ══════════════════════════════════════════════════════════════
  // FELSROCK CITADEL (L35) — 2 new abilities per class
  // These are the turning point — fights get REAL
  // ══════════════════════════════════════════════════════════════

  // ── WARRIOR L35 ──
  { id: "warrior_earthquake_slam", name: "Earthquake Slam",
    description: "Slam the ground so hard the earth splits — AoE radius 12, 240% damage to 6 targets, -100% AGI for 6s (STUNNED), knockback 20",
    className: "warrior", levelRequired: 35, copperCost: 3200, essenceCost: 60, cooldown: 35,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 2.4, maxTargets: 6, areaRadius: 12, statReduction: { agi: 100 }, duration: 6, knockback: 20 } },
  { id: "warrior_undying_rage", name: "Undying Rage",
    description: "Enter an unstoppable berserker state — +85% STR, shield absorbing 65% max HP for 15s. CANNOT. BE. STOPPED.",
    className: "warrior", levelRequired: 35, copperCost: 3500, essenceCost: 55, cooldown: 60,
    type: "buff", targetType: "self",
    effects: { statBonus: { str: 85 }, shield: 65, duration: 15 } },

  // ── PALADIN L35 ──
  { id: "paladin_hammer_of_justice", name: "Hammer of Justice",
    description: "Hurl a divine hammer — 200% damage, -95% AGI and -95% STR for 6s. Target is COMPLETELY locked down.",
    className: "paladin", levelRequired: 35, copperCost: 3000, essenceCost: 55, cooldown: 30,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 2.0, statReduction: { agi: 95, str: 95 }, duration: 6, knockback: 16 } },
  { id: "paladin_wings_of_valor", name: "Wings of Valor",
    description: "Manifest golden wings — shield 120% max HP, +70% DEF, +45% STR for 10s. You ARE the raid boss now.",
    className: "paladin", levelRequired: 35, copperCost: 3800, essenceCost: 70, cooldown: 75,
    type: "buff", targetType: "self",
    effects: { shield: 120, statBonus: { def: 70, str: 45 }, duration: 10 } },

  // ── ROGUE L35 ──
  { id: "rogue_death_mark", name: "Death Mark",
    description: "Mark the target for death — lunge 24, 420% damage, poison DoT 40 over 10s. They're already dead.",
    className: "rogue", levelRequired: 35, copperCost: 3200, essenceCost: 55, cooldown: 25,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 4.2, lunge: 24, dotDamage: 40, duration: 10 } },
  { id: "rogue_phantom_strike", name: "Phantom Strike",
    description: "Phase through reality to reach your target — lunge 38 units(!), 320% damage, -75% DEF for 8s",
    className: "rogue", levelRequired: 35, copperCost: 3500, essenceCost: 60, cooldown: 30,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 3.2, lunge: 38, statReduction: { def: 75 }, duration: 8 } },

  // ── RANGER L35 ──
  { id: "ranger_storm_of_arrows", name: "Storm of Arrows",
    description: "Darken the sky with arrows — AoE radius 14, 220% damage to 10 targets, knockback 14",
    className: "ranger", levelRequired: 35, copperCost: 3200, essenceCost: 55, cooldown: 28,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 2.2, areaRadius: 14, maxTargets: 10, knockback: 14 } },
  { id: "ranger_falcon_dive", name: "Falcon Dive",
    description: "Dive from the sky like a bird of prey — lunge 30, 270% damage, knockback 18. The ultimate gap closer.",
    className: "ranger", levelRequired: 35, copperCost: 3000, essenceCost: 50, cooldown: 22,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 2.7, lunge: 30, knockback: 18 } },

  // ── MAGE L35 ──
  { id: "mage_meteor_strike", name: "Meteor Strike",
    description: "Call down a METEOR — AoE radius 15, 320% damage to 8 targets, 22 DoT over 6s, knockback 22",
    className: "mage", levelRequired: 35, copperCost: 3800, essenceCost: 65, cooldown: 40,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 3.2, areaRadius: 15, maxTargets: 8, dotDamage: 22, duration: 6, knockback: 22 } },
  { id: "mage_time_warp", name: "Time Warp",
    description: "Bend time itself — +100% AGI and +65% INT for 12s. Everything moves in slow motion except you.",
    className: "mage", levelRequired: 35, copperCost: 3000, essenceCost: 50, cooldown: 55,
    type: "buff", targetType: "self",
    effects: { statBonus: { agi: 100, int: 65 }, duration: 12 } },

  // ── CLERIC L35 ──
  { id: "cleric_divine_hymn", name: "Divine Hymn",
    description: "Sing the song of creation — full 100% HP heal + shield absorbing 45% max HP for 20s",
    className: "cleric", levelRequired: 35, copperCost: 3500, essenceCost: 60, cooldown: 60,
    type: "buff", targetType: "self",
    effects: { healAmount: 100, shield: 45, duration: 20 } },
  { id: "cleric_wrath_of_heaven", name: "Wrath of Heaven",
    description: "Call down divine judgment — AoE 10, 220% damage to 6 targets, heal self 35%, knockback 16",
    className: "cleric", levelRequired: 35, copperCost: 3200, essenceCost: 55, cooldown: 30,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 2.2, maxTargets: 6, areaRadius: 10, healAmount: 35, knockback: 16 } },

  // ── WARLOCK L35 ──
  { id: "warlock_soul_rend", name: "Soul Rend",
    description: "Rip the souls from nearby enemies — AoE 8, 270% damage to 5 targets, heal 45% of damage dealt",
    className: "warlock", levelRequired: 35, copperCost: 3200, essenceCost: 55, cooldown: 28,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 2.7, maxTargets: 5, areaRadius: 8, healAmount: 45 } },
  { id: "warlock_nether_gate", name: "Nether Gate",
    description: "Open a portal beneath your target — lunge 28, 200% damage, -85% STR and -85% AGI for 8s. Welcome to the void.",
    className: "warlock", levelRequired: 35, copperCost: 3500, essenceCost: 60, cooldown: 32,
    type: "attack", targetType: "enemy", animStyle: "channel",
    effects: { damageMultiplier: 2.0, lunge: 28, statReduction: { str: 85, agi: 85 }, duration: 8 } },

  // ── MONK L35 ──
  { id: "monk_dragon_strike", name: "Dragon Strike",
    description: "Channel the spirit of the dragon — 520% damage, lunge 24, knockback 20. One punch is all you need.",
    className: "monk", levelRequired: 35, copperCost: 3500, essenceCost: 55, cooldown: 25,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 5.2, lunge: 24, knockback: 20 } },
  { id: "monk_inner_peace", name: "Inner Peace",
    description: "Achieve transcendence — shield 85% max HP, heal 65%, +55% DEF for 10s. Untouchable serenity.",
    className: "monk", levelRequired: 35, copperCost: 3200, essenceCost: 50, cooldown: 55,
    type: "buff", targetType: "self",
    effects: { shield: 85, healAmount: 65, statBonus: { def: 55 }, duration: 10 } },

  // ══════════════════════════════════════════════════════════════
  // LAKE LUMINA (L40) — ULTIMATE ABILITIES
  // The absolute pinnacle. These define endgame.
  // ══════════════════════════════════════════════════════════════

  // ── WARRIOR L40 ──
  { id: "warrior_colossus_smash", name: "Colossus Smash",
    description: "Strike with the force of a god — 620% damage, lunge 22, obliterate -100% DEF for 10s, knockback 25. Armor is a suggestion.",
    className: "warrior", levelRequired: 40, copperCost: 5000, essenceCost: 70, cooldown: 35,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 6.2, lunge: 22, statReduction: { def: 100 }, duration: 10, knockback: 25 } },
  { id: "warrior_avatar_of_war", name: "Avatar of War",
    description: "Become War incarnate — +100% STR, +100% DEF, shield 85% max HP for 12s. You ARE the final boss.",
    className: "warrior", levelRequired: 40, copperCost: 5500, essenceCost: 75, cooldown: 90,
    type: "buff", targetType: "self",
    effects: { statBonus: { str: 100, def: 100 }, shield: 85, duration: 12 } },

  // ── PALADIN L40 ──
  { id: "paladin_wrath_of_the_righteous", name: "Wrath of the Righteous",
    description: "Unleash divine apocalypse — AoE 12, 420% damage to 8 targets, knockback 22, +55% DEF self for 10s",
    className: "paladin", levelRequired: 40, copperCost: 5500, essenceCost: 70, cooldown: 45,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 4.2, maxTargets: 8, areaRadius: 12, knockback: 22 } },
  { id: "paladin_hand_of_god", name: "Hand of God",
    description: "God reaches down and says NO — shield 150% max HP, +100% DEF, heal 60%, 10s. ABSOLUTE INVULNERABILITY.",
    className: "paladin", levelRequired: 40, copperCost: 6000, essenceCost: 80, cooldown: 120,
    type: "buff", targetType: "self",
    effects: { shield: 150, statBonus: { def: 100 }, healAmount: 60, duration: 10 } },

  // ── ROGUE L40 ──
  { id: "rogue_deathblow", name: "Deathblow",
    description: "The killing blow — lunge 30, 720% damage. The single hardest-hitting rogue ability in existence.",
    className: "rogue", levelRequired: 40, copperCost: 5500, essenceCost: 70, cooldown: 30,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 7.2, lunge: 30 } },
  { id: "rogue_living_shadow", name: "Living Shadow",
    description: "Become one with shadow — lunge 42, 420% damage, -100% AGI and -100% STR for 8s, DoT 45 over 10s. Total annihilation.",
    className: "rogue", levelRequired: 40, copperCost: 5500, essenceCost: 75, cooldown: 45,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 4.2, lunge: 42, statReduction: { agi: 100, str: 100 }, duration: 8, dotDamage: 45 } },

  // ── RANGER L40 ──
  { id: "ranger_arrow_of_judgment", name: "Arrow of Judgment",
    description: "A single arrow that decides fate — 560% damage, -85% DEF for 15s, knockback 28",
    className: "ranger", levelRequired: 40, copperCost: 5000, essenceCost: 65, cooldown: 30,
    type: "attack", targetType: "enemy", animStyle: "projectile",
    effects: { damageMultiplier: 5.6, statReduction: { def: 85 }, duration: 15, knockback: 28 } },
  { id: "ranger_heavens_volley", name: "Heaven's Volley",
    description: "Blot out the sun — AoE radius 20, 260% damage to 12 targets, knockback 20. The sky falls.",
    className: "ranger", levelRequired: 40, copperCost: 5500, essenceCost: 70, cooldown: 40,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 2.6, areaRadius: 20, maxTargets: 12, knockback: 20 } },

  // ── MAGE L40 ──
  { id: "mage_arcane_cataclysm", name: "Arcane Cataclysm",
    description: "Tear reality apart — AoE radius 20, 370% damage to 10 targets, 28 DoT over 8s, knockback 25. Everything dies.",
    className: "mage", levelRequired: 40, copperCost: 5500, essenceCost: 75, cooldown: 50,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 3.7, areaRadius: 20, maxTargets: 10, dotDamage: 28, duration: 8, knockback: 25 } },
  { id: "mage_absolute_zero", name: "Absolute Zero",
    description: "Freeze the world — AoE 12, -100% AGI, -100% STR, -80% DEF for 8s. Time stops for your enemies.",
    className: "mage", levelRequired: 40, copperCost: 5000, essenceCost: 70, cooldown: 55,
    type: "debuff", targetType: "area", animStyle: "area",
    effects: { statReduction: { agi: 100, str: 100, def: 80 }, duration: 8, areaRadius: 12 } },

  // ── CLERIC L40 ──
  { id: "cleric_divine_intervention", name: "Divine Intervention",
    description: "The divine refuses to let you die — heal 100% HP, shield 100% max HP, +100% DEF for 15s. Immortality.",
    className: "cleric", levelRequired: 40, copperCost: 5500, essenceCost: 75, cooldown: 90,
    type: "buff", targetType: "self",
    effects: { healAmount: 100, shield: 100, statBonus: { def: 100 }, duration: 15 } },
  { id: "cleric_wrath_of_the_divine", name: "Wrath of the Divine",
    description: "Heaven's fury made manifest — AoE 14, 320% damage to 8 targets, heal self 50%, knockback 22",
    className: "cleric", levelRequired: 40, copperCost: 5000, essenceCost: 65, cooldown: 40,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 3.2, maxTargets: 8, areaRadius: 14, healAmount: 50, knockback: 22 } },

  // ── WARLOCK L40 ──
  { id: "warlock_doom", name: "Doom",
    description: "Seal their fate — DoT 55 over 20s, -65% STR, -65% AGI, -65% DEF for 20s. The longest, most devastating curse.",
    className: "warlock", levelRequired: 40, copperCost: 5000, essenceCost: 65, cooldown: 50,
    type: "debuff", targetType: "enemy", animStyle: "projectile",
    effects: { dotDamage: 55, duration: 20, statReduction: { str: 65, agi: 65, def: 65 } } },
  { id: "warlock_soul_harvest", name: "Soul Harvest",
    description: "Reap every soul nearby — AoE 10, 310% damage to 6 targets, heal 50% of damage dealt, DoT 35 over 10s",
    className: "warlock", levelRequired: 40, copperCost: 5500, essenceCost: 75, cooldown: 45,
    type: "attack", targetType: "area", animStyle: "area",
    effects: { damageMultiplier: 3.1, maxTargets: 6, areaRadius: 10, healAmount: 50, dotDamage: 35, duration: 10 } },

  // ── MONK L40 ──
  { id: "monk_one_thousand_palms", name: "One Thousand Palms",
    description: "The ultimate technique — 850% damage, lunge 28. The single highest damage ability in the game. OMAE WA MOU SHINDEIRU.",
    className: "monk", levelRequired: 40, copperCost: 6000, essenceCost: 80, cooldown: 40,
    type: "attack", targetType: "enemy", animStyle: "melee",
    effects: { damageMultiplier: 8.5, lunge: 28 } },
  { id: "monk_perfect_balance", name: "Perfect Balance",
    description: "Achieve absolute harmony — shield 100% max HP, heal 80%, +80% STR, +80% DEF, +80% AGI for 10s. Perfection.",
    className: "monk", levelRequired: 40, copperCost: 5500, essenceCost: 75, cooldown: 80,
    type: "buff", targetType: "self",
    effects: { shield: 100, healAmount: 80, statBonus: { str: 80, def: 80, agi: 80 }, duration: 10 } },

  // ═══════════════════════════════════════════════════════════════════
  // PARTY BUFFS — targetType "party", affects all party members
  // These are the glue that makes group play worth it.
  // ═══════════════════════════════════════════════════════════════════

  // ── WARRIOR PARTY BUFFS ──
  { id: "warrior_battle_standard", name: "Battle Standard",
    description: "Plant a war banner — all party members gain +20% STR for 20s",
    className: "warrior", levelRequired: 15, copperCost: 350, essenceCost: 35, cooldown: 45,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { str: 20 }, duration: 20 } },
  { id: "warrior_war_cry", name: "War Cry",
    description: "Roar of defiance — all party members gain +25% DEF and +15% STR for 15s",
    className: "warrior", levelRequired: 28, copperCost: 1200, essenceCost: 45, cooldown: 55,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { def: 25, str: 15 }, duration: 15 } },
  { id: "warrior_iron_will", name: "Iron Will",
    description: "Steely resolve — all party members gain +30% DEF and shield absorbing 15% max HP for 18s",
    className: "warrior", levelRequired: 38, copperCost: 4000, essenceCost: 55, cooldown: 70,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { def: 30 }, shield: 15, duration: 18 } },

  // ── PALADIN PARTY BUFFS ──
  { id: "paladin_blessing_of_kings", name: "Blessing of Kings",
    description: "Divine blessing — all party members gain +15% STR, DEF, AGI, and INT for 30s",
    className: "paladin", levelRequired: 15, copperCost: 350, essenceCost: 40, cooldown: 60,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { str: 15, def: 15, agi: 15, int: 15 }, duration: 30 } },
  { id: "paladin_aura_of_devotion", name: "Aura of Devotion",
    description: "Holy aura — all party members gain +25% DEF and +20% FAITH for 25s",
    className: "paladin", levelRequired: 28, copperCost: 1200, essenceCost: 50, cooldown: 55,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { def: 25, faith: 20 }, duration: 25 } },
  { id: "paladin_divine_aegis", name: "Divine Aegis",
    description: "Shield of the divine — all party members gain shield absorbing 25% max HP and +20% DEF for 20s",
    className: "paladin", levelRequired: 38, copperCost: 4500, essenceCost: 65, cooldown: 75,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { shield: 25, statBonus: { def: 20 }, duration: 20 } },

  // ── ROGUE PARTY BUFFS ──
  { id: "rogue_tricks_of_the_trade", name: "Tricks of the Trade",
    description: "Share combat secrets — all party members gain +20% AGI for 15s",
    className: "rogue", levelRequired: 15, copperCost: 350, essenceCost: 30, cooldown: 40,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { agi: 20 }, duration: 15 } },
  { id: "rogue_shadow_veil", name: "Shadow Veil",
    description: "Cloak the party in shadow — all party members gain +25% LUCK and +20% AGI for 18s",
    className: "rogue", levelRequired: 28, copperCost: 1200, essenceCost: 40, cooldown: 50,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { luck: 25, agi: 20 }, duration: 18 } },
  { id: "rogue_assassins_mark", name: "Assassin's Mark",
    description: "Mark targets for death — all party members gain +30% LUCK and +15% STR for 15s",
    className: "rogue", levelRequired: 38, copperCost: 4000, essenceCost: 50, cooldown: 60,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { luck: 30, str: 15 }, duration: 15 } },

  // ── RANGER PARTY BUFFS ──
  { id: "ranger_pack_tactics", name: "Pack Tactics",
    description: "Coordinate the hunt — all party members gain +15% AGI and +15% LUCK for 20s",
    className: "ranger", levelRequired: 15, copperCost: 350, essenceCost: 30, cooldown: 45,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { agi: 15, luck: 15 }, duration: 20 } },
  { id: "ranger_natures_vigil", name: "Nature's Vigil",
    description: "Nature mends all wounds — all party members heal 25% HP over 15s",
    className: "ranger", levelRequired: 28, copperCost: 1200, essenceCost: 45, cooldown: 55,
    type: "healing", targetType: "party", animStyle: "area",
    effects: { healAmount: 25, duration: 15 } },
  { id: "ranger_predators_instinct", name: "Predator's Instinct",
    description: "Sharpen the pack's senses — all party members gain +30% AGI and +20% STR for 18s",
    className: "ranger", levelRequired: 38, copperCost: 4000, essenceCost: 55, cooldown: 65,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { agi: 30, str: 20 }, duration: 18 } },

  // ── MAGE PARTY BUFFS ──
  { id: "mage_arcane_brilliance", name: "Arcane Brilliance",
    description: "Infuse the party with arcane energy — all party members gain +25% INT for 25s",
    className: "mage", levelRequired: 15, copperCost: 350, essenceCost: 35, cooldown: 50,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { int: 25 }, duration: 25 } },
  { id: "mage_temporal_shift", name: "Temporal Shift",
    description: "Bend time for your allies — all party members gain +25% AGI and +15% INT for 15s",
    className: "mage", levelRequired: 28, copperCost: 1200, essenceCost: 50, cooldown: 55,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { agi: 25, int: 15 }, duration: 15 } },
  { id: "mage_arcane_empowerment", name: "Arcane Empowerment",
    description: "Massive arcane surge — all party members gain +35% INT and +20% LUCK for 20s",
    className: "mage", levelRequired: 38, copperCost: 4500, essenceCost: 60, cooldown: 70,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { int: 35, luck: 20 }, duration: 20 } },

  // ── CLERIC PARTY BUFFS ──
  { id: "cleric_prayer_of_healing", name: "Prayer of Healing",
    description: "Mass heal — all party members healed for 30% max HP",
    className: "cleric", levelRequired: 15, copperCost: 350, essenceCost: 40, cooldown: 30,
    type: "healing", targetType: "party", animStyle: "area",
    effects: { healAmount: 30 } },
  { id: "cleric_sanctuary", name: "Sanctuary",
    description: "Holy ground protects — all party members gain shield absorbing 25% max HP for 20s",
    className: "cleric", levelRequired: 28, copperCost: 1200, essenceCost: 55, cooldown: 55,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { shield: 25, duration: 20 } },
  { id: "cleric_divine_chorus", name: "Divine Chorus",
    description: "Hymn of the heavens — all party members heal 40% HP over 15s and gain +25% DEF",
    className: "cleric", levelRequired: 38, copperCost: 4500, essenceCost: 65, cooldown: 70,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { healAmount: 40, statBonus: { def: 25 }, duration: 15 } },

  // ── WARLOCK PARTY BUFFS ──
  { id: "warlock_dark_pact", name: "Dark Pact",
    description: "Share forbidden power — all party members gain +20% INT for 20s",
    className: "warlock", levelRequired: 15, copperCost: 350, essenceCost: 35, cooldown: 45,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { int: 20 }, duration: 20 } },
  { id: "warlock_soul_link", name: "Soul Link",
    description: "Link souls — all party members gain +20% HP and +15% DEF for 25s",
    className: "warlock", levelRequired: 28, copperCost: 1200, essenceCost: 50, cooldown: 55,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { hp: 20, def: 15 }, duration: 25 } },
  { id: "warlock_demonic_empowerment", name: "Demonic Empowerment",
    description: "Channel demonic might — all party members gain +25% STR and +25% INT for 18s",
    className: "warlock", levelRequired: 38, copperCost: 4500, essenceCost: 60, cooldown: 65,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { str: 25, int: 25 }, duration: 18 } },

  // ── MONK PARTY BUFFS ──
  { id: "monk_windwalkers_grace", name: "Windwalker's Grace",
    description: "Share inner harmony — all party members gain +20% AGI for 20s",
    className: "monk", levelRequired: 15, copperCost: 350, essenceCost: 30, cooldown: 45,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { agi: 20 }, duration: 20 } },
  { id: "monk_zen_meditation", name: "Zen Meditation",
    description: "Group meditation — all party members gain +15% STR, DEF, and AGI for 18s",
    className: "monk", levelRequired: 28, copperCost: 1200, essenceCost: 45, cooldown: 55,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { str: 15, def: 15, agi: 15 }, duration: 18 } },
  { id: "monk_transcendence", name: "Transcendence",
    description: "Enlightenment flows — all party members gain +25% all stats and heal 20% HP over 15s",
    className: "monk", levelRequired: 38, copperCost: 4500, essenceCost: 60, cooldown: 70,
    type: "buff", targetType: "party", animStyle: "area",
    effects: { statBonus: { str: 25, def: 25, agi: 25, int: 25, luck: 25 }, healAmount: 20, duration: 15 } },

  // ═══════════════════════════════════════════════════════════════════
  // ALLY BUFFS — targetType "ally", long-duration single-target buffs
  // Cast on a friendly player. These last a LONG time (60-120s).
  // ═══════════════════════════════════════════════════════════════════

  // ── WARRIOR ALLY BUFFS ──
  { id: "warrior_rallying_banner", name: "Rallying Banner",
    description: "Inspire an ally with a war banner — +30% STR for 60s",
    className: "warrior", levelRequired: 18, copperCost: 500, essenceCost: 30, cooldown: 70,
    type: "buff", targetType: "ally",
    effects: { statBonus: { str: 30 }, duration: 60 } },
  { id: "warrior_champions_resolve", name: "Champion's Resolve",
    description: "Grant an ally the resolve of a champion — +25% STR, +25% DEF for 90s",
    className: "warrior", levelRequired: 32, copperCost: 2500, essenceCost: 45, cooldown: 100,
    type: "buff", targetType: "ally",
    effects: { statBonus: { str: 25, def: 25 }, duration: 90 } },

  // ── PALADIN ALLY BUFFS ──
  { id: "paladin_blessing_of_protection", name: "Blessing of Protection",
    description: "Shield an ally with divine light — shield 25% max HP + 25% DEF for 45s",
    className: "paladin", levelRequired: 18, copperCost: 500, essenceCost: 35, cooldown: 60,
    type: "buff", targetType: "ally",
    effects: { shield: 25, statBonus: { def: 25 }, duration: 45 } },
  { id: "paladin_blessing_of_sanctuary", name: "Blessing of Sanctuary",
    description: "Full divine protection — +30% DEF, +20% HP, shield 20% max HP for 90s",
    className: "paladin", levelRequired: 32, copperCost: 2500, essenceCost: 50, cooldown: 100,
    type: "buff", targetType: "ally",
    effects: { statBonus: { def: 30, hp: 20 }, shield: 20, duration: 90 } },

  // ── ROGUE ALLY BUFFS ──
  { id: "rogue_sharpen_blade", name: "Sharpen Blade",
    description: "Hone an ally's weapon — +30% LUCK for 60s",
    className: "rogue", levelRequired: 18, copperCost: 500, essenceCost: 25, cooldown: 70,
    type: "buff", targetType: "ally",
    effects: { statBonus: { luck: 30 }, duration: 60 } },
  { id: "rogue_shadow_infusion", name: "Shadow Infusion",
    description: "Infuse an ally with shadow — +25% AGI, +25% LUCK for 90s",
    className: "rogue", levelRequired: 32, copperCost: 2500, essenceCost: 40, cooldown: 100,
    type: "buff", targetType: "ally",
    effects: { statBonus: { agi: 25, luck: 25 }, duration: 90 } },

  // ── RANGER ALLY BUFFS ──
  { id: "ranger_eagle_eye", name: "Eagle Eye",
    description: "Grant an ally the sight of the eagle — +30% AGI for 60s",
    className: "ranger", levelRequired: 18, copperCost: 500, essenceCost: 25, cooldown: 70,
    type: "buff", targetType: "ally",
    effects: { statBonus: { agi: 30 }, duration: 60 } },
  { id: "ranger_bond_of_the_wild", name: "Bond of the Wild",
    description: "Nature's full blessing on an ally — +25% AGI, +20% STR, heal 20% HP over 30s",
    className: "ranger", levelRequired: 32, copperCost: 2500, essenceCost: 45, cooldown: 100,
    type: "buff", targetType: "ally",
    effects: { statBonus: { agi: 25, str: 20 }, healAmount: 20, duration: 90 } },

  // ── MAGE ALLY BUFFS ──
  { id: "mage_arcane_infusion", name: "Arcane Infusion",
    description: "Infuse an ally with arcane power — +30% INT for 60s",
    className: "mage", levelRequired: 18, copperCost: 500, essenceCost: 30, cooldown: 70,
    type: "buff", targetType: "ally",
    effects: { statBonus: { int: 30 }, duration: 60 } },
  { id: "mage_chrono_blessing", name: "Chrono Blessing",
    description: "Bend time around an ally — +25% INT, +25% AGI for 90s",
    className: "mage", levelRequired: 32, copperCost: 2500, essenceCost: 45, cooldown: 100,
    type: "buff", targetType: "ally",
    effects: { statBonus: { int: 25, agi: 25 }, duration: 90 } },

  // ── CLERIC ALLY BUFFS ──
  { id: "cleric_greater_renew", name: "Greater Renew",
    description: "Powerful sustained heal on an ally — heal 60% HP over 30s",
    className: "cleric", levelRequired: 18, copperCost: 500, essenceCost: 35, cooldown: 45,
    type: "healing", targetType: "ally", animStyle: "projectile",
    effects: { healAmount: 60, duration: 30 } },
  { id: "cleric_blessing_of_light", name: "Blessing of Light",
    description: "Sustained divine blessing — +30% FAITH, +25% DEF, heal 30% over 45s for 90s",
    className: "cleric", levelRequired: 32, copperCost: 2500, essenceCost: 50, cooldown: 100,
    type: "buff", targetType: "ally",
    effects: { statBonus: { faith: 30, def: 25 }, healAmount: 30, duration: 90 } },

  // ── WARLOCK ALLY BUFFS ──
  { id: "warlock_dark_empowerment", name: "Dark Empowerment",
    description: "Infuse an ally with dark energy — +25% STR, +25% INT for 60s",
    className: "warlock", levelRequired: 18, copperCost: 500, essenceCost: 30, cooldown: 70,
    type: "buff", targetType: "ally",
    effects: { statBonus: { str: 25, int: 25 }, duration: 60 } },
  { id: "warlock_soul_covenant", name: "Soul Covenant",
    description: "Bind your soul to an ally — +30% INT, +20% HP, shield 15% max HP for 90s",
    className: "warlock", levelRequired: 32, copperCost: 2500, essenceCost: 45, cooldown: 100,
    type: "buff", targetType: "ally",
    effects: { statBonus: { int: 30, hp: 20 }, shield: 15, duration: 90 } },

  // ── MONK ALLY BUFFS ──
  { id: "monk_chi_attunement", name: "Chi Attunement",
    description: "Harmonize an ally's chi — +20% STR, +20% AGI, +20% DEF for 60s",
    className: "monk", levelRequired: 18, copperCost: 500, essenceCost: 30, cooldown: 70,
    type: "buff", targetType: "ally",
    effects: { statBonus: { str: 20, agi: 20, def: 20 }, duration: 60 } },
  { id: "monk_spirit_bond", name: "Spirit Bond",
    description: "Deep spiritual connection — +25% all stats for 90s. The ultimate ally buff.",
    className: "monk", levelRequired: 32, copperCost: 2500, essenceCost: 50, cooldown: 100,
    type: "buff", targetType: "ally",
    effects: { statBonus: { str: 25, def: 25, agi: 25, int: 25, luck: 25, faith: 25 }, duration: 90 } },
];

// Fallback lookups for dynamically generated techniques (essence + forged)
const fallbackLookups: Array<(id: string) => TechniqueDefinition | undefined> = [];

/**
 * Register a fallback lookup function for techniques not in the static catalog.
 * Multiple lookups can be registered and are tried in order.
 */
export function registerTechniqueFallbackLookup(
  fn: (id: string) => TechniqueDefinition | undefined,
): void {
  fallbackLookups.push(fn);
}

export function getTechniqueById(id: string): TechniqueDefinition | undefined {
  const static_ = TECHNIQUES.find((t) => t.id === id);
  if (static_) return static_;
  for (const lookup of fallbackLookups) {
    const result = lookup(id);
    if (result) return result;
  }
  return undefined;
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
  const r4Match = techniqueId.match(/^(.+)_r4$/);
  if (r4Match) return `${r4Match[1]}_r3`;

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
