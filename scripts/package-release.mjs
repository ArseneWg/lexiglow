import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const releaseDir = path.join(root, "release");
const distDir = path.join(root, "dist");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

if (packageJson.version !== manifest.version) {
  throw new Error(`Version mismatch: package.json=${packageJson.version}, manifest.json=${manifest.version}`);
}

const requiredManifestPaths = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
].filter(Boolean);

for (const relativePath of requiredManifestPaths) {
  const fullPath = path.join(root, relativePath);
  try {
    const info = await stat(fullPath);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`Manifest references missing release file: ${relativePath}`);
  }
}

async function collectFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolute, relative));
    } else if (entry.isFile()) {
      files.push({ absolute, relative });
    }
  }

  return files;
}

const releaseEntries = [
  { absolute: path.join(root, "manifest.json"), relative: "manifest.json" },
  ...(await collectFiles(distDir, "dist")),
];

const forbiddenPatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)tests?(\/|$)/i,
  /(^|\/)e2e(\/|$)/i,
  /playwright-report/i,
  /test-results/i,
  /\.trace$/i,
  /(^|\/)\.git(\/|$)/i,
];

for (const entry of releaseEntries) {
  if (forbiddenPatterns.some((pattern) => pattern.test(entry.relative))) {
    throw new Error(`Forbidden file in release package: ${entry.relative}`);
  }
}

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

const stagingDir = path.join(releaseDir, "staging");
await mkdir(path.join(stagingDir, "dist"), { recursive: true });
for (const entry of releaseEntries) {
  const target = path.join(stagingDir, ...entry.relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await readFile(entry.absolute));
}

const zipName = `lexiglow-${packageJson.version}.zip`;
const zipPath = path.join(releaseDir, zipName);

// Use the ubiquitous system zip utility but normalize timestamps first so the
// artifact is reproducible across repeated CI runs on the same source tree.
await execFileAsync("find", [stagingDir, "-exec", "touch", "-t", "198001010000.00", "{}", ";"]);
await execFileAsync("zip", ["-X", "-q", "-r", zipPath, "."], { cwd: stagingDir });

const zipBytes = await readFile(zipPath);
const digest = createHash("sha256").update(zipBytes).digest("hex");
await writeFile(path.join(releaseDir, "SHA256SUMS"), `${digest}  ${zipName}\n`, "utf8");
await rm(stagingDir, { recursive: true, force: true });

console.log(`Release artifact: ${zipPath}`);
console.log(`SHA256: ${digest}`);
console.log(`Entries: ${releaseEntries.length}`);
