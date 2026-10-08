// Fails the build if the app's first download grows: the entry script and what index.html
// preloads with it, before the game chunk (three.js, the emulator) arrives. Run after vite build.
import { readFileSync, statSync } from "node:fs";

const DIST = new URL("../apps/web/dist/client/", import.meta.url);
/** Raw (not gzipped) bytes. React alone is ~220 KB; the app shell is ~50 KB. */
const BUDGET = 350_000;

const html = readFileSync(new URL("index.html", DIST), "utf8");
const files = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
const sizes = files.map((f) => ({ f, bytes: statSync(new URL(f, DIST)).size }));
const total = sizes.reduce((sum, s) => sum + s.bytes, 0);
for (const { f, bytes } of sizes) console.log(`  ${(bytes / 1000).toFixed(1).padStart(7)} kB  ${f}`);
console.log(`First download: ${(total / 1000).toFixed(1)} kB of ${BUDGET / 1000} kB budget`);
const three = files.find((f) => /\/three-/.test(f));
if (three) throw new Error(`three.js (${three}) loads before the game: keep it behind the game chunk's import()`);
if (total > BUDGET) throw new Error(`The first download is over budget: lazy-load what was added (see App.tsx)`);
