// Browsing a sample manifest: every layer side by side at full pixel resolution, one synced cursor
// with the value under it in words, disagreement overlays, the relief in 3D, and the ways Nick
// hands work back: flag a box, open it in the relief editor prefilled, copy an issue card.
import { useEffect, useMemo, useRef, useState } from "react";
import { parseSampleId, type LabEncoding, type LabFlag, type LabSample, type LabSampleSet } from "@pokehd/protocol";
import { mapRelief, pictureRelief, type Mesh } from "../../tools/relief/shape.ts";
import { reliefLink } from "../../tools/relief/link.ts";
import { fileUrl, putLab, useLab } from "./data.ts";
import { decodeLayer, depthMesh, describe, disagreement, faceAgreement, groundFromNormals, normalAt, toImage, type Pixels } from "./layers.ts";
import { View3D } from "./View3D.tsx";
import { copyText, issueCard } from "./issue.ts";

const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);

/** Loads and decodes one layer file. */
function usePixels(path: string | null, enc: LabEncoding | undefined, w: number, h: number): Pixels | null {
  const file = useLab<ArrayBuffer>(path, { kind: "bytes", live: false });
  const [px, setPx] = useState<Pixels | null>(null);
  useEffect(() => {
    let live = true;
    setPx(null);
    if (!file.data || !enc || !path) return;
    void decodeLayer(file.data, enc, w, h, path).then((p) => live && setPx(p)).catch(() => live && setPx(null));
    return () => { live = false; };
  }, [file.data, enc, w, h, path]);
  return px;
}

interface Ctx { run?: string; runTitle?: string; dataset?: string; stage?: string }

export function SampleBrowser({ manifest, ctx, others = [], initial }: {
  /** Manifest path under lab/. */
  manifest: string;
  ctx: Ctx;
  /** Other runs' manifests to compare the same sample with. */
  others?: { label: string; manifest: string }[];
  initial?: string;
}) {
  const set = useLab<LabSampleSet>(manifest);
  const [itemId, setItemId] = useState<string | undefined>(initial);
  const [sort, setSort] = useState<"order" | "worst" | "best">("order");
  const items = useMemo(() => {
    const list = [...(set.data?.items ?? [])];
    const score = (s: LabSample) => { const v = Object.values(s.scores ?? {}).find((x) => typeof x === "number"); return typeof v === "number" ? v : NaN; };
    if (sort !== "order") list.sort((a, b) => (sort === "worst" ? score(a) - score(b) : score(b) - score(a)));
    return list;
  }, [set.data, sort]);
  const item = items.find((i) => i.id === itemId) ?? items[0];

  if (set.error) return <p className="muted">Couldn't load {manifest} ({set.error}).</p>;
  if (!set.data) return <p className="muted">Loading samples…</p>;
  const dir = dirOf(manifest);
  return (
    <div className="lab-samples">
      <div className="lab-row wrap">
        <strong>{set.data.title ?? manifest}</strong>
        <span className="muted small">{set.data.items.length} samples · {set.data.view === "map" ? "map view" : "picture view"}</span>
        <span className="grow" />
        <label className="small">Order <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="order">as listed</option><option value="worst">worst first</option><option value="best">best first</option>
        </select></label>
      </div>
      <div className="lab-strip" role="listbox" aria-label="Samples">
        {items.map((s) => {
          const input = s.files.input ?? Object.values(s.files)[0];
          const score = Object.entries(s.scores ?? {})[0];
          return (
            <button type="button" role="option" aria-selected={s === item} key={s.id} onClick={() => setItemId(s.id)} title={s.title ?? s.id}>
              {input && <img src={fileUrl(dir + input)} alt="" loading="lazy" />}
              <span>{s.title ?? s.id}</span>
              {score && typeof score[1] === "number" && <em>{score[1] <= 1 ? `${Math.round(score[1] * 100)}%` : score[1].toFixed(2)}</em>}
            </button>
          );
        })}
      </div>
      {item && <Sample key={`${manifest}#${item.id}`} set={set.data} manifest={manifest} item={item} ctx={ctx} others={others} />}
    </div>
  );
}

