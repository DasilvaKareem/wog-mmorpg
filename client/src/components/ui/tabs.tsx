import * as React from "react";

import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) {
    throw new Error("Tabs components must be used within Tabs");
  }
  return ctx;
}

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}

function Tabs({ value, onValueChange, className, children }: TabsProps): React.ReactElement {
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange }}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 border-2 border-black bg-[#121b30] p-1 shadow-[3px_3px_0_0_#000]",
        className
      )}
      {...props}
    />
  );
}

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

function TabsTrigger({ value, className, ...props }: TabsTriggerProps): React.ReactElement {
  const { value: activeValue, setValue } = useTabsContext();
  const active = activeValue === value;

  return (
    <button
      className={cn(
        "border-2 border-black px-2 py-1 text-[8px] uppercase tracking-wide transition",
        active
          ? "bg-[#ffcc00] text-black shadow-[2px_2px_0_0_#000]"
          : "bg-[#2b3656] text-[#d6deff] hover:bg-[#33426b]",
        className
      )}
      onClick={() => setValue(value)}
      type="button"
      {...props}
    />
  );
}

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

function TabsContent({ value, className, ...props }: TabsContentProps): React.ReactElement | null {
  const { value: activeValue } = useTabsContext();
  if (value !== activeValue) return null;
  return <div className={cn("mt-3", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
