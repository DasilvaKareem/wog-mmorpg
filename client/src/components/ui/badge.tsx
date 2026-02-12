import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center border-2 border-black px-1.5 py-0.5 text-[8px] uppercase tracking-wide shadow-[2px_2px_0_0_#000]",
  {
    variants: {
      variant: {
        default: "bg-[#ffcc00] text-black",
        secondary: "bg-[#a6b2d4] text-black",
        success: "bg-[#54f28b] text-black",
        danger: "bg-[#ff4d6d] text-black",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): React.ReactElement {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
