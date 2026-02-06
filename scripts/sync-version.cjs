const fs = require("fs");
const path = require("path");

const isCheck = process.argv.includes("--check");

const packageJsonPath = path.join(process.cwd(), "package.json");
const cargoTomlPath = path.join(process.cwd(), "src-tauri", "Cargo.toml");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");

const packageSectionMatch = cargoToml.match(/\[package\][\s\S]*?(?=\n\[|$)/);
if (!packageSectionMatch) {
  throw new Error("[package] section not found in Cargo.toml");
}

const packageSection = packageSectionMatch[0];
const versionMatch = packageSection.match(/^version\s*=\s*"([^"]+)"/m);
if (!versionMatch) {
  throw new Error("version not found in [package] section of Cargo.toml");
}

const cargoVersion = versionMatch[1];
const nextVersion = packageJson.version;

if (cargoVersion === nextVersion) {
  process.stdout.write("Versions already match.\n");
  process.exit(0);
}

if (isCheck) {
  process.stderr.write(
    `Version mismatch: package.json=${nextVersion} Cargo.toml=${cargoVersion}\n`,
  );
  process.exit(1);
}

const updatedSection = packageSection.replace(
  versionMatch[0],
  `version = "${nextVersion}"`,
);
const updatedToml = cargoToml.replace(packageSection, updatedSection);

fs.writeFileSync(cargoTomlPath, updatedToml);
process.stdout.write(
  `Updated Cargo.toml version ${cargoVersion} -> ${nextVersion}\n`,
);
