import { closeSync, ftruncateSync, mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";

if (!process.argv[2]) {
  throw new Error("Provide a new folder path for the scan fixture.");
}

const root = resolve(process.argv[2]);
mkdirSync(root);
let totalBytes = 0;
let fileCount = 0;
let dirCount = 0;

const createFile = (directory, name, size) => {
  const file = openSync(join(directory, name), "wx");
  try {
    ftruncateSync(file, size);
  } finally {
    closeSync(file);
  }
  totalBytes += size;
  fileCount += 1;
};

for (let group = 0; group < 32; group += 1) {
  const parent = join(root, `g${String(group).padStart(2, "0")}`);
  mkdirSync(parent);
  dirCount += 1;
  for (let child = 0; child < 8; child += 1) {
    const directory = join(parent, `s${String(child).padStart(2, "0")}`);
    mkdirSync(directory);
    dirCount += 1;
    for (let index = 0; index < 128; index += 1) {
      const size = ((group * 8 * 128 + child * 128 + index) % 31 + 1) * 1024;
      createFile(directory, `f${String(index).padStart(3, "0")}.bin`, size);
    }
  }
}

let deep = join(root, "deep");
mkdirSync(deep);
dirCount += 1;
for (let level = 0; level < 96; level += 1) {
  deep = join(deep, "d");
  mkdirSync(deep);
  dirCount += 1;
  createFile(deep, "file.bin", 4096);
}
for (let index = 0; index < 450; index += 1) {
  mkdirSync(join(root, `empty${String(index).padStart(3, "0")}`));
  dirCount += 1;
}
console.log(JSON.stringify({ root, totalBytes, fileCount, dirCount }, null, 2));
