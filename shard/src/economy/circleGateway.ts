// Circle Gateway sell-side API client
// Reference: https://developers.circle.com/gateway/nanopayments

const CIRCLE_API_BASE = process.env.CIRCLE_API_BASE ?? "https://api.circle.com";
const CIRCLE_API_KEY  = process.env.CIRCLE_API_KEY  ?? "";

export const CIRCLE_SELLER_ADDRESS          = process.env.CIRCLE_SELLER_ADDRESS          ?? "";
export const CIRCLE_GATEWAY_WALLET_CONTRACT = process.env.CIRCLE_GATEWAY_WALLET_CONTRACT ?? "";

const USDC_DECIMALS = 6;
export const DEFAULT_SESSION_BUDGET_USDC = 0.10;

export function usdcToMicro(amount: number): string {
  return Math.round(amount * 10 ** USDC_DECIMALS).toString();
}

// Verify an EIP-3009 authorization from the buyer before storing it.
// In dev (no CIRCLE_GATEWAY_WALLET_CONTRACT), skips on-chain verification.
export async function verifyEIP3009Auth(
  signedAuth: string,
  expectedAmountUsdc: number,
  buyerAddress: string,
): Promise<boolean> {
  if (!signedAuth || !buyerAddress) return false;
  if (!CIRCLE_GATEWAY_WALLET_CONTRACT) return true; // dev: skip

  // TODO: verify EIP-3009 sig using viem/ethers:
  //   from=buyerAddress, to=CIRCLE_SELLER_ADDRESS, value=usdcToMicro(expectedAmountUsdc)
  //   validAfter/validBefore timestamps within window
  return true;
}

export async function submitAuthorizationsForSettlement(
  auths: Array<{ wallet: string; auth: string; budgetUsdc: number }>,
): Promise<string | null> {
  if (!CIRCLE_API_KEY) {
    console.warn("[circleGateway] CIRCLE_API_KEY not set — skipping settlement");
    return null;
  }
  if (!auths.length) return null;

  let res: Response;
  try {
    res = await fetch(`${CIRCLE_API_BASE}/v1/gateway/nanopayments/settle`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CIRCLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authorizations: auths.map((a) => ({
          signedAuthorization: a.auth,
          amount: usdcToMicro(a.budgetUsdc),
        })),
      }),
    });
  } catch (err: any) {
    console.error("[circleGateway] Settlement fetch failed:", err.message);
    return null;
  }

  if (!res.ok) {
    console.error("[circleGateway] Settlement failed:", await res.text());
    return null;
  }

  const data: any = await res.json();
  return (data.settlementId ?? null) as string | null;
}

export async function getSellerBalance(): Promise<number> {
  if (!CIRCLE_API_KEY) return 0;
  try {
    const res = await fetch(`${CIRCLE_API_BASE}/v1/gateway/balance`, {
      headers: { Authorization: `Bearer ${CIRCLE_API_KEY}` },
    });
    if (!res.ok) return 0;
    const data: any = await res.json();
    const micro = parseInt(data.balance?.usdc ?? "0", 10);
    return micro / 10 ** USDC_DECIMALS;
  } catch {
    return 0;
  }
}
