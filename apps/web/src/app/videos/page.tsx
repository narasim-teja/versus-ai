"use client";

import { Header } from "@/components/layout/Header";
import { useVideos } from "@/hooks/useVideos";
import { VideoCard } from "@/components/videos/VideoCard";
import { VideoCardSkeleton } from "@/components/videos/VideoCardSkeleton";
import { Button } from "@/components/ui/Button";
import { AlertCircle, Film } from "lucide-react";

export default function VideosPage() {
  const { videos, isLoading, error, refetch } = useVideos();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Videos</h1>
          <p className="mt-1 text-muted-foreground">
            Browse and watch encrypted video streams with pay-per-segment
            micropayments
          </p>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm text-destructive">{error}</span>
            <Button variant="outline" size="sm" onClick={refetch}>
              Retry
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <VideoCardSkeleton key={i} />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Film className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold">No videos yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a video via the API to get started
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
