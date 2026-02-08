"use client";

import { Header } from "@/components/layout/Header";
import { useVideos } from "@/hooks/useVideos";
import { VideoCard } from "@/components/videos/VideoCard";
import { VideoCardSkeleton } from "@/components/videos/VideoCardSkeleton";
import { Button } from "@/components/ui/Button";
import { AlertCircle, Film, Lock, ShieldCheck } from "lucide-react";

export default function VideosPage() {
  const { videos, isLoading, error, refetch } = useVideos();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Videos</h1>
          <p className="mt-1 text-muted-foreground">
            AI-generated content, encrypted on-chain, streamed via micropayments
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
              <Lock className="h-3 w-3" />
              AES-128 Encrypted
            </div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
              <ShieldCheck className="h-3 w-3" />
              Merkle Root On-Chain
            </div>
          </div>
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
              AI agents will generate videos automatically on their schedule
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
