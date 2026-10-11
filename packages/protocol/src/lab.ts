// The relief lab's data contract (docs/relief-ml/LAB-CONTRACT.md), version 1: the file tree the
// trainer on Nick's Mac mirrors into the private bucket under `lab/`, which the dashboard at
// /admin/lab reads. The server only stores files; these schemas are what the files contain.
//
// Objects are loose on purpose: the trainer may add fields before the dashboard knows them, and
// they're kept and shown as raw JSON. Only the fields the dashboard relies on are checked.
import * as v from "valibot";

export const LAB_SCHEMA = 1;

/** Run and dataset ids: lowercase letters, digits, `.`, `_` and `-`. */
export const LAB_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/;
/** File paths under `lab/`: up to 8 segments of letters, digits, `.`, `_`, `-`, `:`, `,`, `+`. */
export const LAB_PATH = /^(?:[A-Za-z0-9_][A-Za-z0-9._,:+-]{0,159}\/){0,7}[A-Za-z0-9_][A-Za-z0-9._,:+-]{0,159}$/;
export const LAB_FILE_MAX_BYTES = 32 * 1024 * 1024;

/** File types the store accepts, by extension. */
export const LAB_CONTENT_TYPES: Record<string, string> = {
  json: "application/json",
  jsonl: "application/x-ndjson",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  f32: "application/octet-stream",
  u8: "application/octet-stream",
  bin: "application/octet-stream",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  glb: "model/gltf-binary",
};

/** The content type for a path, or null when the extension isn't allowed. */
export function labContentType(path: string): string | null {
  if (!LAB_PATH.test(path) || path.split("/").some((s) => s === "." || s === ".." || s.startsWith("."))) return null;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return LAB_CONTENT_TYPES[ext] ?? null;
}

export const LAB_STATUSES = ["queued", "running", "done", "failed", "stopped"] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];
/** The pipeline's stages, left to right on the dashboard's map. */
export const LAB_STAGES = ["source", "render", "dataset", "train", "eval", "3d"] as const;
export type LabStageName = (typeof LAB_STAGES)[number];

const id = v.pipe(v.string(), v.regex(LAB_ID));
const path = v.pipe(v.string(), v.regex(LAB_PATH));
const iso = v.string(); // ISO 8601; not checked strictly so Python's isoformat() variants pass
const num = v.nullable(v.number());
const progress = v.looseObject({ done: v.number(), total: v.number(), unit: v.optional(v.string()), eta: v.optional(iso) });

/** What a metric key means, so it can be labelled, grouped and judged. */
export const LabMetricDefSchema = v.looseObject({
  label: v.string(),
  unit: v.optional(v.string()),
  /** Which way is good. */
  better: v.optional(v.picklist(["lower", "higher"])),
  /** Charts group metrics with the same group ("loss", "accuracy"…). */
  group: v.optional(v.string()),
  /** Shown on run cards and in "best per task". */
  primary: v.optional(v.boolean()),
  /** One sentence for Nick: what it measures, in plain words. */
  help: v.optional(v.string()),
});
export type LabMetricDef = v.InferOutput<typeof LabMetricDefSchema>;

export const LabImageSchema = v.looseObject({
  /** Path relative to the run's folder. */
  path,
  caption: v.optional(v.string()),
  kind: v.optional(v.picklist(["samples", "compare", "3d", "curve", "confusion", "heatmap", "other"])),
});
export type LabImage = v.InferOutput<typeof LabImageSchema>;

