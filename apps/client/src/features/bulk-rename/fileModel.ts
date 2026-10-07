import { applyRules } from "./renameLogic.ts";
import type {
  FileItem,
  FilterRule,
  ImportItem,
  RenameOutcome,
  RenameRule,
  SortKey,
} from "./types.ts";

export function getPathDirectory(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (index < 0) return "";
  if (index === 0) return normalized.slice(0, 1);
  const directory = normalized.slice(0, index);
  return /^[A-Za-z]:$/.test(directory)
    ? directory + normalized[index]
    : directory;
}

export function destinationPath(file: FileItem): string {
  if (!file.directory) return file.newName;
  const separator = file.directory.includes("\\") ? "\\" : "/";
  return (
    file.directory +
    (/[\\/]$/.test(file.directory) ? "" : separator) +
    file.newName
  );
}

export function buildFileItem(item: ImportItem): FileItem {
  return {
    id: crypto.randomUUID(),
    path: item.path,
    directory: getPathDirectory(item.path),
    originalName: item.name,
    newName: item.name,
    size: item.size,
    isDirectory: item.isDirectory,
    status: "pending",
    renameMode: "auto",
  };
}

function matchesFilter(name: string, rule: FilterRule): boolean {
  if (!rule.text) return false;
  if (rule.useRegex) {
    try {
      return new RegExp(rule.text, rule.matchCase ? "" : "i").test(name);
    } catch {
      return false;
    }
  }
  return rule.matchCase
    ? name.includes(rule.text)
    : name.toLowerCase().includes(rule.text.toLowerCase());
}

export function isFileEnabled(file: FileItem, filters: FilterRule[]): boolean {
  if (file.renameMode === "disabled") return false;
  if (file.renameMode === "enabled") return true;
  const active = filters.filter((rule) => rule.active && rule.text);
  if (
    active.some(
      (rule) =>
        rule.type === "exclude" && matchesFilter(file.originalName, rule),
    )
  )
    return false;
  const includes = active.filter((rule) => rule.type === "include");
  return (
    includes.length === 0 ||
    includes.some((rule) => matchesFilter(file.originalName, rule))
  );
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
function extension(file: FileItem): string {
  const index = file.originalName.lastIndexOf(".");
  return file.isDirectory || index <= 0
    ? ""
    : file.originalName.slice(index + 1);
}

export function sortFiles(
  files: FileItem[],
  key: SortKey | null,
  descending: boolean,
): FileItem[] {
  if (!key) return files;
  return [...files].sort((left, right) => {
    const comparison =
      key === "size"
        ? left.size - right.size
        : key === "kind"
          ? Number(!left.isDirectory) - Number(!right.isDirectory)
          : collator.compare(
              key === "extension" ? extension(left) : left[key],
              key === "extension" ? extension(right) : right[key],
            );
    return (
      (comparison || collator.compare(left.originalName, right.originalName)) *
      (descending ? -1 : 1)
    );
  });
}

export function previewFiles(
  files: FileItem[],
  rules: RenameRule[],
  filters: FilterRule[],
): FileItem[] {
  let index = 0;
  return files.map((file) => {
    if (!isFileEnabled(file, filters))
      return { ...file, newName: file.originalName };
    const ruleIndex = index++;
    if (file.status === "success")
      return { ...file, newName: file.originalName };
    return {
      ...file,
      newName: applyRules(
        file.originalName,
        rules,
        ruleIndex,
        file.isDirectory,
      ),
    };
  });
}

export function applyRenameOutcomes(
  files: FileItem[],
  outcomes: RenameOutcome[],
): FileItem[] {
  const results = new Map(outcomes.map((outcome) => [outcome.path, outcome]));
  const moves = outcomes
    .filter((outcome) => !outcome.error)
    .sort((a, b) => b.path.length - a.path.length);
  return files.map((file) => {
    const result = results.get(file.path);
    const move = moves.find(
      (outcome) =>
        file.path === outcome.path ||
        file.path.startsWith(outcome.path + "/") ||
        file.path.startsWith(outcome.path + "\\"),
    );
    const path = move
      ? move.newPath + file.path.slice(move.path.length)
      : file.path;
    const name = path.split(/[\\/]/).at(-1) ?? file.originalName;
    return {
      ...file,
      path,
      directory: getPathDirectory(path),
      originalName: name,
      newName: name,
      status: result ? (result.error ? "error" : "success") : file.status,
      error: result ? result.error ?? undefined : file.error,
    };
  });
}
