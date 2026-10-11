// Builds the relief editor's own mesh (shape.ts) from predicted normals. stdin JSON → stdout binary.
import { mapRelief, pictureRelief } from "/home/user/pokeHD/apps/web/src/client/tools/relief/shape.ts";
const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const j = JSON.parse(Buffer.concat(chunks).toString());
const { w, h } = j;
const N = (x: number, y: number) => { const i = (y * w + x) * 3; return [j.n[i], j.n[i + 1], j.n[i + 2]] as [number, number, number]; };
const C = (x: number, y: number) => { const i = (y * w + x) * 3; return [j.c[i], j.c[i + 1], j.c[i + 2]] as [number, number, number]; };
const m = j.kind === "map"
  ? mapRelief({ width: w, height: h, normal: N, colour: C, ground: (x, y) => j.g[y * w + x] === 1 }, { sides: true, mirror: true })
  : pictureRelief({ width: w, height: h, inside: (x, y) => j.g[y * w + x] === 1, normal: N, colour: C }, j.depth ?? 1);
const out = new Float32Array(m.positions.length * 3);
const n = m.positions.length / 3;
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
  out[i * 9 + k] = m.positions[i * 3 + k]!; out[i * 9 + 3 + k] = m.normals[i * 3 + k]!; out[i * 9 + 6 + k] = m.colours[i * 3 + k]!;
}
process.stdout.write(Buffer.from(out.buffer));
