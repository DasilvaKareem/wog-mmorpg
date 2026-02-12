import * as React from "react";

import { cn } from "@/lib/utils";

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-9 w-full border-4 border-black bg-[#e5ebff] px-2 text-[10px] text-black outline-none shadow-[3px_3px_0_0_#000] focus:bg-white",
        className
      )}
      {...props}
    />
  )
);
Select.displayName = "Select";

export { Select };
