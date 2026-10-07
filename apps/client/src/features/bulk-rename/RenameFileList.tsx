import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  File,
  Folder,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/utils";
import { isFileEnabled } from "./fileModel";
import { emptySelection, selectRow } from "./rowSelection";
import type { FileItem, FilterRule, SortKey } from "./types";

const actionClass =
  "rounded-sm px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sky-500";
const columns =
  "grid grid-cols-[24px_minmax(0,1fr)_116px] sm:grid-cols-[24px_minmax(0,1fr)_16px_minmax(0,1fr)_116px] gap-x-2 sm:gap-2 items-center";

export function RenameFileList({
  files,
  filters,
  busy,
  sortKey,
  descending,
  onSort,
  onMode,
  onRemove,
}: {
  files: FileItem[];
  filters: FilterRule[];
  busy: boolean;
  sortKey: SortKey | null;
  descending: boolean;
  onSort: (key: SortKey | null, descending: boolean) => void;
  onMode: (ids: Set<string>, mode: NonNullable<FileItem["renameMode"]>) => void;
  onRemove: (ids: Set<string>) => void;
}) {
  const [selection, setSelection] = useState(emptySelection);
  const [scrollTop, setScrollTop] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const ids = files.map((file) => file.id);
  const selected = new Set(ids.filter((id) => selection.selected.has(id)));
  const start = Math.max(0, Math.floor(scrollTop / 56) - 5);
  const rendered = files.slice(start, start + 40);
  const remove = (targets: Set<string>) => {
    onRemove(targets);
    setSelection((previous) => ({
      ...previous,
      selected: new Set(
        [...previous.selected].filter((id) => !targets.has(id)),
      ),
      focused: targets.has(previous.focused ?? "") ? null : previous.focused,
      anchor: targets.has(previous.anchor ?? "") ? null : previous.anchor,
      rangeBase: null,
    }));
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("select,button")) return;
    if (
      target instanceof HTMLInputElement &&
      (target.type !== "checkbox" || event.key === " ")
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      setSelection(emptySelection());
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelection((previous) => ({
        ...previous,
        selected: new Set(ids),
        rangeBase: null,
      }));
    }
    if (event.key === "Delete" && !busy) {
      event.preventDefault();
      remove(selected);
    }
    if (event.key === " " && selection.focused) {
      event.preventDefault();
      setSelection((previous) =>
        selectRow(previous, ids, previous.focused!, event.shiftKey, true),
      );
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const current = ids.indexOf(selection.focused ?? "");
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? ids.length - 1
            : Math.min(
                ids.length - 1,
                Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1)),
              );
      const id = ids[index];
      if (!id) return;
      setSelection((previous) =>
        event.shiftKey
          ? selectRow(previous, ids, id, true)
          : { ...previous, focused: id, anchor: id, rangeBase: null },
      );
      const element = viewport.current;
      if (element) {
        if (index * 56 < element.scrollTop) element.scrollTop = index * 56;
        else if ((index + 1) * 56 > element.scrollTop + element.clientHeight)
          element.scrollTop = (index + 1) * 56 - element.clientHeight;
        requestAnimationFrame(() =>
          element.querySelector<HTMLElement>(`[data-row-id="${id}"]`)?.focus(),
        );
      }
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 flex-wrap items-center gap-1 border-b border-slate-800 bg-slate-900/30 px-3 py-1.5">
        {selected.size > 0 ? (
          <>
            <span className="mr-1 text-xs text-sky-300">
              {selected.size} selected
            </span>
            <button
              className={actionClass}
              onClick={() => setSelection(emptySelection())}
            >
              Deselect all
            </button>
            <div className="mx-1 h-4 w-px bg-slate-700" />
            <button
              className={actionClass}
              disabled={busy}
              onClick={() => onMode(selected, "disabled")}
            >
              Disable
            </button>
            <button
              className={actionClass}
              disabled={busy}
              onClick={() => onMode(selected, "enabled")}
            >
              Force enable
            </button>
            <button
              className={actionClass + " flex items-center gap-1"}
              disabled={busy}
              onClick={() => onMode(selected, "auto")}
            >
              <RotateCcw size={12} /> Use filters
            </button>
            <button
              className={actionClass + " flex items-center gap-1 text-rose-300"}
              disabled={busy}
              onClick={() => remove(selected)}
            >
              <Trash2 size={12} /> Remove
            </button>
          </>
        ) : (
          <button
            className={actionClass}
            onClick={() =>
              setSelection((previous) => ({
                ...previous,
                selected: new Set(ids),
                rangeBase: null,
              }))
            }
          >
            Select all
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <select
            aria-label="Sort rows"
            className="max-w-36 rounded-sm border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300"
            value={sortKey ?? "added"}
            onChange={(event) =>
              onSort(
                event.target.value === "added"
                  ? null
                  : (event.target.value as SortKey),
                descending,
              )
            }
          >
            <option value="added">Added order</option>
            <option value="originalName">Name</option>
            <option value="directory">Folder</option>
            <option value="kind">Type</option>
            <option value="extension">Extension</option>
            <option value="size">Size</option>
          </select>
          {sortKey && (
            <button
              aria-label={descending ? "Sort ascending" : "Sort descending"}
              className={actionClass}
              onClick={() => onSort(sortKey, !descending)}
            >
              {descending ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
            </button>
          )}
        </div>
      </div>
      <div
        role="grid"
        aria-label="Rename items"
        aria-multiselectable="true"
        aria-rowcount={files.length + 1}
        className="flex min-h-0 flex-1 flex-col p-3"
        onKeyDown={keyDown}
      >
        <div
          role="row"
          className={cn(columns, "shrink-0 px-2 pb-2 text-xs text-slate-500")}
        >
          <div role="columnheader">
            <input
              aria-label="Select all rows"
              type="checkbox"
              className="accent-sky-500"
              checked={files.length > 0 && selected.size === files.length}
              ref={(element) => {
                if (element)
                  element.indeterminate =
                    selected.size > 0 && selected.size < files.length;
              }}
              onChange={(event) =>
                setSelection((previous) => ({
                  ...previous,
                  selected: event.target.checked ? new Set(ids) : new Set(),
                  rangeBase: null,
                }))
              }
            />
          </div>
          <div
            role="columnheader"
            aria-sort={
              sortKey === "originalName"
                ? descending
                  ? "descending"
                  : "ascending"
                : "none"
            }
          >
            <button
              className="flex items-center gap-1 hover:text-slate-200"
              onClick={() =>
                onSort(
                  "originalName",
                  sortKey === "originalName" ? !descending : false,
                )
              }
            >
              <span className="sm:hidden">Name</span>
              <span className="hidden sm:inline">Original name</span>{" "}
              {sortKey === "originalName" &&
                (descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
            </button>
          </div>
          <div role="columnheader" className="hidden sm:block" />
          <div role="columnheader" className="hidden sm:block">
            New name
          </div>
          <div role="columnheader">Rename</div>
        </div>
        <div
          ref={viewport}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div style={{ height: files.length * 56, position: "relative" }}>
            <div
              style={{ position: "absolute", top: start * 56, width: "100%" }}
            >
              {rendered.map((file, offset) => {
                const enabled = isFileEnabled(file, filters);
                const active = selected.has(file.id);
                return (
                  <div
                    role="row"
                    aria-rowindex={start + offset + 2}
                    aria-selected={active}
                    key={file.id}
                    data-row-id={file.id}
                    tabIndex={
                      selection.focused === file.id ||
                      (!selection.focused && start + offset === 0)
                        ? 0
                        : -1
                    }
                    className={cn(
                      columns,
                      "mb-1 h-[52px] cursor-default select-none rounded-sm border px-2 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500",
                      active
                        ? "border-sky-500/50 bg-sky-500/10"
                        : "border-slate-800/60 bg-slate-900/40 hover:bg-slate-800/60",
                    )}
                    onFocus={(event) => {
                      if (event.target === event.currentTarget)
                        setSelection((previous) => ({
                          ...previous,
                          focused: file.id,
                        }));
                    }}
                    onClick={(event) => {
                      if (
                        (event.target as HTMLElement).closest(
                          "input,select,button",
                        )
                      )
                        return;
                      setSelection((previous) =>
                        selectRow(
                          previous,
                          ids,
                          file.id,
                          event.shiftKey,
                          event.ctrlKey || event.metaKey,
                        ),
                      );
                      event.currentTarget.focus();
                    }}
                  >
                    <div role="gridcell" className="row-span-2 sm:row-span-1">
                      <input
                        aria-label={`Select ${file.originalName}`}
                        type="checkbox"
                        className="accent-sky-500"
                        checked={active}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelection((previous) =>
                            selectRow(
                              previous,
                              ids,
                              file.id,
                              event.shiftKey,
                              !event.shiftKey,
                            ),
                          );
                        }}
                        onChange={() => {}}
                      />
                    </div>
                    <div
                      role="gridcell"
                      className={cn(
                        "col-start-2 row-start-1 sm:col-auto sm:row-auto min-w-0 self-end sm:self-auto",
                        !enabled && "opacity-50",
                      )}
                      title={file.path}
                    >
                      <div className="flex items-center gap-1.5 text-sm text-slate-300">
                        {file.isDirectory ? (
                          <Folder
                            size={14}
                            className="shrink-0 text-amber-500"
                          />
                        ) : (
                          <File size={14} className="shrink-0 text-blue-400" />
                        )}
                        <span className="truncate">{file.originalName}</span>
                      </div>
                      <div className="hidden sm:block mt-0.5 truncate text-[10px] text-slate-500">
                        {file.directory}
                      </div>
                    </div>
                    <div
                      role="gridcell"
                      className="hidden sm:block text-slate-600"
                    >
                      <ArrowRight size={14} />
                    </div>
                    <div
                      role="gridcell"
                      className="col-start-2 row-start-2 sm:col-auto sm:row-auto min-w-0 self-start sm:self-auto"
                      title={file.error ?? file.newName}
                    >
                      <div
                        className={cn(
                          "flex items-center gap-1 text-xs sm:text-sm",
                          !enabled
                            ? "text-slate-600"
                            : file.newName !== file.originalName
                              ? "font-medium text-blue-300"
                              : "text-slate-500",
                        )}
                      >
                        <span className="truncate">{file.newName}</span>
                        {file.status === "success" && (
                          <Check
                            size={13}
                            className="shrink-0 text-emerald-400"
                          />
                        )}
                      </div>
                      {file.error && (
                        <div className="truncate text-[10px] text-rose-300">
                          {file.error}
                        </div>
                      )}
                    </div>
                    <div
                      role="gridcell"
                      className="col-start-3 row-start-1 row-span-2 sm:col-auto sm:row-auto sm:row-span-1 flex items-center gap-1"
                    >
                      <select
                        aria-label={`Rename mode for ${file.originalName}`}
                        value={file.renameMode}
                        disabled={busy}
                        className={cn(
                          "w-[94px] rounded-sm border bg-slate-950 px-1 py-1 text-[11px]",
                          file.renameMode === "enabled"
                            ? "border-sky-800 text-sky-300"
                            : !enabled
                              ? "border-slate-800 text-slate-500"
                              : "border-slate-700 text-slate-300",
                        )}
                        onChange={(event) =>
                          onMode(
                            new Set([file.id]),
                            event.target.value as NonNullable<
                              FileItem["renameMode"]
                            >,
                          )
                        }
                      >
                        <option value="auto">
                          {enabled ? "Auto" : "Filtered"}
                        </option>
                        <option value="disabled">Disabled</option>
                        <option value="enabled">Force enabled</option>
                      </select>
                      <button
                        aria-label={`Remove ${file.originalName} from list`}
                        disabled={busy}
                        className="p-0.5 text-slate-500 hover:text-rose-400 disabled:opacity-40"
                        onClick={() => remove(new Set([file.id]))}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
