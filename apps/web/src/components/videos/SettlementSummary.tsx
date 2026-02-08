"use client";

import { DollarSign, Film, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { SessionCloseResult } from "@/lib/types";

interface SettlementSummaryProps {
  result: SessionCloseResult;
}

function TxCard({
  label,
  chain,
  txHash,
  explorerLink,
  description,
}: {
  label: string;
  chain: string;
  txHash: string | null;
  explorerLink: string | null;
  description: string;
}) {
  if (!txHash) return null;

  const truncatedHash = `${txHash.slice(0, 6)}...${txHash.slice(-4)}`;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-yellow-400">{label}</span>
        <span className="text-[10px] rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-400">
          {chain}
        </span>
      </div>
      <p className="text-[11px] text-zinc-400 mb-2">{description}</p>
      {explorerLink ? (
        <a
          href={explorerLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-mono"
        >
          {truncatedHash}
          <ExternalLink className="w-3 h-3" />
        </a>
      ) : (
        <span className="text-xs font-mono text-zinc-500">{truncatedHash}</span>
      )}
    </div>
  );
}

export function SettlementSummary({ result }: SettlementSummaryProps) {
  const hasTxHashes =
    result.custodyDepositTxHash ||
    result.channelCloseTxHash ||
    result.settlementTxHash ||
    result.bridgeTxHash ||
    result.distributionTxHash;

  if (!hasTxHashes) return null;

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm font-semibold text-green-400">
            Cross-Chain Settlement Complete
          </span>
        </div>
      </div>

      {/* Cost summary */}
      <div className="flex flex-wrap gap-2">
        {result.totalPaid && (
          <Badge
            variant="outline"
            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          >
            <DollarSign className="mr-1 h-3 w-3" />
            Total Paid: ${result.totalPaid}
          </Badge>
        )}
        {result.segmentsDelivered > 0 && (
          <Badge
            variant="outline"
            className="border-zinc-500/30 text-zinc-400"
          >
            <Film className="mr-1 h-3 w-3" />
            {result.segmentsDelivered} segments delivered
          </Badge>
        )}
      </div>

      {/* Transaction cards - 2 column grid on md+ */}
      <div className="grid gap-2 md:grid-cols-2">
        <TxCard
          label="Custody Deposit"
          chain="Base Sepolia"
          txHash={result.custodyDepositTxHash}
          explorerLink={result.explorerLinks?.custodyDeposit ?? null}
          description="USDC deposited into Nitrolite Custody contract"
        />
        <TxCard
          label="Channel Closed"
          chain="Base Sepolia"
          txHash={result.channelCloseTxHash}
          explorerLink={result.explorerLinks?.channelClose ?? null}
          description="State channel finalized on-chain"
        />
        <TxCard
          label="Settlement Recorded"
          chain="Base Sepolia"
          txHash={result.settlementTxHash}
          explorerLink={result.explorerLinks?.settlement ?? null}
          description="Payment settlement verified on-chain"
        />
        <TxCard
          label="Bridge Initiated"
          chain="Base Sepolia"
          txHash={result.bridgeTxHash}
          explorerLink={result.explorerLinks?.bridge ?? null}
          description="USDC bridged via CCTP to ARC testnet"
        />
        <TxCard
          label="Revenue Distributed"
          chain="ARC Testnet"
          txHash={result.distributionTxHash}
          explorerLink={result.explorerLinks?.distribution ?? null}
          description="70% creator / 20% holders / 10% protocol"
        />
      </div>
    </div>
  );
}
