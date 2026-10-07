import type { ScanFile } from "./types.ts";

export class StoredScanFile implements ScanFile {
  readonly name: string;
  readonly sizeBytes: number;
  readonly modified?: number;
  readonly #directory: string;

  constructor(directory: string, file: Pick<ScanFile, "name" | "sizeBytes" | "modified">) {
    this.#directory = directory;
    this.name = file.name;
    this.sizeBytes = file.sizeBytes;
    if (file.modified !== undefined) this.modified = file.modified;
  }

  get path(): string {
    return this.#directory + this.name;
  }

  toJSON(): ScanFile {
    return {
      path: this.path, name: this.name, sizeBytes: this.sizeBytes,
      ...(this.modified !== undefined ? { modified: this.modified } : {}),
    };
  }
}
