import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { memo, useMemo } from "react";
import { formatBytes, truncateMiddle } from "../../lib/utils";
import type { FlatNode, ScanFile, ScanNode } from "./types";

const getDepthTone = (depth: number): string => {
  return depth % 2 === 0 ? "bg-slate-900/40" : "bg-slate-900/60";
};

const getTreeRowClassName = (isActive: boolean, depthTone: string): string => {
  if (isActive) {
    return "flex items-center min-w-full w-full gap-3 px-2 text-left text-sm transition bg-blue-500/15 text-blue-100 border border-blue-500/30 rounded-md";
  }
  return `flex items-center min-w-full w-full gap-3 px-2 text-left text-sm transition ${depthTone} text-slate-200 hover:bg-slate-800/80 hover:border-slate-800/70 border border-transparent rounded-md`;
};

const getExpandButtonClassName = (hasChildren: boolean): string => {
  const visibility = hasChildren ? "visible" : "invisible";
  return `flex h-5 w-5 flex-none items-center justify-center rounded text-xs text-slate-300 transition hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 ${visibility}`;
};

const getMaxSizeByDepth = (items: FlatNode[]): Map<number, number> => {
  const map = new Map<number, number>();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    const size = item.sizeBytes ?? 0;
    const current = map.get(item.depth) ?? 0;
    if (size > current) {
      map.set(item.depth, size);
    }
  }
  return map;
};

const getRowFillPercent = (
  sizeBytes: number,
  depth: number,
  maxSizeByDepth: Map<number, number>,
): number => {
  const maxSize = maxSizeByDepth.get(depth) ?? 0;
  if (maxSize <= 0) return 0;
  const ratio = sizeBytes / maxSize;
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
};

const getRowFillStyle = (percent: number): CSSProperties => {
  if (percent <= 0) {
    return { backgroundClip: "content-box" };
  }
  return {
    backgroundImage: `linear-gradient(90deg, rgba(59,130,246,0.18) ${percent}%, rgba(59,130,246,0) ${percent}%)`,
    backgroundClip: "content-box",
  };
};

interface ScanTreeProps {
  treeItems: FlatNode[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  selectedFilePath: string | null;
  onToggleExpand: (path: string, currentlyExpanded: boolean) => void;
  onSelectFolder: (path: string) => void;
  onSelectFile: (path: string, parentPath: string) => void;
  onDouble: (node: ScanNode) => void;
  onOpenFile: (path: string | null) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>, node: ScanNode) => void;
  onContextMenuFile?: (
    event: MouseEvent<HTMLDivElement>,
    file: ScanFile,
  ) => void;
}

const ScanTree = memo(
  ({
    treeItems,
    expandedPaths,
    selectedPath,
    selectedFilePath,
    onToggleExpand,
    onSelectFolder,
    onSelectFile,
    onDouble,
    onOpenFile,
    onContextMenu,
    onContextMenuFile,
  }: ScanTreeProps) => {
    const maxSizeByDepth = useMemo(() => {
      return getMaxSizeByDepth(treeItems);
    }, [treeItems]);

    const handleSelect = (item: FlatNode): void => {
      if (item.kind === "folder") {
        onSelectFolder(item.path);
        return;
      }
      if (item.parentPath) {
        onSelectFile(item.path, item.parentPath);
      }
    };

    const handleContextMenu = (
      event: MouseEvent<HTMLDivElement>,
      item: FlatNode,
    ): void => {
      if (item.kind === "folder" && item.node) {
        onContextMenu?.(event, item.node);
        return;
      }
      if (item.kind === "file" && item.file && onContextMenuFile) {
        onContextMenuFile(event, item.file);
      }
    };

    const handleDoubleClick = (
      event: MouseEvent<HTMLDivElement>,
      item: FlatNode,
    ): void => {
      event.stopPropagation();
      if (item.kind === "folder" && item.node) {
        onDouble(item.node);
        return;
      }
      onOpenFile(item.path ?? null);
    };

    const handleKeyDown = (
      event: KeyboardEvent<HTMLDivElement>,
      item: FlatNode,
    ): void => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleSelect(item);
      }
    };

    return (
      <>
        {treeItems.map((item) => {
          const isFolder = item.kind === "folder";
          const isExpanded = isFolder && expandedPaths.has(item.path);
          const hasChildren = isFolder && item.hasChildren;
          const isActive = isFolder
            ? item.path === selectedPath
            : item.path === selectedFilePath;
          const fillPercent = getRowFillPercent(
            item.sizeBytes,
            item.depth,
            maxSizeByDepth,
          );
          const depthStyle = {
            paddingLeft: 8 + item.depth * 14,
            ...getRowFillStyle(fillPercent),
          };
          const rowClass = getTreeRowClassName(
            isActive,
            getDepthTone(item.depth),
          );

          const displayName = truncateMiddle(item.name ?? item.path ?? "", 44);

          return (
            <div
              key={item.path}
              className={rowClass}
              style={depthStyle}
              onClick={(): void => handleSelect(item)}
              onContextMenu={(event): void => handleContextMenu(event, item)}
              onDoubleClick={(event): void => handleDoubleClick(event, item)}
              role="button"
              tabIndex={0}
              onKeyDown={(event): void => handleKeyDown(event, item)}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!hasChildren) return;
                    onToggleExpand(item.path, isExpanded);
                  }}
                  className={getExpandButtonClassName(hasChildren)}
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
                {isFolder ? null : (
                  <span className="text-[10px] text-slate-500">FILE</span>
                )}
                <span
                  className="min-w-0 flex-1 truncate whitespace-nowrap"
                  title={item.path}
                >
                  {displayName}
                </span>
              </div>
              <span className="sticky right-0 ml-auto flex-none w-24 py-1.5 pl-4 pr-2 text-right text-xs text-slate-300 tabular-nums bg-slate-950/70 backdrop-blur-sm border-l border-white/5">
                {formatBytes(item.sizeBytes)}
              </span>
            </div>
          );
        })}
      </>
    );
  },
);

export default ScanTree;
