import * as React from "react";

import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";

interface ToastState {
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  notify: (message: string, kind?: ToastKind) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toast, setToast] = React.useState<ToastState | null>(null);

  const notify = React.useCallback((message: string, kind: ToastKind = "info") => {
    setToast({ message, kind });
  }, []);

  React.useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timeout);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {toast ? (
        <div className="fixed bottom-4 right-4 z-[60]">
          <div
            className={cn(
              "border-4 border-black px-3 py-2 text-[9px] uppercase tracking-wide shadow-[6px_6px_0_0_#000]",
              toast.kind === "success" && "bg-[#54f28b] text-black",
              toast.kind === "error" && "bg-[#ff4d6d] text-black",
              toast.kind === "info" && "bg-[#9ab9ff] text-black"
            )}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
