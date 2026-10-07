import { open } from "@tauri-apps/plugin-dialog";
import { LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { ConfirmModal } from "../../components/ConfirmModal";
import { toErrorMessage } from "../../lib/utils";
import { FolderPreview } from "./FolderPreview";
import { FolderSidebar, folderButtonClass } from "./FolderSidebar";
import { buildOptions } from "./model";
import { useEmptyFolderPreferences } from "./store";
import type { EmptyFolderSettings } from "./types";
import { useEmptyFolders } from "./useEmptyFolders";

export default function EmptyFoldersView() {
  const { sources, settings, setSources, setSettings } =
    useEmptyFolderPreferences();
  const folders = useEmptyFolders();
  const [picking, setPicking] = useState(false);
  const [confirmation, setConfirmation] = useState<number | null>(null);
  const validation = buildOptions(settings);
  const busy = folders.activity !== null;
  const changeSources = (next: string[]) => {
    if (
      next.length === sources.length &&
      next.every((source, index) => source === sources[index])
    )
      return;
    folders.invalidate();
    setSources(next);
  };
  const changeSettings = (next: EmptyFolderSettings) => {
    if (
      Object.entries(next).every(
        ([key, value]) => settings[key as keyof EmptyFolderSettings] === value,
      )
    )
      return;
    folders.invalidate();
    setSettings(next);
  };
  const browse = async () => {
    setPicking(true);
    try {
      const result = await open({ directory: true, multiple: true });
      if (result)
        changeSources([
          ...new Set([
            ...sources,
            ...(Array.isArray(result) ? result : [result]),
          ]),
        ]);
    } catch (error) {
      folders.setError(toErrorMessage(error));
    } finally {
      setPicking(false);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-800 text-slate-200 [color-scheme:dark] md:flex-row">
      <div className="flex min-h-48 min-w-0 flex-1 flex-col md:min-h-0">
        <FolderPreview
          key={folders.previewId || "pending"}
          preview={folders.preview}
          selected={folders.selected}
          outcomes={folders.outcomes}
          busy={busy}
          canRemove={!!folders.previewId}
          onSelect={folders.select}
          onRemove={setConfirmation}
        />
        {folders.error && (
          <div
            role="alert"
            className="flex items-center gap-2 border-t border-rose-900/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300"
          >
            <span className="flex-1">{folders.error}</span>
            <button
              aria-label="Dismiss error"
              onClick={() => folders.setError("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {(busy || folders.result) && (
          <div
            role="status"
            className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-800 px-3 py-2 text-xs text-slate-300"
          >
            {busy ? (
              <>
                <LoaderCircle size={14} className="animate-spin text-sky-400" />
                <span>
                  {folders.activity === "finding"
                    ? `${folders.progress?.processed ?? 0} folders checked · ${folders.progress?.found ?? 0} found`
                    : `${folders.progress?.processed ?? 0} of ${folders.progress?.total ?? folders.selected.size} folders processed`}
                </span>
                <button
                  className={folderButtonClass + " ml-auto"}
                  onClick={() => void folders.cancel()}
                >
                  Cancel
                </button>
                {folders.progress?.path && (
                  <span
                    className="w-full truncate text-slate-500"
                    title={folders.progress.path}
                  >
                    {folders.progress.path}
                  </span>
                )}
              </>
            ) : (
              folders.result
            )}
          </div>
        )}
      </div>
      <FolderSidebar
        sources={sources}
        settings={settings}
        busy={busy}
        picking={picking}
        validation={validation.error}
        onSources={changeSources}
        onSettings={changeSettings}
        onBrowse={() => void browse()}
        onFind={() => {
          if (validation.options)
            void folders.find(sources, validation.options);
        }}
      />
      <ConfirmModal
        isOpen={confirmation !== null}
        title="Remove empty folders?"
        message={`Permanently remove ${folders.selected.size} selected ${folders.selected.size === 1 ? "folder" : "folders"}?${confirmation ? ` ${confirmation} ${confirmation === 1 ? "is" : "are"} hidden by the search.` : ""}`}
        confirmLabel="Remove folders"
        isDestructive
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          setConfirmation(null);
          if (!busy && folders.previewId && folders.selected.size)
            void folders.remove();
        }}
      />
    </div>
  );
}
