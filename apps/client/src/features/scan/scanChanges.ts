import { containsPath, parentPath, pathKey, pathName, relocatePath } from "./scanPaths.ts";
import type { ScanFile, ScanNode, ScanSummary } from "./types.ts";

export type ScanEntry = ScanNode | ScanFile;

export const isFolder = (entry: ScanEntry): entry is ScanNode => "children" in entry;

export const relocateEntry = (entry: ScanEntry, destination: string): ScanEntry => {
  const relocateFile = (file: ScanFile): ScanFile => {
    const path = relocatePath(file.path, entry.path, destination);
    return { ...file, path, name: pathName(path) };
  };
  if (!isFolder(entry)) return relocateFile(entry);
  const copies = new Map<ScanNode, ScanNode>();
  const pending = [entry];
  while (pending.length) {
    const node = pending.pop()!;
    const path = relocatePath(node.path, entry.path, destination);
    copies.set(node, { ...node, path, name: pathName(path), files: node.files.map(relocateFile), children: [] });
    for (const child of node.children) pending.push(child);
  }
  for (const [node, copy] of copies) copy.children = node.children.map((child) => copies.get(child)!);
  return copies.get(entry)!;
};

interface Projection {
  node: ScanNode;
  largest: ScanFile[];
  skipped: number;
  revision: number;
}

export class ScanChanges {
  private base: ScanSummary | null = null;
  private readonly entries = new Map<string, ScanEntry | null>();
  private readonly children = new Map<string, Map<string, string>>();
  private readonly revisions = new Map<string, number>();
  private readonly cache = new WeakMap<ScanNode, Projection>();
  private readonly ids = new Map<string, number>();
  private nextId = -1;
  private revision = 0;
  private durationMs = 0;
  rootPath: string;

  constructor(root: string) {
    this.rootPath = root;
  }

  update(summary: ScanSummary): void {
    this.base = summary;
  }

  trackDuration(durationMs: number): void {
    this.durationMs = Math.max(this.durationMs, durationMs);
  }

  interrupt(path: string): void {
    const entry = this.find(path);
    if (!entry || !isFolder(entry)) {
      this.replace(path, entry ?? this.emptyFolder(path, "incomplete"));
      return;
    }
    const copies = new Map<ScanNode, ScanNode>();
    const pending = [entry];
    while (pending.length) {
      const node = pending.pop()!;
      copies.set(node, {
        ...node, state: node.state === "scanning" ? "incomplete" : node.state,
        readState: node.readState === "scanning" ? "incomplete" : node.readState,
      });
      for (const child of node.children) pending.push(child);
    }
    for (const [node, copy] of copies) copy.children = node.children.map((child) => copies.get(child)!);
    const root = copies.get(entry)!;
    this.replace(path, { ...root, state: "incomplete", readState: "incomplete" });
  }

  replace(path: string, entry: ScanEntry | null, clearDescendants = false): void {
    if (clearDescendants) {
      for (const key of this.entries.keys()) {
        if (key !== pathKey(path) && containsPath(path, key)) this.entries.delete(key);
      }
      for (const key of this.children.keys()) {
        if (containsPath(path, key)) this.children.delete(key);
      }
    }
    this.entries.set(pathKey(path), entry);
    this.revision += 1;
    let current: string | null = path;
    while (current && containsPath(this.rootPath, current)) {
      const key = pathKey(current);
      this.revisions.set(key, this.revision);
      const parent = parentPath(current);
      if (parent) {
        let siblings = this.children.get(pathKey(parent));
        if (!siblings) this.children.set(pathKey(parent), siblings = new Map());
        siblings.set(key, current);
      }
      current = parent;
    }
  }

  find(path: string): ScanEntry | null {
    const summary = this.snapshot();
    if (!summary || !containsPath(summary.root.path, path)) return null;
    let node = summary.root;
    while (pathKey(node.path) !== pathKey(path)) {
      const child = node.children.find((entry) => containsPath(entry.path, path));
      if (!child) return node.files.find((file) => pathKey(file.path) === pathKey(path)) ?? null;
      node = child;
    }
    return node;
  }

