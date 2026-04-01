import { build as esbuild } from "esbuild";
import { rm } from "node:fs/promises";
import { build as viteBuild } from "vite";

async function removeStaleContentBundle() {
  await rm(new URL("../dist/content.js", import.meta.url), { force: true });
}

await import("./build-lexicon.mjs");
await viteBuild();
await removeStaleContentBundle();

await esbuild({
  entryPoints: [new URL("../src/content/index.ts", import.meta.url).pathname],
  bundle: true,
  outfile: new URL("../dist/content.js", import.meta.url).pathname,
  format: "iife",
  target: "chrome110",
  platform: "browser",
  legalComments: "none",
});
