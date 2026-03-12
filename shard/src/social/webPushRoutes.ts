/**
 * Web Push API Routes
 *
 * POST   /notifications/push/subscribe         — register a push subscription
 * DELETE /notifications/push/subscribe/:wallet — remove a subscription
 * GET    /notifications/push/vapid-public-key  — return the VAPID public key
 * POST   /notifications/push/test/:wallet      — send a test push (dev only)
 */

import type { FastifyInstance } from "fastify";
import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  sendPushToWallet,
} from "./webPushService.js";

interface SubscribeBody {
  wallet: string;
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
    expirationTime?: number | null;
  };
}

export function registerWebPushRoutes(server: FastifyInstance): void {
  // ── GET /notifications/push/vapid-public-key ─────────────────────────────
  // Returns the VAPID public key so the client can subscribe
  server.get("/notifications/push/vapid-public-key", async (_req, reply) => {
    const key = getVapidPublicKey();
    if (!key) {
      return reply.status(503).send({
        error: "Push notifications not configured on this server",
      });
    }
    return { publicKey: key };
  });

  // ── POST /notifications/push/subscribe ───────────────────────────────────
  // Register a push subscription for a wallet address
  server.post<{ Body: SubscribeBody }>(
    "/notifications/push/subscribe",
    async (request, reply) => {
      const { wallet, subscription } = request.body ?? {};

      if (!wallet || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return reply.status(400).send({ error: "wallet and subscription (with endpoint + keys) are required" });
      }

      if (!wallet.startsWith("0x") || wallet.length < 20) {
        return reply.status(400).send({ error: "Invalid wallet address" });
      }

      await saveSubscription(wallet, subscription as any);
      return { success: true, message: "Push subscription saved" };
    }
  );

  // ── DELETE /notifications/push/subscribe/:wallet ─────────────────────────
  // Remove a push subscription
  server.delete<{ Params: { wallet: string } }>(
    "/notifications/push/subscribe/:wallet",
    async (request, reply) => {
      const { wallet } = request.params;
      if (!wallet) return reply.status(400).send({ error: "wallet required" });
      await removeSubscription(wallet);
      return { success: true };
    }
  );

  // ── POST /notifications/push/test/:wallet ────────────────────────────────
  // Send a test push notification (useful for validating setup)
  server.post<{ Params: { wallet: string } }>(
    "/notifications/push/test/:wallet",
    async (request, reply) => {
      const { wallet } = request.params;
      if (!wallet) return reply.status(400).send({ error: "wallet required" });

      const sent = await sendPushToWallet(wallet, {
        title: "World of Geneva",
        body: "Push notifications are working! You'll be notified of level-ups, deaths, and world events.",
        tag: "wog-test",
        url: "/world",
      });

      if (!sent) {
        return reply.status(404).send({
          error: "No push subscription found for this wallet, or push not configured",
        });
      }
      return { success: true };
    }
  );
}
