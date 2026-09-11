import { useMemo } from "react";
import { formatBytes } from "../../lib/utils";
import type { DiskUsage, ScanNode } from "./types";

type ChartSegment = {
  label: string;
  sizeBytes: number;
};

const CHART_COLORS = [
  "#3b82f6",
  "#10b981",
  "#a855f7",
  "#f59e0b",
  "#f43f5e",
  "#06b6d4",
];

const sumSizes = (nodes: ScanNode[]): number => {
  let total = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    total += node.sizeBytes;
  }
  return total;
};

const sumSegmentBytes = (segments: ChartSegment[]): number => {
  let total = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (!segment) continue;
    total += segment.sizeBytes;
  }
  return total;
};

const sortBySize = (nodes: ScanNode[]): ScanNode[] => {
  return [...nodes].sort((a, b) => b.sizeBytes - a.sizeBytes);
};

const getTotalBytes = (node: ScanNode): number => {
  if (node.sizeBytes > 0) return node.sizeBytes;
  return sumSizes(node.children);
};

const buildSegments = (
  node: ScanNode | null,
  limit: number,
): ChartSegment[] => {
  if (!node || node.children.length === 0) return [];
  const sorted = sortBySize(node.children);
  const total = getTotalBytes(node);
  const segments: ChartSegment[] = [];
  let used = 0;
  for (let i = 0; i < sorted.length && segments.length < limit; i += 1) {
    const item = sorted[i];
    if (!item || item.sizeBytes <= 0) continue;
    segments.push({ label: item.name, sizeBytes: item.sizeBytes });
    used += item.sizeBytes;
  }
  if (total > used) segments.push({ label: "Other", sizeBytes: total - used });
  return segments;
};

const formatPercent = (value: number): string => {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
};

const clampPercent = (value: number): number => {
  return Math.min(100, Math.max(0, value));
};

const getSegmentPercent = (sizeBytes: number, totalBytes: number): number => {
  if (totalBytes <= 0) return 0;
  return (sizeBytes / totalBytes) * 100;
};

const buildConicGradient = (segments: ChartSegment[]): string => {
  let cursor = 0;
  const stops: string[] = [];
  const total = sumSegmentBytes(segments);
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (!segment) continue;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const percent = total > 0 ? (segment.sizeBytes / total) * 100 : 0;
    const start = cursor;
    const end = cursor + percent;
    stops.push(`${color} ${start}% ${end}%`);
    cursor = end;
  }
  if (stops.length === 0) return "#1f2937";
  return `conic-gradient(${stops.join(", ")})`;
};

interface UsageChartsProps {
  node: ScanNode | null;
  diskUsage: DiskUsage | null;
}

const UsageCharts = ({ node, diskUsage }: UsageChartsProps): JSX.Element => {
  const segments = useMemo(() => buildSegments(node, 6), [node]);
  const totalBytes = useMemo(() => {
    return node ? getTotalBytes(node) : 0;
  }, [node]);
  const diskTotal = diskUsage?.totalBytes ?? 0;
  const diskFree = diskUsage?.freeBytes ?? 0;
  const diskUsed = Math.max(0, diskTotal - diskFree);
  const diskPercent = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;
  const pieStyle = useMemo(() => {
    return { backgroundImage: buildConicGradient(segments) };
  }, [segments]);

  return (
    <div className="shrink-0 grid gap-4 2xl:grid-cols-2">
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
              Usage Pie
            </p>
            <p className="text-xs text-slate-400">Top folders by size</p>
          </div>
          <span className="text-xs text-slate-500">
            {formatBytes(totalBytes)}
          </span>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div
            className="relative h-28 w-28 shrink-0 rounded-full border border-slate-800/70 sm:h-32 sm:w-32"
            style={pieStyle}
          >
            <div className="absolute inset-3 rounded-full bg-slate-950/90 border border-slate-800/60 flex items-center justify-center text-[11px] text-slate-300 text-center px-2">
              {segments.length === 0 ? "No data" : "Usage"}
            </div>
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {segments.map((segment, index) => (
              <div
                key={segment.label}
                className="flex items-center gap-2 min-w-0"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                  }}
                />
                <div className="flex-1 min-w-0 overflow-hidden text-xs text-slate-300 truncate">
                  {segment.label}
                </div>
                <div className="shrink-0 text-[10px] text-slate-500 whitespace-nowrap">
                  {formatPercent(
                    getSegmentPercent(segment.sizeBytes, totalBytes),
                  )}
                </div>
              </div>
            ))}
            {segments.length === 0 ? (
              <p className="text-xs text-slate-500">Run a scan to see usage.</p>
            ) : null}
            {diskUsage ? (
              <div className="pt-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  Disk Usage
                </p>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span>{formatBytes(diskUsed)} used</span>
                  <span>{formatBytes(diskFree)} free</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-800/70 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500/70"
                    style={{ width: `${clampPercent(diskPercent)}%` }}
                  />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  {formatBytes(diskTotal)} total
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
              Usage Bars
            </p>
            <p className="text-xs text-slate-400">Share of total size</p>
          </div>
          <span className="text-xs text-slate-500">
            {segments.length} items
          </span>
        </div>
        <div className="space-y-3 min-w-0">
          {segments.map((segment, index) => {
            const percent = getSegmentPercent(segment.sizeBytes, totalBytes);
            return (
              <div key={segment.label} className="min-w-0">
                <div className="flex items-center justify-between text-xs text-slate-300 mb-1 min-w-0 gap-2">
                  <span className="truncate flex-1 min-w-0 pr-2">
                    {segment.label}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500 whitespace-nowrap">
                    {formatPercent(percent)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-800/70 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${clampPercent(percent)}%`,
                      backgroundColor:
                        CHART_COLORS[index % CHART_COLORS.length],
                    }}
                  />
                </div>
              </div>
            );
          })}
          {segments.length === 0 ? (
            <p className="text-xs text-slate-500">No data to display.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default UsageCharts;
