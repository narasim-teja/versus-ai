import { cn } from "@/lib/utils";
import type { ConnectionStatus as ConnectionStatusType } from "@/hooks/useAgentWebSocket";

const statusConfig = {
  connecting: { color: "bg-yellow-500", label: "Connecting..." },
  connected: { color: "bg-emerald-500", label: "Live" },
  disconnected: { color: "bg-gray-500", label: "Disconnected" },
  error: { color: "bg-red-500", label: "Error" },
} as const;

interface ConnectionStatusProps {
  status: ConnectionStatusType;
}

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const { color, label } = statusConfig[status];

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex h-2 w-2">
        {status === "connected" && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              color
            )}
          />
        )}
        <span
          className={cn("relative inline-flex h-2 w-2 rounded-full", color)}
        />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
