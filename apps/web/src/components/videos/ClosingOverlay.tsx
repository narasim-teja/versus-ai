"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, Circle } from "lucide-react";

interface ClosingStep {
  id: string;
  label: string;
  estimatedMs: number;
  requiresCustody?: boolean;
}

const ALL_STEPS: ClosingStep[] = [
  { id: "clearnode", label: "Closing ClearNode Session", estimatedMs: 2000 },
  { id: "custody", label: "Closing Custody Channel", estimatedMs: 5000, requiresCustody: true },
  { id: "settlement", label: "Recording Settlement on Base Sepolia", estimatedMs: 5000 },
  { id: "bridge", label: "Bridging USDC to ARC Network", estimatedMs: 5000 },
  { id: "distribution", label: "Distributing Revenue", estimatedMs: 5000 },
];

interface ClosingOverlayProps {
  hasCustodyChannel: boolean;
  /** When true, the real close has finished — skip to end */
  isComplete?: boolean;
}

export function ClosingOverlay({ hasCustodyChannel, isComplete }: ClosingOverlayProps) {
  const steps = ALL_STEPS.filter((s) => !s.requiresCustody || hasCustodyChannel);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (isComplete) {
      setActiveIndex(steps.length);
      return;
    }

    if (activeIndex >= steps.length) return;

    const timer = setTimeout(() => {
      setActiveIndex((i) => Math.min(i + 1, steps.length));
    }, steps[activeIndex].estimatedMs);

    return () => clearTimeout(timer);
  }, [activeIndex, steps, isComplete]);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6">
      <div className="w-full max-w-sm space-y-3">
        <p className="mb-4 text-center text-sm font-semibold text-white">
          Settling Session...
        </p>

        {steps.map((step, i) => {
          const isActive = i === activeIndex && !isComplete;
          const isDone = i < activeIndex || isComplete;

          return (
            <div key={step.id} className="flex items-center gap-3">
              {isDone ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-yellow-400" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-zinc-600" />
              )}
              <span
                className={
                  isDone
                    ? "text-xs text-green-400"
                    : isActive
                      ? "text-xs text-yellow-400"
                      : "text-xs text-zinc-500"
                }
              >
                {step.label}
              </span>
            </div>
          );
        })}

        {activeIndex >= steps.length && !isComplete && (
          <p className="mt-3 text-center text-[11px] text-zinc-400">
            Finalizing...
          </p>
        )}
      </div>
    </div>
  );
}
