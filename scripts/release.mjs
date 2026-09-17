import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const bumpType = process.argv[2] || "patch";
execFileSync("node", [path.join(root, "scripts/version.mjs"), "stable", bumpType], { cwd: root, stdio: "inherit" });
execFileSync("node", [path.join(root, "scripts/package-mac.mjs")], { cwd: root, stdio: "inherit" });
