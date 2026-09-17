import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const ignoredDirectories = new Set([".git", "dist", "node_modules", "target"]);
const ignoredFiles = new Set(["pnpm-lock.yaml", "src-tauri/Cargo.lock", "scripts/check-privacy.mjs"]);
const textExtensions = new Set([".json", ".md", ".mjs", ".rs", ".toml", ".ts", ".tsx"]);
const violations = [];
const rules = [
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token", pattern: /(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { name: "OpenAI key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: "Slack token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "internal domain", pattern: /\b[a-z0-9.-]+\.(?:internal|corp|intra)\b/i },
  { name: "legacy project identifier", pattern: /wx-(?:retail|member)/i },
  { name: "legacy Apifox project", pattern: /Project #981245/ },
  { name: "concrete Mock project URL", pattern: /https:\/\/m1\.apifoxmock\.com\/m1\/\d+/ },
];

collectFiles(projectRoot);

if (violations.length > 0) {
  console.error("Privacy check failed:");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Privacy check passed.");

function collectFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isIgnoredDirectory(fullPath, entry.name)) collectFiles(fullPath);
      continue;
    }
    inspectFile(fullPath);
  }
}

function isIgnoredDirectory(directoryPath, directoryName) {
  if (ignoredDirectories.has(directoryName)) return true;
  const relativePath = path.relative(projectRoot, directoryPath);
  return relativePath === "docs-site/.vitepress/cache" || relativePath === "docs-site/.vitepress/dist";
}

function inspectFile(filePath) {
  const relative = path.relative(projectRoot, filePath);
  if (ignoredFiles.has(relative)) return;
  if (!textExtensions.has(path.extname(filePath))) return;
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, index) => inspectLine(relative, line, index + 1));
}

function inspectLine(relativePath, line, lineNumber) {
  for (const rule of rules) {
    if (rule.pattern.test(line)) {
      violations.push(`${relativePath}:${lineNumber} contains ${rule.name}`);
    }
  }
}
