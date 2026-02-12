import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full border-4 border-black bg-[#e5ebff] px-2 py-1 text-[10px] text-black outline-none shadow-[3px_3px_0_0_#000] focus:bg-white",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
