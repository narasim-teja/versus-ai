"use client";

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
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      ) : (
        <span className="text-xs font-mono text-zinc-500">{truncatedHash}</span>
      )}
    </div>
  );
}

export function SettlementSummary({ result }: SettlementSummaryProps) {
  const hasTxHashes =
    result.settlementTxHash ||
    result.bridgeTxHash ||
    result.distributionTxHash;

  if (!hasTxHashes) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-xs font-semibold text-green-400">
          Cross-Chain Settlement Complete
        </span>
      </div>

      <div className="grid gap-2">
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
