// Builds the publishable Dex motion tuner: dashboard/dex-motion.html with the Pokédex model
// (apps/web/public/models/pokedex.glb) inlined as base64, written to dashboard/dist/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const page = readFileSync(new URL("dashboard/dex-motion.html", root), "utf8");
const glb = readFileSync(new URL("apps/web/public/models/pokedex.glb", root)).toString("base64");
mkdirSync(new URL("dashboard/dist/", root), { recursive: true });
const out = new URL("dashboard/dist/dex-motion.html", root);
writeFileSync(out, page.replace(">__DEX_GLB__<", `>${glb}<`));
console.log(`wrote ${out.pathname}`);
