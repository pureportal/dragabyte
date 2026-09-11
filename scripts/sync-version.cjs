const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = path.resolve(__dirname, "..");
const isCheck = process.argv.includes("--check");
const rootPackage = JSON.parse(fs.readFileSync(path.join(rootDirectory, "package.json"), "utf8"));
const nextVersion = rootPackage.version;
const updates = [];

for (const workspace of rootPackage.workspaces) {
  const file = `${workspace}/package.json`;
  const data = JSON.parse(fs.readFileSync(path.join(rootDirectory, file), "utf8"));
  if (data.version !== nextVersion) {
    data.version = nextVersion;
    updates.push({ file, content: JSON.stringify(data, null, 2) + "\n" });
  }
}

const lockFile = "package-lock.json";
const lockData = JSON.parse(fs.readFileSync(path.join(rootDirectory, lockFile), "utf8"));
const lockEntries = [lockData, lockData.packages[""], ...rootPackage.workspaces.map((workspace) => lockData.packages[workspace])];
if (lockEntries.some((entry) => entry.version !== nextVersion)) {
  for (const entry of lockEntries) {
    entry.version = nextVersion;
  }
  updates.push({ file: lockFile, content: JSON.stringify(lockData, null, 2) + "\n" });
}

const versionedTextFiles = [
  {
    file: "snapcraft.yaml",
    pattern: /(^version:\s*")([^"]+)(")/m,
  },
  {
    file: "apps/client/src-tauri/Cargo.toml",
    pattern: /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
  },
  {
    file: "apps/client/src-tauri/Cargo.lock",
    pattern: /(^name = "dragabyte"\r?\nversion = ")([^"]+)(")/m,
  },
];

for (const { file, pattern } of versionedTextFiles) {
  const content = fs.readFileSync(path.join(rootDirectory, file), "utf8");
  const match = content.match(pattern);
  if (!match) {
    throw new Error(`Dragabyte version not found in ${file}`);
  }
  if (match[2] !== nextVersion) {
    updates.push({
      file,
      content: content.replace(pattern, (_match, prefix, _version, suffix) => `${prefix}${nextVersion}${suffix}`),
    });
  }
}

if (isCheck && updates.length > 0) {
  process.stderr.write(`Expected version ${nextVersion} in: ${updates.map(({ file }) => file).join(", ")}\n`);
  process.exitCode = 1;
} else {
  for (const { file, content } of updates) {
    fs.writeFileSync(path.join(rootDirectory, file), content);
  }
  process.stdout.write(updates.length > 0 ? `Synced versions to ${nextVersion}.\n` : "Versions already match.\n");
}
