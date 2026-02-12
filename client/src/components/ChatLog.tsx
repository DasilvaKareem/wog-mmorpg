import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useZoneEvents, type ZoneEvent } from "@/hooks/useZoneEvents";
import { cn } from "@/lib/utils";

interface ChatLogProps {
  zoneId: string | null;
  className?: string;
}

function getEventColor(type: ZoneEvent["type"]): string {
  switch (type) {
    case "combat":
      return "text-[#ff9e64]"; // orange
    case "death":
      return "text-[#ff4d6d] font-bold"; // danger red
    case "kill":
      return "text-[#54f28b] font-bold"; // success green
    case "levelup":
      return "text-[#ffdd57] font-bold"; // yellow highlight
    case "chat":
      return "text-[#7dcfff]"; // cyan blue
    case "loot":
      return "text-[#bb9af7]"; // purple
    case "trade":
    case "shop":
      return "text-[#7aa2f7]"; // blue
    case "quest":
      return "text-[#e0af68]"; // gold
    case "system":
      return "text-[#9aa7cc]"; // gray
    default:
      return "text-[#edf2ff]";
  }
}

export function ChatLog({ zoneId, className }: ChatLogProps): React.ReactElement {
  const { events, loading } = useZoneEvents(zoneId, { limit: 100, pollInterval: 2000 });
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = React.useState(true);

  // Auto-scroll to bottom when new events arrive
  React.useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const handleScroll = React.useCallback(() => {
    if (!scrollRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;

    setAutoScroll(isNearBottom);
  }, []);

  if (!zoneId) {
    return (
      <Card className={cn("pointer-events-auto flex items-center justify-center", className)}>
        <p className="text-[9px] text-[#9aa7cc]">Select a zone to view events</p>
      </Card>
    );
  }

  return (
    <Card className={cn("pointer-events-auto flex flex-col", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          Zone Log
          {loading && <span className="text-[8px] text-[#9aa7cc]">...</span>}
        </CardTitle>
      </CardHeader>
      <CardContent
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-0.5 overflow-y-auto pt-0 text-[8px]"
        style={{ minHeight: 0, maxHeight: "200px" }}
      >
        {events.length === 0 && (
          <p className="text-center text-[8px] text-[#9aa7cc] py-4">
            No events yet...
          </p>
        )}

        {events.map((event) => (
          <div
            key={event.id}
            className={cn(
              "leading-tight px-1 py-0.5 hover:bg-[#1a2338] transition-colors",
              getEventColor(event.type)
            )}
          >
            <span className="text-[#565f89] mr-1">
              [{new Date(event.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
              })}]
            </span>
            {event.message}
          </div>
        ))}
      </CardContent>

      {/* Auto-scroll button */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-2 right-2 border-2 border-black bg-[#ffcc00] px-2 py-0.5 text-[8px] uppercase text-black shadow-[2px_2px_0_0_#000] hover:bg-[#ffdd57] transition-colors"
        >
          ↓ New
        </button>
      )}
    </Card>
  );
}
