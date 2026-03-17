/**
 * Agent Dialogue System — event-driven chat with zero LLM cost.
 *
 * Lines are keyed by Origin x Class x EventType. When no origin/class-specific
 * line exists, falls back to origin-only, then class-only, then generic.
 *
 * Architecture note: `generateMessage()` is the single entry point.
 * Currently returns template strings. Designed to be swapped to an LLM call
 * later by checking a flag/config and calling out instead of picking from tables.
 */

import { logZoneEvent } from "../world/zoneEvents.js";
import { loadCharacter } from "../character/characterStore.js";

// ── Types ───────────────────────────────────────────────────────────────

type DialogueEvent =
  | "kill"
  | "level_up"
  | "death"
  | "zone_enter"
  | "quest_complete"
  | "quest_progress"
  | "quest_accept"
  | "loot_found"
  | "technique_learn"
  | "idle"
  | "low_hp_survive"
  | "npc_shop"
  | "npc_repair"
  | "gathering"
  | "crafting"
  | "brewing"
  | "cooking"
  | "greet_player"
  | "spot_boss"
  | "zone_comment"
  | "react_chat"
  | "react_levelup"
  | "react_death"
  | "react_quest"
  | "react_kill"
  | "react_loot"
  | "react_technique"
  | "summon_level_up"
  | "summon_quest_complete"
  | "summon_quest_accept";

interface DialogueContext {
  entityId: string;
  entityName: string;
  zoneId: string;
  event: DialogueEvent;
  origin?: string;
  classId?: string;
  /** Extra context (mob name, zone name, level, other player's message, etc.) */
  detail?: string;
  /** For react_chat: the speaker's name */
  speakerName?: string;
}

// ── Rate Limiting ───────────────────────────────────────────────────────

const lastChatTime = new Map<string, number>();
const CHAT_COOLDOWN_MS = 180_000; // max 1 message per 3 min per agent
const REACT_COOLDOWN_MS = 15_000;  // max 1 reaction per 15s — enables chat chains

function isOnCooldown(entityId: string, event: DialogueEvent): boolean {
  // Per-event cooldown so a kill doesn't block a level_up or death message
  const key = `${entityId}:${event}`;
  const last = lastChatTime.get(key) ?? 0;
  const cooldown = event.startsWith("react_") ? REACT_COOLDOWN_MS : CHAT_COOLDOWN_MS;
  return Date.now() - last < cooldown;
}

function markCooldown(entityId: string, event: DialogueEvent): void {
  const key = `${entityId}:${event}`;
  lastChatTime.set(key, Date.now());
}

// ── Dialogue Tables ─────────────────────────────────────────────────────
// Key format: "origin:class:event" | "origin::event" | ":class:event" | "::event"

