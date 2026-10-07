import type { FlatNode, ScanFile, ScanNode } from "./types.ts";

class FileTreeItem implements FlatNode {
  readonly kind = "file";
  readonly hasChildren = false;

  constructor(readonly depth: number, readonly file: ScanFile, readonly parentPath: string) {}

  get path(): string {
    return this.file.path;
  }

  get name(): string {
    return this.file.name;
  }

  get sizeBytes(): number {
    return this.file.sizeBytes;
  }
}

export const buildNodeMap = (root: ScanNode): Map<string, ScanNode> => {
  const map = new Map<string, ScanNode>();
  const stack: ScanNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    map.set(current.path, current);
    const children = current.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
  return map;
};

export const isEmptyFolder = (node: ScanNode): boolean => {
  return node.state === "complete" && node.sizeBytes === 0 && node.fileCount === 0;
};

interface TreeFrame {
  node: ScanNode;
  depth: number;
  folders: ScanNode[];
  folderIndex: number;
  fileIndex: number;
}

type TreeSegment =
  | { kind: "folder"; start: number; item: FlatNode }
  | { kind: "files"; start: number; depth: number; node: ScanNode; fileStart: number; count: number };

export class TreeItems {
  readonly maxSizeByDepth = new Map<number, number>();
  private readonly segments: TreeSegment[] = [];
  private count = 0;

  get length(): number {
    return this.count;
  }

  appendFolder(item: FlatNode): void {
    this.segments.push({ kind: "folder", start: this.count++, item });
    this.maxSizeByDepth.set(item.depth, Math.max(this.maxSizeByDepth.get(item.depth) ?? 0, item.sizeBytes));
  }

  appendFiles(node: ScanNode, depth: number, fileStart: number, count: number): void {
    this.segments.push({ kind: "files", start: this.count, depth, node, fileStart, count });
    this.count += count;
    this.maxSizeByDepth.set(depth, Math.max(this.maxSizeByDepth.get(depth) ?? 0, node.files[fileStart]!.sizeBytes));
  }

  at(index: number): FlatNode | undefined {
    const position = index < 0 ? this.count + index : index;
    if (position < 0 || position >= this.count) return undefined;
    const segment = this.segments[this.findSegment(position)]!;
    return segment.kind === "folder" ? segment.item :
      new FileTreeItem(segment.depth, segment.node.files[segment.fileStart + position - segment.start]!, segment.node.path);
  }

  slice(start = 0, end = this.count): FlatNode[] {
    const first = start < 0 ? Math.max(0, this.count + start) : Math.min(this.count, start);
    const last = end < 0 ? Math.max(0, this.count + end) : Math.min(this.count, end);
    const rows: FlatNode[] = [];
    let index = first;
    let segmentIndex = this.findSegment(first);
    while (index < last) {
      const segment = this.segments[segmentIndex++]!;
      if (segment.kind === "folder") {
        rows.push(segment.item);
        index += 1;
      } else {
        const limit = Math.min(last, segment.start + segment.count);
        while (index < limit) {
          rows.push(new FileTreeItem(segment.depth, segment.node.files[segment.fileStart + index - segment.start]!, segment.node.path));
          index += 1;
        }
      }
    }
    return rows;
  }

  private findSegment(index: number): number {
    let low = 0;
    let high = this.segments.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.segments[middle]!.start <= index) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }
}

export const buildTreeItems = (
  root: ScanNode | null,
  expanded: Set<string>,
  showFiles: boolean,
  hideEmptyFolders: boolean,
): TreeItems => {
  const result = new TreeItems();
  if (!root) return result;
  const stack: TreeFrame[] = [];
  const appendFolder = (node: ScanNode, depth: number): void => {
    if (depth > 0 && hideEmptyFolders && isEmptyFolder(node)) return;
    result.appendFolder({
      kind: "folder",
      depth,
      path: node.path,
      name: node.name,
      sizeBytes: node.sizeBytes,
      node,
      hasChildren: node.state === "scanning" || node.children.length > 0 ||
        (showFiles && node.files.length > 0),
    });
    if (expanded.has(node.path)) {
      stack.push({
        node,
        depth,
        folders: [...node.children].sort((a, b) => b.sizeBytes - a.sizeBytes),
        folderIndex: 0,
        fileIndex: 0,
      });
    }
  };
  appendFolder(root, 0);
  while (stack.length > 0) {
    const frame = stack.at(-1)!;
    const folder = frame.folders[frame.folderIndex];
    const file = showFiles ? frame.node.files[frame.fileIndex] : undefined;
    if (file && (!folder || file.sizeBytes > folder.sizeBytes)) {
      let low = frame.fileIndex;
      let high = frame.node.files.length;
      if (folder) {
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (frame.node.files[middle]!.sizeBytes > folder.sizeBytes) low = middle + 1;
          else high = middle;
        }
      } else low = high;
      result.appendFiles(frame.node, frame.depth + 1, frame.fileIndex, low - frame.fileIndex);
      frame.fileIndex = low;
    } else if (folder) {
      frame.folderIndex += 1;
      appendFolder(folder, frame.depth + 1);
    } else {
      stack.pop();
    }
  }
  return result;
};