function Sample({ set, manifest, item, ctx, others }: { set: LabSampleSet; manifest: string; item: LabSample; ctx: Ctx; others: { label: string; manifest: string }[] }) {
  const dir = dirOf(manifest);
  const names = Object.keys(item.files).filter((n) => set.layers[n]);
  const [zoom, setZoom] = useState(0); // 0 = fit
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [box, setBox] = useState<[number, number, number, number] | null>(null);
  const [diff, setDiff] = useState(true);
  const truthName = names.find((n) => set.layers[n]!.truth && ["faces", "normals"].includes(set.layers[n]!.encoding));
  const predNames = names.filter((n) => !set.layers[n]!.truth && ["faces", "normals", "depth"].includes(set.layers[n]!.encoding));
  // Pictures default to their depth layer: depth is what puts a head behind a belly.
  const [shapeLayer, setShapeLayer] = useState<string | undefined>((set.view === "pic" ? predNames.find((n) => set.layers[n]!.encoding === "depth") : undefined) ?? predNames[0] ?? truthName);
  const [show3d, setShow3d] = useState(false);

  // Every layer, decoded (hooks in a fixed order: one per layer slot).
  const layers = names.map((n) => ({ name: n, def: set.layers[n]!, path: dir + item.files[n]! }));
  const decoded = useLayerPixels(layers.map((l) => ({ path: l.path, enc: l.def.encoding })), item.width, item.height);
  const byName = useMemo(() => Object.fromEntries(names.map((n, i) => [n, decoded[i]])) as Record<string, Pixels | null | undefined>, [decoded]); // eslint-disable-line react-hooks/exhaustive-deps

  const ref = parseSampleId(item.id);
  const editorLink = ref.kind === "map" || ref.kind === "pic"
    ? reliefLink({ ...(ref.kind === "map" ? { map: ref.map, area: ref.area } : { dex: ref.dex }), seed: manifest, sample: item.id, layer: [shapeLayer, ...predNames].find((n) => n && ["faces", "normals"].includes(set.layers[n]?.encoding ?? "")) })
    : null;

  // Per-face agreement against the truth layer, when both are faces.
  const agreement = useMemo(() => {
    const t = truthName && byName[truthName], p = predNames[0] && byName[predNames[0]];
    if (!t || !p || set.layers[truthName!]!.encoding !== "faces" || set.layers[predNames[0]!]!.encoding !== "faces") return null;
    return faceAgreement(t, p);
  }, [byName, truthName, predNames, set.layers]);

  const mismatch = useMemo(() => {
    const t = truthName && byName[truthName];
    if (!t) return null;
    const out = new Map<string, Float32Array>();
    for (const p of predNames) {
      const px = byName[p], enc = set.layers[p]!.encoding;
      if (px && enc !== "depth") out.set(p, disagreement(t, set.layers[truthName!]!.encoding, px, enc));
    }
    return out;
  }, [byName, truthName, predNames, set.layers]);

  const mesh = useMemo<Mesh | null>(() => {
    if (!show3d || !shapeLayer) return null;
    const shape = byName[shapeLayer], enc = set.layers[shapeLayer]!.encoding;
    const input = byName.input ?? Object.entries(byName).find(([n]) => set.layers[n]!.encoding === "rgb")?.[1];
    const w = item.width, h = item.height;
    if (!shape) return null;
    const colour = (x: number, y: number) => {
      const px = input?.rgba; const i = (y * w + x) * 4;
      return px ? ([px[i]!, px[i + 1]!, px[i + 2]!] as const) : ([200, 200, 200] as const);
    };
    if (enc === "depth" && shape.f32) {
      const normals = predNames.find((n) => set.layers[n]!.encoding === "normals");
      const np = normals ? byName[normals] : undefined;
      return depthMesh(w, h, shape.f32, colour, np ? (x, y) => normalAt(np, "normals", y * w + x) : undefined);
    }
    const normal = (x: number, y: number) => normalAt(shape, enc, y * w + x);
    if (set.view === "map") {
      const mask = Object.entries(byName).find(([n]) => set.layers[n]!.encoding === "mask")?.[1];
      const ground = mask?.rgba ? null : groundFromNormals(w, h, normal);
      return mapRelief({ width: w, height: h, normal: (x, y) => normal(x, y) ?? [0, 0, 1], colour, ground: (x, y) => (mask?.rgba ? mask.rgba[(y * w + x) * 4] === 2 : ground![y * w + x] === 1) }, { sides: true, mirror: true });
    }
    return pictureRelief({ width: w, height: h, inside: (x, y) => normal(x, y) != null, normal: (x, y) => normal(x, y) ?? [0, 0, 1], colour });
  }, [show3d, shapeLayer, byName, set, item, predNames]);

  const readout = cursor ? layers.map((l, i) => { const p = decoded[i]; return p ? `${l.def.label}: ${describe(p, l.def.encoding, cursor[0], cursor[1])}` : null; }).filter(Boolean) : [];

  return (
    <div className="lab-sample">
      <div className="lab-row wrap">
        <strong>{item.title ?? item.id}</strong>
        <code className="small">{item.id}</code>
        <span className="muted small">{item.width}×{item.height}</span>
        {Object.entries(item.scores ?? {}).map(([k, v]) => <span key={k} className="pill">{k} {v == null ? "–" : v <= 1 ? `${Math.round(v * 100)}%` : v.toFixed(2)}</span>)}
      </div>
      <div className="lab-row wrap lab-tools">
        <div className="lab-seg" role="group" aria-label="Zoom">
          {[0, 2, 4, 8].map((z) => <button type="button" key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z ? `${z}×` : "Fit"}</button>)}
        </div>
        {mismatch && mismatch.size > 0 && <label className="small"><input type="checkbox" checked={diff} onChange={(e) => setDiff(e.target.checked)} /> Mark disagreements</label>}
        {(predNames.length > 0 || truthName) && (
          <span className="lab-seg">
            <button type="button" aria-pressed={show3d} onClick={() => setShow3d(!show3d)}>3D</button>
            <select aria-label="Shape from" value={shapeLayer} onChange={(e) => setShapeLayer(e.target.value)}>
              {[...predNames, ...(truthName ? [truthName] : [])].map((n) => <option key={n} value={n}>{set.layers[n]!.label}</option>)}
            </select>
          </span>
        )}
        <span className="grow" />
        {editorLink && <a className="button" href={editorLink} target="_blank" rel="noreferrer">Fix in relief editor</a>}
        <FlagButton manifest={manifest} item={item} ctx={ctx} box={box} layer={shapeLayer} onDone={() => setBox(null)} />
      </div>
      <p className="muted small lab-hint">{cursor ? readout.join(" · ") : "Point at a pixel to read every layer there. Drag on any layer to mark a box for a flag."}{box && ` · box ${box.join(", ")}`}</p>
      <div className={`lab-layers ${zoom ? "zoomed" : ""}`}>
        {layers.map((l, i) => (
          <LayerCanvas key={l.name} label={l.def.label + (l.def.truth ? " (truth)" : "")} pixels={decoded[i] ?? null} enc={l.def.encoding} zoom={zoom}
            overlay={diff ? mismatch?.get(l.name) : undefined} cursor={cursor} box={box} onCursor={setCursor} onBox={setBox} href={fileUrl(l.path)} />
        ))}
        {others.map((o) => <OtherLayer key={o.manifest} label={o.label} manifest={o.manifest} itemId={item.id} zoom={zoom} cursor={cursor} box={box} onCursor={setCursor} onBox={setBox} />)}
      </div>
      {agreement && (
        <table className="lab-table small">
          <thead><tr><th>Face</th>{agreement.map((a) => <th key={a.face}>{a.face}</th>)}</tr></thead>
          <tbody><tr><td>Right</td>{agreement.map((a) => <td key={a.face}>{a.pixels ? `${Math.round((a.right / a.pixels) * 100)}%` : "–"}<span className="muted"> of {a.pixels}</span></td>)}</tr></tbody>
        </table>
      )}
      {show3d && (mesh ? <View3D mesh={mesh} view={set.view} /> : <p className="muted">Building 3D…</p>)}
      {show3d && set.view === "map" && !Object.values(set.layers).some((l) => l.encoding === "mask") && (
        <p className="muted small">No ground mask in this sample, so ground is guessed: top-facing pixels touching the bottom edge through other top-facing pixels.</p>
      )}
    </div>
  );
}