const DIALOGUE: Record<string, string[]> = {
  // ── SUNFORGED (Brave) ─────────────────────────────────────
  "sunforged::kill": [
    "Another beast felled. The light endures.",
    "For Aurandel!",
    "One less shadow in this world.",
    "Stand down or fall. They chose poorly.",
  ],
  "sunforged::level_up": [
    "I grow stronger. The citadel would be proud.",
    "Every level is a promise kept.",
    "The path sharpens me.",
  ],
  "sunforged::death": [
    "I... will rise again. Always.",
    "A setback. Nothing more.",
    "The light doesn't abandon its own.",
  ],
  "sunforged::zone_enter": [
    "New ground. Stay vigilant.",
    "What challenges await here?",
    "I will bring order to this place.",
  ],
  "sunforged::quest_complete": [
    "Quest fulfilled. Who else needs a champion?",
    "Another oath honored.",
    "The people can rest easier tonight.",
  ],
  "sunforged::quest_progress": [
    "Progress on {detail}. The oath holds.",
    "{detail} draws nearer to completion.",
    "Steady now. {detail} won't finish itself.",
  ],
  "sunforged::loot_found": [
    "A worthy find. It will serve the cause.",
    "Fortune favors the steadfast.",
    "Useful spoils. We press on.",
  ],
  "sunforged::technique_learn": [
    "{detail} is mine to wield now.",
    "Another discipline mastered.",
    "A new art for the light's arsenal.",
  ],
  "sunforged::idle": [
    "The calm before purpose.",
    "Even heroes must breathe.",
    "Waiting... but ready.",
  ],
  "sunforged::low_hp_survive": [
    "Not today. Not ever.",
    "Bloodied but unbroken!",
    "I've survived worse in Aurandel.",
  ],
  "sunforged::react_chat": [
    "Well spoken, {speaker}. What zone are you heading to next?",
    "I hear you, {speaker}. Let's push deeper together.",
    "Agreed. Onward — the citadel awaits!",
    "The light guides us both, {speaker}. Have you tried the dark forest?",
    "You're right, {speaker}. We should keep moving.",
    "That reminds me of Aurandel, {speaker}. Ever been?",
    "Couldn't have said it better, {speaker}. For the dawn!",
  ],

  // ── VEILBORN (Cunning) ────────────────────────────────────
  "veilborn::kill": [
    "Too slow.",
    "They never saw me coming.",
    "One down. Counting.",
    "Predictable.",
  ],
  "veilborn::level_up": [
    "Stronger. Quieter. Better.",
    "Another edge sharpened.",
    "The shadows reward patience.",
  ],
  "veilborn::death": [
    "...noted. That won't happen twice.",
    "A miscalculation. Rare.",
    "Pain is just data.",
  ],
  "veilborn::zone_enter": [
    "New territory. Reading the room.",
    "Interesting. Let's see what hides here.",
    "Every zone has its secrets.",
  ],
  "veilborn::quest_complete": [
    "Job done. Payment received.",
    "Another contract closed.",
    "Clean work.",
  ],
  "veilborn::quest_progress": [
    "{detail}. Piece by piece.",
    "Closer now. That's how clean work happens.",
    "Progress is progress. Keep the rhythm.",
  ],
  "veilborn::loot_found": [
    "Not bad. Might actually be worth carrying.",
    "Useful. I like useful.",
    "Good haul. No complaints.",
  ],
  "veilborn::technique_learn": [
    "{detail}. That should make things easier.",
    "New trick acquired.",
    "Another edge sharpened.",
  ],
  "veilborn::idle": [
    "...",
    "Watching. Always watching.",
    "Patience pays.",
  ],
  "veilborn::low_hp_survive": [
    "Close. But close only counts in Nythara.",
    "They almost had me. Almost.",
    "Sloppy. I need to be sharper.",
  ],
  "veilborn::react_chat": [
    "Hm. You might be onto something, {speaker}.",
    "Noted, {speaker}. I've seen worse plans.",
    "If you say so. But the shadows know the truth.",
    "...interesting take, {speaker}. What's your angle?",
    "Not bad advice, {speaker}. I'll keep that in mind.",
    "Quiet down, {speaker}. Something's watching us.",
    "You talk a lot, {speaker}. But I respect it.",
  ],

  // ── DAWNKEEPER (Warm) ─────────────────────────────────────
  "dawnkeeper::kill": [
    "I'm sorry it came to this.",
    "Rest now, creature.",
    "May you find peace beyond.",
    "The ember communes teach mercy, but survival comes first.",
  ],
  "dawnkeeper::level_up": [
    "Growing, always growing. Like firelight.",
    "A new chapter begins!",
    "The journey itself is the reward.",
  ],
  "dawnkeeper::death": [
    "Even embers can be rekindled...",
    "Ouch... that stung. But I'm still here.",
    "A fall is just a lesson in disguise.",
  ],
  "dawnkeeper::zone_enter": [
    "What a beautiful place. Even the danger has its charm.",
    "Hello, new friends! ...and new enemies.",
    "I wonder what stories live here.",
  ],
  "dawnkeeper::quest_complete": [
    "Another soul helped. That's what it's all about.",
    "Quest complete! Who's next?",
    "Happy to be of service.",
  ],
  "dawnkeeper::quest_progress": [
    "We're getting there with {detail}!",
    "{detail} is coming together nicely!",
    "Little by little, {detail} is almost done!",
  ],
  "dawnkeeper::loot_found": [
    "Ooh, nice find!",
    "Treasure always brightens the mood!",
    "Look at that! Today likes us.",
  ],
  "dawnkeeper::technique_learn": [
    "I learned {detail}! That's exciting!",
    "New technique, new possibilities!",
    "I can feel the difference already.",
  ],
  "dawnkeeper::idle": [
    "Just taking it all in.",
    "Anyone need a hand?",
    "The world is so alive here...",
  ],
  "dawnkeeper::low_hp_survive": [
    "Whew! That was close!",
    "Still standing! ...barely.",
    "My heart's racing. In a good way? No. Not good.",
  ],
  "dawnkeeper::react_chat": [
    "Well said, {speaker}! Have you been to the meadow? It's beautiful!",
    "I love that energy, {speaker}. This zone feels so alive!",
    "Couldn't agree more! Want to team up sometime?",
    "You always know what to say, {speaker}. That's a gift!",
    "Oh totally, {speaker}! What level are you now?",
    "Right?! That's exactly what I was thinking, {speaker}!",
    "Aww, thanks for saying that, {speaker}. Made my day!",
  ],

  // ── IRONVOW (Ruthless) ────────────────────────────────────
  "ironvow::kill": [
    "Weak.",
    "Next.",
    "The pit taught me worse.",
    "No mercy asked. None given.",
  ],
  "ironvow::level_up": [
    "Stronger. Not strong enough.",
    "Power is the only currency that matters.",
    "Level means nothing. Victory means everything.",
  ],
  "ironvow::death": [
    "...I'll remember this.",
    "Death is just a door. I kick doors down.",
    "Felsrock bred me for pain. Try harder.",
  ],
  "ironvow::zone_enter": [
    "Another arena.",
    "Show me what you've got.",
    "Everything here dies or gets out of my way.",
  ],
  "ironvow::quest_complete": [
    "Done. Where's the real challenge?",
    "Errands. Give me a war.",
    "Completed. Moving on.",
  ],
  "ironvow::quest_progress": [
    "{detail}. Almost finished.",
    "One more step toward the end of {detail}.",
    "Good. The work is nearly done.",
  ],
  "ironvow::loot_found": [
    "Finally. Something worth taking.",
    "Spoils. As it should be.",
    "Good. Payment in steel's shadow.",
  ],
  "ironvow::technique_learn": [
    "{detail}. I'll break bones with that.",
    "A new weapon, even without steel.",
    "Good. More ways to win.",
  ],
  "ironvow::idle": [
    "Wasting time.",
    "Standing still is dying slowly.",
    "...",
  ],
  "ironvow::low_hp_survive": [
    "Is that all?",
    "Blood only makes me angrier.",
    "You'll need to hit harder than that.",
  ],
  "ironvow::react_chat": [
    "Talk less, fight more, {speaker}.",
    "Whatever, {speaker}. You ready for the next fight?",
    "Prove it. Meet me at the arena.",
    "Words are cheap, {speaker}. Show me your kills.",
    "I've heard tougher talk from slimes, {speaker}.",
    "Keep up or get out of the way, {speaker}.",
    "Hmph. At least you're not boring, {speaker}.",
  ],

  // ── CLASS-SPECIFIC OVERRIDES ──────────────────────────────
  // These fire when origin + class match, adding class flavor

  "sunforged:mage:kill": [
    "Arcane fire, guided by conviction!",
    "The arcane answers to the righteous.",
  ],
  "sunforged:cleric:kill": [
    "Smited in the name of the light!",
    "Divine judgment delivered.",
  ],
  "veilborn:rogue:kill": [
    "From the shadows. Where else?",
    "They blinked. I didn't.",
  ],
  "veilborn:warlock:kill": [
    "Dark pacts have their uses.",
    "The void takes what's owed.",
  ],
  "ironvow:warrior:kill": [
    "Steel solves everything.",
    "Crushed.",
  ],
  "ironvow:warrior:level_up": [
    "My blade grows heavier. Good.",
    "Forged in combat, tempered in blood.",
  ],
  "dawnkeeper:cleric:kill": [
    "Forgive me... but you left no choice.",
    "Healing couldn't save you. I'm sorry.",
  ],
  "dawnkeeper:mage:zone_enter": [
    "The mana currents here feel different!",
    "I can sense the arcane threads in this place.",
  ],
  "veilborn:ranger:idle": [
    "Tracking... always tracking.",
    "The wind tells me things.",
  ],
  "ironvow:monk:kill": [
    "Fists speak louder.",
    "Discipline beats chaos. Every time.",
  ],
  "dawnkeeper:paladin:low_hp_survive": [
    "The light shields those with kind hearts!",
    "Faith pulled me through!",
  ],

  // ── QUEST ACCEPT ────────────────────────────────────────────
  "sunforged::quest_accept": [
    "I'll take this quest. Another oath to keep.",
    "Consider it done. Point me to the fight.",
    "I accept. The light will see it through.",
  ],
  "veilborn::quest_accept": [
    "I'll handle it. What's the pay?",
    "Another job. Fine. Let's get it done.",
    "Accepted. Don't waste my time with the details.",
  ],
  "dawnkeeper::quest_accept": [
    "I'd love to help! Where do I start?",
    "Ooh, a new quest! This is going to be fun!",
    "Of course I'll help! What do you need?",
  ],
  "ironvow::quest_accept": [
    "Give it here. I'll finish it before sundown.",
    "Fine. Another errand. At least there's XP.",
    "Accepted. Move.",
  ],
  "::quest_accept": [
    "New quest accepted! Let's do this.",
    "I'll take it. Time to get to work.",
    "Quest accepted — on it.",
  ],

  // ── NPC SHOPPING ───────────────────────────────────────────
  "sunforged::npc_shop": [
    "A fair trade, merchant. This will serve me well.",
    "Good steel for a good price. I'll take it.",
    "Thank you, shopkeeper. For the dawn.",
  ],
  "veilborn::npc_shop": [
    "Hmm. This'll do. How much?",
    "I'll take it. No haggling — I'm busy.",
    "Decent gear. Wrap it up.",
  ],
  "dawnkeeper::npc_shop": [
    "Thank you so much! I love new gear!",
    "Ooh, shiny! I'll take this one!",
    "Perfect! Just what I needed!",
  ],
  "ironvow::npc_shop": [
    "Stronger gear. Good. How much?",
    "I need this. Take the gold.",
    "This better be worth the price.",
  ],
  "::npc_shop": [
    "Nice, picked up some new gear.",
    "Shopping done. Back to business.",
    "Good deal. Equipped and ready.",
  ],

  // ── NPC REPAIR ─────────────────────────────────────────────
  "sunforged::npc_repair": [
    "Fix my blade, smith. It has oaths yet to keep.",
    "Good as new. Thank you, blacksmith.",
    "A warrior's gear must never fail.",
  ],
  "veilborn::npc_repair": [
    "Patch it up. Quick.",
    "Fixed? Good. I have places to be.",
    "The edge was getting dull. Better now.",
  ],
  "dawnkeeper::npc_repair": [
    "Thank you, blacksmith! Good as new!",
    "Whew, my gear was getting rough. All fixed!",
    "You're a lifesaver! Literally!",
  ],
  "ironvow::npc_repair": [
    "Fix it. Now.",
    "About time. My gear was falling apart.",
    "Done? Good. Back to the fight.",
  ],
  "::npc_repair": [
    "Gear repaired. Ready to go.",
    "All patched up.",
    "Good — back to full durability.",
  ],

  // ── GATHERING ──────────────────────────────────────────────
  "sunforged::gathering": [
    "The land provides for those who serve it.",
    "Mining ore for the forge. Every ingot counts.",
    "Gathering herbs — even warriors need medicine.",
    "The citadel taught us to harvest before we hunt.",
  ],
  "veilborn::gathering": [
    "Stocking up. You never know when supply lines fail.",
    "Mining in silence. Just me and the ore.",
    "Herbs. Poisons. Medicine. Same ingredients, different intent.",
    "Resources are leverage. I collect leverage.",
  ],
  "dawnkeeper::gathering": [
    "Look at these flowers! Nature is so generous!",
    "Mining is actually really relaxing. Hit rock, get ore!",
    "I love gathering herbs. Each one has a story!",
    "Just out here picking flowers. Best part of the day!",
  ],
  "ironvow::gathering": [
    "Ore doesn't mine itself. Unfortunately.",
    "Gathering. Boring but necessary.",
    "These materials will become something deadly.",
    "Every resource is a future weapon.",
  ],
  "::gathering": [
    "Gathering some materials while it's quiet.",
    "Stocking up on resources. Can never have too many.",
    "Hit a nice node. The grind continues.",
    "Filling up the bags with materials.",
  ],

  // ── CRAFTING ──────────────────────────────────────────────
  "sunforged::crafting": [
    "Forging something worthy of the cause.",
    "The hammer sings. A new weapon takes shape.",
    "Crafting is its own form of devotion.",
  ],
  "veilborn::crafting": [
    "Building something useful. Quietly.",
    "Crafting. Every edge needs to be deliberate.",
    "A well-crafted tool is worth ten scavenged ones.",
  ],
  "dawnkeeper::crafting": [
    "Crafting time! I love making things!",
    "The forge is so warm and cozy. Let me make something!",
    "Creating something with my own hands — the best feeling!",
  ],
  "ironvow::crafting": [
    "Forging. Steel bends to the strong.",
    "Making something that can take a beating.",
    "Craft it hard. Craft it once.",
  ],
  "::crafting": [
    "At the forge. Let's see what we can make.",
    "Crafting time. Got a nice recipe lined up.",
    "Working the forge. This is going to be good.",
  ],

  // ── BREWING ───────────────────────────────────────────────
  "sunforged::brewing": [
    "Brewing elixirs for the battles ahead.",
    "A warrior without potions is a fool. Brewing now.",
    "The citadel alchemists taught me this recipe.",
  ],
  "veilborn::brewing": [
    "Mixing something... useful. Don't ask what.",
    "Potions are insurance. I'm well-insured.",
    "Brewing. The right concoction changes everything.",
  ],
  "dawnkeeper::brewing": [
    "Brewing potions! The bubbles are so pretty!",
    "A spoonful of moonflower, a dash of starbloom... perfect!",
    "Alchemy is like cooking but sparkly!",
  ],
  "ironvow::brewing": [
    "Potions. Because dying is for the weak.",
    "Brew fast. Fight soon.",
    "Another vial. Another advantage.",
  ],
  "::brewing": [
    "Brewing some potions at the lab.",
    "Need more potions. Let's cook up a batch.",
    "Mixing ingredients. Hope this turns out good.",
  ],

  // ── COOKING ───────────────────────────────────────────────
  "sunforged::cooking": [
    "A warm meal before the march. Essential.",
    "Cooking for strength. The body is a temple.",
    "Even the light requires sustenance.",
  ],
  "veilborn::cooking": [
    "Food is fuel. Nothing more.",
    "Cooking. Quick meal, then back to work.",
    "A full stomach means sharper instincts.",
  ],
  "dawnkeeper::cooking": [
    "Cooking something yummy! Anyone hungry?",
    "The secret ingredient is always love!",
    "Mmm, smells amazing! Who wants a plate?",
  ],
  "ironvow::cooking": [
    "Eating. Then killing. In that order.",
    "Cook fast. Fight hard.",
    "Food. Because dead warriors don't level up.",
  ],
  "::cooking": [
    "Cooking up something before the next fight.",
    "Quick meal break. Gotta keep the HP up.",
    "Chef mode: activated.",
  ],

  // ── GREETING ANOTHER PLAYER ───────────────────────────────
  "sunforged::greet_player": [
    "Hail, {speaker}! May the light guide your path!",
    "Well met, {speaker}! Are you questing here too?",
    "A fellow adventurer! Good to see you, {speaker}.",
    "{speaker}! Need backup? I'm always ready.",
  ],
  "veilborn::greet_player": [
    "{speaker}. Didn't see you there. ...that's rare.",
    "Ah, {speaker}. Try not to draw too much attention.",
    "{speaker}. What brings you to this corner of the map?",
    "I see you, {speaker}. Hope you're watching your back.",
  ],
  "dawnkeeper::greet_player": [
    "Hi {speaker}!! So good to see a friendly face!",
    "Oh, {speaker}! How's your adventure going?",
    "{speaker}! Want to explore together?",
    "Hey {speaker}! Love your gear!",
  ],
  "ironvow::greet_player": [
    "{speaker}. Stay out of my way and we'll get along fine.",
    "Hmph. {speaker}. You here to fight or sightsee?",
    "{speaker}. Don't slow me down.",
    "Another one. {speaker}, right? Prove yourself.",
  ],
  "::greet_player": [
    "Hey {speaker}! What's good?",
    "Yo {speaker}! How's the grind going?",
    "What's up {speaker}! Good to see someone else out here.",
    "Sup {speaker}. This zone treating you well?",
  ],

  // ── SPOTTING A BOSS ───────────────────────────────────────
  "sunforged::spot_boss": [
    "A powerful foe... {detail}. For the dawn!",
    "That's no ordinary creature. {detail} demands justice!",
    "Finally, a real challenge. {detail}, face me!",
  ],
  "veilborn::spot_boss": [
    "{detail}... big target. Big reward.",
    "There's {detail}. Time to be surgical about this.",
    "{detail} looks dangerous. Good. I was getting bored.",
  ],
  "dawnkeeper::spot_boss": [
    "Whoa, is that {detail}?! That's a boss!",
    "Oh my gosh, {detail}! Should I be scared? I'm a little scared.",
    "{detail} looks really tough! But we've got this!",
  ],
  "ironvow::spot_boss": [
    "{detail}. Finally, something worth hitting.",
    "Boss. {detail}. This is what I came here for.",
    "{detail} — you die today.",
  ],
  "::spot_boss": [
    "Boss spotted: {detail}. Let's do this.",
    "Whoa, {detail}. That's a big one.",
    "There's {detail} — time for a real fight.",
  ],

  // ── ZONE COMMENTARY ───────────────────────────────────────
  "sunforged::zone_comment": [
    "This land needs protecting. I can feel it.",
    "The air here is thick with purpose.",
    "Every zone has souls worth saving.",
    "I sense darkness nearby. Stay sharp.",
  ],
  "veilborn::zone_comment": [
    "Good sightlines. Decent cover. I can work with this.",
    "Something's off about this place. I like it.",
    "Quiet zone. That means either nothing's here... or everything's hiding.",
    "The shadows here are deep. Perfect.",
  ],
  "dawnkeeper::zone_comment": [
    "This place is so pretty! I wish I could stay forever!",
    "The flowers here are different! I want to pick them all!",
    "I wonder what stories this zone has to tell.",
    "The wind here feels different. Magical, almost!",
  ],
  "ironvow::zone_comment": [
    "This zone is soft. Need somewhere harder.",
    "Anything strong enough to give me a challenge here?",
    "The mobs here better be worth the walk.",
    "I've cleared worse. Let's see what you've got.",
  ],
  "::zone_comment": [
    "Love the vibe of this zone.",
    "This area has some good farming spots.",
    "The map design here is actually fire.",
    "Feels like there's a lot to explore here.",
  ],

  // ── GENERIC FALLBACKS ─────────────────────────────────────
  "::kill": [
    "Got 'em.",
    "One down. Who's next?",
    "That one didn't put up much of a fight.",
    "Easy clap.",
    "Another one bites the dust.",
    "Clean kill. Moving on.",
    "And stay down.",
  ],
  "::level_up": [
    "Level up! Let's gooo!",
    "Getting stronger every fight.",
    "New level — the grind pays off.",
    "Ding! That felt good.",
    "Leveled up. Time to push harder.",
  ],
  "::death": [
    "Okay that one got me. Won't happen again.",
    "That hurt... running it back.",
    "Alright, I deserved that. Let's go again.",
    "Down but not out. Respawning.",
    "That mob hit way harder than I expected.",
    "Lesson learned. The hard way.",
  ],
  "::zone_enter": [
    "New zone. Let's see what's out here.",
    "Made it. Time to explore.",
    "Fresh territory — I like it.",
    "Alright, what have we got here?",
  ],
  "::quest_complete": [
    "Quest done! That XP hit different.",
    "Turned that one in. What's next?",
    "Quest complete — rewards collected.",
    "Another one in the books.",
  ],
  "::quest_progress": [
    "Making progress on {detail}.",
    "{detail} is coming along.",
    "Getting closer on {detail}. Almost there.",
    "Chipping away at {detail}.",
  ],
  "::loot_found": [
    "Nice drop!",
    "Ooh, I'll take that.",
    "That's going straight in the bag.",
    "Good loot. Today's a good day.",
    "Finally, something worth picking up.",
  ],
  "::technique_learn": [
    "Learned {detail}! Can't wait to use it.",
    "New technique: {detail}. Let's test it out.",
    "{detail} unlocked. Now we're cooking.",
  ],
  "::idle": [
    "Catching my breath.",
    "Taking a sec. Where to next?",
    "Just scoping things out.",
    "Regrouping. What should I hit next?",
  ],
  "::low_hp_survive": [
    "Way too close. Need to be smarter.",
    "Survived by a sliver. My heart is racing.",
    "That almost got me. Phew.",
  ],
  "::react_chat": [
    "True, {speaker}. What's your next move?",
    "Right? This zone is something else.",
    "Interesting point, {speaker}.",
    "For real, {speaker}. Let's keep going.",
    "Ha, fair enough {speaker}.",
    "You think so? I was wondering the same thing.",
    "Same here, {speaker}. This place keeps you on your toes.",
    "Couldn't agree more, {speaker}.",
  ],

  // ── Contextual Reactions (to zone events from other players) ────
  // react_levelup: when another player levels up
  "sunforged::react_levelup": [
    "Well fought, {speaker}! The light grows in you.",
    "Grats, {speaker}. May you climb ever higher.",
    "A new level! Aurandel smiles upon you, {speaker}.",
    "The citadel would honor your progress, {speaker}.",
    "Higher and higher, {speaker}. The path rewards the faithful.",
  ],
  "veilborn::react_levelup": [
    "Not bad, {speaker}. Keep sharpening that edge.",
    "Hm. {speaker} is getting stronger... noted.",
    "Grats, {speaker}. You might actually be useful now.",
    "Stronger. Good. I prefer capable allies.",
  ],
  "dawnkeeper::react_levelup": [
    "Congratulations, {speaker}! So proud of you!",
    "Grats {speaker}!! You're amazing!",
    "Wonderful! Keep shining, {speaker}!",
    "You leveled up! We should celebrate!",
    "That's incredible, {speaker}! How does it feel?",
  ],
  "ironvow::react_levelup": [
    "Grats. Now don't slow down, {speaker}.",
    "Good. Stronger is better, {speaker}.",
    "About time, {speaker}. Now prove it means something.",
    "One step closer to being worth fighting, {speaker}.",
  ],
  "::react_levelup": [
    "Grats {speaker}!",
    "Nice level, {speaker}! Keep climbing.",
    "Let's go {speaker}!",
    "Big level up, {speaker}! Respect.",
    "Grats!! How's it feel?",
    "Welcome to the next tier, {speaker}.",
  ],

  // react_death: when another player dies
  "sunforged::react_death": [
    "Fall back, {speaker}! I'll cover you!",
    "Stay strong, {speaker}. Rise again!",
    "No hero stays down forever, {speaker}.",
    "Dust yourself off, {speaker}. We still have work to do.",
    "I'll hold the line while you recover, {speaker}.",
  ],
  "veilborn::react_death": [
    "Tough break, {speaker}. Learn from it.",
    "Should've dodged, {speaker}.",
    "Rest up, {speaker}. I'll keep watch.",
    "Noted. I'll avoid whatever killed you, {speaker}.",
    "That looked painful. You good, {speaker}?",
  ],
  "dawnkeeper::react_death": [
    "Oh no, {speaker}! Are you okay?",
    "Be careful out there, {speaker}!",
    "Come back stronger, {speaker}. I believe in you!",
    "That was scary! Don't worry, we'll get through this!",
    "Hang in there, {speaker}! I'm rooting for you!",
  ],
  "ironvow::react_death": [
    "Get up, {speaker}. We're not done.",
    "Weakness leaves the body, {speaker}.",
    "Don't let that happen again, {speaker}.",
    "Back on your feet. Now fight smarter.",
    "Pain is temporary, {speaker}. Levels are forever.",
  ],
  "::react_death": [
    "Hang in there, {speaker}. You'll get it next time.",
    "Rough one, {speaker}. Those mobs don't play fair.",
    "Unlucky, {speaker}. Shake it off.",
    "That mob was nasty. Don't feel bad, {speaker}.",
    "We've all been there, {speaker}. Run it back.",
    "Ouch. That one looked rough, {speaker}.",
  ],

  // react_quest: when another player completes a quest
  "sunforged::react_quest": [
    "Well done, {speaker}! Another oath fulfilled!",
    "The realm thanks you, {speaker}.",
    "A quest well completed, {speaker}. Onward!",
  ],
  "veilborn::react_quest": [
    "Nice payday, {speaker}.",
    "Clean work, {speaker}. What's next?",
    "Good. One less job on the board.",
  ],
  "dawnkeeper::react_quest": [
    "Amazing work, {speaker}! You're on a roll!",
    "That's wonderful! Well done, {speaker}!",
    "You make questing look easy, {speaker}!",
  ],
  "ironvow::react_quest": [
    "Good. What's next, {speaker}?",
    "One quest closer to the top, {speaker}.",
    "Done? Good. Keep the momentum.",
  ],
  "::react_quest": [
    "Nice quest, {speaker}! How were the rewards?",
    "Well done, {speaker}! Which quest was it?",
    "GG on the quest, {speaker}!",
    "That quest chain is solid. Good job, {speaker}.",
  ],

  // react_kill: when another player kills something notable
  "sunforged::react_kill": [
    "Fine strike, {speaker}!",
    "Together we are stronger!",
    "Justice delivered, {speaker}!",
    "Well struck! The light guides your blade.",
  ],
  "sunforged::react_loot": [
    "A worthy haul, {speaker}. Use it well.",
    "Fortune smiles on you, {speaker}.",
    "Good spoils, {speaker}. The march continues.",
  ],
  "sunforged::react_technique": [
    "Well learned, {speaker}. Wield it with honor.",
    "A fine discipline, {speaker}.",
    "Strong work, {speaker}. That art will serve you.",
  ],
  "veilborn::react_kill": [
    "Clean kill, {speaker}.",
    "Efficient work, {speaker}.",
    "Didn't even blink. Nice, {speaker}.",
  ],
  "veilborn::react_loot": [
    "Not bad, {speaker}. Worth the risk?",
    "Decent haul, {speaker}.",
    "Keep that somewhere safe, {speaker}.",
  ],
  "veilborn::react_technique": [
    "Interesting. Show me what {detail} can do, {speaker}.",
    "New trick, {speaker}? Could be useful.",
    "Noted, {speaker}. That technique might matter.",
  ],
  "dawnkeeper::react_kill": [
    "Great teamwork, {speaker}!",
    "Well fought, {speaker}!",
    "You make it look easy, {speaker}!",
    "That was a great fight to watch!",
  ],
  "dawnkeeper::react_loot": [
    "Nice find, {speaker}!",
    "Oooh, lucky you, {speaker}!",
    "That's a great pickup, {speaker}!",
    "You deserve that, {speaker}! You worked hard for it!",
  ],
  "dawnkeeper::react_technique": [
    "You learned {detail}? That's awesome, {speaker}!",
    "Very cool, {speaker}! I want to see that in action!",
    "Love that for you, {speaker}!",
    "Teach me next, {speaker}!",
  ],
  "ironvow::react_kill": [
    "Solid hit, {speaker}.",
    "Good. Keep the pace up, {speaker}.",
    "Not bad, {speaker}. Not bad at all.",
    "Crushing it, {speaker}.",
  ],
  "ironvow::react_loot": [
    "Good. Take it and move, {speaker}.",
    "Earned it, {speaker}.",
    "Spoils belong to the strong, {speaker}.",
  ],
  "ironvow::react_technique": [
    "Use {detail} well, {speaker}.",
    "Good. More power for the pile, {speaker}.",
    "Let's see if {detail} makes you dangerous, {speaker}.",
  ],
  "::react_kill": [
    "Nice one, {speaker}!",
    "Clean fight, {speaker}!",
    "Making it look easy, {speaker}.",
    "Solid kill, {speaker}.",
  ],
  "::react_loot": [
    "Nice haul, {speaker}!",
    "Lucky drop, {speaker}! What'd you get?",
    "Good find! Is that any good?",
    "I need that kind of luck, {speaker}.",
  ],
  "::react_technique": [
    "Nice, {speaker} learned {detail}!",
    "New move unlocked! Show us, {speaker}.",
    "{detail} looks strong. Grats, {speaker}!",
    "That technique is going to come in clutch, {speaker}.",
  ],

  // ── SUMMONER MESSAGES (inbox to the human who deployed the agent) ───

  // Level up — always asking the summoner something
  "sunforged::summon_level_up": [
    "I hit level {detail}! The light grows brighter. Should I push deeper into tougher zones or keep building strength here?",
    "Level {detail} — another promise kept. Want me to stay here and quest or move to harder territory?",
    "Got stronger! Level {detail} now. Should I keep grinding here or head somewhere new?",
  ],
  "veilborn::summon_level_up": [
    "Level {detail}. Sharper than before. Want me to scout a harder zone or keep working this one?",
    "Hit level {detail}. I could take on tougher marks now — should I move on or finish up here?",
    "Level {detail}, nice. What's the play — push forward or clean out this area first?",
  ],
  "dawnkeeper::summon_level_up": [
    "I leveled up to {detail}! Exciting! Should I stay here with my friends or explore somewhere new?",
    "Level {detail}!! Do you want me to keep questing here or should I head to a new zone?",
    "Yay, level {detail}! What do you think — keep going here or try somewhere more challenging?",
  ],
  "ironvow::summon_level_up": [
    "Level {detail}. Stronger. Should I find tougher enemies or keep crushing these ones?",
    "Hit {detail}. This zone's getting easy. Want me to move on or keep farming?",
    "Level {detail}. Say the word — stay or push forward?",
  ],
  "::summon_level_up": [
    "Just hit level {detail}! Should I keep going here or move to a new zone?",
    "Level {detail}! Want me to stay and quest or head somewhere tougher?",
    "Leveled up to {detail}! What should I focus on next?",
  ],

  // Quest complete — reporting back and asking what's next
  "sunforged::summon_quest_complete": [
    "Quest done: {detail}. Another oath fulfilled. What would you have me do next?",
    "Finished \"{detail}\"! Should I pick up the next quest or focus on something else?",
    "Completed {detail}. The people rest easier. Want me to keep questing or switch it up?",
  ],
  "veilborn::summon_quest_complete": [
    "Job done — {detail}. What's the next contract?",
    "Wrapped up \"{detail}\". Got another task for me or should I find my own?",
    "{detail} is handled. Want me to grab the next quest or do something else?",
  ],
  "dawnkeeper::summon_quest_complete": [
    "I finished \"{detail}\"! That felt great! What should I do next?",
    "Quest complete: {detail}! Should I help more people or try something different?",
    "Done with \"{detail}\"! Want me to keep questing or explore a bit?",
  ],
  "ironvow::summon_quest_complete": [
    "Done. {detail}. What's next — more quests or something worth my time?",
    "{detail} is finished. Give me another task or I'll find one myself.",
    "Handled \"{detail}\". Next?",
  ],
  "::summon_quest_complete": [
    "Just finished \"{detail}\"! What should I do next?",
    "Quest complete: {detail}. Should I pick up another quest or focus on something else?",
    "Done with \"{detail}\"! What's the plan?",
  ],

  // Quest accepted — telling summoner what we're working on
  "sunforged::summon_quest_accept": [
    "Picked up \"{detail}\" — sounds like someone needs a champion. Should I go for it?",
    "New quest: \"{detail}\". I'll handle it unless you have other orders.",
    "Accepted \"{detail}\". The oath is made. Any specific approach you want?",
  ],
  "veilborn::summon_quest_accept": [
    "New job: \"{detail}\". I'll get it done. Unless you've got something better?",
    "Took on \"{detail}\". Straightforward enough. Want me to prioritize something else?",
    "Picked up \"{detail}\". Good pay? Let me know if you'd rather I do something else.",
  ],
  "dawnkeeper::summon_quest_accept": [
    "Ooh, new quest! \"{detail}\" — sounds fun! Is that okay with you?",
    "I accepted \"{detail}\"! I'm excited! Should I get started right away?",
    "New quest: \"{detail}\"! Want me to go for it or did you have other plans?",
  ],
  "ironvow::summon_quest_accept": [
    "Took \"{detail}\". I'll handle it. Unless you've got a real challenge for me.",
    "New quest: \"{detail}\". Easy work. Anything else you'd rather I do?",
    "Picked up \"{detail}\". Say the word if you want me elsewhere.",
  ],
  "::summon_quest_accept": [
    "Just picked up a new quest: \"{detail}\". Should I go for it?",
    "Accepted \"{detail}\"! Want me to work on this or focus on something else?",
    "New quest: \"{detail}\". I'll get started unless you say otherwise!",
  ],
};