/** `lab/runs/<id>/run.json`: one experiment, through its stages. */
export const LabRunSchema = v.looseObject({
  schema: v.literal(LAB_SCHEMA),
  id,
  /** What the model is for: "faces", "depth", "normals"… "Best per task" is per this. */
  task: v.string(),
  name: v.optional(v.string()),
  title: v.optional(v.string()),
  status: v.picklist(LAB_STATUSES),
  created: v.optional(iso),
  started: v.optional(iso),
  updated: v.optional(iso),
  finished: v.optional(iso),
  host: v.optional(v.string()),
  /** The run this one changes. Its config is diffed against this one's. */
  parent: v.optional(v.nullable(id)),
  /** What changed against the parent, in plain words, one per line. */
  changes: v.optional(v.array(v.string())),
  /** The hypothesis: why this run exists. */
  why: v.optional(v.string()),
  note: v.optional(v.string()),
  /** Datasets it trained or evaluated on (`lab/datasets/<id>`). */
  datasets: v.optional(v.array(id)),
  config: v.record(v.string(), v.unknown()),
  /** runlog.describe_model(): nodes, skips, params, bytes_fp16. */
  arch: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
  /** The run's own steps, in order: generate, train, eval, render3d… */
  stages: v.optional(v.array(v.looseObject({
    name: v.string(),
    stage: v.optional(v.picklist(LAB_STAGES)),
    status: v.picklist(LAB_STATUSES),
    progress: v.optional(progress),
    started: v.optional(iso),
    finished: v.optional(iso),
    note: v.optional(v.string()),
  }))),
  /** Metric keys (in `summary`, metric rows and evals) → what they mean. Unknown keys still plot. */
  metrics: v.optional(v.record(v.string(), LabMetricDefSchema)),
  /** Latest or final headline numbers. */
  summary: v.optional(v.record(v.string(), v.union([num, v.string()]))),
  classes: v.optional(v.array(v.string())),
  /** Eval names in `evals/` (without `.json`). */
  evals: v.optional(v.array(v.string())),
  /**
   * Prediction manifests in this run (e.g. "preds/watch.json", refreshed every epoch). Those not
   * belonging to an eval are shown on their own.
   */
  preds: v.optional(v.array(path)),
  images: v.optional(v.array(LabImageSchema)),
  findings: v.optional(v.array(v.string())),
  /** Hidden from lists unless asked for. */
  archived: v.optional(v.boolean()),
});
export type LabRun = v.InferOutput<typeof LabRunSchema>;

/** One line of `metrics.jsonl`. Per-class values use `metric/class` keys, e.g. `acc/TOP`. */
export const LabMetricRowSchema = v.looseObject({
  ts: v.optional(iso),
  step: v.number(),
  epoch: v.optional(v.number()),
  /** "train", "val"… */
  split: v.optional(v.string()),
  metrics: v.record(v.string(), num),
});
export type LabMetricRow = v.InferOutput<typeof LabMetricRowSchema>;

export const LabConfusionSchema = v.looseObject({
  labels: v.array(v.string()),
  /** matrix[truth][predicted]: counts (pixels or samples). */
  matrix: v.array(v.array(v.number())),
});
export type LabConfusion = v.InferOutput<typeof LabConfusionSchema>;

/** `lab/runs/<id>/evals/<name>.json`: one evaluation of the run's model on one set of data. */
export const LabEvalSchema = v.looseObject({
  schema: v.literal(LAB_SCHEMA),
  name: v.string(),
  title: v.optional(v.string()),
  /** What it's measured on: "synthetic-val", "testset", "real-maps", "pics"… */
  split: v.optional(v.string()),
  /** True when it's graded by rule labels the model trained on: shown as circular, not quality. */
  circular: v.optional(v.boolean()),
  overall: v.record(v.string(), num),
  /** metric → class → value. */
  perClass: v.optional(v.record(v.string(), v.record(v.string(), num))),
  confusion: v.optional(LabConfusionSchema),
  perObject: v.optional(v.array(v.looseObject({
    id: v.string(),
    title: v.optional(v.string()),
    /** A sample id (see LabSample) to open it. */
    sample: v.optional(v.string()),
    scores: v.record(v.string(), num),
  }))),
  /** Prediction manifests for this eval, relative to the run (e.g. "preds/real-maps.json"). */
  preds: v.optional(v.array(path)),
});
export type LabEval = v.InferOutput<typeof LabEvalSchema>;

/**
 * Layer encodings in a sample manifest, all at full pixel resolution:
 * - `rgb` (PNG): shown as is (game art, a render, a heatmap).
 * - `shades` (PNG): the 4 Game Boy shades as grey 255, 170, 85, 0.
 * - `faces` (8-bit PNG): grey = face index, 0 TOP, 1 FRONT, 2 SLOPE, 3 HIP◀, 4 HIP▶; 255 = none.
 * - `normals` (RGBA PNG): RGB = n × 127.5 + 127.5 (x right, y up, z to the viewer); alpha 0 = no surface.
 * - `depth` (`.f32`): little-endian float32, width × height, pixels towards the viewer; NaN = none.
 * - `mask` (8-bit PNG): 0 background, 1 object, 2 ground.
 * - `error` (PNG): heatmap, brighter = worse.
 */
