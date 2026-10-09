// Writes syms.json ({ label: "BB:AAAA" }) from the explorer database (labels only, no ROM data).
//   node gen-syms.mjs <out.json>
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../../packages/rom/src/generated/explorer-db.ts", import.meta.url), "utf8");
const db = JSON.parse(src.slice(src.indexOf('"'), src.lastIndexOf('"') + 1));
const lines = db.split("\n");
const out = {};
for (const l of lines.slice(lines.indexOf("#labels") + 1)) {
  const m = /^([0-9A-Fa-f]{2})([0-9A-Fa-f]{4})\S*\s+(\S+)$/.exec(l);
  if (m) out[m[3]] = `${m[1]}:${m[2]}`.toUpperCase();
}
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(Object.keys(out).length, "labels");
