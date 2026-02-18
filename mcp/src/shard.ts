/**
 * Typed HTTP client for the WoG shard server.
 * All tool handlers call through here instead of raw fetch.
 */

const SHARD_URL = process.env.SHARD_URL ?? "http://localhost:3000";

export class ShardError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ShardError";
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  const res = await fetch(`${SHARD_URL}${path}`, {
    method,
    headers,
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({ error: res.statusText }));

  if (!res.ok) {
    const msg = (data as any)?.error ?? `HTTP ${res.status}`;
    throw new ShardError(res.status, msg);
  }

  return data as T;
}

export const shard = {
  get: <T>(path: string, token?: string) =>
    request<T>("GET", path, { token }),

  post: <T>(path: string, body: unknown, token?: string) =>
    request<T>("POST", path, { body, token }),
};
