const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

test("version bumps update workspaces, lockfiles, and Snap; checks never write", (context) => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dragabyte-version-"));
  context.after(() => {
    const resolvedDirectory = fs.realpathSync(fixtureDirectory);
    assert.equal(path.dirname(resolvedDirectory), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolvedDirectory).startsWith("dragabyte-version-"));
    fs.rmSync(resolvedDirectory, { recursive: true, force: true });
  });
  const workspaces = ["apps/client", "apps/landing"];
  const writeJson = (file, value) => fs.writeFileSync(path.join(fixtureDirectory, file), JSON.stringify(value));
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(fixtureDirectory, file), "utf8"));

  fs.mkdirSync(path.join(fixtureDirectory, "scripts"));
  fs.mkdirSync(path.join(fixtureDirectory, "apps/client/src-tauri"), { recursive: true });
  fs.mkdirSync(path.join(fixtureDirectory, "apps/landing"), { recursive: true });
  for (const file of ["bump-version.cjs", "sync-version.cjs"]) {
    fs.copyFileSync(path.join(__dirname, file), path.join(fixtureDirectory, "scripts", file));
  }

  writeJson("package.json", { version: "2.3.4", workspaces });
  fs.writeFileSync(path.join(fixtureDirectory, "snapcraft.yaml"), 'name: dragabyte\nversion: "2.3.4"\n');
  for (const workspace of workspaces) {
    writeJson(`${workspace}/package.json`, { version: "2.3.4" });
  }
  const dependency = { version: "9.8.7", integrity: "unchanged" };
  writeJson("package-lock.json", {
    version: "2.3.4",
    lockfileVersion: 3,
    packages: {
      "": { version: "2.3.4", workspaces },
      "apps/client": { version: "2.3.4" },
      "apps/landing": { version: "2.3.4" },
      "node_modules/example": dependency,
    },
  });
  fs.writeFileSync(path.join(fixtureDirectory, "apps/client/src-tauri/Cargo.toml"),
    '[package]\nname = "dragabyte"\nversion = "2.3.4"\n\n[dependencies]\nexample = "9.8.7"\n');
  fs.writeFileSync(path.join(fixtureDirectory, "apps/client/src-tauri/Cargo.lock"),
    'version = 4\n\n[[package]]\nname = "dragabyte"\nversion = "2.3.4"\n\n[[package]]\nname = "example"\nversion = "9.8.7"\n');

  const runScript = (file, ...args) => spawnSync(process.execPath,
    [path.join(fixtureDirectory, "scripts", file), ...args],
    { cwd: path.join(fixtureDirectory, "apps/landing"), encoding: "utf8" });
  for (const [bump, expectedVersion] of [["patch", "2.3.5"], ["minor", "2.4.0"], ["major", "3.0.0"]]) {
    const result = runScript("bump-version.cjs", bump);
    assert.equal(result.status, 0, result.stderr);
    for (const file of ["package.json", ...workspaces.map((workspace) => `${workspace}/package.json`)]) {
      assert.equal(readJson(file).version, expectedVersion);
    }
    const lock = readJson("package-lock.json");
    assert.equal(lock.version, expectedVersion);
    for (const workspace of ["", ...workspaces]) {
      assert.equal(lock.packages[workspace].version, expectedVersion);
    }
    assert.deepEqual(lock.packages["node_modules/example"], dependency);
    assert.match(fs.readFileSync(path.join(fixtureDirectory, "snapcraft.yaml"), "utf8"),
      new RegExp(`^version: "${expectedVersion.replaceAll(".", "\\.")}"$`, "m"));
    for (const file of ["Cargo.toml", "Cargo.lock"]) {
      const content = fs.readFileSync(path.join(fixtureDirectory, "apps/client/src-tauri", file), "utf8");
      assert.ok(content.includes(`name = "dragabyte"\nversion = "${expectedVersion}"`));
      assert.ok(content.includes('"9.8.7"'));
    }
    assert.equal(runScript("sync-version.cjs", "--check").status, 0);
  }

  writeJson("apps/landing/package.json", { version: "0.0.0" });
  const mismatch = runScript("sync-version.cjs", "--check");
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /apps\/landing\/package.json/);
  assert.equal(readJson("apps/landing/package.json").version, "0.0.0");
  assert.equal(runScript("sync-version.cjs").status, 0);
  assert.equal(readJson("apps/landing/package.json").version, "3.0.0");

  const snapPath = path.join(fixtureDirectory, "snapcraft.yaml");
  const staleSnap = 'name: dragabyte\nversion: "0.0.0"\n';
  fs.writeFileSync(snapPath, staleSnap);
  const snapMismatch = runScript("sync-version.cjs", "--check");
  assert.equal(snapMismatch.status, 1);
  assert.match(snapMismatch.stderr, /snapcraft\.yaml/);
  assert.equal(fs.readFileSync(snapPath, "utf8"), staleSnap);
  assert.equal(runScript("sync-version.cjs").status, 0);
  assert.equal(fs.readFileSync(snapPath, "utf8"), 'name: dragabyte\nversion: "3.0.0"\n');
});
