// TODO: Install stripe with: pnpm add stripe
// import Stripe from 'stripe';
import { getGoldBalance } from "./blockchain.js";

export interface PaymentMethod {
  method: "free" | "stripe" | "crypto";
  token?: string; // Stripe token or crypto tx hash
  amount?: number; // USD amount (for stripe)
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  receiptUrl?: string;
  error?: string;
}

export interface PricingTier {
  cost: number; // USD
  goldBonus: number;
  rateLimit: string;
  bonus?: string;
}

export const PRICING_TIERS: Record<string, PricingTier> = {
  free: { cost: 0, goldBonus: 50, rateLimit: "1/hour" },
  basic: { cost: 5, goldBonus: 500, rateLimit: "unlimited" },
  premium: { cost: 20, goldBonus: 2500, rateLimit: "unlimited", bonus: "legendary_item" },
};

/**
 * Process payment for agent deployment
 */
export async function processPayment(payment: PaymentMethod): Promise<PaymentResult> {
  if (payment.method === "free") {
    return { success: true, transactionId: "free-tier" };
  }

  if (payment.method === "stripe") {
    return processStripePayment(payment.token!, payment.amount!);
  }

  if (payment.method === "crypto") {
    return processCryptoPayment(payment.token!);
  }

  return { success: false, error: "Invalid payment method" };
}

/**
 * Process Stripe payment (USD)
 * TODO: Implement when Stripe is added to package.json
 */
async function processStripePayment(token: string, amount: number): Promise<PaymentResult> {
  try {
    // TODO: Uncomment when stripe is installed
    /*
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16',
    });

    const charge = await stripe.charges.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      source: token,
      description: 'WoG Agent Deployment (X402)',
    });

    return {
      success: charge.status === 'succeeded',
      transactionId: charge.id,
      receiptUrl: charge.receipt_url || undefined,
    };
    */

    // Temporary mock implementation
    console.log(`[x402] Mock Stripe payment: $${amount} (token: ${token.substring(0, 10)}...)`);
    return {
      success: true,
      transactionId: `mock_stripe_${Date.now()}`,
      receiptUrl: "https://stripe.com/mock-receipt",
    };
  } catch (err) {
    console.error("[x402] Stripe payment failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Payment failed",
    };
  }
}

/**
 * Verify crypto payment (GOLD token transfer)
 * User must send GOLD tokens to server wallet before calling this
 */
async function processCryptoPayment(txHash: string): Promise<PaymentResult> {
  try {
    // TODO: Verify the transaction on-chain
    // 1. Fetch transaction by hash
    // 2. Verify it's a GOLD transfer to server wallet
    // 3. Verify amount matches required payment

    // Temporary mock implementation
    console.log(`[x402] Mock crypto payment verification: ${txHash.substring(0, 10)}...`);
    return {
      success: true,
      transactionId: txHash,
    };
  } catch (err) {
    console.error("[x402] Crypto payment verification failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Payment verification failed",
    };
  }
}

/**
 * Get pricing tier based on payment method
 */
export function getPricingTier(method: string): PricingTier {
  return PRICING_TIERS[method] || PRICING_TIERS.free;
}
