import * as React from "react";

import { cn } from "@/lib/utils";

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext(): DialogContextValue {
  const ctx = React.useContext(DialogContext);
  if (!ctx) {
    throw new Error("Dialog components must be used within Dialog");
  }
  return ctx;
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function Dialog({ open, onOpenChange, children }: DialogProps): React.ReactElement {
  return (
    <DialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

function DialogContent({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  const { open, onOpenChange } = useDialogContext();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close dialog"
        className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.8)_0px,rgba(0,0,0,0.8)_2px,rgba(0,0,0,0.74)_2px,rgba(0,0,0,0.74)_4px)]"
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-2xl border-4 border-black bg-[linear-gradient(180deg,#18213a,#0a1021)] p-4 text-[#edf2ff] shadow-[8px_8px_0_0_#000]",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn("mb-3 border-b-2 border-[#2d3651] pb-2", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return (
    <h2
      className={cn("text-xs uppercase tracking-wide text-[#ffdd57] [text-shadow:2px_2px_0_#000]", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  return <p className={cn("mt-1 text-[9px] text-[#9aa7cc]", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn("mt-4 flex justify-end gap-2", className)} {...props} />;
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
