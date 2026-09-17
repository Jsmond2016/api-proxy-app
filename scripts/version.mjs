import { execFileSync } from "node:child_process";
import process from "node:process";
import {
  assertProjectVersionsMatch,
  nextPreviewVersion,
  nextStableVersion,
  root,
  updateProjectVersion,
} from "./version-utils.mjs";

function runGit(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function printUsage() {
  console.error("Usage: pnpm version:stable [major|minor|patch]");
  console.error("       pnpm version:preview <beta|rc> [major|minor|patch]");
  console.error("       pnpm version:tag");
}

function createTag() {
  const version = assertProjectVersionsMatch();
  const tag = `v${version}`;

  try {
    runGit([
      "diff",
      "--quiet",
      "HEAD",
      "--",
      "package.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
    ]);
  } catch {
    throw new Error("Commit the version files before creating a release tag.");
  }

  const existingTag = runGit(["tag", "--list", tag]);

  if (existingTag) {
    throw new Error(`Tag ${tag} already exists.`);
  }

  runGit(["tag", "-a", tag, "-m", `Release ${tag}`]);
  console.log(`Created ${tag}. Push it with: git push origin ${tag}`);
}

function updateVersion(mode, args) {
  const currentVersion = assertProjectVersionsMatch();
  let nextVersion;

  if (mode === "stable") {
    nextVersion = nextStableVersion(currentVersion, args[0]);
  } else if (mode === "preview") {
    nextVersion = nextPreviewVersion(currentVersion, args[0], args[1]);
  } else {
    printUsage();
    process.exitCode = 1;
    return;
  }

  updateProjectVersion(nextVersion);
  console.log(`Version set to ${nextVersion}. Expected tag: v${nextVersion}`);
}

try {
  const [mode, ...args] = process.argv.slice(2);

  if (mode === "tag") {
    createTag();
  } else {
    updateVersion(mode, args);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
