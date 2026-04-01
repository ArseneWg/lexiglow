import { mkdir, writeFile } from "node:fs/promises";

const targetUrl =
  "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt";
const targetPath = new URL("../data/google-10000-english.txt", import.meta.url);

const response = await fetch(targetUrl);

if (!response.ok) {
  throw new Error(`Failed to download lexicon: ${response.status} ${response.statusText}`);
}

const content = await response.text();
await mkdir(new URL("../data", import.meta.url), { recursive: true });
await writeFile(targetPath, content, "utf8");

console.log(`Downloaded lexicon to ${targetPath.pathname}`);
