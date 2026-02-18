/**
 * PaymentGate — wraps thirdweb PayEmbed for a direct $10 USD payment
 * to the WoG server wallet. Accepts any crypto on any supported chain.
 */

import * as React from "react";
import { PayEmbed, darkTheme } from "thirdweb/react";
import { defineChain } from "thirdweb";
import { thirdwebClient } from "@/lib/inAppWalletClient";

// Server wallet that receives all fees
const SERVER_WALLET = "0x8cFd0a555dD865B2b63a391AF2B14517C0389808";

// Base mainnet (chain 8453) — broadest crypto support for checkout
// PayEmbed handles cross-chain bridging automatically
const baseMainnet = defineChain(8453);

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
  /** Called when payment is confirmed */
  onSuccess: () => void;
  /** Called when user cancels */
  onCancel: () => void;
}

export function PaymentGate({ label, onSuccess, onCancel }: PaymentGateProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[7px] text-[#565f89]">
        <p className="text-[#ffcc00] mb-1 text-[9px] font-bold">[⟡] PAYMENT REQUIRED</p>
        <p className="text-[#9aa7cc]">{label}</p>
        <p className="mt-1">$10.00 USD — pay with any crypto, any chain.</p>
      </div>

      <div className="flex justify-center">
        <PayEmbed
          client={thirdwebClient}
          theme={wogTheme}
          payOptions={{
            mode: "direct_payment",
            paymentInfo: {
              sellerAddress: SERVER_WALLET,
              chain: baseMainnet,
              amount: "10",
              // No tokenAddress = native ETH; thirdweb converts any crypto the user holds
            },
            metadata: {
              name: label,
              image: "https://worldofgeneva.xyz/favicon.ico",
            },
            onPurchaseSuccess: () => {
              onSuccess();
            },
          }}
        />
      </div>

      <button
        onClick={onCancel}
        className="text-[8px] text-[#3a4260] hover:text-[#9aa7cc] transition-colors text-center"
      >
        ← Cancel
      </button>
    </div>
  );
}
