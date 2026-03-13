export type ProjectileShape = "orb" | "shard" | "needle" | "cross" | "leaf" | "flare";
export type ImpactPattern = "ring" | "spokes" | "diamond" | "petals" | "ward";
export type BeamPattern = "solid" | "pulse" | "drain" | "prayer";

export interface TechniqueVisual {
  primary: number;
  secondary: number;
  accent: number;
  count: number;
  projectileRadius: number;
  ringRadius: number;
  projectileShape: ProjectileShape;
  impactPattern: ImpactPattern;
  beamPattern: BeamPattern;
  uiGlyph: string;
}

const TYPE_BASE_VISUALS: Record<string, TechniqueVisual> = {
  attack:  { primary: 0xf89800, secondary: 0xfacc22, accent: 0xffe38a, count: 6, projectileRadius: 2, ringRadius: 6, projectileShape: "orb",   impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "*" },
  healing: { primary: 0x00ff88, secondary: 0x8fffe0, accent: 0xccffee, count: 5, projectileRadius: 2, ringRadius: 5, projectileShape: "cross", impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "+" },
  buff:    { primary: 0xfacc22, secondary: 0xffee88, accent: 0xfff3c1, count: 4, projectileRadius: 2, ringRadius: 5, projectileShape: "flare", impactPattern: "ward",    beamPattern: "pulse",  uiGlyph: "^" },
  debuff:  { primary: 0xaa44ff, secondary: 0x7722cc, accent: 0xd8a3ff, count: 5, projectileRadius: 2, ringRadius: 6, projectileShape: "shard", impactPattern: "diamond", beamPattern: "drain",  uiGlyph: "!" },
};

