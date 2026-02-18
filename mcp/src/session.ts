/**
 * In-memory session store.
 * Maps MCP sessionId → { walletAddress, jwtToken }
 * Tokens expire in 24h (same as shard JWT_EXPIRY).
 */

interface Session {
  walletAddress: string;
  token: string;
  createdAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const sessions = new Map<string, Session>();

export function setSession(sessionId: string, walletAddress: string, token: string): void {
  sessions.set(sessionId, { walletAddress, token, createdAt: Date.now() });
}

export function getSession(sessionId: string): Session | undefined {
  const s = sessions.get(sessionId);
  if (!s) return undefined;
  if (Date.now() - s.createdAt > TTL_MS) {
    sessions.delete(sessionId);
    return undefined;
  }
  return s;
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Returns {walletAddress, token} or throws if session not found / expired */
export function requireSession(sessionId: string): Session {
  const s = getSession(sessionId);
  if (!s) {
    throw new Error(
      "Not authenticated. Call auth_get_challenge → auth_verify_signature first."
    );
  }
  return s;
}

// GC stale sessions every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > TTL_MS) sessions.delete(id);
  }
}, 15 * 60 * 1000);
