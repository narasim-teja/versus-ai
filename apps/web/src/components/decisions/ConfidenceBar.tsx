import { cn } from "@/lib/utils";

interface ConfidenceBarProps {
  value: number;
}

export function ConfidenceBar({ value }: ConfidenceBarProps) {
  const width = `${Math.round(value * 100)}%`;
  const color =
    value > 0.7
      ? "bg-emerald-500"
      : value > 0.4
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}
