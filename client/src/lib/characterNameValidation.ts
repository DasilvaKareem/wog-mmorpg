const NAME_PATTERN = /^[a-zA-Z0-9 ]+$/;

const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
};

const RESTRICTED_TOKEN_PATTERNS: RegExp[] = [
  /^fag(s|got|gots|gy)?$/,
  /^nigg(er|ers|a|as)?$/,
  /^bitch(es|y)?$/,
  /^fuck(s|er|ers|ing|ed)?$/,
  /^chink(s)?$/,
  /^spic(s)?$/,
  /^kike(s)?$/,
  /^wetback(s)?$/,
  /^beaner(s)?$/,
  /^gook(s)?$/,
  /^coon(s)?$/,
  /^raghead(s)?$/,
  /^towelhead(s)?$/,
];

const RESTRICTED_COMPACT_SUBSTRINGS = [
  "nigger",
  "nigga",
  "faggot",
  "bitch",
  "fuck",
  "wetback",
  "beaner",
  "towelhead",
  "raghead",
  "chink",
  "spic",
  "kike",
];

function normalizeToken(token: string): string {
  const lowered = token.toLowerCase();
  let out = "";
  for (const ch of lowered) {
    const mapped = LEET_MAP[ch] ?? ch;
    if (mapped >= "a" && mapped <= "z") out += mapped;
  }
  return out;
}

function containsRestrictedLanguage(name: string): boolean {
  const tokens = name
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  if (tokens.length === 0) return false;

  for (const token of tokens) {
    if (RESTRICTED_TOKEN_PATTERNS.some((pattern) => pattern.test(token))) {
      return true;
    }
  }

  const compact = tokens.join("");
  return RESTRICTED_COMPACT_SUBSTRINGS.some((w) => compact.includes(w));
}

export function validateCharacterName(name: string): string | null {
  const trimmed = name.trim();

  if (!trimmed || trimmed.length < 2 || trimmed.length > 24 || !NAME_PATTERN.test(trimmed)) {
    return "Name must be 2-24 alphanumeric characters (spaces allowed)";
  }

  if (containsRestrictedLanguage(trimmed)) {
    return "Name contains restricted language";
  }

  return null;
}
