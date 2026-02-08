"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Film, Clock, Layers, Loader2, ShieldCheck, User } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { VideoPlayer } from "@/components/videos/VideoPlayer";
import { SettlementSummary } from "@/components/videos/SettlementSummary";
import { HowItWorksCard } from "@/components/videos/HowItWorksCard";
import { OnChainProofCard } from "@/components/videos/OnChainProofCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Separator } from "@/components/ui/Separator";
import { fetchVideo } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { VideoDetail, SessionCloseResult } from "@/lib/types";
import type { SessionState } from "@/hooks/useVideoSession";

const creatorStyles: Record<string, string> = {
  alice: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  bob: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function getCreatorDisplay(agentId: string | null): { name: string; style: string } {
  if (!agentId) return { name: "Unknown", style: "" };
  const lower = agentId.toLowerCase();
  if (lower.includes("alice")) return { name: "Alice (Academic)", style: creatorStyles.alice };
  if (lower.includes("bob")) return { name: "Bob (Degen)", style: creatorStyles.bob };
  return { name: agentId, style: "" };
}

export default function VideoPage() {
  const params = useParams<{ videoId: string }>();
  const router = useRouter();
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [settlement, setSettlement] = useState<SessionCloseResult | null>(null);

  const handleSessionStateChange = useCallback(
    (state: SessionState, result: SessionCloseResult | null) => {
      setSessionState(state);
      if (result) setSettlement(result);
    },
    []
  );

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const data = await fetchVideo(params.videoId);
        if (mounted) setVideo(data);
      } catch (e) {
        if (mounted)
          setError(e instanceof Error ? e.message : "Failed to load video");
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [params.videoId]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/videos")}
          className="mb-4"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Videos
        </Button>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => router.push("/videos")}
            >
              Go Back
            </Button>
          </div>
        )}

        {video && (() => {
          const creator = getCreatorDisplay(video.agentId);
          return (
            <div className="mx-auto max-w-4xl space-y-6">
              {/* Creator + Title — prominently above player */}
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {video.agentId && (
                    <Badge
                      variant="outline"
                      className={`gap-1 ${creator.style}`}
                    >
                      <User className="h-3 w-3" />
                      {creator.name}
                    </Badge>
                  )}
                  {video.registryTxHash && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-green-500/20 bg-green-500/10 text-green-400"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      On-Chain Verified
                    </Badge>
                  )}
                  {video.quality && (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Film className="h-3 w-3" />
                      {video.quality}
                    </Badge>
                  )}
                  {video.durationSeconds != null && (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Clock className="h-3 w-3" />
                      {formatDuration(video.durationSeconds)}
                    </Badge>
                  )}
                  {video.totalSegments != null && (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Layers className="h-3 w-3" />
                      {video.totalSegments} segments
                    </Badge>
                  )}
                </div>
                <h1 className="text-2xl font-bold tracking-tight">
                  {video.title}
                </h1>
                {video.description && (
                  <p className="mt-1.5 text-muted-foreground">
                    {video.description}
                  </p>
                )}
              </div>

              {/* Player */}
              <VideoPlayer
                video={video}
                onSessionStateChange={handleSessionStateChange}
              />

              {/* Settlement summary (shown below player after session close) */}
              {sessionState === "closed" && settlement && (
                <SettlementSummary result={settlement} />
              )}

              {/* How It Works + On-Chain Proof */}
              <Separator />
              <div className="grid gap-6 md:grid-cols-2">
                <HowItWorksCard />
                <OnChainProofCard
                  merkleRoot={video.merkleRoot}
                  registryTxHash={video.registryTxHash}
                  registryExplorerLink={video.registryExplorerLink}
                  totalSegments={video.totalSegments}
                  creatorWallet={video.creatorWallet}
                />
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}
