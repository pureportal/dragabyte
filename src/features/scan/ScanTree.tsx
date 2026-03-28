import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { memo, useMemo } from "react";
import { getFileIcon, getFolderIcon } from "../../lib/fileIcons";
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

const FolderProgressSpinner = (): JSX.Element => {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 animate-spin text-blue-300"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="9" />
      <path
        className="opacity-90"
        strokeLinecap="round"
        d="M21 12a9 9 0 00-9-9"
      />
    </svg>
  );
};

interface ScanTreeProps {
  treeItems: FlatNode[];
  calculatingFolderPaths: Set<string>;
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
    calculatingFolderPaths,
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
          const isCalculating =
            isFolder && calculatingFolderPaths.has(item.path);
          const isActive = isFolder
            ? item.path === selectedPath
            : item.path === selectedFilePath;
          const fillPercent = getRowFillPercent(
            item.sizeBytes,
            item.depth,
            maxSizeByDepth,
          );
          const Icon = isFolder
            ? getFolderIcon(isExpanded)
            : getFileIcon(item.path, item.name);
          const iconClassName = isFolder ? "text-amber-300" : "text-slate-400";
          const sizeBarStyle: CSSProperties = { width: `${fillPercent}%` };
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
                <Icon className={`h-4 w-4 ${iconClassName}`} />
                {isCalculating ? <FolderProgressSpinner /> : null}
                <span
                  className="min-w-0 flex-1 truncate whitespace-nowrap"
                  title={item.path}
                >
                  {displayName}
                </span>
              </div>
              <div className="sticky right-0 ml-auto flex-none w-32 py-1.5 pl-4 pr-2 text-right text-xs text-slate-300 tabular-nums bg-slate-950/70 backdrop-blur-sm border-l border-white/5">
                <div className="flex flex-col items-end gap-1">
                  <span className="text-slate-200">
                    {formatBytes(item.sizeBytes)}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {fillPercent}% occupied
                  </span>
                  <div className="h-1 w-full rounded bg-slate-800/70">
                    <div
                      className="h-1 rounded bg-blue-400/70"
                      style={sizeBarStyle}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  },
);

export default ScanTree;
