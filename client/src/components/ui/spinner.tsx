import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

interface SpinnerProps {
  className?: string;
}

export function Spinner({ className }: SpinnerProps): ReactElement {
  return (
    <span
      className={cn(
        "inline-block h-3 w-3 animate-spin border-2 border-black border-t-transparent bg-[#ffcc00]",
        className
      )}
    />
  );
}
