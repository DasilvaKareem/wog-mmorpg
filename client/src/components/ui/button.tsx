import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 border-4 border-black px-3 py-2 text-[10px] uppercase tracking-wide text-black shadow-[4px_4px_0_0_#000] transition disabled:pointer-events-none disabled:opacity-60 disabled:shadow-none",
  {
    variants: {
      variant: {
        default: "bg-[#ffcc00] hover:bg-[#ffd84d]",
        secondary: "bg-[#9ab9ff] hover:bg-[#b4cbff]",
        ghost: "border-2 border-[#6b7394] bg-[#1b2236] text-[#e8eeff] shadow-none hover:bg-[#252d45]",
        danger: "bg-[#ff4d6d] hover:bg-[#ff7390]",
      },
      size: {
        default: "min-h-9",
        sm: "min-h-8 px-2 py-1 text-[9px]",
        lg: "min-h-10 px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(
        buttonVariants({ variant, size, className }),
        "active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
      )}
      ref={ref}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
