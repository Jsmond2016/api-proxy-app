import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const projectRoot = process.cwd();
const extensions = new Set([".js", ".ts", ".tsx"]);
const ignoredDirectories = new Set([".git", "dist", "node_modules", "target"]);
const violations = [];

function collectSourceFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!isIgnoredDirectory(fullPath, entry.name)) {
        collectSourceFiles(fullPath);
      }
      continue;
    }

    if (extensions.has(path.extname(entry.name))) {
      inspectSourceFile(fullPath);
    }
  }
}

function isIgnoredDirectory(directoryPath, directoryName) {
  if (ignoredDirectories.has(directoryName)) return true;
  const relativePath = path.relative(projectRoot, directoryPath);
  return relativePath === "docs-site/.vitepress/cache" || relativePath === "docs-site/.vitepress/dist";
}

function inspectSourceFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const lineCount = source.split("\n").length;

  if (lineCount > 500) {
    violations.push(`${relativePath(filePath)} has ${lineCount} lines (maximum: 500)`);
  }

  const scriptKind = resolveScriptKind(filePath);
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  inspectNode(sourceFile, filePath);
}

function inspectNode(node, filePath) {
  if (ts.isConditionalExpression(node)) {
    const position = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
    violations.push(`${relativePath(filePath)}:${position.line + 1} uses a ternary expression`);
  }

  ts.forEachChild(node, (child) => inspectNode(child, filePath));
}

function resolveScriptKind(filePath) {
  const extension = path.extname(filePath);

  if (extension === ".tsx") {
    return ts.ScriptKind.TSX;
  }

  if (extension === ".ts") {
    return ts.ScriptKind.TS;
  }

  return ts.ScriptKind.JS;
}

function relativePath(filePath) {
  return path.relative(projectRoot, filePath);
}

collectSourceFiles(projectRoot);

if (violations.length > 0) {
  console.error("Source rule violations:");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Source rules passed.");
