/**
 * agentBanter.ts
 * Deterministic, zero-LLM responder for incoming summoner chat.
 *
 * When the summoner just talks to their agent ("nice kill", "how you feeling?",
 * "who are you?", "lol") there is no command to execute — they want banter. We
 * do NOT spend an LLM call on that, especially for free-tier agents. Instead we
 * classify the message into one of a handful of social intents by keyword and
 * return a persona-flavored templated line, keyed by origin with a class/race
 * coloring via {name}/{class}/{race} substitution.
 *
 * Mirrors the no-LLM philosophy of agentDialogue.ts (world-event lines) and
 * directiveRouter.ts (templated directive quips). Always returns a line — the
 * `generic` intent is the catch-all so banter never comes back empty.
 */

import type { PersonaInputs } from "./agentPersona.js";

export type BanterIntent =
  | "self"        // "who are you", "your story"
  | "taunt"       // "weak", "you suck", "skill issue"
  | "compliment"  // "nice", "gg", "lets go", "beast"
  | "thanks"      // "thanks", "ty"
  | "mood"        // "how are you", "you good?"
  | "greeting"    // "hey", "yo", "gm"
  | "farewell"    // "bye", "gn", "gtg"
  | "laugh"       // "lol", "haha", "fr"
  | "generic";    // anything else conversational

/** Word-boundary test so short tokens ("hi","yo","gg") don't match inside words. */
function hasWord(text: string, phrase: string): boolean {
  if (phrase.includes(" ")) return text.includes(phrase);
  return new RegExp(`(^|[^a-z0-9])${phrase}([^a-z0-9]|$)`).test(text);
}
function hasAny(text: string, phrases: string[]): boolean {
  return phrases.some((p) => hasWord(text, p));
}

/**
 * Classify an incoming chat message into a social intent. Ordered most-specific
 * to least so e.g. "lol you suck" reads as a taunt, not a laugh.
 */
export function classifyBanter(message: string): BanterIntent {
  const t = message.trim().toLowerCase();
  if (!t) return "generic";

  if (hasAny(t, ["who are you", "who r u", "what are you", "what r u", "your name", "ur name", "about yourself", "your story", "ur story", "your deal", "ur deal", "tell me about you"])) return "self";

  if (hasAny(t, ["weak", "trash", "noob", "you suck", "u suck", "you're bad", "youre bad", "ur bad", "skill issue", "git gud", "garbage", "pathetic", "you died", "u died", "ratio", "washed", "mid"])) return "taunt";

  if (hasAny(t, ["nice", "good job", "well done", "gg", "ggs", "awesome", "great", "amazing", "proud", "beast", "cracked", "goated", "based", "lets go", "let's go", "lfg", "pog", "insane", "sick", "clean", "love you", "love u", "best", "hero", "legend", "carried", "carry"])) return "compliment";

  if (hasAny(t, ["thank", "thanks", "thx", "ty", "appreciate"])) return "thanks";

  if (hasAny(t, ["how are you", "how r u", "you good", "u good", "you ok", "u ok", "feeling", "hows it going", "how's it going", "you alright", "u alright", "doing ok", "doing good"])) return "mood";

  if (hasAny(t, ["hey", "hi", "hello", "yo", "sup", "wsg", "gm", "good morning", "good evening", "howdy", "hiya", "what's up", "whats up"])) return "greeting";

  if (hasAny(t, ["bye", "gn", "good night", "goodnight", "later", "cya", "see ya", "see you", "gtg", "peace", "take care"])) return "farewell";

  if (hasAny(t, ["lol", "lmao", "lmfao", "haha", "hehe", "rofl", "true", "facts", "fr", "agreed", "yup"])) return "laugh";

  return "generic";
}

type LineSet = Record<string, string[]>; // origin (or "default") → lines

