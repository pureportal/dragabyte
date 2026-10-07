import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown, File, Folder, LoaderCircle, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn, toErrorMessage } from "../../lib/utils";
import type { ImportItem, ImportOptions } from "./types";

export const directImportOptions: ImportOptions = {
  contents: false,
  includeFiles: true,
  includeFolders: true,
  minDepth: 0,
  maxDepth: 0,
  pattern: "",
  matchPath: false,
  matchCase: false,
};
const initialOptions: ImportOptions = {
  ...directImportOptions,
  contents: true,
  minDepth: 1,
  maxDepth: 1,
};
const inputClass =
  "w-full rounded-sm border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500";
const buttonClass =
  "flex items-center justify-center gap-1.5 rounded-sm border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sky-500";

export function ImportDialog({
  existingPaths,
  onAdd,
  onClose,
}: {
  existingPaths: Set<string>;
  onAdd: (items: ImportItem[]) => void;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<string[]>([]);
  const [options, setOptions] = useState(initialOptions);
  const [advanced, setAdvanced] = useState(false);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const previewViewport = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);

  const validation =
    options.maxDepth !== null && options.maxDepth < options.minDepth
      ? "Maximum depth must be at least the minimum depth."
      : "";
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!sources.length || validation) {
        setItems([]);
        setBusy(false);
        return;
      }
      setBusy(true);
      setError("");
      invoke<ImportItem[]>("collect_rename_items", { paths: sources, options })
        .then((result) => {
          if (active) {
            setItems(result);
            setExcluded(new Set());
          }
        })
        .catch((reason) => {
          if (active) {
            setError(toErrorMessage(reason));
            setItems([]);
          }
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [sources, options, validation]);

  const available = useMemo(
    () => items.filter((item) => !existingPaths.has(item.path)),
    [items, existingPaths],
  );
  const visible = useMemo(
    () =>
      available.filter((item) =>
        item.relativePath.toLowerCase().includes(search.toLowerCase()),
      ),
    [available, search],
  );
  const selected = available.filter((item) => !excluded.has(item.path));
  const start = Math.max(
    0,
    Math.min(Math.floor(scrollTop / 36) - 4, visible.length - 1),
  );
  const rendered = visible.slice(start, start + 24);
  const update = (patch: Partial<ImportOptions>) => {
    setBusy(sources.length > 0);
    setOptions((previous) => ({ ...previous, ...patch }));
  };
  const pick = async (directory: boolean) => {
    setPicking(true);
    try {
      const result = await open({ directory, multiple: true });
      if (result) {
        setBusy(true);
        setSources((previous) => [
          ...new Set([
            ...previous,
            ...(Array.isArray(result) ? result : [result]),
          ]),
        ]);
      }
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setPicking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            const controls = dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
            );
            if (!controls?.length) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 id="import-title" className="font-semibold text-slate-100">
            Import
          </h2>
          <button
            ref={closeButton}
            aria-label="Close import"
            onClick={onClose}
            className="rounded-sm p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={buttonClass}
              disabled={picking}
              onClick={() => void pick(false)}
            >
              <File size={14} /> Choose files
            </button>
            <button
              className={buttonClass}
              disabled={picking}
              onClick={() => void pick(true)}
            >
              <Folder size={14} /> Choose folders
            </button>
          </div>
          {sources.length > 0 && (
            <div className="max-h-24 overflow-y-auto space-y-1">
              {sources.map((path) => (
                <div
                  key={path}
                  className="flex items-center gap-2 rounded-sm bg-slate-950/50 px-2 py-1 text-xs text-slate-400"
                >
                  <span className="min-w-0 flex-1 truncate" title={path}>
                    {path}
                  </span>
                  <button
                    aria-label={`Remove source ${path}`}
                    className="p-1 hover:text-rose-400"
                    onClick={() => {
                      setBusy(true);
                      setSources((previous) =>
                        previous.filter((source) => source !== path),
                      );
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <label className="text-xs text-slate-400 flex items-center gap-2">
              Add
              <select
                aria-label="Import item type"
                className={inputClass + " w-auto"}
                value={
                  options.includeFiles
                    ? options.includeFolders
                      ? "both"
                      : "files"
                    : "folders"
                }
                onChange={(event) =>
                  update({
                    includeFiles: event.target.value !== "folders",
                    includeFolders: event.target.value !== "files",
                  })
                }
              >
                <option value="both">Files and folders</option>
                <option value="files">Files</option>
                <option value="folders">Folders</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                className="accent-sky-500"
                checked={
                  options.maxDepth === null || (options.maxDepth ?? 0) > 1
                }
                onChange={(event) =>
                  update({
                    maxDepth: event.target.checked ? null : 1,
                    minDepth: Math.min(options.minDepth, 1),
                  })
                }
              />{" "}
              Include subfolders
            </label>
            <button
              className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100"
              aria-expanded={advanced}
              onClick={() => setAdvanced((value) => !value)}
            >
              Advanced{" "}
              <ChevronDown size={14} className={advanced ? "rotate-180" : ""} />
            </button>
          </div>
          {advanced && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-md border border-slate-800 bg-slate-950/40 p-3">
              <label className="space-y-1 text-xs text-slate-400">
                Minimum depth
                <input
                  aria-label="Minimum depth"
                  type="number"
                  min={0}
                  max={1000}
                  value={options.minDepth}
                  className={inputClass}
                  onChange={(event) =>
                    update({
                      minDepth: Math.max(
                        0,
                        Math.min(1000, Number(event.target.value)),
                      ),
                    })
                  }
                />
              </label>
              <label className="space-y-1 text-xs text-slate-400">
                Maximum depth
                <input
                  aria-label="Maximum depth"
                  type="number"
                  min={0}
                  max={1000}
                  value={options.maxDepth ?? ""}
                  placeholder="Unlimited"
                  className={inputClass}
                  onChange={(event) =>
                    update({
                      maxDepth:
                        event.target.value === ""
                          ? null
                          : Math.max(
                              0,
                              Math.min(1000, Number(event.target.value)),
                            ),
                    })
                  }
                />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  className="accent-sky-500"
                  checked={options.minDepth === 0}
                  onChange={(event) =>
                    update({
                      minDepth: event.target.checked ? 0 : 1,
                      maxDepth:
                        options.maxDepth === 0 && !event.target.checked
                          ? 1
                          : options.maxDepth,
                    })
                  }
                />{" "}
                Include selected roots
              </label>
              <p className="col-span-full text-xs text-slate-500">
                Depth 0 is the selected root; depth 1 is its direct children.
              </p>
              <label className="col-span-2 space-y-1 text-xs text-slate-400">
                Regex
                <input
                  aria-label="Import regex"
                  value={options.pattern}
                  className={inputClass + " font-mono"}
                  onChange={(event) => update({ pattern: event.target.value })}
                />
              </label>
              <label className="space-y-1 text-xs text-slate-400">
                Match
                <select
                  aria-label="Regex match target"
                  className={inputClass}
                  value={options.matchPath ? "path" : "name"}
                  onChange={(event) =>
                    update({ matchPath: event.target.value === "path" })
                  }
                >
                  <option value="name">Name</option>
                  <option value="path">Relative path</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  className="accent-sky-500"
                  checked={options.matchCase}
                  onChange={(event) =>
                    update({ matchCase: event.target.checked })
                  }
                />{" "}
                Match case
              </label>
            </div>
          )}
          {(error || validation) && (
            <p role="alert" className="text-xs text-rose-300">
              {validation || error}
            </p>
          )}
          <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-950/40">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-3 py-2">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  aria-label="Select all import items"
                  type="checkbox"
                  className="accent-sky-500"
                  disabled={busy || !available.length}
                  checked={
                    available.length > 0 && selected.length === available.length
                  }
                  ref={(element) => {
                    if (element)
                      element.indeterminate =
                        selected.length > 0 &&
                        selected.length < available.length;
                  }}
                  onChange={(event) =>
                    setExcluded(
                      event.target.checked
                        ? new Set()
                        : new Set(available.map((item) => item.path)),
                    )
                  }
                />{" "}
                Preview {!busy && sources.length > 0 && `(${selected.length})`}
              </label>
              {busy && (
                <LoaderCircle
                  aria-label="Loading preview"
                  size={14}
                  className="animate-spin text-sky-400"
                />
              )}
              <input
                aria-label="Search import preview"
                placeholder="Search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setScrollTop(0);
                  if (previewViewport.current) previewViewport.current.scrollTop = 0;
                }}
                className={inputClass + " ml-auto max-w-48 text-xs"}
              />
            </div>
            <div
              ref={previewViewport}
              className="h-60 overflow-y-auto"
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              {busy ? (
                <div className="flex h-full items-center justify-center">
                  <LoaderCircle
                    size={24}
                    className="animate-spin text-slate-500"
                  />
                </div>
              ) : available.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  {sources.length === 0
                    ? "Choose files or folders"
                    : items.length > 0
                      ? "These items are already in the list"
                      : "No matching items"}
                </div>
              ) : (
                <div
                  style={{ height: visible.length * 36, position: "relative" }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: start * 36,
                      width: "100%",
                    }}
                  >
                    {rendered.map((item) => (
                      <label
                        key={item.path}
                        className={cn(
                          "flex h-9 cursor-pointer items-center gap-2 border-b border-slate-800/40 px-3 text-xs hover:bg-slate-800/60",
                          excluded.has(item.path)
                            ? "text-slate-500"
                            : "text-slate-300",
                        )}
                      >
                        <input
                          aria-label={`Import ${item.relativePath}`}
                          type="checkbox"
                          className="accent-sky-500"
                          checked={!excluded.has(item.path)}
                          onChange={(event) =>
                            setExcluded((previous) => {
                              const next = new Set(previous);
                              if (event.target.checked) next.delete(item.path);
                              else next.add(item.path);
                              return next;
                            })
                          }
                        />
                        {item.isDirectory ? (
                          <Folder
                            size={14}
                            className="shrink-0 text-amber-500"
                          />
                        ) : (
                          <File size={14} className="shrink-0 text-blue-400" />
                        )}
                        <span className="truncate" title={item.path}>
                          {item.relativePath}
                        </span>
                        {advanced && (
                          <span className="ml-auto text-slate-500">
                            {item.depth}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 p-4">
          <button className={buttonClass} onClick={onClose}>
            Cancel
          </button>
          <button
            disabled={
              busy ||
              picking ||
              !!validation ||
              !!error ||
              selected.length === 0
            }
            className={
              buttonClass +
              " border-sky-600 bg-sky-600 text-white hover:bg-sky-500"
            }
            onClick={() => {
              onAdd(selected);
              onClose();
            }}
          >
            <Plus size={14} /> Add {selected.length || ""}{" "}
            {selected.length === 1 ? "item" : "items"}
          </button>
        </div>
      </div>
    </div>
  );
}
