// Meshes a grid of column heights into tops and walls, merging runs of equal cells so flat areas
// stay cheap. Used for the voxel ground (grid on the ground plane, height up) and for extruded
// pixel props (grid on a card, height toward the camera). Pure: no three.js, so it's testable.

export interface HeightfieldInput {
  width: number;
  height: number;
  /** Column height per cell, row-major. NaN marks an empty cell (no column at all). */
  heights: Float32Array;
  /** Height used for neighbours outside the grid or empty. */
  base: number;
  /** Texture coordinate of grid corner (x, y); cells take colour from the texel they cover. */
  uv: (x: number, y: number) => readonly [number, number];
  /** Grid (x, y, h) to model space: origin + x·ax + y·ay + h·ah. */
  origin: readonly [number, number, number];
  ax: readonly [number, number, number];
  ay: readonly [number, number, number];
  ah: readonly [number, number, number];
  /** Also emit the base face under each column (for free-standing props). */
  bottom?: boolean;
}

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export function meshHeightfield(input: HeightfieldInput): MeshArrays {
  const { width: w, height: h, heights, base, uv, origin, ax, ay, ah } = input;
  const pos: number[] = [];
  const nor: number[] = [];
  const tex: number[] = [];
  const idx: number[] = [];
  const at = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return base;
    const v = heights[y * w + x]!;
    return Number.isNaN(v) ? base : v;
  };
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !Number.isNaN(heights[y * w + x]!);
  const point = (x: number, y: number, z: number): [number, number, number] => [
    origin[0] + x * ax[0] + y * ay[0] + z * ah[0],
    origin[1] + x * ax[1] + y * ay[1] + z * ah[1],
    origin[2] + x * ax[2] + y * ay[2] + z * ah[2],
  ];
  const dir = (d: readonly [number, number, number], s: number) => [d[0] * s, d[1] * s, d[2] * s] as const;

  /** Quad from four grid-space corners (in order around the face) facing `normal`. */
  const quad = (
    corners: [number, number, number][],
    uvs: (readonly [number, number])[],
    normal: readonly [number, number, number],
  ) => {
    const p = corners.map(([x, y, z]) => point(x, y, z));
    const n = normalise(normal);
    // Wind counter-clockwise as seen from the normal side.
    const e1 = sub(p[1]!, p[0]!);
    const e2 = sub(p[2]!, p[0]!);
    const flip = dot(cross(e1, e2), n) < 0;
    const start = pos.length / 3;
    p.forEach((c, i) => {
      pos.push(...c);
      nor.push(...n);
      tex.push(...uvs[i]!);
    });
    if (flip) idx.push(start, start + 2, start + 1, start, start + 3, start + 2);
    else idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };

  // Tops (and bottoms): runs along x of equal height.
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!filled(x, y)) { x++; continue; }
      const z = at(x, y);
      let end = x + 1;
      while (end < w && filled(end, y) && at(end, y) === z) end++;
      const uvs = [uv(x, y), uv(end, y), uv(end, y + 1), uv(x, y + 1)];
      quad([[x, y, z], [end, y, z], [end, y + 1, z], [x, y + 1, z]], uvs, ah);
      if (input.bottom) quad([[x, y, base], [end, y, base], [end, y + 1, base], [x, y + 1, base]], uvs, dir(ah, -1));
      x = end;
    }
  }

  // Walls across horizontal edges (between rows y-1 and y), runs along x; coloured by the taller cell.
  for (let y = 0; y <= h; y++) {
    let x = 0;
    while (x < w) {
      const a = at(x, y - 1);
      const b = at(x, y);
      if (a === b || (!filled(x, y - 1) && !filled(x, y))) { x++; continue; }
      let end = x + 1;
      while (end < w && at(end, y - 1) === a && at(end, y) === b && (filled(end, y - 1) || filled(end, y))) end++;
      const upper = a > b ? y - 1 : y;
      const vMid = (uv(x, upper)[1] + uv(x, upper + 1)[1]) / 2;
      const u0 = uv(x, upper)[0];
      const u1 = uv(end, upper)[0];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      // Faces toward the lower side: +y if the upper cell is row y-1.
      quad([[x, y, lo], [end, y, lo], [end, y, hi], [x, y, hi]], [[u0, vMid], [u1, vMid], [u1, vMid], [u0, vMid]], dir(ay, a > b ? 1 : -1));
      x = end;
    }
  }

  // Walls across vertical edges (between columns x-1 and x), runs along y.
  for (let x = 0; x <= w; x++) {
    let y = 0;
    while (y < h) {
      const a = at(x - 1, y);
      const b = at(x, y);
      if (a === b || (!filled(x - 1, y) && !filled(x, y))) { y++; continue; }
      let end = y + 1;
      while (end < h && at(x - 1, end) === a && at(x, end) === b && (filled(x - 1, end) || filled(x, end))) end++;
      const upper = a > b ? x - 1 : x;
      const uMid = (uv(upper, y)[0] + uv(upper + 1, y)[0]) / 2;
      const v0 = uv(upper, y)[1];
      const v1 = uv(upper, end)[1];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      quad([[x, y, lo], [x, end, lo], [x, end, hi], [x, y, hi]], [[uMid, v0], [uMid, v1], [uMid, v1], [uMid, v0]], dir(ax, a > b ? 1 : -1));
      y = end;
    }
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    uvs: new Float32Array(tex),
    indices: new Uint32Array(idx),
  };
}

type V3 = readonly [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalise = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
