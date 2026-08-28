import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const bundleDirectory = path.join(root, "src-tauri", "target", "release", "bundle");
const appPath = path.join(bundleDirectory, "macos", "Apifox Proxy.app");
const architecture = process.arch === "arm64" ? "aarch64" : process.arch;
const outputPath = path.join(bundleDirectory, "dmg", `Apifox Proxy_${packageJson.version}_${architecture}.dmg`);
const stagingDirectory = mkdtempSync(path.join(os.tmpdir(), "apifox-proxy-dmg-"));

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

try {
  run("pnpm", ["tauri", "build", "--bundles", "app"]);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  cpSync(appPath, path.join(stagingDirectory, "Apifox Proxy.app"), { recursive: true });
  symlinkSync("/Applications", path.join(stagingDirectory, "Applications"));
  run("hdiutil", ["create", "-volname", "Apifox Proxy", "-srcfolder", stagingDirectory, "-ov", "-format", "UDZO", outputPath]);
  console.log(`DMG created: ${outputPath}`);
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}
