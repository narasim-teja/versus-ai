"use client";

import { Lock, GitBranch, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

const steps = [
  {
    icon: Lock,
    title: "Encrypted",
    description:
      "Video is split into segments, each encrypted with a unique AES-128 key derived via HKDF.",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
  },
  {
    icon: GitBranch,
    title: "Verified On-Chain",
    description:
      "Segment keys are hashed into a Merkle tree. The root is committed to the VideoRegistry on Base Sepolia.",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
  },
  {
    icon: Zap,
    title: "Pay-per-Segment",
    description:
      "Decryption keys are released only after micropayment via Yellow Network state channels.",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/20",
  },
];

export function HowItWorksCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">How Streaming Works</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative space-y-4">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className="flex gap-3">
                {/* Step indicator */}
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${step.bgColor} ${step.borderColor}`}
                  >
                    <Icon className={`h-4 w-4 ${step.color}`} />
                  </div>
                  {i < steps.length - 1 && (
                    <div className="mt-1 h-full w-px bg-border/50" />
                  )}
                </div>
                {/* Content */}
                <div className="pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-muted-foreground">
                      STEP {i + 1}
                    </span>
                    <span className={`text-sm font-semibold ${step.color}`}>
                      {step.title}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
