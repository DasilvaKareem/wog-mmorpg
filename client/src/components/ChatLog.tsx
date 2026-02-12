import * as React from "react";
import { useZoneEvents, type ZoneEvent } from "@/hooks/useZoneEvents";
import { cn } from "@/lib/utils";

interface ChatLogProps {
  zoneId: string | null;
  className?: string;
}

function getEventColor(type: ZoneEvent["type"]): string {
  switch (type) {
    case "combat":
      return "text-orange-400";
    case "death":
      return "text-red-500 font-bold";
    case "kill":
      return "text-green-400 font-bold";
    case "levelup":
      return "text-yellow-300 font-bold animate-pulse";
    case "chat":
      return "text-cyan-300";
    case "loot":
      return "text-purple-400";
    case "trade":
    case "shop":
      return "text-blue-300";
    case "quest":
      return "text-yellow-400";
    case "system":
      return "text-gray-400";
    default:
      return "text-white";
  }
}

export function ChatLog({ zoneId, className }: ChatLogProps): React.ReactElement {
  const { events, loading, error } = useZoneEvents(zoneId, { limit: 100, pollInterval: 2000 });
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
      <div
        className={cn(
          "flex items-center justify-center bg-black/90 border-2 border-green-500 p-4",
          className
        )}
      >
        <p className="text-green-400 font-mono text-sm">Select a zone to view events</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col bg-black/90 border-2 border-green-500 shadow-lg",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between bg-green-500/20 border-b-2 border-green-500 px-3 py-2">
        <h3 className="text-green-400 font-mono text-sm font-bold uppercase tracking-wider">
          ▶ Zone Log
        </h3>
        {loading && (
          <span className="text-green-400 font-mono text-xs animate-pulse">...</span>
        )}
      </div>

      {/* Events */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-green-500 scrollbar-track-black"
        style={{ minHeight: 0 }}
      >
        {error && (
          <div className="text-red-400 font-mono text-xs p-2 border border-red-500 bg-red-500/10">
            Error: {error.message}
          </div>
        )}

        {events.length === 0 && !loading && !error && (
          <div className="text-gray-500 font-mono text-xs text-center py-4">
            No events yet... waiting for action
          </div>
        )}

        {events.map((event) => (
          <div
            key={event.id}
            className={cn(
              "font-mono text-xs leading-relaxed px-2 py-1 hover:bg-green-500/10 transition-colors rounded",
              getEventColor(event.type)
            )}
          >
            <span className="text-gray-500 mr-2">
              [{new Date(event.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
              })}]
            </span>
            {event.message}
          </div>
        ))}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-4 right-4 bg-green-500 text-black font-mono text-xs px-3 py-1 rounded border-2 border-green-400 hover:bg-green-400 transition-colors shadow-lg"
        >
          ↓ New Events
        </button>
      )}
    </div>
  );
}
