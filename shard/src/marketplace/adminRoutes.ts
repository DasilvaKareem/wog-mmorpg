import type { FastifyInstance } from "fastify";
import { mintItem } from "../blockchain/blockchain.js";
import { assignItemInstanceOwner } from "../items/itemRng.js";
import {
  getOperation,
  getOperationsByStatus,
  getOperationsByWallet,
  updateOperationStatus,
  OperationStatus,
  type Operation,
} from "./operationRegistry.js";
import {
  getRawListing,
  markListingCancelled,
} from "./listingsService.js";

// ── Constants ───────────────────────────────────────────────────────

const ADMIN_SECRET = process.env.ADMIN_SECRET?.trim() || null;

// ── Admin Auth Helper ───────────────────────────────────────────────

function verifyAdmin(
  request: { headers: Record<string, string | string[] | undefined> },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } }
): boolean {
  if (!ADMIN_SECRET) {
    reply.code(503).send({ error: "Admin route disabled: ADMIN_SECRET is not configured" });
    return false;
  }
  const secret = request.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// ── Route Registration ──────────────────────────────────────────────

export function registerMarketplaceAdminRoutes(server: FastifyInstance) {
  // ── GET /admin/marketplace/operations ─────────────────────────────
  server.get<{
    Querystring: {
      status?: string;
      wallet?: string;
      type?: string;
      limit?: string;
      offset?: string;
    };
  }>("/admin/marketplace/operations", async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;

    const { status, wallet, type, limit, offset } = request.query;
    let ops: Operation[] = [];

    if (status) {
      const statusEnum = status.toUpperCase() as OperationStatus;
      if (Object.values(OperationStatus).includes(statusEnum)) {
        ops = await getOperationsByStatus(statusEnum);
      }
    } else if (wallet) {
      ops = await getOperationsByWallet(wallet);
    } else {
      // Without a filter, return operations from all non-terminal statuses
      const activeStatuses = [
        OperationStatus.CREATED,
        OperationStatus.PAYMENT_PENDING,
        OperationStatus.PAYMENT_CONFIRMED,
        OperationStatus.BURN_PENDING,
        OperationStatus.MINT_PENDING,
        OperationStatus.LISTED,
        OperationStatus.FAILED,
        OperationStatus.REPAIR_REQUIRED,
      ];
      for (const s of activeStatuses) {
        const batch = await getOperationsByStatus(s);
        ops.push(...batch);
      }
    }

    // Filter by type if provided
    if (type) {
      ops = ops.filter((op) => op.operationType === type);
    }

    // Sort by updatedAt descending
    ops.sort((a, b) => b.updatedAt - a.updatedAt);

    // Pagination
    const off = offset ? parseInt(offset, 10) : 0;
    const lim = limit ? parseInt(limit, 10) : 50;
    const paginated = ops.slice(off, off + lim);

    return { total: ops.length, operations: paginated };
  });

  // ── GET /admin/marketplace/operations/:operationId ────────────────
  server.get<{ Params: { operationId: string } }>(
    "/admin/marketplace/operations/:operationId",
    async (request, reply) => {
      if (!verifyAdmin(request, reply)) return;

      const op = await getOperation(request.params.operationId);
      if (!op) {
        return reply.code(404).send({ error: "Operation not found" });
      }
      return op;
    }
  );

  // ── POST /admin/marketplace/operations/:operationId/retry ─────────
  server.post<{ Params: { operationId: string } }>(
    "/admin/marketplace/operations/:operationId/retry",
    async (request, reply) => {
      if (!verifyAdmin(request, reply)) return;

      const op = await getOperation(request.params.operationId);
      if (!op) {
        return reply.code(404).send({ error: "Operation not found" });
      }

      if (op.status !== OperationStatus.FAILED) {
        return reply
          .code(400)
          .send({ error: `Cannot retry operation in status ${op.status}` });
      }

      // Reset to the appropriate pre-failure state
      const resetStatus =
        op.operationType === "direct_sale"
          ? OperationStatus.PAYMENT_CONFIRMED
          : OperationStatus.CREATED;

      const updated = await updateOperationStatus(
        op.operationId,
        resetStatus,
        { failureReason: undefined }
      );

      server.log.info(
        `Admin retried operation ${op.operationId}: ${op.status} -> ${resetStatus}`
      );

      return { ok: true, operation: updated };
    }
  );

  // ── POST /admin/marketplace/operations/:operationId/force-complete ─
  server.post<{
    Params: { operationId: string };
    Body: { targetTxHash?: string };
  }>(
    "/admin/marketplace/operations/:operationId/force-complete",
    async (request, reply) => {
      if (!verifyAdmin(request, reply)) return;

      const op = await getOperation(request.params.operationId);
      if (!op) {
        return reply.code(404).send({ error: "Operation not found" });
      }

      const updated = await updateOperationStatus(
        op.operationId,
        OperationStatus.SOLD,
        { targetTxHash: request.body?.targetTxHash }
      );

      server.log.warn(
        `Admin force-completed operation ${op.operationId} from status ${op.status}`
      );

      return { ok: true, operation: updated };
    }
  );

  // ── POST /admin/marketplace/operations/:operationId/force-cancel ──
  server.post<{ Params: { operationId: string } }>(
    "/admin/marketplace/operations/:operationId/force-cancel",
    async (request, reply) => {
      if (!verifyAdmin(request, reply)) return;

      const op = await getOperation(request.params.operationId);
      if (!op) {
        return reply.code(404).send({ error: "Operation not found" });
      }

      // Attempt to restore items to owner
      try {
        const restoreTx = await mintItem(
          op.ownerWallet,
          BigInt(op.sourceTokenId),
          BigInt(op.quantity)
        );
        server.log.info(
          `Admin force-cancel: restored ${op.quantity}x token ${op.sourceTokenId} to ${op.ownerWallet} via ${restoreTx}`
        );

        if (op.instanceId) {
          await assignItemInstanceOwner(op.instanceId, op.ownerWallet);
        }
      } catch (restoreErr) {
        server.log.error(
          restoreErr,
          `Admin force-cancel: failed to restore items for operation ${op.operationId}`
        );
      }

      // Cancel linked listing if any
      if (op.listingId) {
        try {
          await markListingCancelled(op.listingId);
        } catch {
          // Listing may already be in non-active state
        }
      }

      const updated = await updateOperationStatus(
        op.operationId,
        OperationStatus.CANCELLED,
        { failureReason: "Admin force-cancelled" }
      );

      return { ok: true, operation: updated };
    }
  );

  // ── GET /admin/marketplace/stats ──────────────────────────────────
  server.get("/admin/marketplace/stats", async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;

    const statusCounts: Record<string, number> = {};
    for (const status of Object.values(OperationStatus)) {
      const ops = await getOperationsByStatus(status);
      if (ops.length > 0) {
        statusCounts[status] = ops.length;
      }
    }

    const sold = await getOperationsByStatus(OperationStatus.SOLD);
    const totalVolume = sold.length; // Could be extended to track USD volume

    return {
      operationsByStatus: statusCounts,
      totalSoldOperations: sold.length,
      totalOperations: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    };
  });
}
