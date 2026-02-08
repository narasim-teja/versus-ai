"use client";

import { useEffect, useState } from "react";
import {
  Clock,
  Film,
  Loader2,
  CheckCircle2,
  XCircle,
  Timer,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import type { VideoScheduleStatus } from "@/lib/types";

interface VideoScheduleCardProps {
  schedule: VideoScheduleStatus;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00:00";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const statusProgress: Record<string, number> = {
  pending: 0,
  ideating: 15,
  generating_video: 40,
  generating_thumbnail: 70,
  processing: 85,
  uploading: 95,
  completed: 100,
  failed: 0,
};

const statusLabels: Record<string, string> = {
  ideating: "Generating idea...",
  generating_video: "Creating video (LTX-2)...",
  generating_thumbnail: "Creating thumbnail...",
  processing: "Processing & encrypting...",
  uploading: "Uploading to storage...",
  completed: "Complete",
  failed: "Failed",
};

export function VideoScheduleCard({ schedule }: VideoScheduleCardProps) {
  const [countdown, setCountdown] = useState(schedule.msUntilNext);

  useEffect(() => {
    setCountdown(schedule.msUntilNext);
    const interval = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [schedule.msUntilNext]);

  if (!schedule.isEnabled) {
    return (
      <Card className="border-dashed opacity-60">
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Film className="h-4 w-4" />
          Video generation not configured
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Timer className="h-4 w-4" />
          Video Generation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Countdown */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Next video in</span>
          <span className="font-mono text-lg font-semibold tabular-nums">
            {schedule.isGenerating
              ? "Generating..."
              : formatCountdown(countdown)}
          </span>
        </div>

        {/* Generation in progress */}
        {schedule.isGenerating && schedule.currentGenerationStatus && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span>
                {statusLabels[schedule.currentGenerationStatus] ||
                  "Working..."}
              </span>
            </div>
            <Progress
              value={statusProgress[schedule.currentGenerationStatus] || 0}
              className="h-1.5"
            />
          </div>
        )}

        {/* Last generation result */}
        {schedule.lastGenerationStatus && !schedule.isGenerating && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {schedule.lastGenerationStatus === "completed" ? (
              <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="h-3 w-3 shrink-0 text-red-400" />
            )}
            <span className="truncate">
              {schedule.lastGenerationTitle || "Last generation"} &mdash;{" "}
              {schedule.lastGenerationStatus}
            </span>
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Videos generated
          </span>
          <span>{schedule.generationCount}</span>
        </div>
      </CardContent>
    </Card>
  );
}
