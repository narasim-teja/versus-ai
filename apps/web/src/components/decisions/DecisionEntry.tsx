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

export function DecisionEntry({ decision }: DecisionEntryProps) {
  const [expanded, setExpanded] = useState(false);

  const hasActions = decision.actions.length > 0;
  const hasThinking = decision.thinking.length > 0;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 transition-colors",
        expanded ? "bg-muted/20" : "hover:bg-muted/10"
      )}
    >
      {/* Collapsed Header */}
      <button
        className="flex w-full items-center gap-2"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}

        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          #{decision.cycle}
        </Badge>

        <span className="text-[11px] text-muted-foreground">
          {formatTimeAgo(decision.timestamp)}
        </span>

        <div className="flex flex-1 flex-wrap justify-end gap-1">
          {decision.actions.length === 0 ? (
            <span className="text-[10px] text-muted-foreground">No action</span>
          ) : (
            decision.actions.map((action, i) => (
              <ActionBadge key={i} type={action.type} />
            ))
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Actions Detail */}
          {hasActions && (
            <>
              <Separator />
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Actions
                </span>
                {decision.actions.map((action, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <ActionBadge type={action.type} />
                        <span className="text-[10px] text-muted-foreground">
                          P{action.priority}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {action.reason}
                      </p>
                    </div>
                    <ConfidenceBar value={action.confidence} />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Thinking Process */}
          {hasThinking && (
            <>
              <Separator />
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Thinking Process
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
