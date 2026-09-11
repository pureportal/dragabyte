import type { ScanFile, ScanNode, ScanSummary, ScanUpdate } from "./types.ts";

const mergeFiles = (existing: ScanFile[], additions: ScanFile[]): ScanFile[] => {
  additions.sort((a, b) => b.sizeBytes - a.sizeBytes);
  const merged: ScanFile[] = [];
  let current = 0;
  let added = 0;
  while (current < existing.length || added < additions.length) {
    const file = existing[current];
    const next = additions[added];
    if (file && (!next || file.sizeBytes >= next.sizeBytes)) {
      merged.push(file);
      current += 1;
    } else if (next) {
      merged.push(next);
      added += 1;
    }
  }
  return merged;
};

export class ScanResults {
  private readonly nodes = new Map<number, ScanNode>();
  private sequence = 0;

  constructor(private readonly id: string) {}

  apply(updates: ScanUpdate[]): ScanSummary {
    const changed = new Map<number, ScanNode>();
    const files = new Map<number, ScanFile[]>();
    const editNode = (id: number): ScanNode => {
      const draft = changed.get(id);
      if (draft) return draft;
      const node = this.nodes.get(id);
      if (!node) throw new Error("Scan results are incomplete. Scan the folder again.");
      const copy = { ...node, children: [...node.children] };
      changed.set(id, copy);
      let parentId = copy.parentId;
      while (parentId !== null && !changed.has(parentId)) {
        const parent = this.nodes.get(parentId);
        if (!parent) throw new Error("Scan results are incomplete. Scan the folder again.");
        changed.set(parentId, { ...parent, children: [...parent.children] });
        parentId = parent.parentId;
      }
      return copy;
    };

    for (const update of updates) {
      if (update.id !== this.id || update.sequence !== this.sequence) {
        throw new Error("Scan updates arrived out of order. Scan the folder again.");
      }
      this.sequence += 1;
      for (const folder of update.folders) {
        const existing = changed.get(folder.id) ?? this.nodes.get(folder.id);
        if (existing) {
          Object.assign(editNode(folder.id), folder);
        } else {
          const node: ScanNode = { ...folder, files: [], children: [] };
          changed.set(folder.id, node);
          if (folder.parentId !== null) {
            editNode(folder.parentId).children.push(node);
          }
        }
      }
      for (const entry of update.files) {
        const pending = files.get(entry.parentId);
        if (pending) pending.push(entry.file);
        else files.set(entry.parentId, [entry.file]);
      }
    }

    for (const [id, additions] of files) {
      const node = editNode(id);
      node.files = mergeFiles(node.files, additions);
    }
    for (const id of [...changed.keys()].sort((a, b) => b - a)) {
      const node = changed.get(id)!;
      node.children = node.children.map((child) => this.nodes.get(child.id) ?? child);
      this.nodes.set(id, node);
    }
    const root = this.nodes.get(0);
    const latest = updates.at(-1);
    if (!root || !latest) throw new Error("No scan results received. Scan the folder again.");
    return {
      id: this.id,
      root,
      totalBytes: latest.totalBytes,
      fileCount: latest.fileCount,
      dirCount: latest.dirCount,
      largestFiles: latest.largestFiles,
      durationMs: latest.durationMs,
      skippedEntries: latest.skippedEntries,
    };
  }
}

export type ScanUpdateKind = "progress" | "complete" | "cancelled";

export class ScanUpdateQueue {
  private readonly results: ScanResults;
  private readonly pending: { update: ScanUpdate; kind: ScanUpdateKind }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private accepting = true;
  private latest: { summary: ScanSummary; kind: ScanUpdateKind } | null = null;
  private lastPublished = -Infinity;

  constructor(
    private readonly id: string,
    private readonly publish: (summary: ScanSummary, kind: ScanUpdateKind) => void,
    private readonly fail: (message: string) => void,
  ) {
    this.results = new ScanResults(id);
  }

  push(update: ScanUpdate, kind: ScanUpdateKind): void {
    if (!this.accepting || update.id !== this.id) return;
    this.pending.push({ update, kind });
    if (kind !== "progress") this.accepting = false;
    this.timer ??= setTimeout(() => this.flush(), 16);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending.length = 0;
    this.latest = null;
    this.accepting = false;
  }

  private flush(): void {
    this.timer = null;
    const batch = this.pending.splice(0, 4);
    try {
      if (batch.length > 0) {
        const summary = this.results.apply(batch.map(({ update }) => update));
        this.latest = { summary, kind: batch.at(-1)!.kind };
      }
      if (this.latest && (this.latest.kind !== "progress" || Date.now() - this.lastPublished >= 100)) {
        const { summary, kind } = this.latest;
        this.latest = null;
        this.lastPublished = Date.now();
        this.publish(summary, kind);
      }
      if (this.pending.length > 0) this.timer = setTimeout(() => this.flush(), 16);
      else if (this.latest) this.timer = setTimeout(() => this.flush(), Math.max(1, 100 - (Date.now() - this.lastPublished)));
    } catch (error) {
      this.dispose();
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }
}
