# World of Geneva - Sound Effects & BGM Master List

> 100+ sound effects and background music tracks for zones, abilities, UI, professions, combat, chat, movement, and ambient systems.

---

## Table of Contents

1. [Zone BGM (30 Tracks)](#1-zone-background-music-30-tracks)
2. [UI Sound Effects (15 SFX)](#2-ui-sound-effects-15-sfx)
3. [Combat & Ability SFX (25 SFX)](#3-combat--ability-sound-effects-25-sfx)
4. [Profession SFX (12 SFX)](#4-profession-sound-effects-12-sfx)
5. [Movement & Navigation SFX (8 SFX)](#5-movement--navigation-sfx-8-sfx)
6. [Ambient Zone Loops (10 SFX)](#6-ambient-zone-loops-10-sfx)
7. [Chat & Social SFX (6 SFX)](#7-chat--social-sfx-6-sfx)
8. [Death & Respawn SFX (4 SFX)](#8-death--respawn-sfx-4-sfx)
9. [Loot & Economy SFX (6 SFX)](#9-loot--economy-sfx-6-sfx)
10. [Implementation Guide](#10-implementation-guide)

---

## 1. Zone Background Music (30 Tracks)

Each zone has a unique looping BGM track that fades in/out on zone transitions.

| # | File Name | Zone | Style / Mood | Duration | Loop |
|---|-----------|------|-------------|----------|------|
| 001 | `bgm_village_square.ogg` | Village Square | Warm folk lute & flute, peaceful tavern feel | 2:30 | Yes |
| 002 | `bgm_wild_meadow.ogg` | Wild Meadow | Light pastoral strings, birdsong undertones | 2:45 | Yes |
| 003 | `bgm_dark_forest.ogg` | Dark Forest | Low cello drones, eerie woodwinds, tension | 3:00 | Yes |
| 004 | `bgm_auroral_plains.ogg` | Auroral Plains | Sweeping orchestral, open sky grandeur | 2:40 | Yes |
| 005 | `bgm_emerald_woods.ogg` | Emerald Woods | Mystical harp arpeggios, gentle chimes | 2:50 | Yes |
| 006 | `bgm_viridian_range.ogg` | Viridian Range | Deep brass, mountain echo percussion | 3:10 | Yes |
| 007 | `bgm_moondancer_glade.ogg` | Moondancer Glade | Ethereal choir pads, moonlit ambience | 2:55 | Yes |
| 008 | `bgm_felsrock_citadel.ogg` | Felsrock Citadel | Military march drums, stone fortress grandeur | 3:00 | Yes |
| 009 | `bgm_lake_lumina.ogg` | Lake Lumina | Shimmering piano, water textures, calm | 2:35 | Yes |
| 010 | `bgm_azurshard_chasm.ogg` | Azurshard Chasm | Crystal resonance, deep reverb, mysterious | 3:15 | Yes |
| 011 | `bgm_stormbreak_pass.ogg` | Stormbreak Pass | Driving percussion, wind howls, urgent | 2:50 | Yes |
| 012 | `bgm_northwind_hollow.ogg` | Northwind Hollow | Frozen strings, ice chimes, desolate | 3:00 | Yes |
| 013 | `bgm_eastmarch_wastes.ogg` | Eastmarch Wastes | Dry desert oud, sparse percussion | 2:45 | Yes |
| 014 | `bgm_shattered_coast.ogg` | Shattered Coast | Sea shanty fiddle, crashing wave rhythm | 2:40 | Yes |
| 015 | `bgm_frostfall_ridge.ogg` | Frostfall Ridge | Nordic war drums, frost wind layers | 3:05 | Yes |
| 016 | `bgm_windswept_bluffs.ogg` | Windswept Bluffs | Lonely flute, cliff-edge wind gusts | 2:30 | Yes |
| 017 | `bgm_sunflower_fields.ogg` | Sunflower Fields | Bright acoustic guitar, warm summer feel | 2:20 | Yes |
| 018 | `bgm_harvest_hollow.ogg` | Harvest Hollow | Country fiddle, barn dance warmth | 2:25 | Yes |
| 019 | `bgm_willowfen_pastures.ogg` | Willowfen Pastures | Soft accordion, lazy river ambience | 2:35 | Yes |
| 020 | `bgm_bramblewood_homestead.ogg` | Bramblewood Homestead | Rustic banjo, crackling campfire undertone | 2:30 | Yes |
| 021 | `bgm_goldenreach_grange.ogg` | Goldenreach Grange | Warm brass fanfare, golden hour glow | 2:40 | Yes |
| 022 | `bgm_dewveil_orchard.ogg` | Dewveil Orchard | Music box melody, morning dew drips | 2:15 | Yes |
| 023 | `bgm_thornwall_ranch.ogg` | Thornwall Ranch | Rugged western guitar, dusty trail feel | 2:30 | Yes |
| 024 | `bgm_moonpetal_gardens.ogg` | Moonpetal Gardens | Glass harmonica, night-blooming serenity | 2:50 | Yes |
| 025 | `bgm_ironroot_farmstead.ogg` | Ironroot Farmstead | Heavy folk drums, anvil strikes, sturdy | 2:25 | Yes |
| 026 | `bgm_crystalbloom_terrace.ogg` | Crystalbloom Terrace | Celesta sparkle, crystal cave reverb | 2:45 | Yes |
| 027 | `bgm_copperfield_meadow.ogg` | Copperfield Meadow | Tin whistle, rolling hills lightness | 2:20 | Yes |
| 028 | `bgm_silkwood_grove.ogg` | Silkwood Grove | Sitar-like strings, silk rustling textures | 2:55 | Yes |
| 029 | `bgm_emberglow_estate.ogg` | Emberglow Estate | Warm fireplace cello, ember crackles | 2:35 | Yes |
| 030 | `bgm_starfall_ranch.ogg` | Starfall Ranch | Stargazing synth pads, nighttime crickets | 2:40 | Yes |

---

## 2. UI Sound Effects (15 SFX)

Short, responsive UI sounds for menus, buttons, and navigation.

| # | File Name | Trigger | Description | Duration |
|---|-----------|---------|-------------|----------|
| 031 | `ui_button_hover.ogg` | Mouse hover over any button/icon | Soft tonal tick, subtle wooden click | 50ms |
| 032 | `ui_button_click.ogg` | Click any button/icon | Crisp mechanical click with slight reverb | 80ms |
| 033 | `ui_dialog_open.ogg` | Open any dialog/panel | Scroll unrolling whoosh, parchment unfurl | 300ms |
| 034 | `ui_dialog_close.ogg` | Close any dialog/panel | Quick paper fold snap | 200ms |
| 035 | `ui_tab_switch.ogg` | Switch between tabs | Light page turn flick | 120ms |
| 036 | `ui_inventory_open.ogg` | Open inventory/bags | Leather pouch buckle unlatch | 250ms |
| 037 | `ui_item_pickup.ogg` | Pick up item / drag to slot | Small metallic clink | 100ms |
| 038 | `ui_item_drop.ogg` | Drop item from slot | Thud with cloth rustling | 150ms |
| 039 | `ui_item_equip.ogg` | Equip weapon or armor | Metal clasp lock with armor jingle | 300ms |
| 040 | `ui_quest_accept.ogg` | Accept a quest | Triumphant horn note + quill scratch | 500ms |
| 041 | `ui_quest_complete.ogg` | Complete a quest | Fanfare stinger, coin shower | 800ms |
| 042 | `ui_level_up.ogg` | Character levels up | Ascending chime cascade + radiant burst | 1200ms |
| 043 | `ui_error.ogg` | Invalid action / error | Low buzz rejection tone | 200ms |
| 044 | `ui_notification.ogg` | Toast notification popup | Gentle bell ding | 150ms |
| 045 | `ui_map_open.ogg` | Open world map | Large parchment unroll + compass click | 400ms |

---

## 3. Combat & Ability Sound Effects (25 SFX)

### General Combat

| # | File Name | Trigger | Description | Duration |
|---|-----------|---------|-------------|----------|
| 046 | `combat_melee_hit.ogg` | Standard melee attack lands | Metal slash impact, flesh thud | 200ms |
| 047 | `combat_melee_miss.ogg` | Melee attack misses | Whoosh of air, sword swipe | 250ms |
| 048 | `combat_melee_crit.ogg` | Critical hit (melee) | Heavy crushing blow + bone crack | 300ms |
| 049 | `combat_ranged_hit.ogg` | Ranged attack lands | Arrow thunk into target | 200ms |
| 050 | `combat_ranged_miss.ogg` | Ranged attack misses | Arrow whizzing past | 300ms |
| 051 | `combat_defend.ogg` | Use Defend action | Shield raise clang, brace stance | 250ms |
| 052 | `combat_flee.ogg` | Flee from combat | Scrambling footsteps, panic run | 400ms |
| 053 | `combat_battle_start.ogg` | Combat encounter begins | Dramatic sword unsheathe + war horn | 600ms |
| 054 | `combat_victory.ogg` | Win a battle | Triumphant brass fanfare + crowd cheer | 1500ms |

### Class Ability SFX

| # | File Name | Class | Abilities Covered | Description | Duration |
|---|-----------|-------|-------------------|-------------|----------|
| 055 | `ability_warrior_strike.ogg` | Warrior | Heroic Strike, Cleave, Rending Strike | Heavy blade slam, ground shake | 350ms |
| 056 | `ability_warrior_shout.ogg` | Warrior | Intimidating Shout, Battle Rage, Rallying Cry | Deep war cry echo | 500ms |
| 057 | `ability_warrior_shield.ogg` | Warrior | Shield Wall | Massive shield slam, metal ring | 400ms |
| 058 | `ability_paladin_holy.ogg` | Paladin | Holy Smite, Judgment | Radiant light burst, divine chime | 400ms |
| 059 | `ability_paladin_shield.ogg` | Paladin | Divine Shield, Blessing of Might, Aura of Resolve | Golden barrier hum, holy resonance | 500ms |
| 060 | `ability_paladin_heal.ogg` | Paladin | Lay on Hands, Consecration | Warm heavenly choir note, healing shimmer | 600ms |
| 061 | `ability_rogue_stab.ogg` | Rogue | Backstab, Shadow Strike, Blade Flurry | Quick dagger pierce, rapid slashes | 250ms |
| 062 | `ability_rogue_stealth.ogg` | Rogue | Stealth, Smoke Bomb, Evasion | Shadow whoosh, vanishing fade | 400ms |
| 063 | `ability_rogue_poison.ogg` | Rogue | Poison Blade | Venom drip sizzle, toxic coating | 300ms |
| 064 | `ability_ranger_shot.ogg` | Ranger | Aimed Shot, Quick Shot, Multi-Shot, Volley | Bow draw + arrow release twang | 350ms |
| 065 | `ability_ranger_nature.ogg` | Ranger | Nature's Blessing, Entangling Roots, Hunters' Mark | Vine growth rustle, nature pulse | 450ms |
| 066 | `ability_mage_fire.ogg` | Mage | Fireball, Flamestrike | Roaring fire whoosh, explosive impact | 400ms |
| 067 | `ability_mage_frost.ogg` | Mage | Frost Armor, Frost Nova, Slow | Ice crystallization crackle, frozen burst | 400ms |
| 068 | `ability_mage_arcane.ogg` | Mage | Arcane Missiles, Mana Shield | Arcane energy hum, electric zaps | 350ms |
| 069 | `ability_cleric_light.ogg` | Cleric | Holy Light, Holy Nova, Smite | Divine radiance wash, warm glow | 500ms |
| 070 | `ability_cleric_prayer.ogg` | Cleric | Prayer of Fortitude, Divine Protection, Renew, Spirit of Redemption | Whispered prayer echo, blessed aura | 600ms |
| 071 | `ability_warlock_shadow.ogg` | Warlock | Shadow Bolt, Corruption | Dark energy crackle, void rip | 350ms |
| 072 | `ability_warlock_drain.ogg` | Warlock | Drain Life, Siphon Soul, Curse of Weakness | Soul-sucking vortex, eerie wail | 500ms |
| 073 | `ability_warlock_fear.ogg` | Warlock | Howl of Terror, Soul Shield | Demonic howl, terror scream | 450ms |
| 074 | `ability_monk_strike.ogg` | Monk | Palm Strike, Chi Burst, Flying Kick, Whirlwind Kick | Rapid martial arts impacts, ki burst | 300ms |
| 075 | `ability_monk_focus.ogg` | Monk | Inner Focus, Meditation, Disable | Deep breath, inner energy hum, chi flow | 500ms |

### Status Effect SFX

| # | File Name | Trigger | Description | Duration |
|---|-----------|---------|-------------|----------|
| 076 | `status_poison_tick.ogg` | Poison damage tick | Bubbling acid drip | 200ms |
| 077 | `status_regen_tick.ogg` | Regeneration heal tick | Gentle sparkle shimmer | 200ms |
| 078 | `status_haste.ogg` | Haste applied | Quick tempo speed whoosh | 300ms |
| 079 | `status_slow.ogg` | Slow applied | Heavy sluggish drone | 300ms |
| 080 | `status_stop.ogg` | Stop applied | Time freeze crackle, clock halt | 350ms |

---

## 4. Profession Sound Effects (12 SFX)

| # | File Name | Profession | Trigger | Description | Duration |
|---|-----------|-----------|---------|-------------|----------|
| 081 | `prof_mining_hit.ogg` | Mining | Strike ore deposit | Pickaxe on stone clang, rock crumble | 300ms |
| 082 | `prof_mining_success.ogg` | Mining | Ore extracted | Crystal chime + rock split | 400ms |
| 083 | `prof_herbalism_gather.ogg` | Herbalism | Gather herb | Leaf pluck, gentle stem snap, rustling | 350ms |
| 084 | `prof_herbalism_success.ogg` | Herbalism | Herb collected | Floral sparkle, nature whisper | 400ms |
| 085 | `prof_skinning_cut.ogg` | Skinning | Skin a beast | Knife slice, leather stretch tear | 350ms |
| 086 | `prof_blacksmith_hammer.ogg` | Blacksmithing | Craft weapon/armor | Anvil hammer strike, metal ring, forge hiss | 400ms |
| 087 | `prof_alchemy_brew.ogg` | Alchemy | Brew potion | Bubbling cauldron, liquid pour, cork pop | 500ms |
| 088 | `prof_cooking_sizzle.ogg` | Cooking | Cook a meal | Pan sizzle, stirring, fire crackle | 500ms |
| 089 | `prof_leatherwork_stitch.ogg` | Leatherworking | Craft leather item | Needle through hide, thread pull | 350ms |
| 090 | `prof_jewelcraft_cut.ogg` | Jewelcrafting | Cut gem / forge jewelry | Gem facet clink, precision tap, sparkle | 400ms |
| 091 | `prof_craft_success.ogg` | All Crafting | Item successfully crafted | Completion chime + item materialize shimmer | 600ms |
| 092 | `prof_craft_fail.ogg` | All Crafting | Craft attempt fails | Fizzle out, crumble, disappointed tone | 400ms |

---

## 5. Movement & Navigation SFX (8 SFX)

| # | File Name | Trigger | Description | Duration |
|---|-----------|---------|-------------|----------|
| 093 | `move_footstep_grass.ogg` | Walk on grass/meadow terrain | Soft grass crunch step | 150ms |
| 094 | `move_footstep_stone.ogg` | Walk on stone/citadel terrain | Hard boot on cobblestone | 150ms |
| 095 | `move_footstep_dirt.ogg` | Walk on dirt/wasteland terrain | Dry earth pad step | 150ms |
| 096 | `move_footstep_snow.ogg` | Walk on snow/frost terrain | Snow compression crunch | 150ms |
| 097 | `move_footstep_wood.ogg` | Walk on wood/indoor terrain | Hollow wooden board creak | 150ms |
| 098 | `move_zone_transition.ogg` | Enter a new zone | Magical whoosh portal sweep + area reveal | 800ms |
| 099 | `move_portal_enter.ogg` | Step into a portal | Swirling vortex pull, dimensional warp | 600ms |
| 100 | `move_mount_gallop.ogg` | Mounted movement (future) | Horse hooves clopping rhythm | 300ms |

---

## 6. Ambient Zone Loops (10 SFX)

Layered ambient loops that play underneath zone BGM for immersion. Lower volume, continuous.

| # | File Name | Zone Type | Description | Duration |
|---|-----------|-----------|-------------|----------|
| 101 | `amb_forest.ogg` | Dark Forest, Emerald Woods, Silkwood Grove | Rustling leaves, distant owl, creaking branches | 30s loop |
| 102 | `amb_meadow.ogg` | Wild Meadow, Sunflower Fields, Copperfield Meadow | Crickets, gentle breeze, birdsong | 30s loop |
| 103 | `amb_mountain.ogg` | Viridian Range, Frostfall Ridge, Stormbreak Pass | Howling wind, distant rockfall, eagle cry | 30s loop |
| 104 | `amb_water.ogg` | Lake Lumina, Shattered Coast, Willowfen Pastures | Lapping waves, flowing stream, water drips | 30s loop |
| 105 | `amb_cave.ogg` | Azurshard Chasm | Deep echoes, dripping water, distant rumble | 30s loop |
| 106 | `amb_village.ogg` | Village Square, Harvest Hollow, homesteads | Crowd murmur, blacksmith clang, chickens | 30s loop |
| 107 | `amb_night.ogg` | All zones (night cycle) | Crickets, owls, wolf howl, rustling | 30s loop |
| 108 | `amb_rain.ogg` | Dynamic weather overlay | Steady rainfall, thunder rumble | 30s loop |
| 109 | `amb_wind.ogg` | Windswept Bluffs, Northwind Hollow | Strong gusting wind, sand/snow particles | 30s loop |
| 110 | `amb_garden.ogg` | Moonpetal Gardens, Dewveil Orchard, Crystalbloom Terrace | Bees buzzing, fountain trickle, wind chimes | 30s loop |

---

## 7. Chat & Social SFX (6 SFX)

| # | File Name | Trigger | Description | Duration |
|---|-----------|---------|-------------|----------|
| 111 | `chat_message_send.ogg` | Send a chat message | Quick pen scratch whoosh | 100ms |
| 112 | `chat_message_receive.ogg` | Receive a chat message | Soft pop notification | 120ms |
| 113 | `chat_whisper_receive.ogg` | Receive a direct/whisper message | Hushed mystical whisper tone | 200ms |
| 114 | `chat_global_announce.ogg` | Global/system announcement | Town crier horn blast | 400ms |
| 115 | `chat_party_invite.ogg` | Receive party invitation | Friendly chime + handshake sound | 300ms |
| 116 | `chat_guild_announce.ogg` | Guild message / guild event | Banner unfurl with guild horn | 350ms |

---

## 8. Death & Respawn SFX (4 SFX)

| # | File Name | Trigger | Description | Duration |
|---|-----------|---------|-------------|----------|
| 117 | `death_player.ogg` | Player character dies | Heavy body collapse, fading heartbeat, soul departure whoosh | 1200ms |
| 118 | `death_enemy.ogg` | Enemy/mob is killed | Creature death cry, body dissolve shimmer | 600ms |
| 119 | `death_boss.ogg` | Boss enemy defeated | Massive explosion, ground shake, triumphant echo | 1500ms |
| 120 | `respawn_player.ogg` | Player respawns at graveyard/town | Ethereal reassembly, light coalesce, heartbeat resume | 1000ms |

---

## 9. Loot & Economy SFX (6 SFX)

| # | File Name | Trigger | Description | Duration |
|---|-----------|---------|-------------|----------|
| 121 | `loot_drop.ogg` | Loot drops from enemy | Items scattering on ground, sparkle | 300ms |
| 122 | `loot_pickup_common.ogg` | Pick up common item | Simple grab thud | 150ms |
| 123 | `loot_pickup_rare.ogg` | Pick up rare/epic item | Gleaming chime + magical reveal | 400ms |
| 124 | `economy_coins_gain.ogg` | Receive gold/copper | Coin jingle shower | 300ms |
| 125 | `economy_coins_spend.ogg` | Spend gold at shop | Register cha-ching, coins sliding | 250ms |
| 126 | `economy_auction_sold.ogg` | Auction house item sold | Gavel slam + coin cascade | 400ms |

---

## 10. Implementation Guide

### File Structure

```
/public/audio/
  /bgm/
    bgm_village_square.ogg
    bgm_wild_meadow.ogg
    ... (30 zone BGM files)
  /sfx/
    /ui/
      ui_button_hover.ogg
      ui_button_click.ogg
      ... (15 UI SFX files)
    /combat/
      combat_melee_hit.ogg
      ability_warrior_strike.ogg
      status_poison_tick.ogg
      ... (35 combat SFX files)
    /profession/
      prof_mining_hit.ogg
      prof_herbalism_gather.ogg
      ... (12 profession SFX files)
    /movement/
      move_footstep_grass.ogg
      move_zone_transition.ogg
      ... (8 movement SFX files)
    /ambient/
      amb_forest.ogg
      amb_meadow.ogg
      ... (10 ambient loop files)
    /chat/
      chat_message_send.ogg
      ... (6 chat SFX files)
    /death/
      death_player.ogg
      respawn_player.ogg
      ... (4 death/respawn SFX files)
    /loot/
      loot_drop.ogg
      economy_coins_gain.ogg
      ... (6 loot/economy SFX files)
```

### Audio Format Specs

| Property | Value |
|----------|-------|
| Format | OGG Vorbis (primary), MP3 (fallback) |
| Sample Rate | 44.1 kHz |
| Bit Rate | 128 kbps (SFX), 192 kbps (BGM) |
| Channels | Stereo (BGM, Ambient), Mono (SFX) |
| Normalization | -14 LUFS (BGM), -12 LUFS (SFX) |

### Volume Mixing Defaults

| Category | Default Volume | User Adjustable |
|----------|---------------|-----------------|
| BGM | 0.08 (8%) | Yes |
| Ambient | 0.05 (5%) | Yes |
| Combat SFX | 0.30 (30%) | Yes |
| UI SFX | 0.15 (15%) | Yes |
| Ability SFX | 0.25 (25%) | Yes |
| Chat SFX | 0.10 (10%) | Yes |
| Movement SFX | 0.08 (8%) | Yes |

### Integration with Existing `useBackgroundMusic.ts`

The existing hook at `client/src/hooks/useBackgroundMusic.ts` handles BGM playback. Extend with:

```typescript
// New hooks to create:
// client/src/hooks/useSoundEffects.ts    - One-shot SFX playback
// client/src/hooks/useAmbientSound.ts    - Looping ambient layers
// client/src/hooks/useCombatSounds.ts    - Combat-specific audio triggers

// SFX Categories for settings panel integration
export type SFXCategory =
  | 'bgm'
  | 'ambient'
  | 'combat'
  | 'ui'
  | 'ability'
  | 'chat'
  | 'movement'
  | 'profession'
  | 'loot'
  | 'death';
```

### Priority for Asset Creation

| Priority | Category | Count | Reason |
|----------|----------|-------|--------|
| P0 | UI SFX | 15 | Instant player feedback, most used |
| P0 | Combat SFX | 9 | Core gameplay loop |
| P1 | Ability SFX | 21 | Class identity |
| P1 | Death/Respawn | 4 | Critical game moments |
| P1 | Zone BGM (top 5) | 5 | Starting zones first |
| P2 | Profession SFX | 12 | Crafting engagement |
| P2 | Chat SFX | 6 | Social feedback |
| P2 | Movement SFX | 8 | Immersion |
| P3 | Remaining Zone BGM | 25 | Full world coverage |
| P3 | Ambient Loops | 10 | Deep immersion layer |
| P3 | Status Effect SFX | 5 | Combat polish |
| P3 | Loot/Economy SFX | 6 | Reward feedback |

---

**Total: 126 audio assets** (30 BGM + 96 SFX)
