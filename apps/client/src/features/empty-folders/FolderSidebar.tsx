import { FolderPlus, RotateCcw, Search, X } from "lucide-react";
import { useState } from "react";
import { defaultSettings } from "./model";
import type { EmptyFolderSettings } from "./types";

export const folderInputClass =
  "w-full rounded-sm border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500";
export const folderButtonClass =
  "flex items-center justify-center gap-1.5 rounded-sm border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sky-500";

export function FolderSidebar({
  sources,
  settings,
  busy,
  picking,
  validation,
  onSources,
  onSettings,
  onBrowse,
  onFind,
}: {
  sources: string[];
  settings: EmptyFolderSettings;
  busy: boolean;
  picking: boolean;
  validation: string;
  onSources: (sources: string[]) => void;
  onSettings: (settings: EmptyFolderSettings) => void;
  onBrowse: () => void;
  onFind: () => void;
}) {
  const [path, setPath] = useState("");
  const update = (patch: Partial<EmptyFolderSettings>) =>
    onSettings({ ...settings, ...patch });
  const addPath = () => {
    const source = path.trim().replace(/^"|"$/g, "");
    if (!source) return;
    onSources([...new Set([...sources, source])]);
    setPath("");
  };
  const textFilters = [
    ["includeNames", "Include names"],
    ["excludeNames", "Exclude names"],
    ["includePaths", "Include paths"],
    ["excludePaths", "Exclude paths"],
  ] as const;
  return (
    <aside aria-label="Folder search options" className="flex max-h-[50%] min-h-0 w-full shrink-0 flex-col border-t border-slate-800 bg-slate-900/30 md:max-h-none md:w-72 md:border-t-0 md:border-l lg:w-80">
      <fieldset
        disabled={busy || picking}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 disabled:opacity-60"
      >
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-100">
            Source folders
          </h2>
          <button className={folderButtonClass + " w-full"} onClick={onBrowse}>
            <FolderPlus size={15} />
            Choose folders
          </button>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addPath();
            }}
          >
            <input
              aria-label="Folder path"
              className={folderInputClass + " min-w-0"}
              placeholder="Folder path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            <button className={folderButtonClass} disabled={!path.trim()}>
              Add
            </button>
          </form>
          {sources.length > 0 && (
            <ul className="max-h-36 space-y-1 overflow-y-auto">
              {sources.map((source) => (
                <li
                  key={source}
                  className="flex items-center gap-1 rounded-sm bg-slate-950/60 px-2 py-1 text-xs text-slate-400"
                >
                  <span className="min-w-0 flex-1 truncate" title={source}>
                    {source}
                  </span>
                  <button
                    className="p-1 hover:text-rose-300"
                    aria-label={`Remove source ${source}`}
                    onClick={() =>
                      onSources(sources.filter((value) => value !== source))
                    }
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-3 border-t border-slate-800 pt-4">
          <h2 className="text-sm font-semibold text-slate-100">Search</h2>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-sky-500"
              checked={settings.maxDepth !== "1"}
              onChange={(event) =>
                update({
                  maxDepth: event.target.checked ? "" : "1",
                  minDepth: "1",
                })
              }
            />
            Include subfolders
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-sky-500"
              checked={settings.emptyAfterRemoval}
              onChange={(event) =>
                update({ emptyAfterRemoval: event.target.checked })
              }
            />
            Include empty folder chains
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-sky-500"
              checked={settings.includeHidden}
              onChange={(event) =>
                update({ includeHidden: event.target.checked })
              }
            />
            Include hidden folders
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-slate-400">
              Minimum depth
              <input
                aria-label="Minimum depth"
                type="number"
                min="1"
                max="1000"
                className={folderInputClass}
                value={settings.minDepth}
                onChange={(event) => update({ minDepth: event.target.value })}
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              Maximum depth
              <input
                aria-label="Maximum depth"
                type="number"
                min="1"
                max="1000"
                placeholder="Unlimited"
                className={folderInputClass}
                value={settings.maxDepth}
                onChange={(event) => update({ maxDepth: event.target.value })}
              />
            </label>
          </div>
        </section>
        <section className="space-y-3 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Filters</h2>
            <button
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100"
              onClick={() => onSettings({ ...defaultSettings })}
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </div>
          {textFilters.map(([key, label]) => (
            <label key={key} className="block space-y-1 text-xs text-slate-400">
              {label}
              <input
                aria-label={label}
                className={folderInputClass}
                placeholder="Comma-separated"
                value={settings[key]}
                onChange={(event) => update({ [key]: event.target.value })}
              />
            </label>
          ))}
          <details className="space-y-3">
            <summary className="cursor-pointer text-xs text-slate-300">
              Regex and age
            </summary>
            {(
              [
                ["includeRegex", "Include regex"],
                ["excludeRegex", "Exclude regex"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="block space-y-1 text-xs text-slate-400"
              >
                {label}
                <input
                  aria-label={label}
                  className={folderInputClass + " font-mono"}
                  value={settings[key]}
                  onChange={(event) => update({ [key]: event.target.value })}
                />
              </label>
            ))}
            <label className="block space-y-1 text-xs text-slate-400">
              Regex target
              <select
                aria-label="Regex target"
                className={folderInputClass}
                value={settings.regexMatchPath ? "path" : "name"}
                onChange={(event) =>
                  update({ regexMatchPath: event.target.value === "path" })
                }
              >
                <option value="name">Name</option>
                <option value="path">Relative path</option>
              </select>
            </label>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="mb-2 text-xs text-slate-400">
                Modified age (days)
              </legend>
              <label className="space-y-1 text-xs text-slate-400">
                Minimum
                <input
                  aria-label="Minimum age (days)"
                  type="number"
                  min="0"
                  step="any"
                  className={folderInputClass}
                  value={settings.minAgeDays}
                  onChange={(event) =>
                    update({ minAgeDays: event.target.value })
                  }
                />
              </label>
              <label className="space-y-1 text-xs text-slate-400">
                Maximum
                <input
                  aria-label="Maximum age (days)"
                  type="number"
                  min="0"
                  step="any"
                  className={folderInputClass}
                  value={settings.maxAgeDays}
                  onChange={(event) =>
                    update({ maxAgeDays: event.target.value })
                  }
                />
              </label>
            </fieldset>
          </details>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-sky-500"
              checked={settings.matchCase}
              onChange={(event) => update({ matchCase: event.target.checked })}
            />
            Match case
          </label>
        </section>
      </fieldset>
      <div className="shrink-0 space-y-2 border-t border-slate-800 p-4">
        {validation && (
          <p role="alert" className="text-xs text-rose-300">
            {validation}
          </p>
        )}
        <button
          disabled={busy || picking || !sources.length || !!validation}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
          onClick={onFind}
        >
          <Search size={15} />
          Find empty folders
        </button>
      </div>
    </aside>
  );
}
