"use client";

import Link from "next/link";
import { Play, Clock, Film, User } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Video } from "@/lib/types";

interface VideoCardProps {
  video: Video;
}

const statusStyles: Record<string, string> = {
  ready: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  processing: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  pending: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  error: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function VideoCard({ video }: VideoCardProps) {
  const isReady = video.status === "ready";

  const content = (
    <Card
      className={cn(
        "group transition-colors",
        isReady
          ? "cursor-pointer hover:border-primary/50"
          : "cursor-not-allowed opacity-60"
      )}
    >
      {/* Thumbnail placeholder */}
      <div className="relative flex h-40 items-center justify-center rounded-t-xl bg-muted">
        <Film className="h-10 w-10 text-muted-foreground/50" />
        {isReady && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-xl bg-black/0 transition-colors group-hover:bg-black/30">
            <Play className="h-8 w-8 text-white opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        )}
        {video.durationSeconds != null && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(video.durationSeconds)}
          </span>
        )}
      </div>

      <CardHeader className="pb-2 pt-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="line-clamp-1 text-sm">
            {video.title}
          </CardTitle>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 text-[10px]",
              statusStyles[video.status] ?? ""
            )}
          >
            {video.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pb-4 pt-0">
        {video.description && (
          <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">
            {video.description}
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {video.quality && (
            <span className="flex items-center gap-1">
              <Film className="h-3 w-3" />
              {video.quality}
            </span>
          )}
          {video.totalSegments != null && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {video.totalSegments} segments
            </span>
          )}
          {video.agentId && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {video.agentId}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (!isReady) return content;

  return <Link href={`/videos/${video.id}`}>{content}</Link>;
}
