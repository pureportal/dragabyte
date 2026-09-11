const fs = require("node:fs");
const path = require("node:path");

const bumpType = process.argv[2];
const validTypes = new Set(["patch", "minor", "major"]);

if (!validTypes.has(bumpType)) {
  throw new Error("Usage: node scripts/bump-version.cjs <patch|minor|major>");
}

const packageJsonPath = path.resolve(__dirname, "..", "package.json");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const currentVersion = packageJson.version;

const versionMatch = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(currentVersion);
if (!versionMatch) {
  throw new Error(`Invalid version in package.json: ${currentVersion}`);
}

const major = Number(versionMatch[1]);
const minor = Number(versionMatch[2]);
const patch = Number(versionMatch[3]);

let nextVersion = currentVersion;
if (bumpType === "patch") {
  nextVersion = `${major}.${minor}.${patch + 1}`;
}
if (bumpType === "minor") {
  nextVersion = `${major}.${minor + 1}.0`;
}
if (bumpType === "major") {
  nextVersion = `${major + 1}.0.0`;
}

packageJson.version = nextVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
require("./sync-version.cjs");

process.stdout.write(`Version bumped ${currentVersion} -> ${nextVersion}\n`);