  emptyFolder(path: string, state: ScanNode["readState"] = "complete"): ScanNode {
    const key = pathKey(path);
    let id = this.ids.get(key);
    if (id === undefined) this.ids.set(key, id = this.nextId--);
    return {
      id, parentId: null, path, name: pathName(path), sizeBytes: 0, fileCount: 0, dirCount: 0,
      state, readState: state, skippedEntries: 0, children: [], files: [],
    };
  }

  snapshot(): ScanSummary | null {
    if (!this.base) return null;
    const root = this.resolve(this.rootPath, this.base.root);
    if (!root || !isFolder(root)) return null;
    const projected = new Map<ScanNode, Projection>();
    const stack: { node: ScanNode; visited: boolean; children?: ScanNode[]; files?: ScanFile[] }[] = [{ node: root, visited: false }];
    while (stack.length) {
      const frame = stack.pop()!;
      const node = frame.node;
      const key = pathKey(node.path);
      if (!this.ids.has(key)) this.ids.set(key, this.nextId--);
      const revision = this.revisions.get(key) ?? 0;
      const cached = this.cache.get(node);
      if (cached?.revision === revision) {
        projected.set(node, cached);
        continue;
      }
      if (!frame.visited) {
        if (!this.children.has(key)) {
          stack.push({ node, visited: true, children: node.children, files: node.files });
          for (const child of node.children) stack.push({ node: child, visited: false });
          continue;
        }
        const entries = new Map<string, ScanEntry>();
        for (const entry of [...node.children, ...node.files]) entries.set(pathKey(entry.path), entry);
        for (const [childKey, path] of this.children.get(key) ?? []) {
          const replacement = this.resolve(path, entries.get(childKey));
          if (replacement) entries.set(childKey, replacement);
          else entries.delete(childKey);
        }
        const children: ScanNode[] = [];
        const files: ScanFile[] = [];
        for (const entry of entries.values()) {
          if (isFolder(entry)) children.push(entry);
          else files.push(entry);
        }
        stack.push({ node, visited: true, children, files });
        for (const child of children) stack.push({ node: child, visited: false });
        continue;
      }
      const childResults = frame.children!.map((child) => projected.get(child)!);
      const files = frame.files === node.files ? node.files : frame.files!.sort((a, b) => b.sizeBytes - a.sizeBytes);
      const children = childResults.map((child) => child.node);
      const state = node.readState === "scanning" || children.some((child) => child.state === "scanning")
        ? "scanning"
        : node.readState === "incomplete" || children.some((child) => child.state === "incomplete") ? "incomplete" : "complete";
      const largest = files.slice(0, 100).filter((file) => file.sizeBytes > 0);
      for (const child of childResults) {
        largest.push(...child.largest);
        largest.sort((a, b) => b.sizeBytes - a.sizeBytes);
        largest.length = Math.min(100, largest.length);
      }
      const id = this.ids.get(key)!;
      const result: Projection = {
        revision, largest, skipped: node.skippedEntries + childResults.reduce((sum, child) => sum + child.skipped, 0),
        node: {
          ...node, id, files, children, state,
          parentId: pathKey(node.path) === pathKey(this.rootPath) ? null : this.ids.get(pathKey(parentPath(node.path)!))!,
          sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0) + children.reduce((sum, child) => sum + child.sizeBytes, 0),
          fileCount: files.length + children.reduce((sum, child) => sum + child.fileCount, 0),
          dirCount: children.length + children.reduce((sum, child) => sum + child.dirCount, 0),
        },
      };
      this.cache.set(node, result);
      projected.set(node, result);
    }
    const result = projected.get(root)!;
    return {
      ...this.base, root: result.node, totalBytes: result.node.sizeBytes, fileCount: result.node.fileCount,
      durationMs: Math.max(this.base.durationMs, this.durationMs),
      dirCount: result.node.dirCount, skippedEntries: result.skipped, largestFiles: result.largest,
    };
  }

  private resolve(path: string, existing?: ScanEntry): ScanEntry | null {
    const key = pathKey(path);
    if (this.entries.has(key)) return this.entries.get(key)!;
    if (existing) return existing;
    const pending = [key];
    while (pending.length) {
      const parent = pending.pop()!;
      for (const child of this.children.get(parent)?.keys() ?? []) {
        if (this.entries.has(child)) {
          if (this.entries.get(child)) return this.emptyFolder(path, this.base?.root.state === "scanning" ? "scanning" : "complete");
        } else pending.push(child);
      }
    }
    return null;
  }
}
