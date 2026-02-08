"use client";

import { useState } from "react";
import { ShieldCheck, ExternalLink, Copy, Check, Layers, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface OnChainProofCardProps {
  merkleRoot: string | null;
  registryTxHash: string | null;
  registryExplorerLink: string | null;
  totalSegments: number | null;
  creatorWallet: string | null;
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export function OnChainProofCard({
  merkleRoot,
  registryTxHash,
  registryExplorerLink,
  totalSegments,
  creatorWallet,
}: OnChainProofCardProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const isVerified = !!registryTxHash;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">On-Chain Proof</CardTitle>
          <Badge
            variant="outline"
            className={
              isVerified
                ? "border-green-500/20 bg-green-500/10 text-green-400"
                : "border-zinc-500/20 text-zinc-400"
            }
          >
            <ShieldCheck className="mr-1 h-3 w-3" />
            {isVerified ? "Verified" : "Pending"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Merkle Root */}
        {merkleRoot && (
          <div className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Merkle Root
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted/30 px-2 py-1.5 font-mono text-[11px] text-emerald-400">
                {truncateHash(merkleRoot)}
              </code>
              <button
                onClick={() => handleCopy(merkleRoot, "merkle")}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
              >
                {copied === "merkle" ? (
                  <Check className="h-3.5 w-3.5 text-green-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Registry Transaction */}
        {registryTxHash && (
          <div className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Registry Transaction
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted/30 px-2 py-1.5 font-mono text-[11px]">
                {truncateHash(registryTxHash)}
              </code>
              {(registryExplorerLink || registryTxHash) && (
                <a
                  href={
                    registryExplorerLink ||
                    `https://sepolia.basescan.org/tx/${registryTxHash}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-blue-400"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground">
              Base Sepolia
            </span>
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-3 border-t border-border/50 pt-3">
          {totalSegments != null && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Layers className="h-3 w-3" />
              {totalSegments} segments in tree
            </div>
          )}
          {creatorWallet && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              {`${creatorWallet.slice(0, 6)}...${creatorWallet.slice(-4)}`}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
