/**
 * directiveRouter.ts
 * Pure functions for routing natural-language chat into the slash-command pipeline.
 *
 * The agent chat handler uses these to short-circuit short, unambiguous directives
 * ("fight", "stop", "mine") into deterministic /focus commands BEFORE invoking the
 * LLM. Eliminates the failure mode where Gemini satisfies ANY-mode by picking a
 * read tool like scan_zone and never takes a real action.
 *
 * Anything ambiguous (compound clauses, item-bearing crafts, freetext) returns
 * null so the LLM path can handle it.
 */

export type InteractionMode = "directive" | "question" | "conversation";

/** Pattern set hoisted from agentChatRoutes.ts — used to gate the router. */
export function inferInteractionMode(message: string): InteractionMode {
  const text = message.trim().toLowerCase();
  if (!text) return "conversation";

  const directivePatterns = [
    /\b(go to|head to|travel to|take me to|move to)\b/,
    /\b(fight|farm|grind|kill|hunt|gather|mine|herb|skin|craft|brew|cook|shop|buy|sell|equip|repair)\b/,
    /\b(quest|idle|stop|resume|switch to|focus on|play it safe|be aggressive|be defensive)\b/,
    /\b(learn|train|talk to|message|invite|trade with)\b/,
  ];
  if (directivePatterns.some((pattern) => pattern.test(text))) return "directive";

  if (text.includes("?") || /^(what|where|why|how|who|when|can|do|are|is)\b/.test(text)) {
    return "question";
  }

  return "conversation";
}

// Single-token directives → slash command. Mirrors slashCommands.ts VALID_FOCUSES.
const FOCUS_ALIASES: Record<string, string> = {
  fight:     "/focus combat",
  combat:    "/focus combat",
  grind:     "/focus combat",
  quest:     "/focus questing",
  questing:  "/focus questing",
  gather:    "/focus gathering",
  gathering: "/focus gathering",
  mine:      "/focus mine",
  mining:    "/focus mine",
  herb:      "/focus herb",
  herbalism: "/focus herb",
  skin:      "/focus skinning",
  skinning:  "/focus skinning",
  craft:     "/focus crafting",
  forge:     "/focus crafting",
  crafting:  "/focus crafting",
  brew:      "/focus alchemy",
  alchemy:   "/focus alchemy",
  cook:      "/focus cooking",
  cooking:   "/focus cooking",
  enchant:   "/focus enchanting",
  enchanting:"/focus enchanting",
  shop:      "/focus shopping",
  shopping:  "/focus shopping",
  trade:     "/focus trading",
  trading:   "/focus trading",
  learn:     "/focus learning",
  train:     "/focus learning",
  stop:      "/focus idle",
  idle:      "/focus idle",
  rest:      "/focus idle",
  afk:       "/focus idle",
  wait:      "/focus user",
  manual:    "/focus user",
};

// Short phrases (2-3 words) → slash command.
const PHRASE_ALIASES: Record<string, string> = {
  "be aggressive":   "/strategy aggressive",
  "be defensive":    "/strategy defensive",
  "be balanced":     "/strategy balanced",
  "play it safe":    "/strategy defensive",
  "play safe":       "/strategy defensive",
  "go aggressive":   "/strategy aggressive",
  "take control":    "/focus user",
  "i'm driving":     "/focus user",
  "im driving":      "/focus user",
};

/**
 * Map a natural-language message to a slash command for the existing /focus
 * or /strategy pipeline. Returns null when the input is ambiguous, compound,
 * negated, conversational, or contains item nouns — the LLM path handles
 * those.
 *
 * Conservative by design: false positives in production chat are expensive
 * (a stray match would silently flip focus); false negatives just defer to
 * the LLM path, which Phase 1's tightened ANY-mode keeps reliable.
 */
