"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Separator } from "@/components/ui/Separator";
import { ActionBadge } from "./ActionBadge";
import { ConfidenceBar } from "./ConfidenceBar";
import { ThinkingProcess } from "./ThinkingProcess";
import { formatTimeAgo } from "@/lib/format";
import type { DecisionLog } from "@/lib/types";
import { cn } from "@/lib/utils";

interface DecisionEntryProps {
  decision: DecisionLog;
}

// Map action types to left border colors
const actionBorderColors: Record<string, string> = {
  BUY_TOKEN: "border-l-emerald-500",
  SELL_TOKEN: "border-l-red-500",
  BORROW: "border-l-purple-500",
  REPAY: "border-l-blue-500",
  CLAIM_REVENUE: "border-l-yellow-500",
  DEPOSIT_COLLATERAL: "border-l-indigo-500",
  WITHDRAW_COLLATERAL: "border-l-pink-500",
};

export function DecisionEntry({ decision }: DecisionEntryProps) {
  const [expanded, setExpanded] = useState(false);

  const hasActions = decision.actions.length > 0;
  const hasThinking = decision.thinking.length > 0;
  const primaryAction = decision.actions[0]?.type;
  const borderClass = primaryAction
    ? actionBorderColors[primaryAction] ?? "border-l-border"
    : "border-l-border/30";

  return (
    <div
      className={cn(
        "rounded-md border border-l-2 px-2.5 py-1.5 transition-colors",
        borderClass,
        expanded ? "bg-muted/20" : "hover:bg-muted/10"
      )}
    >
      {/* Compact header */}
      <button
        className="flex w-full items-center gap-2"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        )}

        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
          #{decision.cycle}
        </Badge>

        <span className="text-[10px] text-muted-foreground">
          {formatTimeAgo(decision.timestamp)}
        </span>

        <div className="flex flex-1 flex-wrap justify-end gap-1">
          {decision.actions.length === 0 ? (
            <span className="text-[10px] text-muted-foreground/60">No action</span>
          ) : (
            decision.actions.map((action, i) => (
              <ActionBadge key={i} type={action.type} />
            ))
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-2 space-y-2">
          {hasActions && (
            <>
              <Separator />
              <div className="space-y-1.5">
                {decision.actions.map((action, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-2 rounded border bg-muted/10 px-2 py-1.5"
                  >
                    <div className="flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <ActionBadge type={action.type} />
                        <span className="text-[10px] text-muted-foreground">
                          P{action.priority}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {action.reason}
                      </p>
                    </div>
                    <ConfidenceBar value={action.confidence} />
                  </div>
                ))}
              </div>
            </>
          )}

          {hasThinking && (
            <>
              <Separator />
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground">
                  Thinking
                </span>
                <ThinkingProcess thinking={decision.thinking} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