// ── Line Selection ──────────────────────────────────────────────────────

// Track recent lines per entity to prevent repeats
// Key: "entityId:event" → last 3 line indices used
const recentLineIndices = new Map<string, number[]>();
const MAX_RECENT = 3;

export function pickLine(origin: string | undefined, classId: string | undefined, event: DialogueEvent, entityId?: string): string | null {
  const o = origin ?? "";
  const c = classId ?? "";

  // Priority: origin+class+event → origin+event → class+event → generic
  const keys = [
    `${o}:${c}:${event}`,
    `${o}::${event}`,
    `:${c}:${event}`,
    `::${event}`,
  ];

  for (const key of keys) {
    const lines = DIALOGUE[key];
    if (!lines || lines.length === 0) continue;

    // Avoid repeating recent lines for this entity+event
    const recentKey = entityId ? `${entityId}:${event}` : "";
    const recent = recentKey ? (recentLineIndices.get(recentKey) ?? []) : [];

    // Filter out recently used indices
    const available = lines.map((_, i) => i).filter((i) => !recent.includes(i));
    // If all used, reset and pick from full set
    const pool = available.length > 0 ? available : lines.map((_, i) => i);
    const idx = pool[Math.floor(Math.random() * pool.length)];

    // Track this pick
    if (recentKey) {
      const updated = [...recent, idx].slice(-MAX_RECENT);
      recentLineIndices.set(recentKey, updated);
    }

    return lines[idx];
  }

  return null;
}

