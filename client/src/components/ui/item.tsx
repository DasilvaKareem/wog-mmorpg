import type { ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { copperToGold } from "@/lib/currency";

interface ItemProps {
  name: string;
  description: string;
  price: number;
  disabled?: boolean;
  onBuy: () => void;
}

export function Item({ name, description, price, disabled, onBuy }: ItemProps): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 border-b-2 border-[#29334d] py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] text-[#f4f8ff]">{name}</p>
        <p className="text-[8px] text-[#9ca9cc]">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="bg-[#a6b2d4] border-2 border-black px-1.5 py-0.5 shadow-[2px_2px_0_0_#000]">
          <CurrencyDisplay amount={copperToGold(price)} size="sm" />
        </div>
        <Button disabled={disabled} onClick={onBuy} size="sm" type="button">
          Buy
        </Button>
      </div>
    </div>
  );
}
