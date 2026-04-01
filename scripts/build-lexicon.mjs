import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourcePath = new URL("../data/google-10000-english.txt", import.meta.url);
const targetPath = new URL("../src/generated/lexicon.ts", import.meta.url);

let content;

try {
  content = await readFile(sourcePath, "utf8");
} catch {
  throw new Error(
    "Missing data/google-10000-english.txt. Run `npm run fetch:lexicon` first.",
  );
}

const words = content
  .split(/\r?\n/)
  .map((line) => line.trim().toLowerCase())
  .filter(Boolean);

await mkdir(new URL("../src/generated", import.meta.url), { recursive: true });

const moduleSource = `export const WORDS = ${JSON.stringify(words, null, 2)} as const;\n`;
await writeFile(targetPath, moduleSource, "utf8");

console.log(`Generated ${words.length} lexicon entries at ${targetPath.pathname}`);
