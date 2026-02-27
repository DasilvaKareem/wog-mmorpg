import type { FastifyInstance } from "fastify";
import { createClient } from "@farcaster/quick-auth";
import { generateAuthToken } from "./auth.js";

const farcasterClient = createClient();

/**
 * Register Farcaster Mini App authentication routes.
 *
 * POST /auth/farcaster — verify a Farcaster Quick Auth JWT,
 * map the user's FID to their provided wallet address,
 * and issue a WoG JWT for subsequent authenticated calls.
 */
export function registerFarcasterAuthRoutes(server: FastifyInstance): void {
  server.post<{
    Body: {
      /** Farcaster Quick Auth JWT from sdk.quickAuth.getToken() */
      farcasterToken: string;
      /** The user's Ethereum wallet address from Warpcast */
      walletAddress: string;
    };
  }>("/auth/farcaster", async (request, reply) => {
    const { farcasterToken, walletAddress } = request.body;

    if (!farcasterToken || !walletAddress) {
      return reply.status(400).send({ error: "Missing farcasterToken or walletAddress" });
    }

    if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return reply.status(400).send({ error: "Invalid wallet address" });
    }

    try {
      // Verify the Farcaster Quick Auth JWT using the official library.
      // This validates the signature against Farcaster's JWKS endpoint
      // and returns the decoded payload with the user's FID.
      const domain = request.headers.origin
        ? new URL(request.headers.origin).hostname
        : request.hostname;

      const payload = await farcasterClient.verifyJwt({
        token: farcasterToken,
        domain,
      });

      const fid = payload.sub;

      // Issue a WoG JWT tied to the wallet address
      const token = generateAuthToken(walletAddress);

      server.log.info(
        `[farcaster-auth] FID ${fid} authenticated with wallet ${walletAddress.slice(0, 8)}...`
      );

      return reply.send({
        success: true,
        token,
        walletAddress,
        fid,
        expiresIn: "24h",
      });
    } catch (err: any) {
      server.log.warn(`[farcaster-auth] JWT verification failed: ${err.message?.slice(0, 120)}`);
      return reply.status(401).send({
        error: "Invalid Farcaster token",
        details: err.message?.slice(0, 120),
      });
    }
  });
}
