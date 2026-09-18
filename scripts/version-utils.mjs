import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");

const cargoPackagePattern = /^(version\s*=\s*)"[^"]+"/m;
const cargoLockPackagePattern = /(name = "tauri-app"[\s\S]*?version = )"([^"]+)"/;
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-(beta|rc)\.(\d+))?$/;
const versionFile = "VERSION";

function resolveProjectFile(file) {
  return path.join(root, file);
}

function readJson(file) {
  return JSON.parse(readFileSync(resolveProjectFile(file), "utf8"));
}

export function getProjectVersion() {
  return readFileSync(resolveProjectFile(versionFile), "utf8").trim();
}

function writeJson(file, value) {
  writeFileSync(resolveProjectFile(file), `${JSON.stringify(value, null, 2)}\n`);
}

export function parseVersion(version) {
  const match = versionPattern.exec(version);

  if (!match) {
    throw new Error(`Unsupported version: ${version}`);
  }

  const [, major, minor, patch, channel, sequence] = match;
  let parsedSequence = null;

  if (sequence) {
    parsedSequence = Number(sequence);
  }

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    channel: channel ?? null,
    sequence: parsedSequence,
  };
}

export function formatVersion(version) {
  const base = `${version.major}.${version.minor}.${version.patch}`;

  if (!version.channel) {
    return base;
  }

  return `${base}-${version.channel}.${version.sequence}`;
}

export function isPrerelease(version) {
  return Boolean(parseVersion(version).channel);
}

export function compareVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  const numericFields = ["major", "minor", "patch"];

  for (const field of numericFields) {
    if (left[field] !== right[field]) {
      if (left[field] > right[field]) {
        return 1;
      }

      return -1;
    }
  }

  if (!left.channel && !right.channel) {
    return 0;
  }

  if (!left.channel) {
    return 1;
  }

  if (!right.channel) {
    return -1;
  }

  const channelOrder = { beta: 0, rc: 1 };

  if (channelOrder[left.channel] !== channelOrder[right.channel]) {
    if (channelOrder[left.channel] > channelOrder[right.channel]) {
      return 1;
    }

    return -1;
  }

  if (left.sequence === right.sequence) {
    return 0;
  }

  if (left.sequence > right.sequence) {
    return 1;
  }

  return -1;
}

export function nextStableVersion(currentVersion, bumpType) {
  const current = parseVersion(currentVersion);

  if (current.channel && !bumpType) {
    return formatVersion({ ...current, channel: null, sequence: null });
  }

  const next = { ...current, channel: null, sequence: null };
  const type = bumpType ?? "patch";

  if (type === "major") {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (type === "minor") {
    next.minor += 1;
    next.patch = 0;
  } else if (type === "patch") {
    next.patch += 1;
  } else {
    throw new Error(`Unsupported version type: ${type}`);
  }

  return formatVersion(next);
}

export function nextPreviewVersion(currentVersion, channel, bumpType) {
  if (channel !== "beta" && channel !== "rc") {
    throw new Error(`Unsupported preview channel: ${channel}`);
  }

  const current = parseVersion(currentVersion);

  if (current.channel === channel && !bumpType) {
    return formatVersion({ ...current, sequence: current.sequence + 1 });
  }

  let base = currentVersion;

  if (current.channel) {
    base = formatVersion({ ...current, channel: null, sequence: null });
  }

  let nextBase = base;

  if (!current.channel || bumpType) {
    nextBase = nextStableVersion(base, bumpType ?? "patch");
  }

  const next = parseVersion(nextBase);
  return formatVersion({ ...next, channel, sequence: 1 });
}

export function readProjectVersions() {
  const packageJson = readJson("package.json");
  const tauriConfig = readJson("src-tauri/tauri.conf.json");
  const cargoToml = readFileSync(resolveProjectFile("src-tauri/Cargo.toml"), "utf8");
  const cargoLock = readFileSync(resolveProjectFile("src-tauri/Cargo.lock"), "utf8");
  const cargoVersion = cargoPackagePattern.exec(cargoToml)?.[0].match(/"([^"]+)"/)?.[1];
  const cargoLockVersion = cargoLockPackagePattern.exec(cargoLock)?.[2];

  if (!cargoVersion || !cargoLockVersion) {
    throw new Error("Unable to read the Tauri package version from Cargo files.");
  }

  return {
    packageJson: packageJson.version,
    tauriConfig: tauriConfig.version,
    cargoToml: cargoVersion,
    cargoLock: cargoLockVersion,
  };
}

export function assertProjectVersionsMatch() {
  const versions = readProjectVersions();
  const sourceVersion = getProjectVersion();
  const uniqueVersions = new Set(Object.values(versions));

  if (uniqueVersions.size !== 1 || sourceVersion !== versions.packageJson) {
    throw new Error(`Version mismatch: ${JSON.stringify({ source: sourceVersion, ...versions })}`);
  }

  parseVersion(versions.packageJson);
  return versions.packageJson;
}

export function updateProjectVersion(version) {
  parseVersion(version);
  writeFileSync(resolveProjectFile(versionFile), `${version}\n`);

  const packageJson = readJson("package.json");
  packageJson.version = version;
  writeJson("package.json", packageJson);

  const tauriConfig = readJson("src-tauri/tauri.conf.json");
  tauriConfig.version = version;
  writeJson("src-tauri/tauri.conf.json", tauriConfig);

  for (const file of ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
    const filePath = resolveProjectFile(file);
    const content = readFileSync(filePath, "utf8");
    let pattern = cargoLockPackagePattern;

    if (file.endsWith("Cargo.toml")) {
      pattern = cargoPackagePattern;
    }

    const replacement = `$1"${version}"`;
    const updated = content.replace(pattern, replacement);

    if (updated === content) {
      throw new Error(`Unable to update version in ${file}.`);
    }

    writeFileSync(filePath, updated);
  }
}
