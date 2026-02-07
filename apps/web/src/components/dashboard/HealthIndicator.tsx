"use client";

import { useHealth } from "@/hooks/useHealth";
import { cn } from "@/lib/utils";

const statusColors = {
  healthy: "bg-emerald-500",
  degraded: "bg-yellow-500",
  unhealthy: "bg-red-500",
} as const;

export function HealthIndicator() {
  const { health, error } = useHealth();

  const status = error ? "unhealthy" : health?.status ?? "unhealthy";
  const label = error ? "Offline" : health ? capitalize(status) : "...";

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex h-2.5 w-2.5">
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
            statusColors[status]
          )}
        />
        <span
          className={cn(
            "relative inline-flex h-2.5 w-2.5 rounded-full",
            statusColors[status]
          )}
        />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