/** Loads and decodes every layer of a sample; one array, replaced when they've all arrived. */
function useLayerPixels(list: { path: string; enc: LabEncoding }[], w: number, h: number): (Pixels | null)[] {
  const key = list.map((l) => `${l.enc}:${l.path}`).join("\n");
  const [out, setOut] = useState<(Pixels | null)[]>([]);
  useEffect(() => {
    let live = true;
    const items = key ? key.split("\n").map((k) => { const i = k.indexOf(":"); return { enc: k.slice(0, i) as LabEncoding, path: k.slice(i + 1) }; }) : [];
    setOut(items.map(() => null));
    void Promise.all(items.map(async (l) => {
      const res = await fetch(fileUrl(l.path), { credentials: "same-origin" }).catch(() => null);
      return res?.ok ? decodeLayer(await res.arrayBuffer(), l.enc, w, h, l.path).catch(() => null) : null;
    })).then((px) => live && setOut(px));
    return () => { live = false; };
  }, [key, w, h]);
  return out;
}

/** Another run's prediction for the same sample id, for side-by-side comparison. */
function OtherLayer({ label, manifest, itemId, ...rest }: { label: string; manifest: string; itemId: string } & Omit<Parameters<typeof LayerCanvas>[0], "label" | "pixels" | "enc" | "href">) {
  const set = useLab<LabSampleSet>(manifest, { live: false });
  const item = set.data?.items.find((i) => i.id === itemId);
  const name = item && Object.keys(item.files).find((n) => set.data!.layers[n] && !set.data!.layers[n]!.truth && ["faces", "normals", "depth"].includes(set.data!.layers[n]!.encoding));
  const path = name ? dirOf(manifest) + item!.files[name]! : null;
  const enc = name ? set.data!.layers[name]!.encoding : undefined;
  const px = usePixels(path, enc, item?.width ?? 0, item?.height ?? 0);
  if (!set.data) return null;
  if (!name) return <div className="lab-layer missing"><span>{label}</span><p className="muted small">No prediction for this sample.</p></div>;
  return <LayerCanvas label={`${label}: ${set.data.layers[name]!.label}`} pixels={px} enc={enc!} href={fileUrl(path!)} {...rest} />;
}

