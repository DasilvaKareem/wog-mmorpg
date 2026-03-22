import type { QuestGraphFreeformRoute } from "./types.js";

export interface FreeformIntentResolution {
  route: QuestGraphFreeformRoute | null;
  confidence: number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

function phraseScore(input: string, phrase: string): number {
  if (!phrase) return 0;
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return 0;
  if (input === normalizedPhrase) return 8;
  if (input.includes(normalizedPhrase)) return 5;
  return 0;
}

function tokenScore(inputTokens: string[], candidate: string): number {
  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) return 0;
  let score = 0;
  for (const token of candidateTokens) {
    if (inputTokens.includes(token)) score += 2;
  }
  return score;
}

export function resolveFreeformQuestIntent(
  input: string,
  routes: QuestGraphFreeformRoute[],
): FreeformIntentResolution {
  const normalizedInput = normalize(input);
  const inputTokens = tokenize(input);
  let bestRoute: QuestGraphFreeformRoute | null = null;
  let bestScore = 0;

  for (const route of routes) {
    let score = 0;
    for (const intent of route.intents) {
      score += phraseScore(normalizedInput, intent);
      score += tokenScore(inputTokens, intent);
    }
    for (const phrase of route.phrases ?? []) {
      score += phraseScore(normalizedInput, phrase);
      score += tokenScore(inputTokens, phrase);
    }

    if (score > bestScore) {
      bestScore = score;
      bestRoute = route;
    }
  }

  if (!bestRoute || bestScore <= 0) {
    return { route: null, confidence: 0 };
  }

  return {
    route: bestRoute,
    confidence: Math.min(0.99, 0.35 + bestScore / 20),
  };
}