const TECHNIQUE_VISUALS: Record<string, TechniqueVisual> = {
  warrior_heroic_strike:      { primary: 0xe14b2d, secondary: 0xffb347, accent: 0xffe0a8, count: 7, projectileRadius: 2, ringRadius: 6, projectileShape: "flare", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "/" },
  warrior_shield_wall:        { primary: 0x5f86ff, secondary: 0xb8c7ff, accent: 0xe5ebff, count: 5, projectileRadius: 2, ringRadius: 7, projectileShape: "cross", impactPattern: "ward",    beamPattern: "pulse",  uiGlyph: "#" },
  warrior_intimidating_shout: { primary: 0x8f2a2a, secondary: 0xc75b39, accent: 0xffb38f, count: 6, projectileRadius: 2, ringRadius: 8, projectileShape: "flare", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "!" },
  warrior_battle_rage:        { primary: 0xff4f1f, secondary: 0xffb000, accent: 0xffe08a, count: 7, projectileRadius: 2, ringRadius: 7, projectileShape: "flare", impactPattern: "spokes",  beamPattern: "pulse",  uiGlyph: "*" },
  warrior_cleave:             { primary: 0xd96a1d, secondary: 0xf2d14c, accent: 0xfff0a8, count: 8, projectileRadius: 3, ringRadius: 9, projectileShape: "flare", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: ">" },

  paladin_holy_smite:         { primary: 0xffd54a, secondary: 0xfff1a8, accent: 0xffffff, count: 6, projectileRadius: 2, ringRadius: 6, projectileShape: "cross", impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "+" },
  paladin_divine_shield:      { primary: 0xf7f2b4, secondary: 0xb6e3ff, accent: 0xffffff, count: 5, projectileRadius: 2, ringRadius: 8, projectileShape: "cross", impactPattern: "ward",    beamPattern: "prayer", uiGlyph: "#" },
  paladin_lay_on_hands:       { primary: 0xfff0b8, secondary: 0xffd76b, accent: 0xffffff, count: 6, projectileRadius: 2, ringRadius: 7, projectileShape: "cross", impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "+" },
  paladin_consecration:       { primary: 0xffc94d, secondary: 0xff8b3d, accent: 0xfff4c2, count: 7, projectileRadius: 2, ringRadius: 10, projectileShape: "flare", impactPattern: "ward",    beamPattern: "prayer", uiGlyph: "*" },
  paladin_blessing_of_might:  { primary: 0xffe16f, secondary: 0xffb347, accent: 0xfff5cf, count: 5, projectileRadius: 2, ringRadius: 7, projectileShape: "flare", impactPattern: "ward",    beamPattern: "pulse",  uiGlyph: "^" },

  rogue_backstab:             { primary: 0x6c1f7a, secondary: 0xd7263d, accent: 0xff8aa1, count: 7, projectileRadius: 2, ringRadius: 6, projectileShape: "needle", impactPattern: "diamond", beamPattern: "solid",  uiGlyph: "/" },
  rogue_stealth:              { primary: 0x4f4b75, secondary: 0x151728, accent: 0x8d9ad9, count: 4, projectileRadius: 2, ringRadius: 6, projectileShape: "shard",  impactPattern: "diamond", beamPattern: "pulse",  uiGlyph: "~" },
  rogue_poison_blade:         { primary: 0x5edc1f, secondary: 0x167a2f, accent: 0xb8ff6f, count: 7, projectileRadius: 2, ringRadius: 6, projectileShape: "needle", impactPattern: "petals",  beamPattern: "drain",  uiGlyph: "x" },
  rogue_evasion:              { primary: 0x73d2de, secondary: 0x456990, accent: 0xd8f8ff, count: 5, projectileRadius: 2, ringRadius: 7, projectileShape: "leaf",   impactPattern: "petals",  beamPattern: "pulse",  uiGlyph: "<" },
  rogue_shadow_strike:        { primary: 0x28104e, secondary: 0xa11fff, accent: 0xe0a8ff, count: 8, projectileRadius: 2, ringRadius: 7, projectileShape: "shard",  impactPattern: "diamond", beamPattern: "drain",  uiGlyph: "*" },

  ranger_aimed_shot:          { primary: 0xb86b2b, secondary: 0xe4c46a, accent: 0xffefb0, count: 6, projectileRadius: 2, ringRadius: 5, projectileShape: "needle", impactPattern: "ring",    beamPattern: "solid",  uiGlyph: ">" },
  ranger_hunters_mark:        { primary: 0xc63f17, secondary: 0x7fbf3f, accent: 0xf7f08a, count: 5, projectileRadius: 2, ringRadius: 6, projectileShape: "shard",  impactPattern: "diamond", beamPattern: "solid",  uiGlyph: "O" },
  ranger_quick_shot:          { primary: 0xf2d14c, secondary: 0xff8a3d, accent: 0xfff3bf, count: 6, projectileRadius: 2, ringRadius: 5, projectileShape: "needle", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: ">" },
  ranger_natures_blessing:    { primary: 0x37c871, secondary: 0x9af27f, accent: 0xe4ffd8, count: 5, projectileRadius: 2, ringRadius: 7, projectileShape: "leaf",   impactPattern: "petals",  beamPattern: "prayer", uiGlyph: "%" },
  ranger_multi_shot:          { primary: 0xc98f2f, secondary: 0xffd85a, accent: 0xfff3bf, count: 8, projectileRadius: 2, ringRadius: 8, projectileShape: "needle", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "*" },

  mage_fireball:              { primary: 0xff5a2a, secondary: 0xffb347, accent: 0xfff0a8, count: 7, projectileRadius: 3, ringRadius: 7, projectileShape: "orb",    impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "*" },
  mage_frost_armor:           { primary: 0x66ccff, secondary: 0xb8f0ff, accent: 0xeafcff, count: 5, projectileRadius: 2, ringRadius: 8, projectileShape: "shard",  impactPattern: "ward",    beamPattern: "pulse",  uiGlyph: "#" },
  mage_arcane_missiles:       { primary: 0xb14cff, secondary: 0x5d8bff, accent: 0xe0d1ff, count: 8, projectileRadius: 2, ringRadius: 6, projectileShape: "shard",  impactPattern: "diamond", beamPattern: "pulse",  uiGlyph: "*" },
  mage_slow:                  { primary: 0x5f86ff, secondary: 0x9f7aea, accent: 0xd8d3ff, count: 5, projectileRadius: 2, ringRadius: 6, projectileShape: "orb",    impactPattern: "diamond", beamPattern: "pulse",  uiGlyph: "~" },
  mage_flamestrike:           { primary: 0xff6b1a, secondary: 0xffd166, accent: 0xfff4c2, count: 9, projectileRadius: 3, ringRadius: 11, projectileShape: "flare", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "*" },

  cleric_holy_light:          { primary: 0xfff1a8, secondary: 0xffffff, accent: 0xcff7ff, count: 5, projectileRadius: 2, ringRadius: 6, projectileShape: "cross", impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "+" },
  cleric_divine_protection:   { primary: 0xa8f0ff, secondary: 0xffffff, accent: 0xe8fbff, count: 5, projectileRadius: 2, ringRadius: 8, projectileShape: "cross", impactPattern: "ward",    beamPattern: "prayer", uiGlyph: "#" },
  cleric_smite:               { primary: 0xffd15c, secondary: 0xfff5bf, accent: 0xffffff, count: 6, projectileRadius: 2, ringRadius: 6, projectileShape: "cross", impactPattern: "spokes",  beamPattern: "prayer", uiGlyph: "*" },
  cleric_renew:               { primary: 0x7cffb8, secondary: 0xcfffe8, accent: 0xffffff, count: 5, projectileRadius: 2, ringRadius: 7, projectileShape: "leaf",   impactPattern: "petals",  beamPattern: "prayer", uiGlyph: "+" },
  cleric_prayer_of_fortitude: { primary: 0x9fd8ff, secondary: 0xffefb8, accent: 0xffffff, count: 5, projectileRadius: 2, ringRadius: 8, projectileShape: "cross", impactPattern: "ward",    beamPattern: "prayer", uiGlyph: "^" },

  warlock_shadow_bolt:        { primary: 0x5b2a86, secondary: 0xbf2e6d, accent: 0xf0a8ff, count: 7, projectileRadius: 2, ringRadius: 6, projectileShape: "shard",  impactPattern: "diamond", beamPattern: "drain",  uiGlyph: "*" },
  warlock_curse_of_weakness:  { primary: 0x7d2248, secondary: 0x5b9a31, accent: 0xc9ff8a, count: 5, projectileRadius: 2, ringRadius: 7, projectileShape: "shard",  impactPattern: "petals",  beamPattern: "drain",  uiGlyph: "!" },
  warlock_drain_life:         { primary: 0x7a1238, secondary: 0x29b36a, accent: 0xa8ffd3, count: 7, projectileRadius: 2, ringRadius: 6, projectileShape: "needle", impactPattern: "diamond", beamPattern: "drain",  uiGlyph: "|" },
  warlock_soul_shield:        { primary: 0x6a3fb5, secondary: 0x2b0e52, accent: 0xcfb8ff, count: 5, projectileRadius: 2, ringRadius: 8, projectileShape: "shard",  impactPattern: "ward",    beamPattern: "pulse",  uiGlyph: "#" },
  warlock_corruption:         { primary: 0x3d6b1f, secondary: 0x7a1f4d, accent: 0xc2ff7a, count: 7, projectileRadius: 2, ringRadius: 7, projectileShape: "orb",    impactPattern: "petals",  beamPattern: "drain",  uiGlyph: "x" },

  monk_palm_strike:           { primary: 0xffb347, secondary: 0xff6b35, accent: 0xffe0a8, count: 6, projectileRadius: 2, ringRadius: 6, projectileShape: "flare", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "/" },
  monk_inner_focus:           { primary: 0x3ec7c1, secondary: 0xa8fff4, accent: 0xe4ffff, count: 5, projectileRadius: 2, ringRadius: 7, projectileShape: "leaf",   impactPattern: "ward",    beamPattern: "pulse",  uiGlyph: "^" },
  monk_disable:               { primary: 0x5e88fc, secondary: 0x74d3ae, accent: 0xd9f6ff, count: 5, projectileRadius: 2, ringRadius: 6, projectileShape: "needle", impactPattern: "diamond", beamPattern: "pulse",  uiGlyph: "!" },
  monk_chi_burst:             { primary: 0x11d4ff, secondary: 0x7afcff, accent: 0xe0ffff, count: 7, projectileRadius: 3, ringRadius: 7, projectileShape: "orb",    impactPattern: "spokes",  beamPattern: "pulse",  uiGlyph: "*" },
  monk_meditation:            { primary: 0x77f6d7, secondary: 0xd6fff6, accent: 0xffffff, count: 5, projectileRadius: 2, ringRadius: 8, projectileShape: "leaf",   impactPattern: "petals",  beamPattern: "prayer", uiGlyph: "o" },

  // ── WARRIOR R2/R3 + NEW ─────────────────────────────────────────────
  warrior_heroic_strike_r2:   { primary: 0xf43218, secondary: 0xff7733, accent: 0xffcc88, count: 8,  projectileRadius: 3, ringRadius: 7,  projectileShape: "flare",  impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "/" },
  warrior_heroic_strike_r3:   { primary: 0xff1a00, secondary: 0xff5511, accent: 0xffaa55, count: 10, projectileRadius: 3, ringRadius: 8,  projectileShape: "flare",  impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "/" },
  warrior_battle_rage_r2:     { primary: 0xff6600, secondary: 0xffc200, accent: 0xffe555, count: 8,  projectileRadius: 2, ringRadius: 8,  projectileShape: "flare",  impactPattern: "spokes",  beamPattern: "pulse",  uiGlyph: "*" },
  warrior_cleave_r2:          { primary: 0xf0a020, secondary: 0xffd84c, accent: 0xfff3b0, count: 10, projectileRadius: 3, ringRadius: 11, projectileShape: "flare",  impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: ">" },
  warrior_rallying_cry:       { primary: 0xffd700, secondary: 0xffffff, accent: 0xfff8cc, count: 7,  projectileRadius: 2, ringRadius: 10, projectileShape: "flare",  impactPattern: "ring",    beamPattern: "pulse",  uiGlyph: "^" },
  warrior_rending_strike:     { primary: 0x8b0000, secondary: 0xcc1111, accent: 0xff4444, count: 8,  projectileRadius: 2, ringRadius: 6,  projectileShape: "needle", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "/" },

  // ── PALADIN R2/R3 + NEW ─────────────────────────────────────────────
  paladin_holy_smite_r2:      { primary: 0xffe14a, secondary: 0xfff5bb, accent: 0xffffff, count: 8,  projectileRadius: 3, ringRadius: 8,  projectileShape: "cross",  impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "+" },
  paladin_holy_smite_r3:      { primary: 0xffee00, secondary: 0xfffadd, accent: 0xffffff, count: 10, projectileRadius: 3, ringRadius: 10, projectileShape: "cross",  impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "+" },
  paladin_consecration_r2:    { primary: 0xffb520, secondary: 0xff7722, accent: 0xffe0a0, count: 9,  projectileRadius: 3, ringRadius: 12, projectileShape: "flare",  impactPattern: "ward",    beamPattern: "prayer", uiGlyph: "*" },
  paladin_lay_on_hands_r2:    { primary: 0xffffff, secondary: 0xffe680, accent: 0xfff8e0, count: 7,  projectileRadius: 2, ringRadius: 8,  projectileShape: "cross",  impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "+" },
  paladin_judgment:           { primary: 0xaaccff, secondary: 0xeef4ff, accent: 0xffffff, count: 8,  projectileRadius: 3, ringRadius: 7,  projectileShape: "cross",  impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "!" },
  paladin_aura_of_resolve:    { primary: 0xc0c0c0, secondary: 0xffffff, accent: 0xf0f0ff, count: 6,  projectileRadius: 2, ringRadius: 9,  projectileShape: "cross",  impactPattern: "ward",    beamPattern: "pulse",  uiGlyph: "#" },

  // ── ROGUE R2/R3 + NEW ──────────────────────────────────────────────
  rogue_backstab_r2:          { primary: 0x520a6a, secondary: 0xb81a2f, accent: 0xff6680, count: 8,  projectileRadius: 2, ringRadius: 7,  projectileShape: "needle", impactPattern: "diamond", beamPattern: "solid",  uiGlyph: "/" },
  rogue_backstab_r3:          { primary: 0x3d0055, secondary: 0x991122, accent: 0xff3355, count: 10, projectileRadius: 3, ringRadius: 8,  projectileShape: "needle", impactPattern: "diamond", beamPattern: "solid",  uiGlyph: "/" },
  rogue_poison_blade_r2:      { primary: 0x33cc00, secondary: 0x0a8822, accent: 0x88ff44, count: 8,  projectileRadius: 2, ringRadius: 7,  projectileShape: "needle", impactPattern: "petals",  beamPattern: "drain",  uiGlyph: "x" },
  rogue_shadow_strike_r2:     { primary: 0x1a0033, secondary: 0x8800ee, accent: 0xcc77ff, count: 9,  projectileRadius: 2, ringRadius: 8,  projectileShape: "shard",  impactPattern: "diamond", beamPattern: "drain",  uiGlyph: "*" },
  rogue_smoke_bomb:           { primary: 0x555555, secondary: 0x333333, accent: 0x888888, count: 10, projectileRadius: 3, ringRadius: 10, projectileShape: "orb",    impactPattern: "ring",    beamPattern: "solid",  uiGlyph: "~" },
  rogue_blade_flurry:         { primary: 0xcccccc, secondary: 0xffffff, accent: 0xeeeeff, count: 9,  projectileRadius: 2, ringRadius: 7,  projectileShape: "needle", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "*" },

  // ── RANGER R2/R3 + NEW ─────────────────────────────────────────────
  ranger_aimed_shot_r2:       { primary: 0xcc7a22, secondary: 0xf0d060, accent: 0xfff0a0, count: 7,  projectileRadius: 2, ringRadius: 6,  projectileShape: "needle", impactPattern: "ring",    beamPattern: "solid",  uiGlyph: ">" },
  ranger_aimed_shot_r3:       { primary: 0xe09030, secondary: 0xffd84c, accent: 0xfff5bb, count: 8,  projectileRadius: 3, ringRadius: 7,  projectileShape: "needle", impactPattern: "ring",    beamPattern: "solid",  uiGlyph: ">" },
  ranger_multi_shot_r2:       { primary: 0xdaa030, secondary: 0xffe066, accent: 0xfff5cc, count: 10, projectileRadius: 2, ringRadius: 9,  projectileShape: "needle", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "*" },
  ranger_hunters_mark_r2:     { primary: 0xdd3311, secondary: 0x88bb33, accent: 0xffdd66, count: 6,  projectileRadius: 2, ringRadius: 7,  projectileShape: "shard",  impactPattern: "diamond", beamPattern: "solid",  uiGlyph: "O" },
  ranger_entangling_roots:    { primary: 0x4a8c2a, secondary: 0x8b6633, accent: 0x99dd55, count: 8,  projectileRadius: 2, ringRadius: 8,  projectileShape: "leaf",   impactPattern: "petals",  beamPattern: "pulse",  uiGlyph: "%" },
  ranger_volley:              { primary: 0x6699cc, secondary: 0xaaddff, accent: 0xeef8ff, count: 12, projectileRadius: 2, ringRadius: 12, projectileShape: "needle", impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "*" },

  // ── MAGE R2/R3 + NEW ───────────────────────────────────────────────
  mage_fireball_r2:           { primary: 0xff7733, secondary: 0xffcc55, accent: 0xfff0bb, count: 9,  projectileRadius: 4, ringRadius: 8,  projectileShape: "orb",    impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "*" },
  mage_fireball_r3:           { primary: 0xffaa44, secondary: 0xffe088, accent: 0xffffff, count: 12, projectileRadius: 5, ringRadius: 10, projectileShape: "orb",    impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "*" },
  mage_arcane_missiles_r2:    { primary: 0xcc44ff, secondary: 0x7799ff, accent: 0xeeddff, count: 10, projectileRadius: 3, ringRadius: 7,  projectileShape: "shard",  impactPattern: "diamond", beamPattern: "pulse",  uiGlyph: "*" },
  mage_flamestrike_r2:        { primary: 0xff8822, secondary: 0xffdd88, accent: 0xffffff, count: 11, projectileRadius: 4, ringRadius: 13, projectileShape: "flare",  impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "*" },
  mage_frost_nova:            { primary: 0x66ddff, secondary: 0xbbf0ff, accent: 0xffffff, count: 10, projectileRadius: 3, ringRadius: 10, projectileShape: "shard",  impactPattern: "ring",    beamPattern: "pulse",  uiGlyph: "#" },
  mage_mana_shield:           { primary: 0x7766ee, secondary: 0xaa88ff, accent: 0xddccff, count: 6,  projectileRadius: 2, ringRadius: 9,  projectileShape: "orb",    impactPattern: "ward",    beamPattern: "pulse",  uiGlyph: "#" },

  // ── CLERIC R2/R3 + NEW ─────────────────────────────────────────────
  cleric_holy_light_r2:       { primary: 0xfff5cc, secondary: 0xffffff, accent: 0xe0ffff, count: 7,  projectileRadius: 2, ringRadius: 7,  projectileShape: "cross",  impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "+" },
  cleric_holy_light_r3:       { primary: 0xffffff, secondary: 0xfff8dd, accent: 0xffffff, count: 9,  projectileRadius: 3, ringRadius: 8,  projectileShape: "cross",  impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "+" },
  cleric_renew_r2:            { primary: 0x66ff99, secondary: 0xccffdd, accent: 0xffffff, count: 6,  projectileRadius: 2, ringRadius: 8,  projectileShape: "leaf",   impactPattern: "petals",  beamPattern: "prayer", uiGlyph: "+" },
  cleric_divine_protection_r2:{ primary: 0x88eeff, secondary: 0xddf8ff, accent: 0xffffff, count: 6,  projectileRadius: 2, ringRadius: 9,  projectileShape: "cross",  impactPattern: "ward",    beamPattern: "prayer", uiGlyph: "#" },
  cleric_holy_nova:           { primary: 0xffd54a, secondary: 0xffe88a, accent: 0xffffff, count: 9,  projectileRadius: 3, ringRadius: 10, projectileShape: "cross",  impactPattern: "ring",    beamPattern: "prayer", uiGlyph: "*" },
  cleric_spirit_of_redemption:{ primary: 0xfff8ee, secondary: 0xffeebb, accent: 0xffffff, count: 7,  projectileRadius: 2, ringRadius: 9,  projectileShape: "cross",  impactPattern: "ward",    beamPattern: "prayer", uiGlyph: "^" },

  // ── WARLOCK R2/R3 + NEW ─────────────────────────────────────────────
  warlock_shadow_bolt_r2:     { primary: 0x441a6e, secondary: 0xa01850, accent: 0xdd88ff, count: 8,  projectileRadius: 3, ringRadius: 7,  projectileShape: "shard",  impactPattern: "diamond", beamPattern: "drain",  uiGlyph: "*" },
  warlock_shadow_bolt_r3:     { primary: 0x2e0050, secondary: 0x880044, accent: 0xcc66ee, count: 10, projectileRadius: 4, ringRadius: 8,  projectileShape: "shard",  impactPattern: "diamond", beamPattern: "drain",  uiGlyph: "*" },
  warlock_corruption_r2:      { primary: 0x2a5510, secondary: 0x661133, accent: 0xaaee55, count: 8,  projectileRadius: 2, ringRadius: 8,  projectileShape: "orb",    impactPattern: "petals",  beamPattern: "drain",  uiGlyph: "x" },
  warlock_drain_life_r2:      { primary: 0x600022, secondary: 0x1a9955, accent: 0x88ffc0, count: 8,  projectileRadius: 2, ringRadius: 7,  projectileShape: "needle", impactPattern: "diamond", beamPattern: "drain",  uiGlyph: "|" },
  warlock_howl_of_terror:     { primary: 0x660000, secondary: 0x220000, accent: 0xcc3333, count: 9,  projectileRadius: 3, ringRadius: 11, projectileShape: "shard",  impactPattern: "spokes",  beamPattern: "drain",  uiGlyph: "!" },
  warlock_siphon_soul:        { primary: 0x5544aa, secondary: 0x8866dd, accent: 0xccaaff, count: 7,  projectileRadius: 2, ringRadius: 7,  projectileShape: "orb",    impactPattern: "diamond", beamPattern: "drain",  uiGlyph: "|" },

  // ── MONK R2/R3 + NEW ───────────────────────────────────────────────
  monk_palm_strike_r2:        { primary: 0xffc833, secondary: 0xff8822, accent: 0xffeebb, count: 8,  projectileRadius: 2, ringRadius: 7,  projectileShape: "flare",  impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: "/" },
  monk_chi_burst_r2:          { primary: 0x00e8ff, secondary: 0x66ffff, accent: 0xccffff, count: 9,  projectileRadius: 4, ringRadius: 8,  projectileShape: "orb",    impactPattern: "spokes",  beamPattern: "pulse",  uiGlyph: "*" },
  monk_chi_burst_r3:          { primary: 0x00ffff, secondary: 0x55ffff, accent: 0xeeffff, count: 12, projectileRadius: 5, ringRadius: 10, projectileShape: "orb",    impactPattern: "spokes",  beamPattern: "pulse",  uiGlyph: "*" },
  monk_meditation_r2:         { primary: 0x55ffcc, secondary: 0xbbffee, accent: 0xffffff, count: 7,  projectileRadius: 2, ringRadius: 9,  projectileShape: "leaf",   impactPattern: "petals",  beamPattern: "prayer", uiGlyph: "o" },
  monk_flying_kick:           { primary: 0xff8833, secondary: 0xffc855, accent: 0xffe8aa, count: 8,  projectileRadius: 2, ringRadius: 7,  projectileShape: "flare",  impactPattern: "spokes",  beamPattern: "solid",  uiGlyph: ">" },
  monk_whirlwind_kick:        { primary: 0x22ddee, secondary: 0xccffff, accent: 0xffffff, count: 10, projectileRadius: 3, ringRadius: 9,  projectileShape: "orb",    impactPattern: "ring",    beamPattern: "pulse",  uiGlyph: "*" },
};

