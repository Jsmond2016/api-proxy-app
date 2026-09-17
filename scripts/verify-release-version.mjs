import process from "node:process";
import { assertProjectVersionsMatch, compareVersions, isPrerelease } from "./version-utils.mjs";

function readOption(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

try {
  const version = assertProjectVersionsMatch();
  const expectedTag = readOption("--tag");
  const previousVersion = readOption("--greater-than");

  if (expectedTag && expectedTag !== `v${version}`) {
    throw new Error(`Tag ${expectedTag} does not match project version ${version}.`);
  }

  if (previousVersion && compareVersions(version, previousVersion) <= 0) {
    throw new Error(`Project version ${version} must be greater than ${previousVersion}.`);
  }

  if (process.argv.includes("--github-output")) {
    console.log(`version=${version}`);
    console.log(`tag=v${version}`);
    console.log(`prerelease=${isPrerelease(version)}`);
  } else {
    console.log(`Validated release version ${version}.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
