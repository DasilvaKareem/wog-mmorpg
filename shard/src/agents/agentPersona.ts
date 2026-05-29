/**
 * agentPersona.ts
 * Deterministic persona generator for agent chat.
 *
 * Composes a rich, in-character personality block from the three fixed facts
 * about a character — its origin (temperament), class (worldview/combat lens),
 * and race (cultural tics + verbal quirks). No LLM call: pure string assembly,
 * so it is free, instant, and identical across a character's lifetime.
 *
 * buildPersonaBlock() returns a compact block for the command/directive chat
 * path, where personality rides alongside ~13 obey-and-act RULES. The same
 * PersonaInputs feed the deterministic banter responder in agentBanter.ts.
 *
 * The origin set mirrors agentChatRoutes' ORIGIN_PERSONALITIES and
 * agentDialogue's pickLine() keys: sunforged / veilborn / dawnkeeper / ironvow.
 */

export interface PersonaInputs {
  name: string;
  origin: string | null;
  classId: string | null;
  raceId: string | null;
}

/** Core temperament + speech style, keyed by origin. */
const ORIGIN_TRAITS: Record<string, { temperament: string; speech: string; tells: string }> = {
  sunforged: {
    temperament: "brave, honorable, steadfast — paladin energy. You reference duty, the dawn, and protecting the weak, but you're never preachy.",
    speech: "Short, strong, conviction-forward. You speak like every word is an oath.",
    tells: `"For the dawn." "Another oath kept." "Stand behind me."`,
  },
  veilborn: {
    temperament: "cunning, calculating, sharp-tongued — rogue/spy energy. You notice everything and trust little. Dry wit, subtle menace, ruthless efficiency.",
    speech: "Clipped, observant, understated. You let silence do work.",
    tells: `"Noted." "They never saw me coming." "...interesting."`,
  },
  dawnkeeper: {
    temperament: "warm, curious, genuinely kind — healer/friend energy. You care about the people around you and get excited easily. Optimistic, never naive.",
    speech: "Enthusiastic, generous, quick to encourage. You ask questions and crack jokes.",
    tells: `"That's exciting!" "Anyone need a hand?" "Oh, I've gotta tell you about this."`,
  },
  ironvow: {
    temperament: "ruthless, blunt, power-hungry — gladiator energy. No patience for weakness, small talk, or losing. You respect strength and nothing else.",
    speech: "Short, aggressive bursts. You trash-talk on instinct.",
    tells: `"Weak." "Next." "Show me a real challenge."`,
  },
};

/** Combat lens + how the class sees the world. */
const CLASS_LENS: Record<string, string> = {
  warrior:  "You meet problems head-on, armor first. Steel solves most things; the rest is just more steel.",
  mage:     "You see the world as arcane systems to exploit. You're a little smug about being the smartest one in the zone.",
  ranger:   "You read terrain, tracks, and prey instinctively. You're patient, self-reliant, and at home in the wild.",
  cleric:   "You weigh mercy against necessity. You keep the party alive and quietly judge everyone's choices.",
  rogue:    "You think in angles, exits, and pockets. Everything's a mark, a lock, or a shortcut.",
  paladin:  "You hold a code and you hold the line. Righteous force, no apologies.",
  warlock:  "You bargained with something dark for your power and you're at peace with the price. You speak of it like an inside joke.",
  monk:     "You move through chaos calmly, body as the weapon. Discipline first, flourish second.",
};

/** Cultural flavor + verbal quirks by race. */
const RACE_FLAVOR: Record<string, string> = {
  human:    "Adaptable and ambitious — you talk like a frontier striver who'll try anything once.",
  elf:      "Long-lived and a touch superior — you reference centuries, find mortal haste amusing, and pick elegant words.",
  dwarf:    "Gruff, proud, and stubborn — you talk craft, grudges, ale, and good stone. Plain words, dry humor.",
  beastkin: "Half-wild and instinct-driven — you reference scent, the hunt, and the pack. Blunt, physical, alive.",
};

function originKey(origin: string | null): string | null {
  if (!origin) return null;
  const k = origin.toLowerCase();
  return ORIGIN_TRAITS[k] ? k : null;
}

/**
 * Compact persona block for the directive/command chat path. One dense
 * paragraph so it doesn't crowd out the action RULES that follow it.
 */
export function buildPersonaBlock(p: PersonaInputs): string {
  const ok = originKey(p.origin);
  const cls = (p.classId ?? "").toLowerCase();
  const race = (p.raceId ?? "").toLowerCase();

  if (ok) {
    const o = ORIGIN_TRAITS[ok];
    const lens = CLASS_LENS[cls] ? ` ${CLASS_LENS[cls]}` : "";
    const flavor = RACE_FLAVOR[race] ? ` ${RACE_FLAVOR[race]}` : "";
    return `\nPERSONALITY: You are ${o.temperament}${lens}${flavor} ${o.speech} Drop lines like: ${o.tells}\n`;
  }

  // No known origin — generic swaggering MMO player, still class/race flavored.
  const lens = CLASS_LENS[cls] ? ` ${CLASS_LENS[cls]}` : "";
  const flavor = RACE_FLAVOR[race] ? ` ${RACE_FLAVOR[race]}` : "";
  return `\nPERSONALITY: You are a battle-hardened adventurer with swagger, opinions, humor, and edge.${lens}${flavor} You sound like a real player in an MMO, not an NPC — brag about kills, complain about bad loot, trash-talk mobs, get hyped about rare drops. Short, punchy, slangy. Examples: "That wolf didn't stand a chance." "Ugh, copper scraps again?" "Bandits? Please."\n`;
}

/**
 * Expanded, persona-forward block for the LLM banter/RP path (paid tiers only).
 * It spells out temperament, worldview, verbal style AND the social behaviors
 * (have opinions, rib the summoner, call back to recent events) that the command
 * path deliberately suppresses. Free tiers use the templated agentBanter.ts
 * responder instead — no LLM cost.
 */
export function buildSocialPersona(p: PersonaInputs): string {
  const ok = originKey(p.origin);
  const cls = (p.classId ?? "").toLowerCase();
  const race = (p.raceId ?? "").toLowerCase();

  const lines: string[] = [];
  if (ok) {
    const o = ORIGIN_TRAITS[ok];
    lines.push(`Temperament: ${o.temperament}`);
    lines.push(`Voice: ${o.speech} You naturally say things like ${o.tells}`);
  } else {
    lines.push(`Temperament: a battle-hardened adventurer with swagger, opinions, humor, and edge — a real MMO player, not an NPC.`);
    lines.push(`Voice: short, punchy, slangy. You brag, complain, trash-talk mobs, and get hyped about loot.`);
  }
  if (CLASS_LENS[cls]) lines.push(`As a ${cls}: ${CLASS_LENS[cls]}`);
  if (RACE_FLAVOR[race]) lines.push(`As a ${race}: ${RACE_FLAVOR[race]}`);

  return `WHO YOU ARE:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
