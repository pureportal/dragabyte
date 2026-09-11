import type { ScanNode } from "../features/scan/types";
import { formatBytes, truncateMiddle } from "../lib/utils";

interface DetailsModalProps {
  node: ScanNode | null;
  isOpen: boolean;
  onClose: () => void;
}

export const DetailsModal = ({
  node,
  isOpen,
  onClose,
}: DetailsModalProps): JSX.Element | null => {
  if (!isOpen || !node) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl ring-1 ring-slate-800/60">
        <div className="flex items-center justify-between border-b border-slate-800 p-4 bg-slate-900/80">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">
              Item Details
            </h3>
            <p className="text-xs text-slate-500">
              File and folder metadata snapshot.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700/70 hover:text-slate-100 transition"
          >
            Close
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              Name
            </label>
            <p className="text-sm text-slate-200">{node.name || "(Root)"}</p>
          </div>
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              Path
            </label>
            <p
              className="text-sm font-mono text-slate-400 bg-slate-950/70 p-2 rounded mt-1 border border-slate-800/60 whitespace-nowrap truncate"
              title={node.path}
            >
              {truncateMiddle(node.path, 72)}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">
                Size
              </label>
              <p className="text-sm text-slate-200">
                {formatBytes(node.sizeBytes)}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">
                Files
              </label>
              <p className="text-sm text-slate-200">{node.fileCount}</p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">
                Folders
              </label>
              <p className="text-sm text-slate-200">{node.dirCount}</p>
            </div>
          </div>
        </div>
        <div className="flex justify-end p-4 border-t border-slate-800 bg-slate-900/80">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium shadow-lg shadow-blue-500/20"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
