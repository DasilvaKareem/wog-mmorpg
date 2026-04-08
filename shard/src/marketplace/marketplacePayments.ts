import { randomUUID } from "crypto";
import { getRedis } from "../redis.js";
import {
  deleteMarketplacePendingPayment,
  getMarketplacePendingPayment,
  putMarketplacePendingPayment,
} from "../db/marketplaceStore.js";
import { isPostgresConfigured } from "../db/postgres.js";
import {
  getOperation,
  updateOperationStatus,
  OperationStatus,
} from "./operationRegistry.js";

const DEFAULT_RECIPIENT = "0x8cFd0a555dD865B2b63a391AF2B14517C0389808";
const DEFAULT_USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const MARKETPLACE_PAYMENT_RECIPIENT =
  process.env.MARKETPLACE_PAYMENT_RECIPIENT_ADDRESS ??
  process.env.MPP_RECIPIENT_ADDRESS ??
  DEFAULT_RECIPIENT;
const MARKETPLACE_PAYMENT_CURRENCY =
  process.env.MARKETPLACE_PAYMENT_CURRENCY_ADDRESS ??
  process.env.MPP_CURRENCY_ADDRESS ??
  DEFAULT_USDC_BASE;
const MARKETPLACE_PAYMENT_CHAIN_ID = Number(
  process.env.MARKETPLACE_PAYMENT_CHAIN_ID ?? "8453"
);
const PAYMENT_TTL_SECONDS = Number(
  process.env.MARKETPLACE_PAYMENT_TTL_SECONDS ?? "1800"
);

export const MARKETPLACE_PAYMENT_RAIL = "base_usdc";

const KEY_PAYMENT = (paymentId: string) => `mktplace:payment:${paymentId}`;

interface PendingMarketplacePayment {
  paymentId: string;
  wallet: string;
  amountCents: number;
  description?: string;
  createdAt: number;
}

export interface MarketplacePaymentIntent {
  paymentId: string;
  amountCents: number;
  amountUsd: string;
  payment: {
    chainId: number;
    currency: string;
    recipientWallet: string;
  };
}

export interface PaymentReceipt {
  receiptId: string;
  operationId: string;
  amountCents: number;
  paymentRail: string;
  transactionHash?: string;
  confirmedAt: number;
}

function formatUsdAmount(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

async function getPendingMarketplacePayment(
  paymentId: string
): Promise<PendingMarketplacePayment | null> {
  if (isPostgresConfigured()) {
    const payment = await getMarketplacePendingPayment<PendingMarketplacePayment>(paymentId);
    if (payment) return payment;
  }
  const redis = getRedis();
  if (!redis) return null;

  const raw = await redis.get(KEY_PAYMENT(paymentId));
  return raw ? (JSON.parse(raw) as PendingMarketplacePayment) : null;
}

export async function createMarketplacePaymentIntent(params: {
  wallet: string;
  amountCents: number;
  description?: string;
}): Promise<MarketplacePaymentIntent> {
  const paymentId = randomUUID();
  const pending: PendingMarketplacePayment = {
    paymentId,
    wallet: params.wallet.toLowerCase(),
    amountCents: params.amountCents,
    description: params.description,
    createdAt: Date.now(),
  };

  if (isPostgresConfigured()) {
    await putMarketplacePendingPayment(paymentId, pending.wallet, pending, Date.now() + PAYMENT_TTL_SECONDS * 1000);
  }
  const redis = getRedis();
  if (redis) {
    await redis.set(
      KEY_PAYMENT(paymentId),
      JSON.stringify(pending),
      "EX",
      PAYMENT_TTL_SECONDS
    );
  }

  return {
    paymentId,
    amountCents: params.amountCents,
    amountUsd: formatUsdAmount(params.amountCents),
    payment: {
      chainId: MARKETPLACE_PAYMENT_CHAIN_ID,
      currency: MARKETPLACE_PAYMENT_CURRENCY,
      recipientWallet: MARKETPLACE_PAYMENT_RECIPIENT,
    },
  };
}

export async function validateMarketplacePayment(params: {
  paymentId: string;
  wallet: string;
  transactionHash?: string;
}): Promise<PaymentReceipt> {
  const pending = await getPendingMarketplacePayment(params.paymentId);
  if (!pending) {
    throw new Error("Payment not found or expired");
  }
  if (pending.wallet !== params.wallet.toLowerCase()) {
    throw new Error("Payment belongs to a different wallet");
  }

  return {
    receiptId: pending.paymentId,
    operationId: pending.paymentId,
    amountCents: pending.amountCents,
    paymentRail: MARKETPLACE_PAYMENT_RAIL,
    transactionHash: params.transactionHash,
    confirmedAt: Date.now(),
  };
}

export async function deleteMarketplacePayment(paymentId: string): Promise<void> {
  if (isPostgresConfigured()) {
    await deleteMarketplacePendingPayment(paymentId);
  }
  const redis = getRedis();
  if (!redis) return;
  await redis.del(KEY_PAYMENT(paymentId));
}

export async function markPaymentConfirmed(
  operationId: string,
  receipt: PaymentReceipt
): Promise<void> {
  await updateOperationStatus(operationId, OperationStatus.PAYMENT_CONFIRMED, {
    paymentReference: receipt.transactionHash ?? receipt.receiptId,
  });
}

export async function ensureIdempotentSettlement(
  operationId: string
): Promise<boolean> {
  const op = await getOperation(operationId);
  if (!op) return false;

  return (
    op.status === OperationStatus.SOLD ||
    op.status === OperationStatus.MINTED_ON_TARGET ||
    op.status === OperationStatus.REIMPORTED ||
    op.status === OperationStatus.RENTAL_ACTIVE
  );
}