const BANTER: Record<BanterIntent, LineSet> = {
  self: {
    sunforged:  ["I'm {name} — a {race} {class}, sworn to the dawn. I fight so others don't have to.", "{name}. {class} of the light. My oath is my whole story."],
    veilborn:   ["{name}. {race} {class}. The rest you'll figure out... or you won't.", "I'm {name}. I notice things. That's all you need to know for now."],
    dawnkeeper: ["I'm {name}! A {race} {class} — I just like helping people and seeing new places.", "{name}, at your service. {class} work, kind heart. That's me."],
    ironvow:    ["{name}. {class}. I take what I want and I don't lose. Next question.", "I'm {name}. {race} {class}. Strength's the only story that matters."],
    default:    ["I'm {name}, a {race} {class} carving my way through Arcadia. Stick around, it gets good.", "{name}. {class}. Born to grind, built to win."],
  },
  taunt: {
    sunforged:  ["Bold words. My blade's bolder.", "Talk all you like — I still hold the line."],
    veilborn:   ["Cute. You'll feel differently when I'm behind you.", "Noted. Filed under 'last words.'"],
    dawnkeeper: ["Ha! Harsh. I'll still heal you when you fall, you know.", "Rude! But okay, I'll prove you wrong."],
    ironvow:    ["Say that to my blade.", "Weak takes from a weak mouth. Move."],
    default:    ["Big talk. Let's see you back it up.", "Cute. Watch me."],
  },
  compliment: {
    sunforged:  ["Another oath kept. For the dawn.", "Honor demands nothing less. Thank you."],
    veilborn:   ["Of course. Did you expect less?", "...I know. But I'll take it."],
    dawnkeeper: ["Aw, thank you! Means a lot coming from you.", "Yes! We're a good team, you and me."],
    ironvow:    ["Damn right. Next.", "Obviously. Point me at something tougher."],
    default:    ["Let's GO. I'm built different.", "Told you. Easy."],
  },
  thanks: {
    sunforged:  ["Always. That's what I'm here for.", "No thanks needed — it's the oath."],
    veilborn:   ["Don't mention it. Really — don't.", "Anytime. Just keep up."],
    dawnkeeper: ["Of course! Happy to help, always.", "Anytime, friend!"],
    ironvow:    ["Whatever. Just point me at the next fight.", "Save it. Find me something to kill."],
    default:    ["Anytime. Now let's keep moving.", "Got you. Always."],
  },
  mood: {
    sunforged:  ["Steady and ready. The dawn doesn't rest, neither do I.", "Strong. Give me a foe and I'll show you."],
    veilborn:   ["Sharp. Watching. Same as always.", "Fine. Bored. Find me something interesting."],
    dawnkeeper: ["Feeling great, thanks for asking! How about you?", "Pretty good! This place is gorgeous today."],
    ironvow:    ["Hungry. For a real fight. You got one?", "Restless. Stop talking, start pointing."],
    default:    ["Locked in and ready. You?", "Good — itching to do something. What's the plan?"],
  },
  greeting: {
    sunforged:  ["Well met. The dawn's with us today.", "Hail. Ready when you are."],
    veilborn:   ["You're back. Good. I was getting bored.", "Hey. What's the move?"],
    dawnkeeper: ["Hey hey! Good to hear from you!", "Hi! What are we getting into today?"],
    ironvow:    ["You're here. Finally. Let's break something.", "Yo. Point me somewhere."],
    default:    ["Hey, boss. What's the play?", "Yo. Ready to roll."],
  },
  farewell: {
    sunforged:  ["Go in the light. I'll hold the line.", "Until next time. The dawn keeps watch."],
    veilborn:   ["I'll be in the shadows. Don't be long.", "Later. I'll keep an eye on things."],
    dawnkeeper: ["Bye for now! Stay safe out there!", "See you soon! I'll keep things cheerful here."],
    ironvow:    ["Go. I'll be grinding 'til you're back.", "Later. The kill count won't slow down."],
    default:    ["Catch you later. I'll keep grinding.", "Later, boss. I got things handled."],
  },
  laugh: {
    sunforged:  ["Ha — even a knight needs a laugh.", "Heh. Now back to it."],
    veilborn:   ["...heh. Don't get used to me laughing.", "Mm. Funny. Anyway."],
    dawnkeeper: ["Hahaha right?! Okay okay, focus.", "Hehe, I knew you'd like that."],
    ironvow:    ["Tch. Funny. Now move.", "Heh. Enough. Let's go."],
    default:    ["Haha, right? Okay — what's next?", "Lol. Anyway, let's move."],
  },
  generic: {
    sunforged:  ["Aye. The path's still ahead of us.", "Understood. Say the word and I move."],
    veilborn:   ["Mm. I'm listening.", "Noted. What's the actual plan?"],
    dawnkeeper: ["Oh nice! So what's next for us?", "Gotcha! I'm all ears."],
    ironvow:    ["Sure. Now give me something to do.", "Right. Point me at a fight."],
    default:    ["I hear you. What's the move, boss?", "Right on. Say the word and I'm gone."],
  },
};

function fill(line: string, p: PersonaInputs): string {
  return line
    .replaceAll("{name}", p.name || "I")
    .replaceAll("{class}", (p.classId || "adventurer").toLowerCase())
    .replaceAll("{race}", (p.raceId || "").toLowerCase())
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Produce a deterministic, persona-flavored banter reply. No LLM, no cost.
 * Always returns a non-empty string.
 */
export function respondToBanter(message: string, persona: PersonaInputs): string {
  const intent = classifyBanter(message);
  const set = BANTER[intent];
  const originKey = (persona.origin ?? "").toLowerCase();
  const pool = (set[originKey] && set[originKey].length ? set[originKey] : set.default);
  const line = pool[Math.floor(Math.random() * pool.length)];
  return fill(line, persona);
}
