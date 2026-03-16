# World of Geneva - Client-XR Master Asset List
## Anime Fantasy WoW Art Direction

> **Style Target:** Anime-stylized fantasy MMO — think Final Fantasy XIV meets Genshin Impact meets World of Warcraft.
> Low-poly but expressive, vibrant colors, exaggerated proportions, glowing magical effects.

> **Format:** GLB (with Draco compression) for all 3D models
> **Pipeline:** Tripo3D AI generation → optimize → `/client-xr/public/models/`

---

## Table of Contents

1. [What Exists vs What's Missing](#1-what-exists-vs-whats-missing)
2. [Character Models](#2-character-models)
3. [Weapons (8 Types × 5 Quality Tiers)](#3-weapons)
4. [Armor Sets (7 Slots × 3 Materials × 5 Qualities)](#4-armor-sets)
5. [Monster & Boss Models (152 Mobs + 8 Bosses)](#5-monster--boss-models)
6. [NPC Models](#6-npc-models)
7. [Environment - Vegetation](#7-environment---vegetation)
8. [Environment - Structures & Buildings](#8-environment---structures--buildings)
9. [Environment - Props & Furniture](#9-environment---props--furniture)
10. [Environment - Terrain Textures](#10-environment---terrain-textures)
11. [Resource Nodes](#11-resource-nodes)
12. [Crafting Stations](#12-crafting-stations)
13. [Items & Loot (Inventory Icons / 3D Drops)](#13-items--loot)
14. [Spell & Ability VFX](#14-spell--ability-vfx)
15. [UI & HUD Art](#15-ui--hud-art)
16. [Skybox & Atmosphere](#16-skybox--atmosphere)
17. [Mounts & Pets (Future)](#17-mounts--pets-future)
18. [Priority Matrix](#18-priority-matrix)

---

## 1. What Exists vs What's Missing

### Currently Have (32 GLB models + 6 textures + 6 skybox faces)

| Asset | File | Status |
|-------|------|--------|
| Oak Tree | `oak_tree.glb` | ✅ In-game |
| Pine Tree | `pine_tree.glb` | ✅ In-game |
| Dead Tree | `dead_tree.glb` | ✅ Loaded, not placed |
| Tree Stump | `tree_stump.glb` | ✅ In-game |
| Bush | `bush.glb` | ✅ In-game |
| Boulder | `boulder.glb` | ✅ In-game |
| Rock Cluster | `rock_cluster.glb` | ✅ In-game |
| Cliff Face | `cliff_face.glb` | ✅ Loaded, not placed |
| Tall Grass | `tall_grass.glb` | ✅ Loaded, not placed |
| Flower Patch | `flower_patch.glb` | ✅ In-game (herbalism) |
| Reeds | `reeds.glb` | ✅ Loaded, not placed |
| Stone Wall | `stone_wall.glb` | ✅ In-game |
| Wooden Fence | `wooden_fence.glb` | ✅ In-game |
| Wooden Door | `wooden_door.glb` | ✅ Loaded, not placed |
| Roof Thatch | `roof_thatch.glb` | ✅ Loaded, not placed |
| Portal Frame | `portal_frame.glb` | ✅ In-game |
| Torch | `torch.glb` | ✅ Loaded, not placed |
| Well | `well.glb` | ✅ Loaded, not placed |
| Crate | `crate.glb` | ✅ Loaded, not placed |
| Barrel | `barrel.glb` | ✅ Loaded, not placed |
| Market Stall | `market_stall.glb` | ✅ Loaded, not placed |
| Bridge | `bridge.glb` | ✅ Loaded, not placed |
| Signpost | `signpost.glb` | ✅ Loaded, not placed |
| Campfire | `campfire.glb` | ✅ Loaded, not placed |
| Dock | `dock.glb` | ✅ Loaded, not placed |
| Rare Ore | `rare_ore.glb` | ✅ In-game (mining) |
| Shadow Wolf | `shadow_wolf.glb` | ✅ In-game |
| Dark Cultist | `dark_cultist.glb` | ✅ In-game |
| Undead Knight | `undead_knight.glb` | ✅ In-game |
| Forest Troll | `forest_troll.glb` | ✅ In-game |
| Ancient Golem | `ancient_golem.glb` | ✅ In-game |
| Necromancer Boss | `necromancer_boss.glb` | ✅ In-game |

### Currently Procedural (Geometry Primitives — Needs Real Models)

- **ALL player character bodies** — capsules/spheres/cylinders
- **ALL 8 weapon types** — box/cylinder/torus primitives
- **ALL armor pieces** (7 slots × 3 materials) — capsule/sphere/torus primitives
- **ALL NPCs** — reuse player rig primitives
- **146 of 152 mob types** — fallback colored capsules (only 6 have GLB)
- **ALL crafting stations** — colored boxes
- **ALL resource nodes** — dodecahedrons/cones

---

## 2. Character Models

> Currently: 18-bone procedural rig built from capsules/spheres.
> Goal: Anime-style character base meshes that attach to the existing bone system.

### Base Body Models (by Race × Gender = 8 models)

| # | Model Name | Description | Prompt Keyword |
|---|-----------|-------------|----------------|
| 1 | `human_male_base.glb` | Human male body, medium athletic build | Anime fantasy human male warrior body, JRPG style |
| 2 | `human_female_base.glb` | Human female body, athletic build | Anime fantasy human female body, JRPG proportions |
| 3 | `elf_male_base.glb` | Elf male, slender tall build, pointed ears | Anime high elf male, slender, pointed ears, ethereal |
| 4 | `elf_female_base.glb` | Elf female, graceful build, pointed ears | Anime high elf female, graceful, pointed ears |
| 5 | `dwarf_male_base.glb` | Dwarf male, stocky broad build, shorter | Anime fantasy dwarf male, stocky, barrel-chested |
| 6 | `dwarf_female_base.glb` | Dwarf female, sturdy build, shorter | Anime fantasy dwarf female, sturdy, compact |
| 7 | `beastkin_male_base.glb` | Beastkin male, feral features, animal ears/tail | Anime beast-folk male, wolf ears, tail, claws |
| 8 | `beastkin_female_base.glb` | Beastkin female, feral features, animal ears/tail | Anime beast-folk female, fox ears, tail, agile |

### Hair Models (12 styles — unisex, attach to Head bone)

| # | Model Name | Style | Prompt Keyword |
|---|-----------|-------|----------------|
| 1 | `hair_short.glb` | Short cropped | Anime short spiky hair, fantasy RPG |
| 2 | `hair_long.glb` | Long flowing | Anime long flowing hair, JRPG protagonist |
| 3 | `hair_mohawk.glb` | Mohawk/punk | Anime mohawk hairstyle, punk fantasy |
| 4 | `hair_ponytail.glb` | High ponytail | Anime high ponytail, samurai style |
| 5 | `hair_braided.glb` | Braided | Anime braided hair, viking fantasy |
| 6 | `hair_locs.glb` | Dreadlocks | Anime dreadlocks hairstyle |
| 7 | `hair_afro.glb` | Afro | Anime afro hairstyle, fantasy |
| 8 | `hair_cornrows.glb` | Cornrows | Anime cornrows hairstyle |
| 9 | `hair_bantu_knots.glb` | Bantu knots | Anime bantu knots hairstyle |
| 10 | `hair_bangs.glb` | Side bangs | Anime side swept bangs, JRPG |
| 11 | `hair_topknot.glb` | Top knot/bun | Anime top knot bun, martial arts |
| 12 | *(bald — no model needed)* | — | — |

**Total Character Models: 20**

---

## 3. Weapons

> Currently: Procedural geometry (boxes, cylinders, torus shapes).
> Goal: Anime-fantasy styled weapon GLBs. Each type needs ONE base model — quality is shown via shader color/glow.

### Weapon Models (8 base types)

| # | Model Name | Type | Description | Prompt Keyword |
|---|-----------|------|-------------|----------------|
| 1 | `weapon_sword.glb` | Sword | Longsword, broad blade | Anime fantasy longsword, ornate crossguard, WoW style |
| 2 | `weapon_axe.glb` | Axe | Two-handed battle axe | Anime fantasy battle axe, large crescent blade, glowing runes |
| 3 | `weapon_staff.glb` | Staff | Mage staff with crystal orb | Anime mage staff, floating crystal orb top, arcane runes |
| 4 | `weapon_bow.glb` | Bow | Elegant longbow | Anime fantasy longbow, elven curved limbs, glowing string |
| 5 | `weapon_dagger.glb` | Dagger | Rogue's curved dagger | Anime fantasy dagger, curved blade, assassin style |
| 6 | `weapon_mace.glb` | Mace | Heavy flanged mace | Anime fantasy mace, spiked head, paladin style |
| 7 | `weapon_pickaxe.glb` | Pickaxe | Mining tool | Fantasy mining pickaxe, dwarven crafted |
| 8 | `weapon_sickle.glb` | Sickle | Harvesting sickle | Fantasy harvesting sickle, druidic curved blade |

### Shield Model (1)

| # | Model Name | Description | Prompt Keyword |
|---|-----------|-------------|----------------|
| 9 | `weapon_shield.glb` | Kite shield | Anime fantasy kite shield, lion emblem, metallic |

**Tier Variants (visual only — handled by shader):**
- Common: Gray metal
- Uncommon: Green glow
- Rare: Blue glow
- Epic: Purple glow
- Legendary: Orange/gold glow + particle aura

**Total Weapon Models: 9**

---

## 4. Armor Sets

> Currently: Procedural capsules/spheres/torus shapes per bone.
> Goal: Modular armor pieces that snap to the existing 18-bone rig. 3 material themes × 7 slots.

### Armor Slots × Material Variants (21 models)

#### Plate Armor Set (Heavy — Warriors, Paladins)

| # | Model Name | Slot | Bone | Prompt Keyword |
|---|-----------|------|------|----------------|
| 1 | `armor_plate_helm.glb` | Helm | Head | Anime fantasy plate helmet, full visor, knight, WoW style |
| 2 | `armor_plate_chest.glb` | Chest | Chest | Anime plate breastplate, ornate, pauldron-ready |
| 3 | `armor_plate_shoulders.glb` | Shoulders | L/R Shoulder | Anime plate pauldrons, spiked, WoW oversized style |
| 4 | `armor_plate_legs.glb` | Legs | L/R Knee | Anime plate greaves, articulated knee guards |
| 5 | `armor_plate_boots.glb` | Boots | L/R Foot | Anime plate sabatons, armored boots |
| 6 | `armor_plate_gloves.glb` | Gloves | L/R Hand | Anime plate gauntlets, clawed fingers |
| 7 | `armor_plate_belt.glb` | Belt | Hip | Anime plate war belt, skull buckle, pouches |

#### Chain Armor Set (Medium — Rangers, Monks, Clerics)

| # | Model Name | Slot | Bone | Prompt Keyword |
|---|-----------|------|------|----------------|
| 8 | `armor_chain_helm.glb` | Helm | Head | Anime chainmail coif, open face, fantasy |
| 9 | `armor_chain_chest.glb` | Chest | Chest | Anime chainmail hauberk, layered rings |
| 10 | `armor_chain_shoulders.glb` | Shoulders | L/R Shoulder | Anime chain shoulder guards, mail drape |
| 11 | `armor_chain_legs.glb` | Legs | L/R Knee | Anime chain leggings, knee pads |
| 12 | `armor_chain_boots.glb` | Boots | L/R Foot | Anime chain boots, reinforced toe |
| 13 | `armor_chain_gloves.glb` | Gloves | L/R Hand | Anime chain gloves, fingerless mail |
| 14 | `armor_chain_belt.glb` | Belt | Hip | Anime chain belt, ring buckle |

#### Leather Armor Set (Light — Rogues, Mages, Warlocks)

| # | Model Name | Slot | Bone | Prompt Keyword |
|---|-----------|------|------|----------------|
| 15 | `armor_leather_helm.glb` | Helm | Head | Anime leather hood, assassin/ranger style |
| 16 | `armor_leather_chest.glb` | Chest | Chest | Anime leather vest, buckles, rogue style |
| 17 | `armor_leather_shoulders.glb` | Shoulders | L/R Shoulder | Anime leather shoulder pads, straps |
| 18 | `armor_leather_legs.glb` | Legs | L/R Knee | Anime leather pants, knee wraps |
| 19 | `armor_leather_boots.glb` | Boots | L/R Foot | Anime leather boots, buckled, adventurer |
| 20 | `armor_leather_gloves.glb` | Gloves | L/R Hand | Anime leather bracers, hand wraps |
| 21 | `armor_leather_belt.glb` | Belt | Hip | Anime leather belt, potion pouches, thief |

### Jewelry (optional 3D — could be shader-only)

| # | Model Name | Slot | Prompt Keyword |
|---|-----------|------|----------------|
| 22 | `jewelry_ring_ruby.glb` | Ring | Fantasy ruby ring, gold band, glowing gem |
| 23 | `jewelry_ring_sapphire.glb` | Ring | Fantasy sapphire ring, silver band |
| 24 | `jewelry_ring_emerald.glb` | Ring | Fantasy emerald ring, nature-themed |
| 25 | `jewelry_amulet_diamond.glb` | Amulet | Fantasy diamond amulet, pendant, holy |
| 26 | `jewelry_amulet_shadow.glb` | Amulet | Fantasy dark opal amulet, shadow energy |
| 27 | `jewelry_amulet_arcane.glb` | Amulet | Fantasy arcane crystal amulet, mage |

**Total Armor Models: 21 (+ 6 optional jewelry = 27)**

---

## 5. Monster & Boss Models

> Currently: Only 6 mob GLBs exist. The other 146 mob types render as colored capsules.
> These are grouped by visual archetype — many mobs can share a model with recolor/rescale.

### Existing Models (6) ✅

| Model | Used For |
|-------|----------|
| `shadow_wolf.glb` | All wolves (shadow wolf, dire wolf, frost wolf, etc.) |
| `dark_cultist.glb` | All cultists |
| `undead_knight.glb` | All undead/skeletons |
| `forest_troll.glb` | All trolls |
| `ancient_golem.glb` | All golems |
| `necromancer_boss.glb` | Necromancer Valdris boss |

### Needed Monster Models — Grouped by Visual Archetype

#### Beasts (Natural Creatures)

| # | Model Name | Reused By | Zones | Prompt Keyword |
|---|-----------|-----------|-------|----------------|
| 1 | `mob_slime.glb` | Green Slime, Toxic Slime, Crystal Slime, Lava Slime, Void Slime, Swamp Slime | village-square, multiple | Anime fantasy slime monster, translucent, bouncy, JRPG |
| 2 | `mob_rat.glb` | Field Rat, Sewer Rat, Plague Rat, Shadow Rat | village-square, wild-meadow | Anime giant rat, glowing eyes, fantasy RPG |
| 3 | `mob_boar.glb` | Wild Boar, Razorback Boar, Ironhide Boar | wild-meadow | Anime wild boar, tusked, aggressive, fantasy |
| 4 | `mob_bear.glb` | Forest Bear, Cave Bear, Dire Bear, Shadow Bear, Moonbear | wild-meadow, dark-forest | Anime fantasy bear, massive, armored fur |
| 5 | `mob_spider.glb` | Giant Spider, Poison Spider, Brood Mother, Crystal Spider, Phase Spider | dark-forest, multiple | Anime giant spider, glowing abdomen, fantasy horror |
| 6 | `mob_bat.glb` | Cave Bat, Vampire Bat, Shadow Bat | dark-forest | Anime fantasy bat, large wings, red eyes |
| 7 | `mob_snake.glb` | Viper, Shadow Serpent, Basilisk, Sea Serpent | multiple | Anime fantasy serpent, coiled, venomous |
| 8 | `mob_hawk.glb` | Storm Hawk, Thunder Hawk, Sky Raptor | auroral-plains | Anime fantasy hawk, lightning wings, majestic |
| 9 | `mob_beetle.glb` | Iron Beetle, Crystal Beetle, Fire Beetle | viridian-range | Anime giant beetle, armored carapace, fantasy |
| 10 | `mob_scorpion.glb` | Sand Scorpion, Crystal Scorpion | azurshard-chasm | Anime giant scorpion, crystal stinger, fantasy |
| 11 | `mob_drake.glb` | Young Drake, Storm Drake, Fire Drake, Frost Drake | multiple high-level | Anime wyvern/drake, small dragon, wingless or small wings |
| 12 | `mob_stag.glb` | Forest Stag, Spirit Stag, Moonlit Stag | emerald-woods, moondancer-glade | Anime spirit deer, glowing antlers, ethereal |

#### Undead & Dark (share skeleton base)

| # | Model Name | Reused By | Zones | Prompt Keyword |
|---|-----------|-----------|-------|----------------|
| 13 | `mob_skeleton.glb` | Skeleton Warrior, Skeleton Archer, Skeleton Mage, Bone Guardian | dark-forest, felsrock | Anime skeleton warrior, rusty armor, glowing eyes |
| 14 | `mob_ghost.glb` | Restless Spirit, Wailing Ghost, Phantom, Wraith, Banshee | dark-forest, multiple | Anime ghost, translucent, flowing robes, eerie glow |
| 15 | `mob_zombie.glb` | Shambling Corpse, Plague Zombie, Risen Dead | dark-forest | Anime zombie, decaying, glowing green eyes |
| 16 | `mob_lich.glb` | Lich Acolyte, Bone Lich | felsrock-citadel | Anime lich, floating, crown, dark robes, soul fire |
| 17 | `mob_vampire.glb` | Vampire Thrall, Vampire Lord | felsrock-citadel | Anime vampire, pale, red eyes, cape, aristocratic |
| 18 | `mob_death_knight.glb` | Death Knight, Fallen Paladin | felsrock-citadel | Anime death knight, dark plate armor, runed sword |

#### Humanoid Enemies

| # | Model Name | Reused By | Zones | Prompt Keyword |
|---|-----------|-----------|-------|----------------|
| 19 | `mob_goblin.glb` | Goblin Scout, Goblin Shaman, Goblin Raider, Goblin Chieftain | wild-meadow, dark-forest | Anime goblin, green skin, oversized ears, crude weapon |
| 20 | `mob_bandit.glb` | Bandit, Highwayman, Outlaw, Marauder | wild-meadow, multiple | Anime human bandit, hooded, dual daggers, leather |
| 21 | `mob_orc.glb` | Orc Grunt, Orc Berserker, Orc Warlord | viridian-range | Anime orc, green skin, tusks, massive, tribal armor |
| 22 | `mob_dark_mage.glb` | Dark Mage, Shadow Caster, Void Sorcerer | dark-forest, felsrock | Anime dark mage, hooded robes, floating grimoire |
| 23 | `mob_witch.glb` | Swamp Witch, Hedge Witch, Night Hag | dark-forest, moondancer | Anime witch, pointed hat, cauldron, gnarled staff |
| 24 | `mob_harpy.glb` | Harpy, Storm Harpy, Harpy Matriarch | auroral-plains | Anime harpy, feathered wings, talons, screaming |

#### Elementals & Magical Creatures

| # | Model Name | Reused By | Zones | Prompt Keyword |
|---|-----------|-----------|-------|----------------|
| 25 | `mob_elemental_fire.glb` | Fire Elemental, Infernal, Magma Brute | felsrock-citadel | Anime fire elemental, living flame, molten core |
| 26 | `mob_elemental_water.glb` | Water Elemental, Tide Lurker | lake-lumina | Anime water elemental, flowing liquid body, glowing |
| 27 | `mob_elemental_earth.glb` | Earth Elemental, Stone Sentinel | viridian-range | Anime earth elemental, rocky body, crystal growths |
| 28 | `mob_elemental_lightning.glb` | Storm Elemental, Thunder Sprite | auroral-plains | Anime lightning elemental, crackling energy body |
| 29 | `mob_treant.glb` | Corrupted Treant, Ancient Treant, Thornguard | emerald-woods | Anime treant, walking tree, glowing eyes, mossy |
| 30 | `mob_mushroom.glb` | Spore Walker, Fungal Beast, Myconid | dark-forest | Anime mushroom monster, spotted cap, spore cloud |
| 31 | `mob_wisp.glb` | Will-o-Wisp, Fey Wisp, Moon Wisp | moondancer-glade | Anime floating wisp, orb of light, fairy-like |
| 32 | `mob_fairy.glb` | Dark Fairy, Pixie, Fey Guardian | moondancer-glade | Anime dark fairy, butterfly wings, tiny, magical |

#### Large / Elite Creatures

| # | Model Name | Reused By | Zones | Prompt Keyword |
|---|-----------|-----------|-------|----------------|
| 33 | `mob_ogre.glb` | Ogre, Hill Giant, Frost Giant | viridian-range | Anime ogre, massive, club, dumb expression |
| 34 | `mob_minotaur.glb` | Minotaur, Labyrinth Guardian | felsrock-citadel | Anime minotaur, bull head, massive axe, muscular |
| 35 | `mob_wyvern.glb` | Wyvern, Poison Wyvern | azurshard-chasm | Anime wyvern, bat wings, spiked tail, flying pose |
| 36 | `mob_centaur.glb` | Centaur Archer, Centaur Warrior | auroral-plains | Anime centaur, horse body, human torso, bow |
| 37 | `mob_gargoyle.glb` | Gargoyle, Stone Gargoyle | felsrock-citadel | Anime gargoyle, stone wings, perched, demonic |

### Boss Models (8 — Unique, High-Detail)

| # | Model Name | Boss Name | Zone | Level | Prompt Keyword |
|---|-----------|-----------|------|-------|----------------|
| 1 | `boss_necromancer.glb` | Necromancer Valdris | dark-forest | 16 | ✅ EXISTS as `necromancer_boss.glb` |
| 2 | `boss_drake.glb` | Skyward Drake | auroral-plains | 20 | Anime sky dragon, white/gold scales, lightning breath, majestic |
| 3 | `boss_grom.glb` | Grom Sentinel | emerald-woods | 25 | Anime ancient tree guardian, massive treant, glowing rune core |
| 4 | `boss_titan.glb` | Avalanche Titan | viridian-range | 30 | Anime frost titan, ice armor, mountain-sized, avalanche fists |
| 5 | `boss_archdruid.glb` | Moondancer Archdruid | moondancer-glade | 35 | Anime corrupted archdruid, antlers, moonlight aura, shapeshifter |
| 6 | `boss_infernal.glb` | Forgemaster Infernal | felsrock-citadel | 40 | Anime forge demon, molten armor, giant hammer, lava veins |
| 7 | `boss_solaris.glb` | Solaris Warden | lake-lumina | 45 | Anime solar angel guardian, radiant wings, holy sword, blinding |
| 8 | `boss_dragon.glb` | Azurshard Dragon | azurshard-chasm | 50 | Anime crystal dragon, azure scales, massive, gem breath, final boss |

**Total Monster/Boss Models Needed: 37 new (+ 6 existing = 43 total)**

---

## 6. NPC Models

> Currently: NPCs use the same procedural player rig (capsule bodies).
> Goal: Distinctive NPC models or at least unique outfit sets per NPC archetype.

### NPC Archetype Models

| # | Model Name | Used By | Count | Prompt Keyword |
|---|-----------|---------|-------|----------------|
| 1 | `npc_guard.glb` | Guard Captain Marcus, town guards | ~5 | Anime fantasy town guard, plate armor, spear, cape |
| 2 | `npc_merchant.glb` | Grimwald, general merchants | ~10 | Anime fantasy merchant, robes, coin purse, friendly |
| 3 | `npc_blacksmith.glb` | Bron, forge masters, blacksmiths | ~8 | Anime dwarf blacksmith, leather apron, hammer, muscular |
| 4 | `npc_alchemist.glb` | Alchemist trainers | ~4 | Anime alchemist, goggles, bubbling flasks, purple robes |
| 5 | `npc_herbalist.glb` | Herbalism trainers | ~4 | Anime herbalist, druid robes, flower crown, nature |
| 6 | `npc_miner.glb` | Mining trainers | ~4 | Anime miner NPC, hard hat, pickaxe, dusty |
| 7 | `npc_cook.glb` | Cooking trainers, campfire NPCs | ~4 | Anime fantasy cook, chef hat, ladle, jolly |
| 8 | `npc_leatherworker.glb` | Leatherworking trainers | ~3 | Anime leatherworker, tanning tools, leather apron |
| 9 | `npc_jeweler.glb` | Jewelcrafting trainers | ~3 | Anime jeweler, magnifying glass, gems, elegant |
| 10 | `npc_priest.glb` | Priestess Selene, clerics | ~5 | Anime fantasy priestess, white robes, holy staff, gentle |
| 11 | `npc_ranger.glb` | Ranger Thornwood, scouts | ~5 | Anime forest ranger, green cloak, bow, rugged |
| 12 | `npc_mage_elder.glb` | Archmage, lore NPCs | ~5 | Anime elderly wizard, long beard, staff, star robes |
| 13 | `npc_auctioneer.glb` | Auctioneers | ~10 | Anime auctioneer, fancy vest, gavel, theatrical |
| 14 | `npc_arena_master.glb` | Arena Masters | ~10 | Anime arena champion, scarred, gladiator armor, trophy |
| 15 | `npc_guild_registrar.glb` | Guild registrars | ~5 | Anime guild clerk, scrolls, inkwell, official robes |
| 16 | `npc_farmer.glb` | Farmstead NPCs | ~10 | Anime farmer, straw hat, overalls, pitchfork |
| 17 | `npc_innkeeper.glb` | Rest/inn NPCs | ~5 | Anime innkeeper, portly, mug of ale, welcoming |

**Total NPC Models: 17**

---

## 7. Environment - Vegetation

> Trees/bushes exist. Need more variety per biome for the anime fantasy feel.

### Needed Vegetation (by Zone Biome)

| # | Model Name | Biome | Prompt Keyword |
|---|-----------|-------|----------------|
| 1 | `veg_cherry_blossom.glb` | Village/Meadow | Anime cherry blossom tree, pink petals falling, fantasy |
| 2 | `veg_willow.glb` | Lake/Meadow | Anime weeping willow, glowing leaves, mystical |
| 3 | `veg_giant_mushroom.glb` | Dark Forest | Anime giant mushroom tree, bioluminescent, fantasy forest |
| 4 | `veg_crystal_tree.glb` | Azurshard Chasm | Anime crystal tree, translucent branches, gem leaves |
| 5 | `veg_bamboo_cluster.glb` | Moondancer Glade | Anime bamboo grove, moonlit, zen garden feel |
| 6 | `veg_vine_wall.glb` | Emerald Woods | Anime hanging vines, thick jungle wall, mossy |
| 7 | `veg_sunflower_giant.glb` | Sunflower Fields | Anime giant sunflower, oversized, cheerful, farm |
| 8 | `veg_corrupted_tree.glb` | Dark Forest | Anime corrupted tree, dark purple bark, evil faces |
| 9 | `veg_glowing_fern.glb` | Moondancer Glade | Anime glowing ferns, bioluminescent, magical forest floor |
| 10 | `veg_autumn_maple.glb` | Harvest Hollow | Anime autumn maple tree, red/orange leaves, cozy |
| 11 | `veg_cactus.glb` | Auroral Plains (dry areas) | Anime fantasy cactus, crystal flowers, desert |
| 12 | `veg_mangrove.glb` | Willowfen Pastures | Anime mangrove tree, roots in water, swamp |

**Total Vegetation Models: 12 new**

---

## 8. Environment - Structures & Buildings

> Currently: Stone walls and fences only. No actual buildings.
> Goal: Zone-appropriate structures for villages, dungeons, farms.

### Village & Town Structures

| # | Model Name | Description | Prompt Keyword |
|---|-----------|-------------|----------------|
| 1 | `struct_cottage.glb` | Small player home (farmstead stage 1) | Anime fantasy thatched cottage, cozy, chimney smoke |
| 2 | `struct_farmhouse.glb` | Medium home (farmstead stage 2) | Anime fantasy farmhouse, two-story, stone base, wood top |
| 3 | `struct_manor.glb` | Large home (farmstead stage 3) | Anime fantasy manor house, elegant, garden, balcony |
| 4 | `struct_estate.glb` | Grand home (farmstead stage 4) | Anime fantasy estate, mansion, towers, grand entrance |
| 5 | `struct_inn.glb` | Tavern/inn building | Anime fantasy tavern, hanging sign, warm light, stone |
| 6 | `struct_shop.glb` | General store front | Anime fantasy shop, merchant stall, colorful awning |
| 7 | `struct_blacksmith_shop.glb` | Forge building with chimney | Anime blacksmith forge, bellows, anvil outside, smoke |
| 8 | `struct_church.glb` | Temple/church for clerics | Anime fantasy cathedral, stained glass, holy light |
| 9 | `struct_wizard_tower.glb` | Mage tower | Anime wizard tower, crooked, floating books, arcane |
| 10 | `struct_guard_tower.glb` | Watchtower | Anime fantasy guard tower, wooden, lookout platform |
| 11 | `struct_gate_arch.glb` | City/zone entrance gate | Anime fantasy gate arch, stone, carved, imposing |
| 12 | `struct_windmill.glb` | Farm windmill | Anime fantasy windmill, spinning blades, grain bags |
| 13 | `struct_stable.glb` | Stable building | Anime fantasy stable, horse stalls, hay bales |
| 14 | `struct_guild_hall.glb` | Guild headquarters | Anime fantasy guild hall, large banners, trophy wall |

### Dungeon & Dark Structures

| # | Model Name | Description | Prompt Keyword |
|---|-----------|-------------|----------------|
| 15 | `struct_dungeon_entrance.glb` | Cave/dungeon mouth | Anime dungeon entrance, skull arch, dark, ominous |
| 16 | `struct_ruins.glb` | Ancient ruins | Anime fantasy ruins, crumbling columns, overgrown |
| 17 | `struct_dark_altar.glb` | Cultist altar | Anime dark altar, candles, blood runes, sinister |
| 18 | `struct_crypt.glb` | Graveyard crypt entrance | Anime crypt entrance, iron gate, fog, undead |
| 19 | `struct_fortress_wall.glb` | Citadel wall segment | Anime dark fortress wall, obsidian, gargoyle perches |
| 20 | `struct_lava_forge.glb` | Felsrock boss arena forge | Anime demonic forge, lava pools, chains, hellish |

### Farm Structures

| # | Model Name | Description | Prompt Keyword |
|---|-----------|-------------|----------------|
| 21 | `struct_crop_field.glb` | Planted crop rows | Anime farm crop rows, neat furrows, growing plants |
| 22 | `struct_scarecrow.glb` | Scarecrow decoration | Anime fantasy scarecrow, funny hat, patchwork |
| 23 | `struct_water_well.glb` | Farm water well | Anime fantasy well, stone, wooden bucket, rope |
| 24 | `struct_silo.glb` | Grain silo | Anime fantasy grain silo, wooden, farming |
| 25 | `struct_greenhouse.glb` | Crystal greenhouse for herbs | Anime fantasy greenhouse, glass panels, glowing plants |

**Total Structure Models: 25**

---

## 9. Environment - Props & Furniture

> Some exist as GLB (barrel, crate, etc.) but aren't placed. Need more for world detail.

### World Props

| # | Model Name | Status | Prompt Keyword |
|---|-----------|--------|----------------|
| 1 | `prop_barrel.glb` | ✅ EXISTS | — |
| 2 | `prop_crate.glb` | ✅ EXISTS | — |
| 3 | `prop_campfire.glb` | ✅ EXISTS | — |
| 4 | `prop_torch.glb` | ✅ EXISTS | — |
| 5 | `prop_well.glb` | ✅ EXISTS | — |
| 6 | `prop_signpost.glb` | ✅ EXISTS | — |
| 7 | `prop_bridge.glb` | ✅ EXISTS | — |
| 8 | `prop_dock.glb` | ✅ EXISTS | — |
| 9 | `prop_market_stall.glb` | ✅ EXISTS | — |
| 10 | `prop_treasure_chest.glb` | NEEDED | Anime fantasy treasure chest, gold trim, glowing lock |
| 11 | `prop_gravestone.glb` | NEEDED | Anime fantasy gravestone, mossy, cracked, eerie |
| 12 | `prop_statue_hero.glb` | NEEDED | Anime fantasy hero statue, sword raised, pedestal |
| 13 | `prop_statue_goddess.glb` | NEEDED | Anime fantasy goddess statue, flowing robes, blessing |
| 14 | `prop_banner_pole.glb` | NEEDED | Anime fantasy banner, guild/faction flag pole |
| 15 | `prop_wagon.glb` | NEEDED | Anime fantasy merchant wagon, covered, wooden wheels |
| 16 | `prop_boat.glb` | NEEDED | Anime fantasy rowboat, wooden, fishing |
| 17 | `prop_lamp_post.glb` | NEEDED | Anime fantasy street lamp, magical floating flame |
| 18 | `prop_fountain.glb` | NEEDED | Anime fantasy fountain, center statue, magical water |
| 19 | `prop_haystack.glb` | NEEDED | Anime haystack, golden, farm prop |
| 20 | `prop_mining_cart.glb` | NEEDED | Anime mining cart, ore filled, tracks |
| 21 | `prop_weapon_rack.glb` | NEEDED | Anime weapon rack, swords/shields displayed |
| 22 | `prop_potion_shelf.glb` | NEEDED | Anime potion shelf, colorful bottles, bubbling |
| 23 | `prop_anvil.glb` | NEEDED | Anime blacksmith anvil, heavy, dented, sparks |
| 24 | `prop_cauldron.glb` | NEEDED | Anime witch cauldron, bubbling green, tripod |
| 25 | `prop_crystal_cluster.glb` | NEEDED | Anime crystal formation, blue/purple, glowing, cave |

**Total Props: 16 new (+ 9 existing = 25)**

---

## 10. Environment - Terrain Textures

> Currently: 6 basic JPG textures. Need more for biome variety.

### Existing Textures ✅

| Texture | File | Size |
|---------|------|------|
| Grass | `grass.jpg` | 107 KB |
| Dirt | `dirt.jpg` | 58 KB |
| Sand | `sand.jpg` | 43 KB |
| Stone | `stone.jpg` | 56 KB |
| Rock | `rock.jpg` | 49 KB |
| Water | `water.jpg` | 37 KB |

### Needed Textures

| # | Texture Name | Biome | Description |
|---|-------------|-------|-------------|
| 1 | `snow.jpg` | Viridian Range | Snowy ground, frost crystals |
| 2 | `lava_rock.jpg` | Felsrock Citadel | Cracked obsidian with lava veins |
| 3 | `crystal_floor.jpg` | Azurshard Chasm | Blue crystal/gem ground |
| 4 | `swamp.jpg` | Willowfen Pastures | Muddy swamp, moss patches |
| 5 | `cobblestone.jpg` | Village Square | Cobblestone village path |
| 6 | `wood_plank.jpg` | Interiors/Docks | Wooden floor planks |
| 7 | `moonstone.jpg` | Moondancer Glade | Pale luminescent stone |
| 8 | `farmland.jpg` | All farm zones | Tilled dark soil rows |
| 9 | `marble.jpg` | Lake Lumina (temple) | White marble tile with gold veins |
| 10 | `dark_earth.jpg` | Dark Forest | Dark, corrupted soil |

**Total Textures: 10 new (+ 6 existing = 16)**

---

## 11. Resource Nodes

> Currently: `rare_ore.glb` and `flower_patch.glb` exist. Need nodes for all gathering professions.

| # | Model Name | Profession | Description | Prompt Keyword |
|---|-----------|-----------|-------------|----------------|
| 1 | `node_copper_ore.glb` | Mining | Copper vein in rock | Anime copper ore vein, orange metallic, rocky |
| 2 | `node_tin_ore.glb` | Mining | Tin deposit | Anime tin ore deposit, silver-gray, crystal |
| 3 | `node_silver_ore.glb` | Mining | Silver vein, glowing | Anime silver ore vein, shimmering, moonlit |
| 4 | `node_gold_ore.glb` | Mining | Gold vein, bright | Anime gold ore vein, glittering, rich yellow |
| 5 | `node_coal.glb` | Mining | Coal deposit, dark | Anime coal deposit, dark chunks, dusty |
| 6 | `node_herb_meadow_lily.glb` | Herbalism | White flowers | Anime meadow lily cluster, white petals, dewdrops |
| 7 | `node_herb_wild_rose.glb` | Herbalism | Pink roses | Anime wild rose bush, pink blooms, thorny |
| 8 | `node_herb_moonflower.glb` | Herbalism | Glowing night flower | Anime moonflower, glowing petals, ethereal, night |
| 9 | `node_herb_starbloom.glb` | Herbalism | Star-shaped rare herb | Anime starbloom flower, star petals, sparkling |
| 10 | `node_herb_dragons_breath.glb` | Herbalism | Fiery rare plant | Anime dragon's breath plant, red flames, rare herb |
| 11 | `node_skinning_hide.glb` | Skinning | Animal carcass for skinning | Anime fantasy animal hide pile, leather scraps |
| 12 | `node_gem_rough.glb` | Jewelcrafting | Rough gemstone cluster | Anime rough gem cluster, uncut crystals, sparkling |

**Total Resource Node Models: 12**

---

## 12. Crafting Stations

> Currently: Procedural colored boxes. Need proper themed models.

| # | Model Name | Station Type | Count In-World | Prompt Keyword |
|---|-----------|-------------|----------------|----------------|
| 1 | `station_forge.glb` | Forge / Anvil | 18 | Anime fantasy forge, glowing coals, bellows, anvil, sparks |
| 2 | `station_alchemy_lab.glb` | Alchemy Lab | 8 | Anime alchemy lab, bubbling flasks, colored liquids, tubes |
| 3 | `station_enchanting_altar.glb` | Enchanting Altar | 3 | Anime enchanting altar, floating runes, purple glow, arcane |
| 4 | `station_campfire.glb` | Cooking Fire | 11 | Anime fantasy campfire, cooking spit, hanging pot, warm |
| 5 | `station_tanning_rack.glb` | Tanning Rack | 1 | Anime tanning rack, stretched leather, wooden frame |
| 6 | `station_jewelers_bench.glb` | Jeweler's Bench | 1 | Anime jeweler's workbench, magnifying glass, gems, tools |
| 7 | `station_essence_forge.glb` | Essence Forge | varies | Anime magical essence forge, swirling energy, crystal core |
| 8 | `station_loom.glb` | (Future: Tailoring) | — | Anime fantasy loom, magical thread, glowing fabric |

**Total Crafting Station Models: 8**

---

## 13. Items & Loot

> For world drops and inventory display. Small 3D models or 2D icons.

### World-Drop 3D Models (items on ground when dropped)

| # | Model Name | Category | Prompt Keyword |
|---|-----------|----------|----------------|
| 1 | `drop_potion_red.glb` | Health potions | Anime red potion bottle, glowing, corked |
| 2 | `drop_potion_blue.glb` | Mana potions | Anime blue potion bottle, swirling, magical |
| 3 | `drop_potion_green.glb` | Stamina/buff potions | Anime green potion bottle, bubbling |
| 4 | `drop_potion_purple.glb` | Enchantment elixirs | Anime purple elixir bottle, dark, mysterious |
| 5 | `drop_gold_pile.glb` | Gold currency | Anime gold coin pile, sparkling, fantasy |
| 6 | `drop_ore_chunk.glb` | Raw ore materials | Anime raw ore chunk, crystalline facets |
| 7 | `drop_herb_bundle.glb` | Herb materials | Anime herb bundle, tied with string, leafy |
| 8 | `drop_leather_roll.glb` | Leather materials | Anime leather roll, brown, tied |
| 9 | `drop_gem.glb` | Gem materials | Anime uncut gemstone, rough facets, glowing |
| 10 | `drop_scroll.glb` | Scrolls/recipes | Anime magic scroll, rolled, wax seal, glowing |
| 11 | `drop_meat.glb` | Raw meat | Anime fantasy raw meat, drumstick style |
| 12 | `drop_key.glb` | Gate essence keys | Anime fantasy key, ornate, glowing, magical |
| 13 | `drop_food.glb` | Cooked food | Anime fantasy feast plate, steaming, hearty |
| 14 | `drop_gear_bag.glb` | Equipment drops | Anime loot bag, bulging, sparkles leaking |

**Total Loot Drop Models: 14**

---

## 14. Spell & Ability VFX

> Currently: Particle-based orbs, rings, shields (pool-based system).
> Goal: Enhanced VFX textures and meshes for anime-style combat.

### VFX Textures/Sprites Needed

| # | Asset Name | Type | Used By | Prompt Keyword |
|---|-----------|------|---------|----------------|
| 1 | `vfx_slash_arc.png` | Texture | Melee attacks | Anime sword slash arc, white energy trail |
| 2 | `vfx_fire_burst.png` | Texture | Fire spells | Anime fire explosion, orange/red burst |
| 3 | `vfx_ice_crystal.png` | Texture | Ice spells | Anime ice shard formation, blue crystal |
| 4 | `vfx_lightning_bolt.png` | Texture | Lightning spells | Anime lightning bolt, branching, electric blue |
| 5 | `vfx_holy_light.png` | Texture | Holy/heal spells | Anime holy light beam, golden rays, warm |
| 6 | `vfx_shadow_mist.png` | Texture | Dark/warlock spells | Anime shadow mist, purple tendrils, ominous |
| 7 | `vfx_heal_sparkle.png` | Texture | Healing effects | Anime green heal sparkles, floating crosses |
| 8 | `vfx_buff_glow.png` | Texture | Buff auras | Anime power-up glow, ascending particles |
| 9 | `vfx_level_up.png` | Texture | Level up moment | Anime level up burst, golden rings, triumphant |
| 10 | `vfx_portal_swirl.png` | Texture | Zone portals | Anime portal vortex, blue spiral, magical |
| 11 | `vfx_death_soul.png` | Texture | Death effect | Anime soul departing, translucent, ascending |
| 12 | `vfx_craft_sparkle.png` | Texture | Crafting success | Anime crafting sparkle, anvil sparks, magical |

### VFX 3D Models

| # | Asset Name | Type | Used By |
|---|-----------|------|---------|
| 13 | `vfx_magic_circle.glb` | Mesh | Spell casting ground circle |
| 14 | `vfx_shield_bubble.glb` | Mesh | Shield/barrier buff |
| 15 | `vfx_aura_ring.glb` | Mesh | Area-of-effect indicator |

**Total VFX Assets: 15**

---

## 15. UI & HUD Art

> Currently: Programmatic HTML/Canvas HUD. Need themed UI art.

| # | Asset Name | Type | Description |
|---|-----------|------|-------------|
| 1 | `ui_hp_bar_frame.png` | UI | Ornate HP bar border, anime RPG style |
| 2 | `ui_mp_bar_frame.png` | UI | Mana bar border, blue-themed |
| 3 | `ui_xp_bar_frame.png` | UI | XP bar border, gold-themed |
| 4 | `ui_minimap_frame.png` | UI | Ornate minimap circular border |
| 5 | `ui_chat_frame.png` | UI | Chat window border/background |
| 6 | `ui_inventory_slot.png` | UI | Equipment slot frame |
| 7 | `ui_button_normal.png` | UI | Button base state |
| 8 | `ui_button_hover.png` | UI | Button hover state |
| 9 | `ui_button_pressed.png` | UI | Button pressed state |
| 10 | `ui_tooltip_bg.png` | UI | Tooltip background, parchment style |
| 11 | `ui_class_icon_warrior.png` | Icon | Warrior class icon (sword) |
| 12 | `ui_class_icon_paladin.png` | Icon | Paladin class icon (shield+cross) |
| 13 | `ui_class_icon_mage.png` | Icon | Mage class icon (staff/crystal) |
| 14 | `ui_class_icon_rogue.png` | Icon | Rogue class icon (daggers) |
| 15 | `ui_class_icon_ranger.png` | Icon | Ranger class icon (bow) |
| 16 | `ui_class_icon_cleric.png` | Icon | Cleric class icon (holy symbol) |
| 17 | `ui_class_icon_warlock.png` | Icon | Warlock class icon (dark orb) |
| 18 | `ui_class_icon_monk.png` | Icon | Monk class icon (fist) |
| 19 | `ui_quality_common.png` | Icon | Gray quality border |
| 20 | `ui_quality_uncommon.png` | Icon | Green quality border |
| 21 | `ui_quality_rare.png` | Icon | Blue quality border |
| 22 | `ui_quality_epic.png` | Icon | Purple quality border |
| 23 | `ui_quality_legendary.png` | Icon | Orange quality border with glow |
| 24 | `ui_cursor_default.png` | Cursor | Fantasy cursor, gauntlet hand |
| 25 | `ui_cursor_attack.png` | Cursor | Attack cursor, crossed swords |
| 26 | `ui_cursor_interact.png` | Cursor | Interact cursor, gear/hand |
| 27 | `ui_logo.png` | Logo | "World of Geneva" game logo |

**Total UI Assets: 27**

---

## 16. Skybox & Atmosphere

> Currently: 6-face cubemap PNG. Functional but basic.

### Needed Skybox Variants (for zone atmosphere)

| # | Asset Set | Zone Theme | Description |
|---|----------|-----------|-------------|
| 1 | `skybox_default_*.png` (6 faces) | ✅ EXISTS | Current blue sky + clouds |
| 2 | `skybox_dark_*.png` (6 faces) | Dark Forest, Felsrock | Overcast, ominous purple/gray, lightning |
| 3 | `skybox_night_*.png` (6 faces) | Moondancer Glade | Starry night, aurora borealis, moon |
| 4 | `skybox_sunset_*.png` (6 faces) | Auroral Plains | Vibrant orange/pink sunset, dramatic clouds |
| 5 | `skybox_crystal_*.png` (6 faces) | Azurshard Chasm | Deep blue, floating crystal shards in sky |
| 6 | `skybox_infernal_*.png` (6 faces) | Felsrock Citadel | Red/orange volcanic sky, ash particles |

**Total Skybox Sets: 5 new (× 6 faces = 30 images)**

---

## 17. Mounts & Pets (Future)

> Not in codebase yet — planned for future expansion.

### Suggested Mount Models

| # | Model Name | Description | Prompt Keyword |
|---|-----------|-------------|----------------|
| 1 | `mount_horse.glb` | Basic horse mount | Anime fantasy horse, armored saddle, flowing mane |
| 2 | `mount_wolf.glb` | Wolf mount (Beastkin) | Anime dire wolf mount, saddle, fierce, loyal |
| 3 | `mount_drake.glb` | Flying drake mount | Anime small dragon mount, leather harness, wings |
| 4 | `mount_stag.glb` | Spirit stag mount (Elf) | Anime spirit stag mount, glowing antlers, ethereal |
| 5 | `mount_ram.glb` | War ram mount (Dwarf) | Anime armored ram mount, horns, dwarven saddle |
| 6 | `mount_gryphon.glb` | Epic flying mount | Anime gryphon mount, eagle head, lion body, majestic |

### Suggested Pet/Companion Models

| # | Model Name | Description | Prompt Keyword |
|---|-----------|-------------|----------------|
| 7 | `pet_cat.glb` | Cat companion | Anime fantasy cat, big eyes, fluffy tail |
| 8 | `pet_owl.glb` | Owl companion | Anime magical owl, glowing eyes, wise |
| 9 | `pet_fairy.glb` | Fairy companion | Anime fairy companion, tiny wings, sparkle trail |
| 10 | `pet_baby_dragon.glb` | Baby dragon | Anime baby dragon, cute, small wings, fire hiccups |
| 11 | `pet_fox.glb` | Fox companion | Anime spirit fox, two tails, flame tipped |
| 12 | `pet_slime.glb` | Tamed slime | Anime cute slime pet, bouncy, happy face |

**Total Mount/Pet Models: 12 (future)**

---

## 18. Priority Matrix

### P0 — Critical (Game Looks Broken Without These)

| Category | Count | Description |
|----------|-------|-------------|
| Monster Models | **37** | Players fight colored capsules right now |
| Crafting Stations | **8** | Players craft at colored boxes |
| Resource Nodes | **12** | Mining/herbalism are dodecahedrons |

**P0 Total: 57 models**

### P1 — High (Major Visual Upgrade)

| Category | Count | Description |
|----------|-------|-------------|
| Weapon Models | **9** | Replace procedural box/cylinder weapons |
| Armor Sets | **21** | Replace procedural capsule armor |
| NPC Models | **17** | NPCs look same as players |
| Character Base Bodies | **8** | Replace capsule bodies |
| Hair Models | **11** | Replace procedural hair geometry |

**P1 Total: 66 models**

### P2 — Medium (World Polish)

| Category | Count | Description |
|----------|-------|-------------|
| Structures & Buildings | **25** | No actual buildings in the world |
| Vegetation (new biome) | **12** | More tree/plant variety |
| Props (new) | **16** | World detail and atmosphere |
| Terrain Textures | **10** | Biome-specific ground |
| Skybox Variants | **5 sets** | Zone-specific atmospheres |

**P2 Total: 63 models + 10 textures + 30 skybox images**

### P3 — Nice-to-Have (Polish & Future)

| Category | Count | Description |
|----------|-------|-------------|
| Loot Drop Models | **14** | 3D items on ground |
| VFX Assets | **15** | Enhanced spell effects |
| UI Art | **27** | Themed HUD elements |
| Mounts & Pets | **12** | Future feature |
| Jewelry | **6** | Optional ring/amulet models |

**P3 Total: 74 assets**

---

## Grand Total Summary

| Priority | 3D Models | Textures/2D | Total |
|----------|-----------|-------------|-------|
| P0 Critical | 57 | 0 | **57** |
| P1 High | 66 | 0 | **66** |
| P2 Medium | 63 | 40 | **103** |
| P3 Polish | 47 | 27 | **74** |
| **TOTAL** | **233** | **67** | **300** |

### Already Exists: 32 GLB models + 6 textures + 6 skybox faces = **44 assets**

### Total New Assets Needed: **~300**

---

## Generation Strategy

1. **AI Generation (Tripo3D)** — Best for: monsters, props, vegetation, resource nodes
   - Already integrated at `client-xr/src/tools/TripoAssetGenerator.ts`
   - Use text-to-3D with anime/fantasy style prompts from this doc
   - Batch generate P0 monsters first (~37 models)

2. **AI Generation (Stable Diffusion / DALL-E)** — Best for: textures, skybox faces, UI art, VFX sprites
   - Generate terrain textures as seamless tiles
   - Generate skybox as equirectangular → convert to cubemap
   - Generate UI elements as transparent PNGs

3. **Asset Libraries (Sketchfab, Poly.pizza, CGTrader)** — Best for: character bodies, armor, weapons
   - Search for anime/stylized low-poly models
   - License: CC0 or CC-BY for commercial use
   - Will need bone-remapping to match 18-bone CharacterRig

4. **Hand-Modeled (Blender)** — Best for: character base bodies, armor that must snap to bones
   - These need precise bone weight painting
   - Consider commissioning or using VRoid Studio for anime base

---

*Last updated: 2026-03-16*
*Generated from codebase analysis of `/home/dellmaster/code/wog-mmorpg/`*
