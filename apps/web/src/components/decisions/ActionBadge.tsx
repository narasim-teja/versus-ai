import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type { ActionType } from "@/lib/types";

const ACTION_STYLES: Record<ActionType, string> = {
  BUY_TOKEN: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  SELL_TOKEN: "bg-red-500/10 text-red-400 border-red-500/20",
  BORROW: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  REPAY: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  CLAIM_REVENUE: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  DEPOSIT_COLLATERAL: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  WITHDRAW_COLLATERAL: "bg-pink-500/10 text-pink-400 border-pink-500/20",
};

const ACTION_LABELS: Record<ActionType, string> = {
  BUY_TOKEN: "Buy",
  SELL_TOKEN: "Sell",
  BORROW: "Borrow",
  REPAY: "Repay",
  CLAIM_REVENUE: "Claim",
  DEPOSIT_COLLATERAL: "Deposit",
  WITHDRAW_COLLATERAL: "Withdraw",
};

interface ActionBadgeProps {
  type: ActionType;
  className?: string;
}

export function ActionBadge({ type, className }: ActionBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] px-1.5 py-0", ACTION_STYLES[type], className)}
    >
      {ACTION_LABELS[type]}
    </Badge>
  );
}
