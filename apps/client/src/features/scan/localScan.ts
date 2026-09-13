import { isFolder, relocateEntry, ScanChanges } from "./scanChanges.ts";
import { containsPath, pathKey, relocatePath } from "./scanPaths.ts";
import { ScanUpdateQueue } from "./scanResults.ts";
import type { FilesystemChange, ScanHandlers, ScanOptions, ScanSummary } from "./types.ts";

interface ScanTransport {
  start: (root: string, options: ScanOptions, handlers: ScanHandlers, id: string, scope?: string, signal?: AbortSignal) => Promise<() => void>;
  cancel: (id: string) => Promise<void>;
}

interface ScanTask {
  id: string;
  path: string;
  queue: ScanUpdateQueue;
  controller: AbortController;
  unlisten?: () => void;
  stopped?: boolean;
}

export class LocalScan {
  private readonly changes: ScanChanges;
  private readonly tasks = new Map<string, ScanTask>();
  private disposed = false;
  private operations: Promise<void> = Promise.resolve();

  constructor(
    private readonly id: string,
    root: string,
    private readonly options: ScanOptions,
    private readonly transport: ScanTransport,
    private readonly publish: (summary: ScanSummary | null, scanning: boolean) => void,
    private readonly fail: (message: string) => void,
  ) {
    this.changes = new ScanChanges(root);
  }

  start(): Promise<void> {
    return this.startTask(this.changes.rootPath);
  }

  mutate(change: FilesystemChange, operation: () => Promise<void>): Promise<void> {
    const next = this.operations.then(async () => {
      try {
        await operation();
      } catch (error) {
        if (!this.disposed && change.kind !== "relocate") {
          this.refresh(change.kind === "copy" ? change.newPath : change.path);
        }
        throw error;
      }
      if (!this.disposed) this.applyChange(change);
    });
    this.operations = next.catch(() => undefined);
    return next;
  }

  dispose(): void {
    this.disposed = true;
    for (const task of this.tasks.values()) this.stopTask(task);
    this.tasks.clear();
  }

  private applyChange(received: FilesystemChange): void {
    const root = this.changes.rootPath;
    const change = containsPath(received.path, root) && received.kind === "relocate"
      ? { ...received, path: root, newPath: relocatePath(root, received.path, received.newPath) }
      : containsPath(received.path, root) && received.kind === "delete" ? { ...received, path: root } : received;
    const entry = this.changes.find(change.path);
    if (change.kind === "delete" || change.kind === "relocate") {
      this.stopAffectedTasks(change.path);
      this.changes.replace(change.path, null, true);
    }
    if (change.kind === "relocate") {
      if (pathKey(change.path) === pathKey(root)) this.changes.rootPath = change.newPath;
      if (containsPath(this.changes.rootPath, change.newPath)) {
        const relocated = entry ? relocateEntry(entry, change.newPath) : null;
        this.changes.replace(change.newPath, relocated, true);
        const filters = this.options.filters;
        const pathFilters = filters.includePaths.length || filters.excludePaths.length || filters.includeRegex ||
          filters.excludeRegex || filters.excludeNames.length || (!entry || !isFolder(entry)) &&
          (filters.includeNames.length || filters.includeExtensions.length || filters.excludeExtensions.length);
        if (!entry || isFolder(entry) && entry.state !== "complete" || pathFilters) this.refresh(change.newPath);
      }
    } else if (change.kind === "create") {
      this.changes.replace(change.path, this.changes.emptyFolder(change.path), true);
      const filters = this.options.filters;
      if (filters.excludeNames.length || filters.excludePaths.length || filters.excludeRegex) this.refresh(change.path);
    } else if (change.kind === "copy") {
      this.refresh(change.newPath);
    } else if (change.kind === "refresh") {
      this.refresh(containsPath(change.path, root) ? root : change.path);
    }
    this.publishResults();
  }

  private refresh(path: string): void {
    if (!containsPath(this.changes.rootPath, path)) return;
    this.stopAffectedTasks(path);
    const entry = this.changes.find(path);
    this.changes.replace(path, entry && isFolder(entry)
      ? { ...entry, state: "scanning", readState: "scanning" }
      : entry, true);
    void this.startTask(path, path);
  }

  private async startTask(path: string, scope?: string): Promise<void> {
    const id = scope ? crypto.randomUUID() : this.id;
    const durationOffset = scope ? this.changes.snapshot()?.durationMs ?? 0 : 0;
    const task: ScanTask = {
      id, path, controller: new AbortController(),
      queue: new ScanUpdateQueue(id, (summary, kind) => {
        if (this.disposed || this.tasks.get(id) !== task) return;
        if (scope) {
          this.changes.trackDuration(durationOffset + summary.durationMs);
          const entry = summary.root.children.find((child) => pathKey(child.path) === pathKey(scope)) ??
            summary.root.files.find((file) => pathKey(file.path) === pathKey(scope)) ?? null;
          this.changes.replace(scope, entry);
        } else this.changes.update(summary);
        if (kind !== "progress") {
          this.tasks.delete(id);
          task.unlisten?.();
        }
        this.publishResults();
      }, (message) => this.taskFailed(task, message, scope)),
    };
    this.tasks.set(id, task);
    this.publishResults();
    try {
      const unlisten = await this.transport.start(this.changes.rootPath, this.options, {
        onProgress: (update) => task.queue.push(update, "progress"),
        onComplete: (update) => task.queue.push(update, "complete"),
        onCancel: (update) => task.queue.push(update, "cancelled"),
        onError: (message) => this.taskFailed(task, message, scope),
      }, id, scope, task.controller.signal);
      if (this.tasks.get(id) === task) task.unlisten = unlisten;
      else {
        unlisten();
        if (task.stopped) void this.transport.cancel(id).catch((error: unknown) => this.fail(String(error)));
      }
    } catch (error) {
      this.taskFailed(task, error instanceof Error ? error.message : String(error), scope);
    }
  }

  private taskFailed(task: ScanTask, message: string, scope?: string): void {
    if (this.disposed || this.tasks.get(task.id) !== task) return;
    this.tasks.delete(task.id);
    task.queue.dispose();
    task.unlisten?.();
    const path = scope ?? this.changes.rootPath;
    this.changes.interrupt(path);
    this.fail(message);
    this.publishResults();
  }

  private stopAffectedTasks(path: string): void {
    for (const [id, task] of this.tasks) {
      if (!containsPath(path, task.path)) continue;
      this.tasks.delete(id);
      this.stopTask(task);
    }
  }

  private stopTask(task: ScanTask): void {
    task.stopped = true;
    task.controller.abort();
    task.queue.dispose();
    task.unlisten?.();
    void this.transport.cancel(task.id).catch((error: unknown) => this.fail(String(error)));
  }

  private publishResults(): void {
    if (!this.disposed) this.publish(this.changes.snapshot(), this.tasks.size > 0);
  }
}