function LayerCanvas({ label, pixels, enc, zoom, overlay, cursor, box, onCursor, onBox, href }: {
  label: string;
  pixels: Pixels | null;
  enc: LabEncoding;
  zoom: number;
  overlay?: Float32Array;
  cursor: [number, number] | null;
  box: [number, number, number, number] | null;
  onCursor: (c: [number, number] | null) => void;
  onBox: (b: [number, number, number, number] | null) => void;
  href: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<[number, number] | null>(null);
  useEffect(() => {
    const c = canvas.current; if (!c || !pixels) return;
    c.width = pixels.width; c.height = pixels.height;
    const img = toImage(pixels, enc);
    if (overlay) for (let i = 0; i < overlay.length; i++) if (overlay[i] === 1) { img[i * 4] = 255; img[i * 4 + 1] = 40; img[i * 4 + 2] = 120; }
    c.getContext("2d")!.putImageData(new ImageData(img, pixels.width, pixels.height), 0, 0);
  }, [pixels, enc, overlay]);
  const at = (e: React.PointerEvent): [number, number] | null => {
    if (!pixels) return null;
    const r = canvas.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * pixels.width), y = Math.floor(((e.clientY - r.top) / r.height) * pixels.height);
    return x >= 0 && y >= 0 && x < pixels.width && y < pixels.height ? [x, y] : null;
  };
  const w = pixels?.width ?? 1, h = pixels?.height ?? 1;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <figure className="lab-layer">
      <figcaption><span>{label}</span><a href={href} target="_blank" rel="noreferrer" className="muted small" title="Open the file">file</a></figcaption>
      <div className="frame" style={zoom ? { width: w * zoom } : { aspectRatio: `${w} / ${h}` }}>
        <canvas ref={canvas}
          onPointerMove={(e) => { const p = at(e); onCursor(p); if (drag.current && p) onBox(norm(drag.current, p)); }}
          onPointerDown={(e) => { const p = at(e); if (!p) return; (e.target as Element).setPointerCapture(e.pointerId); drag.current = p; onBox(null); }}
          onPointerUp={() => { drag.current = null; }}
          onPointerLeave={() => onCursor(null)} />
        {cursor && <span className="cross-h" style={{ top: pct(cursor[1] + 0.5, h) }} />}
        {cursor && <span className="cross-v" style={{ left: pct(cursor[0] + 0.5, w) }} />}
        {box && <span className="box" style={{ left: pct(box[0], w), top: pct(box[1], h), width: pct(box[2], w), height: pct(box[3], h) }} />}
        {!pixels && <span className="loading">Loading…</span>}
      </div>
    </figure>
  );
}