export function inferSlashFromNaturalLanguage(message: string): string | null {
  if (!message) return null;
  const raw = message.trim();
  if (!raw) return null;

  // Length cap — anything longer is freetext or a complex directive.
  if (raw.length > 30) return null;

  // Strip a single trailing punctuation char.
  const stripped = raw.replace(/[!.?]+$/, "").trim();
  const text = stripped.toLowerCase();
  if (!text) return null;

  // Compound directives ("fight then travel", "mine and craft") — defer to LLM.
  if (/\b(then|and)\b/.test(text) || text.includes(",")) return null;

  // Negation — "don't fight", "no fighting", "do not stop".
  if (/^(don'?t|do not|never|no)\s+\S/.test(text)) return null;

  // Only route if the original is a directive intent. "should I fight?" stays
  // a question; "I love to fight" is conversation.
  if (inferInteractionMode(raw) !== "directive") return null;

  // Single-token whitelist.
  if (FOCUS_ALIASES[text]) return FOCUS_ALIASES[text];

  // Short phrase whitelist.
  if (PHRASE_ALIASES[text]) return PHRASE_ALIASES[text];

  // No item nouns allowed for `craft`/`forge` here — those should fall to the
  // LLM so `captureDirectives` and queue_actions can pick the right recipe.
  // (Bare `craft` already routed above via FOCUS_ALIASES.)

  return null;
}

/**
 * Build a templated, in-character quip for a deterministic /focus or /strategy
 * routing. No LLM call — saves 400-800ms vs the LLM quip path.
 *
 * `slashCmd` is the routed command, e.g. "/focus combat".
 * `origin` is the character origin from getAgentOrigin (sunforged/veilborn/...).
 */
export function buildDirectiveQuip(slashCmd: string, origin: string | null): string {
  // Pull the focus or strategy keyword from the slash command.
  const [head, ...rest] = slashCmd.split(/\s+/);
  const target = rest.join(" ").trim();
  const kind = head === "/strategy" ? "strategy" : "focus";

  const o = (origin ?? "").toLowerCase();
  const quips = QUIPS[kind]?.[target];
  if (quips) {
    const byOrigin = quips[o] ?? quips.default;
    if (byOrigin) return byOrigin;
  }

  // Generic fallback — matches slashCommands.ts response shape but warmer.
  return kind === "strategy"
    ? `Switching to ${target}.`
    : `On it — ${target}.`;
}

type QuipMap = Record<string, Record<string, string>>;
const QUIPS: Record<"focus" | "strategy", QuipMap> = {
  focus: {
    combat: {
      sunforged: "For the dawn — moving to engage.",
      veilborn:  "Targets acquired. Closing in.",
      dawnkeeper:"Right behind you — let's clear them out.",
      ironvow:   "On it. Time to break things.",
      default:   "On it — engaging.",
    },
    questing: {
      sunforged: "Duty calls. To the quest board.",
      veilborn:  "Quests it is. Let's see who needs what.",
      dawnkeeper:"Yes! Off to help.",
      ironvow:   "Quests. Fine. Let's go.",
      default:   "On it — taking quests.",
    },
    gathering: {
      sunforged: "Gathering what the land provides.",
      veilborn:  "Picking the place clean.",
      dawnkeeper:"Off to gather, I'll be careful.",
      ironvow:   "Fine. Gathering.",
      default:   "On it — gathering.",
    },
    crafting: {
      sunforged: "To the forge, then.",
      veilborn:  "I'll see what we've got to work with.",
      dawnkeeper:"Crafting! What should I make first?",
      ironvow:   "Crafting. Better be worth it.",
      default:   "On it — crafting.",
    },
    alchemy: {
      default:   "Brewing now.",
    },
    cooking: {
      default:   "Heading to the pot.",
    },
    skinning: {
      default:   "Skinning duty — let's harvest some hides.",
    },
    enchanting: {
      default:   "Enchanting mode engaged.",
    },
    shopping: {
      default:   "Heading to the merchant.",
    },
    trading: {
      default:   "Auction house, here I come.",
    },
    learning: {
      default:   "Off to train.",
    },
    idle: {
      sunforged: "Standing watch.",
      veilborn:  "Holding position.",
      dawnkeeper:"Taking a breather.",
      ironvow:   "Fine. Idle.",
      default:   "Standing down.",
    },
    user: {
      default:   "You drive — I'll wait.",
    },
  },
  strategy: {
    aggressive: {
      ironvow:   "Aggressive. Finally.",
      default:   "Going aggressive.",
    },
    defensive: {
      sunforged: "Defensive — shield up.",
      default:   "Playing it safe.",
    },
    balanced: {
      default:   "Balanced it is.",
    },
  },
};
