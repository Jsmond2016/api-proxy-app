import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const bumpType = process.argv[2] || "patch";
const supportedTypes = new Set(["major", "minor", "patch"]);

if (!supportedTypes.has(bumpType)) {
  console.error(`Unsupported version type: ${bumpType}. Use major, minor, or patch.`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(readFileSync(path.join(root, file), "utf8"));
}

function writeJson(file, value) {
  writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
}

function bumpVersion(version, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid current version: ${version}`);
  let [major, minor, patch] = match.slice(1).map(Number);
  if (type === "major") { major += 1; minor = 0; patch = 0; }
  if (type === "minor") { minor += 1; patch = 0; }
  if (type === "patch") patch += 1;
  return `${major}.${minor}.${patch}`;
}

const packageJson = readJson("package.json");
const nextVersion = bumpVersion(packageJson.version, bumpType);
packageJson.version = nextVersion;
writeJson("package.json", packageJson);

const tauriConfigPath = path.join(root, "src-tauri/tauri.conf.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
tauriConfig.version = nextVersion;
writeJson("src-tauri/tauri.conf.json", tauriConfig);

for (const file of ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
  const filePath = path.join(root, file);
  const content = readFileSync(filePath, "utf8");
  const updated = file.endsWith("Cargo.toml")
    ? content.replace(/^(version\s*=\s*)"[^\"]+"/m, `$1"${nextVersion}"`)
    : content.replace(/(name = "tauri-app"[\s\S]*?version = )"[^\"]+"/, `$1"${nextVersion}"`);
  writeFileSync(filePath, updated);
}

console.log(`Version bumped to ${nextVersion} (${bumpType})`);
execFileSync("node", [path.join(root, "scripts/package-mac.mjs")], { cwd: root, stdio: "inherit" });
