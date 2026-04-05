import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { verifyMessage } from "viem";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = "24h";

interface AuthPayload {
  walletAddress: string;
  timestamp: number;
}

interface JWTPayload {
  walletAddress: string;
  iat: number;
  exp: number;
}

/**
 * Generate a JWT token for an authenticated wallet
 */
export function generateAuthToken(walletAddress: string): string {
  return jwt.sign({ walletAddress }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify a JWT token and return the wallet address
 */
export function verifyAuthToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded.walletAddress;
  } catch (err) {
    return null;
  }
}

export function getAuthenticatedWallet(request: FastifyRequest): string | null {
  const walletAddress = (request as any).walletAddress;
  return typeof walletAddress === "string" && walletAddress.length > 0
    ? walletAddress
    : null;
}

export function walletsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function requireWalletMatch(
  reply: FastifyReply,
  authenticatedWallet: string | null | undefined,
  requestedWallet: string | null | undefined,
  errorMessage = "Not authorized to use this wallet"
): boolean {
  if (walletsMatch(authenticatedWallet, requestedWallet)) {
    return true;
  }

  reply.code(403).send({ error: errorMessage });
  return false;
}

/**
 * Verify a wallet signature
 * Message format: "Sign this message to authenticate with WoG MMORPG\nTimestamp: {timestamp}\nWallet: {address}"
 */
export async function verifyWalletSignature(
  walletAddress: string,
  signature: string,
  timestamp: number
): Promise<boolean> {
  // Check timestamp is recent (within 5 minutes)
  const now = Date.now();
  if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
    return false;
  }

  const message = `Sign this message to authenticate with WoG MMORPG\nTimestamp: ${timestamp}\nWallet: ${walletAddress}`;

  try {
    const isValid = await verifyMessage({
      address: walletAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    return isValid;
  } catch (err) {
    console.error("Signature verification failed:", err);
    return false;
  }
}

/**
 * Fastify authentication middleware
 * Checks for Bearer token in Authorization header
 */
export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix
  const walletAddress = verifyAuthToken(token);

  if (!walletAddress) {
    reply.code(401).send({ error: "Invalid or expired token" });
    return;
  }

  // Attach wallet address to request for use in route handlers
  (request as any).walletAddress = walletAddress;
}

/**
 * Register authentication routes
 */
export function registerAuthRoutes(server: FastifyInstance): void {
  // Get authentication challenge (message to sign)
  server.get<{
    Querystring: { wallet: string };
  }>("/auth/challenge", async (req, reply) => {
    const { wallet } = req.query;

    if (!wallet || !wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
      return reply.status(400).send({ error: "Invalid wallet address" });
    }

    const timestamp = Date.now();
    const message = `Sign this message to authenticate with WoG MMORPG\nTimestamp: ${timestamp}\nWallet: ${wallet}`;

    return reply.send({
      message,
      timestamp,
      wallet,
    });
  });

  // Verify signature and issue JWT token
  server.post<{
    Body: {
      walletAddress: string;
      signature: string;
      timestamp: number;
    };
  }>("/auth/verify", async (req, reply) => {
    const { walletAddress, signature, timestamp } = req.body;

    if (!walletAddress || !signature || !timestamp) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const isValid = await verifyWalletSignature(walletAddress, signature, timestamp);

    if (!isValid) {
      return reply.status(401).send({ error: "Invalid signature or expired timestamp" });
    }

    const token = generateAuthToken(walletAddress);

    return reply.send({
      success: true,
      token,
      walletAddress,
      expiresIn: JWT_EXPIRY,
    });
  });

  // Verify thirdweb token and issue shard JWT (for native mobile apps)
  server.post("/auth/verify-thirdweb", async (req, reply) => {
    const body = req.body as any;
    const thirdwebToken: string | undefined =
      typeof body === "object" && body !== null ? body.thirdwebToken : undefined;

    if (!thirdwebToken || typeof thirdwebToken !== "string") {
      server.log.warn(`[auth] verify-thirdweb bad body: ${JSON.stringify(body)}`);
      return reply.status(400).send({ error: "Missing thirdwebToken in request body" });
    }

    try {
      const twRes = await fetch("https://api.thirdweb.com/v1/wallets/me", {
        headers: {
          "Authorization": `Bearer ${thirdwebToken}`,
          "x-client-id": process.env.THIRDWEB_CLIENT_ID || "231a06443d1568f83d2d4f2c8e7dfe3b",
        },
      });

      if (!twRes.ok) {
        const errText = await twRes.text();
        server.log.warn(`[auth] Thirdweb /wallets/me failed (${twRes.status}): ${errText}`);
        return reply.status(401).send({ error: "Invalid thirdweb token" });
      }

      const twData = await twRes.json() as any;
      const walletAddress = twData?.result?.address ?? twData?.address;

      if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        server.log.warn(`[auth] No wallet in thirdweb response: ${JSON.stringify(twData)}`);
        return reply.status(401).send({ error: "Could not resolve wallet from thirdweb token" });
      }

      const token = generateAuthToken(walletAddress);
      server.log.info(`[auth] Thirdweb token verified for ${walletAddress} (native mobile)`);

      return reply.send({
        success: true,
        token,
        walletAddress,
        expiresIn: JWT_EXPIRY,
      });
    } catch (err) {
      server.log.error(err, "[auth] Thirdweb token verification failed");
      return reply.status(500).send({ error: "Failed to verify thirdweb token" });
    }
  });

  // Verify token endpoint (check if token is still valid)
  server.get("/auth/verify-token", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const walletAddress = (req as any).walletAddress;

    return reply.send({
      valid: true,
      walletAddress,
    });
  });

  // Refresh token (get new token before expiry)
  server.post("/auth/refresh", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const walletAddress = (req as any).walletAddress;
    const newToken = generateAuthToken(walletAddress);

    return reply.send({
      success: true,
      token: newToken,
      walletAddress,
      expiresIn: JWT_EXPIRY,
    });
  });
}

/**
 * Helper to verify wallet owns the entity they're trying to control
 */
export function verifyEntityOwnership(
  entityWallet: string | undefined,
  requestWallet: string
): boolean {
  if (!entityWallet) return false;
  return entityWallet.toLowerCase() === requestWallet.toLowerCase();
}
