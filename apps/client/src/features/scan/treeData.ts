import type { FlatNode, ScanNode } from "./types.ts";

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

export const buildTreeItems = (
  root: ScanNode,
  expanded: Set<string>,
  showFiles: boolean,
  hideEmptyFolders: boolean,
): FlatNode[] => {
  const result: FlatNode[] = [];
  const stack: TreeFrame[] = [];
  const appendFolder = (node: ScanNode, depth: number): void => {
    if (depth > 0 && hideEmptyFolders && isEmptyFolder(node)) return;
    result.push({
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
      frame.fileIndex += 1;
      result.push({
        kind: "file",
        depth: frame.depth + 1,
        path: file.path,
        name: file.name,
        sizeBytes: file.sizeBytes,
        hasChildren: false,
        file,
        parentPath: frame.node.path,
      });
    } else if (folder) {
      frame.folderIndex += 1;
      appendFolder(folder, frame.depth + 1);
    } else {
      stack.pop();
    }
  }
  return result;
};