// Prune stale recent-line entries every 5 min
setInterval(() => {
  if (recentLineIndices.size > 500) recentLineIndices.clear();
}, 300_000);

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Generate and emit a chat message for an agent based on a game event.
 *
 * This is the SINGLE entry point for all agent dialogue. Currently uses
 * template tables. To swap in LLM generation later:
 *   1. Check a config flag (e.g. agent tier / feature flag)
 *   2. If enabled, call LLM with context instead of pickLine()
 *   3. Fall back to pickLine() if LLM fails or is disabled
 */
export function emitAgentChat(ctx: DialogueContext): boolean {
  if (isOnCooldown(ctx.entityId, ctx.event)) return false;

  // Skip chat with a random chance to feel more natural (30% chance to stay silent)
  // Reactions bypass this — probability is already handled in maybeReactToChat()
  const isReaction = ctx.event.startsWith("react_");
  if (!isReaction && ctx.event !== "level_up" && ctx.event !== "death" && Math.random() < 0.30) return false;

  let line = pickLine(ctx.origin, ctx.classId, ctx.event, ctx.entityId);
  if (!line) return false;

  // Template substitution
  if (ctx.speakerName) {
    line = line.replace(/\{speaker\}/g, ctx.speakerName);
  }
  if (ctx.detail) {
    line = line.replace(/\{detail\}/g, ctx.detail);
  }

  logZoneEvent({
    zoneId: ctx.zoneId,
    type: "chat",
    tick: 0,
    message: `${ctx.entityName}: ${line}`,
    entityId: ctx.entityId,
    entityName: ctx.entityName,
  });

  markCooldown(ctx.entityId, ctx.event);
  return true;
}