const norm = (a: [number, number], b: [number, number]): [number, number, number, number] =>
  [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1];

function FlagButton({ manifest, item, ctx, box, layer, onDone }: { manifest: string; item: LabSample; ctx: Ctx; box: [number, number, number, number] | null; layer?: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LabFlag["kind"]>("bad-prediction");
  const [note, setNote] = useState("");
  const [state, setState] = useState("");
  const flag = (): LabFlag => ({
    schema: 1, id: `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`,
    created: new Date().toISOString(), kind, status: "open", note,
    ...(ctx.run ? { run: ctx.run } : {}), ...(ctx.dataset ? { dataset: ctx.dataset } : {}), ...(ctx.stage ? { stage: ctx.stage } : {}),
    sample: { manifest, id: item.id, ...(layer ? { layer } : {}) }, ...(box ? { box } : {}),
  });
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Flag{box ? " box" : ""}</button>;
  return (
    <div className="lab-flagform">
      <select value={kind} onChange={(e) => setKind(e.target.value as LabFlag["kind"])} aria-label="Kind">
        <option value="bad-prediction">Prediction is wrong</option>
        <option value="wrong-label">Label is wrong</option>
        <option value="bad-data">Data looks wrong</option>
        <option value="bug">Bug</option>
        <option value="idea">Idea</option>
        <option value="question">Question</option>
      </select>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={box ? `What's wrong in the box at ${box.join(", ")}?` : "What's wrong? (drag on a layer to mark a box)"} rows={2} />
      <div className="lab-row">
        <button type="button" className="primary" disabled={!note.trim()} onClick={async () => {
          const f = flag();
          const ok = await putLab(`flags/${f.id}.json`, JSON.stringify(f));
          setState(ok ? "Flagged for the ops agent." : "Couldn't save the flag.");
          if (ok) { setOpen(false); setNote(""); onDone(); }
        }}>Save flag</button>
        <button type="button" disabled={!note.trim()} onClick={async () => setState((await copyText(issueCard(flag(), ctx.runTitle))) ? "Issue card copied." : "Couldn't copy.")}>Copy issue card</button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
        <span className="muted small">{state}</span>
      </div>
    </div>
  );
}