export const LAB_ENCODINGS = ["rgb", "shades", "faces", "normals", "depth", "mask", "error"] as const;
export type LabEncoding = (typeof LAB_ENCODINGS)[number];
export const LAB_FACES = ["TOP", "FRONT", "SLOPE", "HIP◀", "HIP▶"] as const;

/**
 * Sample ids say where a sample comes from, so the dashboard can open it in the relief editor:
 * `map:<MAP_NAME>[:bx,by,bw,bh]` (an area in 32-pixel blocks), `pic:<dex number>`,
 * `synth:<dataset id>:<index>`.
 */
export type LabSampleRef =
  | { kind: "map"; map: string; area?: [number, number, number, number] }
  | { kind: "pic"; dex: number }
  | { kind: "synth"; dataset: string; index: number }
  | { kind: "other" };

export function parseSampleId(sampleId: string): LabSampleRef {
  const [kind, a, b] = sampleId.split(":");
  if (kind === "map" && a) {
    const area = b?.split(",").map(Number);
    return { kind, map: a, ...(area?.length === 4 && area.every(Number.isFinite) ? { area: area as [number, number, number, number] } : {}) };
  }
  if (kind === "pic" && a && Number.isInteger(Number(a))) return { kind, dex: Number(a) };
  if (kind === "synth" && a && b && Number.isInteger(Number(b))) return { kind, dataset: a, index: Number(b) };
  return { kind: "other" };
}

/**
 * A sample manifest (`preds/<set>.json` in a run, or `samples.json` in a dataset): images to browse
 * side by side, zoom, turn into 3D, flag and open in the relief editor. File paths are relative to
 * the manifest's folder.
 */
export const LabSampleSetSchema = v.looseObject({
  schema: v.literal(LAB_SCHEMA),
  title: v.optional(v.string()),
  /** `map`: three-quarter view (3D via the editor's mapRelief); `pic`: front view (3D via depth). */
  view: v.picklist(["map", "pic"]),
  layers: v.record(v.string(), v.looseObject({
    label: v.string(),
    encoding: v.picklist(LAB_ENCODINGS),
    /** Ground truth (labels) rather than model output. */
    truth: v.optional(v.boolean()),
  })),
  items: v.array(v.looseObject({
    id: v.string(),
    title: v.optional(v.string()),
    width: v.number(),
    height: v.number(),
    split: v.optional(v.string()),
    /** Layer name → file. */
    files: v.record(v.string(), path),
    scores: v.optional(v.record(v.string(), num)),
    tags: v.optional(v.array(v.string())),
  })),
});
export type LabSampleSet = v.InferOutput<typeof LabSampleSetSchema>;
export type LabSample = LabSampleSet["items"][number];

/** `lab/datasets/<id>/dataset.json`: a generated or extracted dataset. */
export const LabDatasetSchema = v.looseObject({
  schema: v.literal(LAB_SCHEMA),
  id,
  title: v.optional(v.string()),
  /** "synthetic" scenes, or real "rom" art. */
  kind: v.optional(v.string()),
  view: v.optional(v.picklist(["map", "pic"])),
  status: v.optional(v.picklist(LAB_STATUSES)),
  created: v.optional(iso),
  updated: v.optional(iso),
  progress: v.optional(progress),
  /** What made it: generator, renderer and style settings. */
  config: v.optional(v.record(v.string(), v.unknown())),
  /** How many of each kind of scene: { "rooms": 3000, "posed creatures": 4000 }. */
  counts: v.optional(v.record(v.string(), v.number())),
  /** The dataset this one was derived from or calibrated against. */
  parent: v.optional(v.nullable(id)),
  changes: v.optional(v.array(v.string())),
  /** Sample manifests in this folder. */
  samples: v.optional(v.array(path)),
  images: v.optional(v.array(LabImageSchema)),
  findings: v.optional(v.array(v.string())),
});
export type LabDataset = v.InferOutput<typeof LabDatasetSchema>;

