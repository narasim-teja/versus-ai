"use client";

import { useEffect, useRef, useCallback } from "react";
import { createChart, ColorType, AreaSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { TrendingUp, TrendingDown, BarChart3, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { useTradingChart } from "@/hooks/useTradingChart";
import { formatTokenPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TradingChartProps {
  tokenAddress: string;
  currentPrice?: string;
}

export function TradingChart({ tokenAddress, currentPrice }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { candles, trades, isLoading } = useTradingChart(tokenAddress);

  // Compute price change from candles
  const firstPrice = candles.length > 0 ? candles[0].close : 0;
  const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const priceChange =
    firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const isUp = priceChange >= 0;

  // Total volume from recent trades
  const totalVolume = trades.reduce(
    (sum, t) => sum + Number(t.usdcAmount) / 1e6,
    0
  );

  const initChart = useCallback(() => {
    if (!chartContainerRef.current) return;

    // Clean up existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 300,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.04)" },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        scaleMargins: { top: 0.1, bottom: 0.05 },
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: {
          color: "rgba(255, 255, 255, 0.2)",
          labelBackgroundColor: "#374151",
        },
        horzLine: {
          color: "rgba(255, 255, 255, 0.2)",
          labelBackgroundColor: "#374151",
        },
      },
      handleScroll: { vertTouchDrag: false },
    });

    const lineColor = isUp ? "#10b981" : "#ef4444";
    const topColor = isUp
      ? "rgba(16, 185, 129, 0.3)"
      : "rgba(239, 68, 68, 0.3)";
    const bottomColor = isUp
      ? "rgba(16, 185, 129, 0.0)"
      : "rgba(239, 68, 68, 0.0)";

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor,
      topColor,
      bottomColor,
      lineWidth: 2,
      priceFormat: {
        type: "price",
        precision: 4,
        minMove: 0.0001,
      } as const,
    });

    // Convert candles to area data (use close price)
    const areaData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.close,
    }));

    if (areaData.length > 0) {
      areaSeries.setData(areaData);
      chart.timeScale().fitContent();
    }

    chartRef.current = chart;

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) {
          chart.resize(width, 300);
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, isUp]);

  useEffect(() => {
    const cleanup = initChart();
    return cleanup;
  }, [initChart]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <BarChart3 className="h-4 w-4" />
            Price Chart
          </CardTitle>
          <div className="flex items-center gap-4 text-xs">
            {currentPrice && (
              <span className="font-mono text-sm font-semibold">
                {formatTokenPrice(currentPrice)}
              </span>
            )}
            {candles.length > 1 && (
              <span
                className={cn(
                  "flex items-center gap-0.5 font-mono",
                  isUp ? "text-emerald-400" : "text-red-400"
                )}
              >
                {isUp ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {isUp ? "+" : ""}
                {priceChange.toFixed(2)}%
              </span>
            )}
            {totalVolume > 0 && (
              <span className="text-muted-foreground">
                Vol ${totalVolume.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2 pr-2">
        {isLoading ? (
          <div className="flex h-[300px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : candles.length === 0 ? (
          <div className="flex h-[300px] flex-col items-center justify-center text-muted-foreground">
            <BarChart3 className="mb-2 h-8 w-8 opacity-30" />
            <p className="text-sm">No trade data yet</p>
            <p className="text-xs opacity-60">
              Chart will populate as trades happen
            </p>
          </div>
        ) : (
          <div ref={chartContainerRef} className="h-[300px] w-full" />
        )}
      </CardContent>
    </Card>
  );
}
