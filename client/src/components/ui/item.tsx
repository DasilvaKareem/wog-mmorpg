import type { ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
        <Badge variant="secondary">{price}g</Badge>
        <Button disabled={disabled} onClick={onBuy} size="sm" type="button">
          Buy
        </Button>
      </div>
    </div>
  );
}
