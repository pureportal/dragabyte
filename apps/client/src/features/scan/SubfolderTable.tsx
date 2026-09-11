import { useMemo, useState, type JSX, type MouseEvent } from "react";
import { getFolderIcon } from "../../lib/fileIcons";
import { formatBytes } from "../../lib/utils";
import type { ScanNode } from "./types";
import { useVirtualRows } from "./useVirtualRows";

interface SubfolderTableProps {
  folders: ScanNode[];
  selectedPath: string | null;
  scanning: boolean;
  onSelect: (path: string) => void;
  onContextMenu: (event: MouseEvent, node: ScanNode) => void;
}

const ROW_HEIGHT = 48;
const FolderIcon = getFolderIcon(false);

export default function SubfolderTable({ folders, selectedPath, scanning, onSelect, onContextMenu }: SubfolderTableProps): JSX.Element {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const ordered = useMemo(() => [...folders].sort((a, b) => b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name)), [folders]);
  const { start, end } = useVirtualRows(ordered.length, ROW_HEIGHT, container);
  const maxSize = ordered[0]?.sizeBytes ?? 0;
  return (
    <div ref={setContainer} className="flex-1 overflow-auto">
      <table className="w-full text-sm table-fixed">
        <thead className="sticky top-0 bg-slate-950/90 text-left text-[10px] font-bold uppercase text-slate-500 tracking-wider shadow-xs z-10">
          <tr>
            <th className="px-4 py-3 font-semibold w-[40%]">Name</th>
            <th className="px-4 py-3 font-semibold w-[28%]">Size</th>
            <th className="px-4 py-3 font-semibold">Files</th>
            <th className="px-4 py-3 font-semibold">Folders</th>
          </tr>
        </thead>
        <tbody>
          {start > 0 ? <tr aria-hidden="true"><td colSpan={4} style={{ height: start * ROW_HEIGHT }} /></tr> : null}
          {ordered.slice(start, end).map((folder) => {
            const fill = maxSize > 0 ? Math.round(folder.sizeBytes / maxSize * 100) : 0;
            return (
              <tr key={folder.path} onClick={() => onSelect(folder.path)} onContextMenu={(event) => onContextMenu(event, folder)}
                aria-busy={scanning && folder.state === "scanning"}
                style={{ height: ROW_HEIGHT, backgroundImage: `linear-gradient(90deg, rgba(59,130,246,0.18) ${fill}%, transparent ${fill}%)` }}
                className={`cursor-pointer border-t border-slate-800 text-slate-200 hover:bg-slate-800/60 ${selectedPath === folder.path ? "bg-blue-500/10" : ""}`}>
                <td className="px-4 py-2"><div className="flex items-center gap-2"><FolderIcon className="h-4 w-4 shrink-0 text-amber-300" /><span className="truncate" title={folder.path}>{folder.name}</span></div></td>
                <td className="px-4 py-2"><div className="flex flex-col gap-1"><span className="whitespace-nowrap">{folder.state !== "complete" ? "≥ " : ""}{formatBytes(folder.sizeBytes)}</span><div className="h-1 rounded-sm bg-slate-800/70"><div className="h-1 rounded-sm bg-blue-400/70" style={{ width: `${fill}%` }} /></div></div></td>
                <td className="px-4 py-2 tabular-nums">{folder.fileCount}</td>
                <td className="px-4 py-2 tabular-nums">{folder.dirCount}</td>
              </tr>
            );
          })}
          {end < ordered.length ? <tr aria-hidden="true"><td colSpan={4} style={{ height: (ordered.length - end) * ROW_HEIGHT }} /></tr> : null}
          {ordered.length === 0 ? <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={4}>{scanning ? "Scanning…" : "No subfolders"}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
