/**
 * PaymentGate — wraps thirdweb PayEmbed for crypto payments
 * to the WoG server wallet. Accepts any crypto on any supported chain.
 */

import * as React from "react";
import { PayEmbed, darkTheme } from "thirdweb/react";
import { defineChain, getContract } from "thirdweb";
import { thirdwebClient } from "@/lib/inAppWalletClient";

// Server wallet that receives all fees
const SERVER_WALLET = "0x8cFd0a555dD865B2b63a391AF2B14517C0389808";

const wogTheme = darkTheme({
  colors: {
    modalBg: "#060d12",
    primaryText: "#d6deff",
    secondaryText: "#9aa7cc",
    accentText: "#54f28b",
    borderColor: "#2a3450",
    separatorLine: "#1a2a30",
  },
});

interface PaymentGateProps {
  /** What the fee is for, shown in the UI */
  label: string;
  /** Amount in USD */
  amount: string;
  /** Called when payment is confirmed */
  onSuccess: (transactionHash?: string) => void;
  /** Called when user cancels */
  onCancel: () => void;
  /** Wallet that receives the payment */
  sellerAddress?: string;
  /** Payment chain id */
  chainId?: number;
  /** Token contract on the payment chain */
  tokenAddress?: string;
}

export function PaymentGate({
  label,
  amount,
  onSuccess,
  onCancel,
  sellerAddress = SERVER_WALLET,
  chainId = 8453,
  tokenAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
}: PaymentGateProps): React.ReactElement {
  const paymentChain = React.useMemo(() => defineChain(chainId), [chainId]);
  const paymentToken = React.useMemo(
    () =>
      getContract({
        client: thirdwebClient,
        chain: paymentChain,
        address: tokenAddress,
      }),
    [paymentChain, tokenAddress]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[10px] text-[#8b95c2]">
        <p className="text-[#ffcc00] mb-1 text-[12px] font-bold">[⟡] PAYMENT REQUIRED</p>
        <p className="text-[#9aa7cc]">{label}</p>
        <p className="mt-1">${amount} USD — pay with any crypto, any chain.</p>
      </div>

      <div className="flex justify-center">
        <PayEmbed
          client={thirdwebClient}
          theme={wogTheme}
          payOptions={{
            mode: "direct_payment",
            paymentInfo: {
              sellerAddress: sellerAddress as `0x${string}`,
              amount,
              token: paymentToken,
            },
            metadata: {
              name: label,
              image: "https://worldofgeneva.com/favicon.ico",
            },
            onPurchaseSuccess: (info) => {
              onSuccess(info?.type === "transaction" ? info.transactionHash : undefined);
            },
          }}
        />
      </div>

      <button
        onClick={onCancel}
        className="text-[11px] text-[#6d77a3] hover:text-[#9aa7cc] transition-colors text-center"
      >
        ← Cancel
      </button>
    </div>
  );
}