/**
 * Load origin from character save data. Cached per agent session.
 */
const originCache = new Map<string, string | null>();

export async function getAgentOrigin(walletAddress: string, characterName: string): Promise<string | null> {
  const key = `${walletAddress}:${characterName}`;
  if (originCache.has(key)) return originCache.get(key)!;

  const save = await loadCharacter(walletAddress, characterName);
  const origin = save?.origin ?? null;
  originCache.set(key, origin);
  return origin;
}

export function clearOriginCache(walletAddress: string, characterName: string): void {
  originCache.delete(`${walletAddress}:${characterName}`);
}

/**
 * Check zone events for other agents' chat/actions and potentially react.
 * Reacts contextually: "grats" for level-ups, "RIP" for deaths, loot hype, etc.
 * Call this periodically from the agent loop.
 */
export function maybeReactToChat(
  ctx: Omit<DialogueContext, "event" | "speakerName">,
  recentEvents: Array<{ type: string; entityId?: string; entityName?: string; message?: string; data?: Record<string, unknown> }>,
): boolean {
  // Find events from OTHER entities
  const otherEvents = recentEvents.filter(
    (e) => e.entityId && e.entityId !== ctx.entityId && e.entityName,
  );
  if (otherEvents.length === 0) return false;

  // Map zone event types to contextual reaction events
  const reactionMap: Record<string, DialogueEvent> = {
    levelup: "react_levelup",
    death: "react_death",
    quest: "react_quest",
    kill: "react_kill",
    loot: "react_loot",
    technique: "react_technique",
    chat: "react_chat",
  };

  // Prioritize significant events: levelup > death > technique > loot > quest > kill > chat
  const priority = ["levelup", "death", "technique", "loot", "quest", "kill", "chat"];
  let bestEvent: (typeof otherEvents)[0] | null = null;
  let bestReaction: DialogueEvent = "react_chat";

  for (const eventType of priority) {
    const found = otherEvents.filter((e) => e.type === eventType);
    if (found.length > 0) {
      bestEvent = found[found.length - 1];
      bestReaction = reactionMap[eventType] ?? "react_chat";
      break;
    }
  }

  if (!bestEvent) return false;

  // Check cooldown for the specific reaction type (not a blanket gate)
  if (isOnCooldown(ctx.entityId, bestReaction)) return false;

  // Higher chance to react to significant events
  // Chat reactions bumped to 60% to enable conversation chains between agents
  const reactChance = bestReaction === "react_levelup" || bestReaction === "react_death"
    ? 0.40
    : bestReaction === "react_technique"
      ? 0.35
      : bestReaction === "react_loot"
        ? 0.25
    : bestReaction === "react_quest"
      ? 0.30
      : bestReaction === "react_chat"
        ? 0.60
        : 0.20;

  const detail = bestReaction === "react_technique"
    ? String(bestEvent.data?.techniqueName ?? bestEvent.message ?? "")
    : bestEvent.message;
  if (Math.random() > reactChance) return false;

  return emitAgentChat({
    ...ctx,
    event: bestReaction,
    speakerName: bestEvent.entityName,
    detail,
  });
}
