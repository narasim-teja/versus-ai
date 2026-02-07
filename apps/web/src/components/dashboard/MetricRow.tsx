import { cn } from "@/lib/utils";

interface MetricRowProps {
  label: string;
  value: string | React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function MetricRow({ label, value, icon, className }: MetricRowProps) {
  return (
    <div
      className={cn("flex items-center justify-between py-1.5", className)}
    >
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
