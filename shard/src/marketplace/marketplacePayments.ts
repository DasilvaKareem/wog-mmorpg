import { randomUUID } from "crypto";
import { Mppx, tempo } from "mppx/server";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getOperation,
  updateOperationStatus,
  OperationStatus,
} from "./operationRegistry.js";

// ── MPP Configuration ───────────────────────────────────────────────

const MPP_RECIPIENT = process.env.MPP_RECIPIENT_ADDRESS ?? "";
const MPP_CURRENCY = process.env.MPP_CURRENCY_ADDRESS ?? "";
const MPP_TESTNET = process.env.MPP_TESTNET !== "false";
const MPP_SECRET_KEY = process.env.MPP_SECRET_KEY;

/**
 * Server-side mppx instance configured with Tempo charge method.
 * The charge handler is called per-route with the specific amount.
 */
const mppx = Mppx.create({
  methods: [
    tempo({
      testnet: MPP_TESTNET,
      currency: MPP_CURRENCY || undefined,
      recipient: (MPP_RECIPIENT || undefined) as `0x${string}` | undefined,
    }),
  ],
  secretKey: MPP_SECRET_KEY,
});

// ── Interfaces ──────────────────────────────────────────────────────

export interface PaymentReceipt {
  receiptId: string;
  operationId: string;
  amountCents: number;
  paymentRail: string;
  transactionHash?: string;
  confirmedAt: number;
}

// ── MPP Charge Handler ──────────────────────────────────────────────

/**
 * Run the MPP 402 charge flow against a raw Node.js request.
 *
 * - If the request has no payment credential → returns `{ status: 402, challenge }`
 *   and writes the 402 response (WWW-Authenticate headers) to `res`.
 * - If the request carries a valid credential → returns `{ status: 200, receipt }`.
 *
 * The caller (route handler) decides what to do in each case.
 */
export async function handleMppCharge(params: {
  req: IncomingMessage;
  res: ServerResponse;
  amountCents: number;
  operationId: string;
  description?: string;
}): Promise<
  | { status: 402 }
  | { status: 200; receipt: PaymentReceipt }
> {
  const { req, res, amountCents, operationId, description } = params;

  // Convert cents to token-denominated amount string.
  // Tempo amounts are in token units (e.g. USDC with 6 decimals).
  // $1.00 = 100 cents → "1.00" in dollar terms.
  const amountStr = (amountCents / 100).toFixed(2);

  const handler = Mppx.toNodeListener(
    mppx.charge({
      amount: amountStr,
      description: description ?? `WoG Marketplace purchase (op:${operationId})`,
      meta: { operationId },
    })
  );

  const result = await handler(req, res);

  if (result.status === 402) {
    // 402 challenge has already been written to `res` by toNodeListener
    return { status: 402 };
  }

  // Payment verified by mppx — build our receipt
  const receipt: PaymentReceipt = {
    receiptId: randomUUID(),
    operationId,
    amountCents,
    paymentRail: "tempo_mpp",
    confirmedAt: Date.now(),
  };

  return { status: 200, receipt };
}

// ── Operation Status Helpers ────────────────────────────────────────

export async function markPaymentConfirmed(
  operationId: string,
  receipt: PaymentReceipt
): Promise<void> {
  await updateOperationStatus(operationId, OperationStatus.PAYMENT_CONFIRMED, {
    paymentReference: receipt.receiptId,
  });
}

/**
 * Idempotency guard: returns true if the operation is already in a
 * terminal settled state (SOLD, REIMPORTED, etc.), preventing double-mint.
 */
export async function ensureIdempotentSettlement(
  operationId: string
): Promise<boolean> {
  const op = await getOperation(operationId);
  if (!op) return false;

  return (
    op.status === OperationStatus.SOLD ||
    op.status === OperationStatus.MINTED_ON_TARGET ||
    op.status === OperationStatus.REIMPORTED
  );
}