const FALLBACK_PROJECTILES: ProjectileShape[] = ["orb", "shard", "needle", "cross", "leaf", "flare"];
const FALLBACK_PATTERNS: ImpactPattern[] = ["ring", "spokes", "diamond", "petals", "ward"];
const FALLBACK_BEAMS: BeamPattern[] = ["solid", "pulse", "drain", "prayer"];
const FALLBACK_GLYPHS = ["*", "+", "!", "~", "%", "^", "#", "O"];

export function getTechniqueVisual(techniqueId: string, techniqueType = "attack"): TechniqueVisual {
  return TECHNIQUE_VISUALS[techniqueId] ?? buildFallbackVisual(techniqueId || techniqueType, techniqueType);
}

export function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function buildFallbackVisual(seed: string, techniqueType: string): TechniqueVisual {
  const base = TYPE_BASE_VISUALS[techniqueType] ?? TYPE_BASE_VISUALS.attack;
  const hash = hashText(seed);
  const hue = hash % 360;
  return {
    primary: hslToInt(hue, 0.86, 0.56),
    secondary: hslToInt((hue + 26) % 360, 0.74, 0.68),
    accent: hslToInt((hue + 52) % 360, 0.82, 0.84),
    count: base.count + (hash % 3),
    projectileRadius: base.projectileRadius + (hash % 2),
    ringRadius: base.ringRadius + (hash % 3),
    projectileShape: FALLBACK_PROJECTILES[hash % FALLBACK_PROJECTILES.length],
    impactPattern: FALLBACK_PATTERNS[hash % FALLBACK_PATTERNS.length],
    beamPattern: FALLBACK_BEAMS[hash % FALLBACK_BEAMS.length],
    uiGlyph: FALLBACK_GLYPHS[hash % FALLBACK_GLYPHS.length],
  };
}

function hashText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function hslToInt(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r1, g1, b1] = [0, 0, 0];
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return (r << 16) | (g << 8) | b;
}
