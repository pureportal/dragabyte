import { Check, Folder, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useVirtualRows } from "../../hooks/useVirtualRows";
import { folderButtonClass, folderInputClass } from "./FolderSidebar";
import type {
  EmptyFolderPreview,
  FolderSortKey,
  RemovalOutcome,
} from "./types";

export function FolderPreview({
  preview,
  selected,
  outcomes,
  busy,
  canRemove,
  onSelect,
  onRemove,
}: {
  preview: EmptyFolderPreview | null;
  selected: Set<string>;
  outcomes: RemovalOutcome[];
  busy: boolean;
  canRemove: boolean;
  onSelect: (paths: string[], checked: boolean) => void;
  onRemove: (hiddenSelection: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: FolderSortKey; descending: boolean }>(
    { key: "path", descending: false },
  );
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const results = useMemo(
    () => new Map(outcomes.map((outcome) => [outcome.path, outcome])),
    [outcomes],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const folders = (preview?.folders ?? []).filter((folder) =>
      folder.path.toLowerCase().includes(query),
    );
    return folders.sort((a, b) => {
      const order =
        sort.key === "path"
          ? a.path.localeCompare(b.path, undefined, { numeric: true })
          : sort.key === "depth"
            ? a.depth - b.depth
            : (a.modified ?? 0) - (b.modified ?? 0);
      return (
        (order || a.path.localeCompare(b.path)) * (sort.descending ? -1 : 1)
      );
    });
  }, [preview, search, sort]);
  const selectable = visible.filter(
    (folder) => results.get(folder.path)?.error !== null,
  );
  const checkedCount = selectable.filter((folder) =>
    selected.has(folder.path),
  ).length;
  const { start, end, totalHeight } = useVirtualRows(
    visible.length,
    72,
    container,
  );
  const sortBy = (key: FolderSortKey) => {
    container?.scrollTo({ top: 0 });
    setSort((previous) => ({
      key,
      descending: previous.key === key && !previous.descending,
    }));
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900/50 px-3 py-2">
        <h1 className="text-sm font-semibold text-slate-100">
          Remove empty folders
        </h1>
        <button
          disabled={busy || !canRemove || !selected.size}
          className={
            folderButtonClass +
            " ml-auto border-rose-500/40 text-rose-200 hover:bg-rose-950/50"
          }
          onClick={() => onRemove(selected.size - checkedCount)}
        >
          <Trash2 size={14} />
          Remove selected{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 px-3 py-2">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            aria-label="Select all visible folders"
            type="checkbox"
            className="accent-sky-500"
            disabled={busy || !canRemove || !selectable.length}
            checked={
              selectable.length > 0 && checkedCount === selectable.length
            }
            ref={(element) => {
              if (element)
                element.indeterminate =
                  checkedCount > 0 && checkedCount < selectable.length;
            }}
            onChange={(event) =>
              onSelect(
                selectable.map((folder) => folder.path),
                event.target.checked,
              )
            }
          />
          Preview
          {preview
            ? ` (${search.trim() ? `${visible.length} of ` : ""}${preview.folders.length})`
            : ""}
        </label>
        <div className="relative ml-auto w-full max-w-52">
          <input
            aria-label="Search folder preview"
            placeholder="Search"
            className={folderInputClass + " pr-8 text-xs"}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              container?.scrollTo({ top: 0 });
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearch("");
                container?.scrollTo({ top: 0 });
              }
            }}
          />
          {search && (
            <button
              aria-label="Clear folder search"
              className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-slate-400 hover:text-slate-100"
              onClick={() => {
                setSearch("");
                container?.scrollTo({ top: 0 });
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      {visible.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
          <button
            className="ml-6 min-w-0 flex-1 text-left"
            onClick={() => sortBy("path")}
          >
            Folder{sort.key === "path" ? (sort.descending ? " ↓" : " ↑") : ""}
          </button>
          <button className="w-12 text-right" onClick={() => sortBy("depth")}>
            Depth{sort.key === "depth" ? (sort.descending ? " ↓" : " ↑") : ""}
          </button>
          <button
            className="hidden w-24 text-right sm:block"
            onClick={() => sortBy("modified")}
          >
            Modified
            {sort.key === "modified" ? (sort.descending ? " ↓" : " ↑") : ""}
          </button>
        </div>
      )}
      <div
        ref={setContainer}
        role="region"
        aria-label="Empty folder preview"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {visible.length === 0 ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 text-sm text-slate-400">
            <Search size={28} className="opacity-40" />
            <p>
              {busy && !preview
                ? "Finding empty folders…"
                : !preview
                  ? "Choose folders to search"
                  : search
                    ? "No matching folders"
                    : "No empty folders found"}
            </p>
          </div>
        ) : (
          <div style={{ height: totalHeight, position: "relative" }}>
            <div
              style={{ position: "absolute", top: start * 72, width: "100%" }}
            >
              {visible.slice(start, end).map((folder) => {
                const outcome = results.get(folder.path);
                const removed = outcome?.error === null;
                return (
                  <div
                    key={folder.path}
                    className={`flex h-[72px] items-center gap-3 border-b border-slate-800/50 px-3 text-xs ${removed ? "text-slate-500" : "text-slate-300 hover:bg-slate-800/40"}`}
                  >
                    <input
                      aria-label={`Remove ${folder.relativePath}`}
                      type="checkbox"
                      className="shrink-0 accent-sky-500"
                      disabled={busy || !canRemove || removed}
                      checked={selected.has(folder.path)}
                      onChange={(event) =>
                        onSelect([folder.path], event.target.checked)
                      }
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Folder size={13} className="shrink-0 text-amber-500" />
                        <span className="truncate">{folder.name}</span>
                        {removed && (
                          <Check size={13} className="text-emerald-400" />
                        )}
                      </div>
                      <div
                        className="truncate text-slate-400"
                        title={folder.path}
                      >
                        {folder.path}
                      </div>
                      {(outcome?.error || removed || folder.children.length > 0) && (
                        <div
                          className={`truncate ${outcome?.error ? "text-rose-300" : removed ? "text-emerald-400" : "text-slate-400"}`}
                          title={outcome?.error ?? undefined}
                        >
                          {outcome?.error ??
                            (removed
                              ? "Removed"
                              : "Empty after subfolders are removed")}
                        </div>
                      )}
                    </div>
                    <span className="w-12 text-right text-slate-400">
                      {folder.depth}
                    </span>
                    <span className="hidden w-24 text-right text-slate-400 sm:block">
                      {folder.modified === null
                        ? "—"
                        : new Date(folder.modified * 1000).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {!!preview?.errors.length && (
        <details className="max-h-40 shrink-0 overflow-y-auto border-t border-slate-800 px-3 py-2 text-xs text-rose-300">
          <summary className="cursor-pointer">
            Search errors ({preview.errors.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {preview.errors.map((error, index) => (
              <li key={`${error.path}-${index}`}>
                <div className="break-all">{error.path}</div>
                <div>{error.message}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
