import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { File as FileIcon, Folder, FolderInput, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "../../lib/utils";
import { getLaunchContext, type LaunchContext } from "../scan/api";
import { ImportDialog, directImportOptions } from "./ImportDialog";
import { RenameFileList } from "./RenameFileList";
import { RenameSidebar } from "./RenameSidebar";
import {
  applyRenameOutcomes,
  buildFileItem,
  destinationPath,
  isFileEnabled,
  previewFiles,
  sortFiles,
} from "./fileModel";
import type {
  FileItem,
  FilterRule,
  ImportItem,
  RenameOutcome,
  RenameRule,
  SortKey,
} from "./types";

const parseContextPaths = (): string[] => {
  const params = new URLSearchParams(window.location.search);
  const single = params.get("path");
  const rawPaths = params.get("paths");
  if (rawPaths) {
    try {
      const parsed = JSON.parse(rawPaths);
      if (Array.isArray(parsed)) {
        return parsed.filter((value) => typeof value === "string");
      }
    } catch {
      return single ? [single] : [];
    }
  }
  return single ? [single] : [];
};

export default function BulkRenameView() {
  const [{ files, rules }, setRenameState] = useState<{
    files: FileItem[];
    rules: RenameRule[];
  }>({ files: [], rules: [] });
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [message, setMessage] = useState("");
  const [sort, setSort] = useState<{
    key: SortKey | null;
    descending: boolean;
  }>({ key: null, descending: false });
  const applying = useRef(false);

  const updateRules = (nextRules: RenameRule[]): void => {
    setRenameState((previous) => ({
      rules: nextRules,
      files: previous.files.map((file) => ({
        ...file,
        status: "pending",
        error: undefined,
      })),
    }));
  };

  const preview = useMemo(
    () =>
      previewFiles(
        sortFiles(files, sort.key, sort.descending),
        rules,
        filterRules,
      ),
    [files, sort, rules, filterRules],
  );
  const changes = preview.filter(
    (file) =>
      isFileEnabled(file, filterRules) && file.originalName !== file.newName,
  );
  const existingPaths = useMemo(
    () => new Set(files.map((file) => file.path)),
    [files],
  );

  const mergeItems = useCallback((incoming: ImportItem[]): void => {
    if (applying.current || incoming.length === 0) return;
    setRenameState((previous) => {
      const existing = new Set(previous.files.map((file) => file.path));
      const added: FileItem[] = [];
      for (const item of incoming) {
        if (existing.has(item.path)) continue;
        existing.add(item.path);
        added.push(buildFileItem(item));
      }
      return { ...previous, files: [...previous.files, ...added] };
    });
    setMessage("");
  }, []);

  const loadContextItems = useCallback(
    async (paths: string[], contents = false): Promise<void> => {
      setIsLoading(true);
      try {
        const items = await invoke<ImportItem[]>("collect_rename_items", {
          paths,
          options: contents
            ? {
                ...directImportOptions,
                contents: true,
                minDepth: 1,
                maxDepth: 1,
              }
            : directImportOptions,
        });
        mergeItems(items);
      } catch (error) {
        setMessage(toErrorMessage(error));
      } finally {
        setIsLoading(false);
      }
    },
    [mergeItems],
  );

  const loadRenameLaunchContext = useCallback(
    (context: LaunchContext): void => {
      if (context.mode === "rename" && context.paths.length > 0)
        void loadContextItems(context.paths, true);
    },
    [loadContextItems],
  );

  useEffect(() => {
    getLaunchContext()
      .then((context) => {
        const paths = parseContextPaths();
        if (paths.length > 0) void loadContextItems(paths, true);
        else loadRenameLaunchContext(context);
      })
      .catch((error) => setMessage(toErrorMessage(error)));
  }, [loadContextItems, loadRenameLaunchContext]);

  useEffect(() => {
    let active = true;
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (active && event.payload.type === "drop" && !applying.current)
        void loadContextItems(event.payload.paths);
    });
    unlisten.catch((error) => setMessage(toErrorMessage(error)));
    return () => {
      active = false;
      void unlisten.then((stop) => stop()).catch(console.error);
    };
  }, [loadContextItems]);

  const pickItems = async (directory: boolean) => {
    setIsLoading(true);
    try {
      const selected = await open({ multiple: true, directory });
      if (selected)
        await loadContextItems(Array.isArray(selected) ? selected : [selected]);
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const changeMode = (
    ids: Set<string>,
    renameMode: NonNullable<FileItem["renameMode"]>,
  ) => {
    setRenameState((previous) => ({
      ...previous,
      files: previous.files.map((file) =>
        ids.has(file.id) ? { ...file, renameMode } : file,
      ),
    }));
  };

  const removeItems = (ids: Set<string>) => {
    setRenameState((previous) => ({
      ...previous,
      files: previous.files.filter((file) => !ids.has(file.id)),
    }));
  };

  const handleApply = async () => {
    if (applying.current || !changes.length) return;
    applying.current = true;
    setIsApplying(true);
    setMessage("");
    try {
      const outcomes = await invoke<RenameOutcome[]>("batch_rename", {
        items: changes.map((file) => ({
          path: file.path,
          new_path: destinationPath(file),
        })),
      });
      setRenameState((previous) => ({
        ...previous,
        files: applyRenameOutcomes(previous.files, outcomes),
      }));
      const failures = outcomes.filter((outcome) => outcome.error);
      if (failures.length)
        setMessage(
          `${failures.length} ${failures.length === 1 ? "item" : "items"} could not be renamed. Check the errors in the list.`,
        );
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      applying.current = false;
      setIsApplying(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row text-slate-200 [color-scheme:dark]">
      {showImport && (
        <ImportDialog
          existingPaths={existingPaths}
          onAdd={mergeItems}
          onClose={() => setShowImport(false)}
        />
      )}

      <div className="min-h-48 flex-1 flex flex-col border-r border-slate-800 min-w-0">
        <div className="min-h-12 shrink-0 border-b border-slate-800 flex flex-wrap items-center px-3 py-2 gap-2 bg-slate-900/50">
          <span className="font-semibold text-slate-100 hidden md:inline">
            Items ({files.length})
          </span>
          <div className="flex-1" />

          <div className="flex bg-slate-800 rounded-sm p-0.5">
            <button
              onClick={() => void pickItems(false)}
              disabled={isApplying || isLoading}
              className="flex items-center gap-1.5 px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded-sm text-xs font-semibold transition-colors"
              title="Add specific files"
            >
              <FileIcon className="w-3.5 h-3.5" />
              Add Files
            </button>
            <div className="w-px bg-slate-900 mx-0.5" />
            <button
              onClick={() => void pickItems(true)}
              disabled={isApplying || isLoading}
              className="flex items-center gap-1.5 px-3 py-1 hover:bg-slate-600 rounded-sm text-xs font-semibold transition-colors"
              title="Add folder (as item to rename)"
            >
              <Folder className="w-3.5 h-3.5" />
              Folder
            </button>
            <div className="w-px bg-slate-900 mx-0.5" />
            <button
              onClick={() => setShowImport(true)}
              disabled={isApplying || isLoading}
              className="flex items-center gap-1.5 px-3 py-1 hover:bg-slate-600 rounded-sm text-xs font-semibold transition-colors"
              title="Import"
            >
              <FolderInput className="w-3.5 h-3.5" />
              Import
            </button>
          </div>

          <button
            onClick={() =>
              setRenameState((previous) => ({ ...previous, files: [] }))
            }
            disabled={isApplying || !files.length}
            aria-label="Clear list"
            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-sm transition-colors"
            title="Clear list"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {message && (
          <div
            role="alert"
            className="flex items-center gap-2 border-b border-rose-900/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300"
          >
            <span className="flex-1">{message}</span>
            <button aria-label="Dismiss error" onClick={() => setMessage("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {files.length === 0 ? (
          <div className="m-4 flex min-h-32 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-800 bg-slate-900/20 text-slate-500">
            <FolderInput size={32} className="opacity-40" />
            <p className="text-sm">
              {isLoading ? "Loading items…" : "Add files or folders"}
            </p>
          </div>
        ) : (
          <RenameFileList
            files={preview}
            filters={filterRules}
            busy={isApplying}
            sortKey={sort.key}
            descending={sort.descending}
            onSort={(key, descending) => setSort({ key, descending })}
            onMode={changeMode}
            onRemove={removeItems}
          />
        )}
      </div>

      <RenameSidebar
        rules={rules}
        filterRules={filterRules}
        updateRules={updateRules}
        setFilterRules={setFilterRules}
        isApplying={isApplying}
        isLoading={isLoading}
        changeCount={changes.length}
        onApply={() => void handleApply()}
      />
    </div>
  );
}