/** `lab/index.json`: the front page. The trainer rewrites it whenever a run or dataset changes. */
export const LabIndexSchema = v.looseObject({
  schema: v.literal(LAB_SCHEMA),
  updated: iso,
  runs: v.array(v.looseObject({
    id,
    task: v.string(),
    status: v.picklist(LAB_STATUSES),
    title: v.optional(v.string()),
    name: v.optional(v.string()),
    parent: v.optional(v.nullable(id)),
    datasets: v.optional(v.array(id)),
    started: v.optional(iso),
    updated: v.optional(iso),
    summary: v.optional(v.record(v.string(), v.union([num, v.string()]))),
    archived: v.optional(v.boolean()),
  })),
  datasets: v.optional(v.array(v.looseObject({
    id,
    title: v.optional(v.string()),
    kind: v.optional(v.string()),
    status: v.optional(v.picklist(LAB_STATUSES)),
    updated: v.optional(iso),
  }))),
  /** The current best run per task. */
  best: v.optional(v.record(v.string(), id)),
  /** What the ops agent is doing now, and why. */
  ops: v.optional(v.looseObject({
    doing: v.string(),
    why: v.optional(v.string()),
    next: v.optional(v.array(v.string())),
    runs: v.optional(v.array(id)),
    /** Plateau watch: when the best score last improved, per task. */
    lastImproved: v.optional(v.record(v.string(), iso)),
    updated: v.optional(iso),
  })),
  /** Metric definitions shared by every run (a run's own `metrics` override them). */
  metrics: v.optional(v.record(v.string(), LabMetricDefSchema)),
});
export type LabIndex = v.InferOutput<typeof LabIndexSchema>;

export const LAB_EVENT_KINDS = ["finding", "decision", "question", "milestone", "note", "status"] as const;
/** One line of `lab/events.jsonl`: the ops agent's journal, newest last. */
export const LabEventSchema = v.looseObject({
  ts: iso,
  kind: v.picklist(LAB_EVENT_KINDS),
  title: v.string(),
  /** Paragraphs separated by blank lines; `- ` bullets, `code`, **bold**, [links](…). */
  body: v.optional(v.string()),
  runs: v.optional(v.array(id)),
  /** Images by path under `lab/`. */
  images: v.optional(v.array(v.looseObject({ path, caption: v.optional(v.string()) }))),
  /** Explainer artifacts or docs for Nick. */
  links: v.optional(v.array(v.looseObject({ url: v.string(), title: v.string() }))),
  tags: v.optional(v.array(v.string())),
});
export type LabEvent = v.InferOutput<typeof LabEventSchema>;

export const LAB_FLAG_KINDS = ["wrong-label", "bad-prediction", "bad-data", "bug", "idea", "question"] as const;
export const LAB_FLAG_STATUSES = ["open", "seen", "fixed", "wontfix"] as const;
/**
 * `lab/flags/<id>.json`: something Nick flagged on the dashboard, for the ops agent. The dashboard
 * creates it; the ops agent re-PUTs it with `status` and `reply`. The trainer's sync never
 * deletes or overwrites flags it didn't change.
 */
export const LabFlagSchema = v.looseObject({
  schema: v.literal(LAB_SCHEMA),
  id,
  created: iso,
  kind: v.picklist(LAB_FLAG_KINDS),
  status: v.picklist(LAB_FLAG_STATUSES),
  note: v.string(),
  run: v.optional(id),
  dataset: v.optional(id),
  stage: v.optional(v.string()),
  /** A sample: its manifest (path under `lab/`), id and layer. */
  sample: v.optional(v.looseObject({ manifest: path, id: v.string(), layer: v.optional(v.string()) })),
  /** A pixel box in the sample, [x, y, w, h]. */
  box: v.optional(v.tuple([v.number(), v.number(), v.number(), v.number()])),
  reply: v.optional(v.string()),
  updated: v.optional(iso),
});
export type LabFlag = v.InferOutput<typeof LabFlagSchema>;
