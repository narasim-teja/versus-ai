"use client";

import {
  ShieldCheck,
  Wallet,
  Landmark,
  TrendingUp,
  ArrowRightLeft,
  BarChart3,
} from "lucide-react";
import type { ThinkingStep, ThinkingCategory } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";

const CATEGORY_CONFIG: Record<
  ThinkingCategory,
  { icon: React.ElementType; label: string; color: string }
> = {
  health: {
    icon: ShieldCheck,
    label: "Health",
    color: "text-emerald-400",
  },
  treasury: {
    icon: Wallet,
    label: "Treasury",
    color: "text-blue-400",
  },
  lending: {
    icon: Landmark,
    label: "Lending",
    color: "text-purple-400",
  },
  revenue: {
    icon: TrendingUp,
    label: "Revenue",
    color: "text-yellow-400",
  },
  trading: {
    icon: ArrowRightLeft,
    label: "Trading",
    color: "text-orange-400",
  },
  market: {
    icon: BarChart3,
    label: "Market",
    color: "text-cyan-400",
  },
};

interface ThinkingProcessProps {
  thinking: ThinkingStep[];
}

export function ThinkingProcess({ thinking }: ThinkingProcessProps) {
  if (!thinking || thinking.length === 0) return null;

  // Group by category
  const grouped = thinking.reduce(
    (acc, step) => {
      const cat = step.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(step);
      return acc;
    },
    {} as Record<string, ThinkingStep[]>
  );

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([category, steps]) => {
        const cfg = CATEGORY_CONFIG[category as ThinkingCategory];
        if (!cfg) return null;
        const Icon = cfg.icon;

        return (
          <div key={category} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
              <span className={`text-xs font-medium ${cfg.color}`}>
                {cfg.label}
              </span>
            </div>
            {steps.map((step, i) => (
              <div
                key={i}
                className="ml-5 rounded-md border bg-muted/30 px-3 py-2"
              >
                <p className="text-xs text-muted-foreground">
                  {step.observation}
                </p>
                <p className="mt-1 text-xs font-medium">{step.conclusion}</p>
                {step.metrics && Object.keys(step.metrics).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {Object.entries(step.metrics).map(([key, val]) => (
                      <Badge
                        key={key}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {key}: {val}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
