import { useMemo } from "react";
import { formatBytes } from "../../lib/utils";
import type { ScanNode } from "./types";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  node: ScanNode;
}

interface TreemapProps {
  rootNode: ScanNode;
  width: number;
  height: number;
  onSelect: (node: ScanNode) => void;
  selectedPath: string | null;
}

const MIN_LABEL_WIDTH = 40;
const MIN_LABEL_HEIGHT = 20;

const sumNodeSizes = (nodes: ScanNode[]): number => {
  let total = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    total += node.sizeBytes;
  }
  return total;
};

const sortBySize = (nodes: ScanNode[]): ScanNode[] => {
  return [...nodes].sort((a, b) => b.sizeBytes - a.sizeBytes);
};

const getSplitIndex = (nodes: ScanNode[], total: number): number => {
  let currentSum = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    currentSum += node.sizeBytes;
    if (currentSum >= total / 2) {
      return i + 1;
    }
  }
  return 1;
};

const shouldRenderLabel = (rect: Rect): boolean => {
  return rect.w > MIN_LABEL_WIDTH && rect.h > MIN_LABEL_HEIGHT;
};

function recursiveSplit(
  nodes: ScanNode[],
  x: number,
  y: number,
  w: number,
  h: number,
): Rect[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    const node = nodes[0];
    if (!node) return [];
    return [{ x, y, w, h, node }];
  }
  const sorted = sortBySize(nodes);
  const total = sumNodeSizes(sorted);
  if (total <= 0) {
    return [];
  }
  const splitIndex = getSplitIndex(sorted, total);
  const groupA = sorted.slice(0, splitIndex);
  const groupB = sorted.slice(splitIndex);

  const sizeA = sumNodeSizes(groupA);

  const ratioA = sizeA / total;

  const result: Rect[] = [];

  if (w > h) {
    const wA = w * ratioA;
    result.push(...recursiveSplit(groupA, x, y, wA, h));
    result.push(...recursiveSplit(groupB, x + wA, y, w - wA, h));
  } else {
    const hA = h * ratioA;
    result.push(...recursiveSplit(groupA, x, y, w, hA));
    result.push(...recursiveSplit(groupB, x, y + hA, w, h - hA));
  }

  return result;
}

const COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
];

const Treemap = ({
  rootNode,
  width,
  height,
  onSelect,
  selectedPath,
}: TreemapProps): JSX.Element => {
  const rects = useMemo(() => {
    return recursiveSplit(rootNode.children, 0, 0, width, height);
  }, [rootNode, width, height]);

  return (
    <div
      style={{ width, height, position: "relative" }}
      className="overflow-hidden rounded-lg border border-slate-800/70 bg-slate-950/70"
    >
      {rects.map((r, i) => {
        const isSelected = selectedPath === r.node.path;
        const colorClass = COLORS[i % COLORS.length];

        return (
          <div
            key={r.node.path}
            onClick={() => onSelect(r.node)}
            className={`absolute border border-slate-900/50 transition-all hover:brightness-110 cursor-pointer flex items-center justify-center overflow-hidden rounded-sm shadow-sm
                    ${colorClass}
                    ${isSelected ? "ring-2 ring-white/80 z-10" : "opacity-80"}
                `}
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
            }}
            title={`${r.node.name} (${formatBytes(r.node.sizeBytes)})`}
          >
            {shouldRenderLabel(r) && (
              <span className="text-[10px] sm:text-xs font-semibold text-white/90 truncate px-1 drop-shadow-md cursor-default pointer-events-none select-none">
                {r.node.name}
              </span>
            )}
          </div>
        );
      })}
      {rects.length === 0 && (
        <div className="flex items-center justify-center h-full text-slate-500 text-sm">
          {rootNode.children.length === 0
            ? "Empty folder"
            : "No sizable content"}
        </div>
      )}
    </div>
  );
};

export default Treemap;
