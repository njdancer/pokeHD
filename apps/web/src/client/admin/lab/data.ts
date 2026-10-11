// Reading the lab's file tree (docs/relief-ml/LAB-CONTRACT.md) from /api/admin/lab, live: every
// file a page shows is polled while the tab is visible, with If-None-Match so unchanged files
// cost a 304. One cache per page load, shared by every component that reads the same file.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { LabEvent, LabIndex, LabMetricDef, LabMetricRow, LabRun } from "@pokehd/protocol";

export const API = "/api/admin/lab/";
const POLL_MS = 5000;

type Entry = { etag?: string; value?: unknown; error?: string; at: number; loading?: Promise<void> };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const watched = new Map<string, number>();
let version = 0;
let lastOk = 0;

function notify() {
  version++;
  for (const l of listeners) l();
}

type Kind = "json" | "jsonl" | "bytes";
const kinds = new Map<string, Kind>();

async function load(path: string): Promise<void> {
  const prev = cache.get(path);
  if (prev?.loading) return prev.loading;
  const kind = kinds.get(path) ?? "json";
  const loading = (async () => {
    try {
      const res = await fetch(API + path, { headers: prev?.etag ? { "if-none-match": prev.etag } : {}, credentials: "same-origin" });
      lastOk = Date.now();
      if (res.status === 304) { cache.set(path, { ...prev!, loading: undefined, at: Date.now() }); return; }
      if (!res.ok) { cache.set(path, { error: res.status === 404 ? "missing" : `HTTP ${res.status}`, at: Date.now() }); notify(); return; }
      const etag = res.headers.get("etag") ?? undefined;
      const value = kind === "bytes" ? await res.arrayBuffer() : kind === "jsonl" ? parseJsonl(await res.text()) : await res.json();
      cache.set(path, { etag, value, at: Date.now() });
      notify();
    } catch (e) {
      cache.set(path, { ...prev, error: String(e), loading: undefined, at: Date.now() });
      notify();
    }
  })();
  cache.set(path, { ...(prev ?? { at: 0 }), loading });
  return loading;
}

export function parseJsonl(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a line cut mid-write: skip it */ }
  }
  return out;
}

// One poller for every watched file.
let timer = 0;
function ensurePolling() {
  if (timer) return;
  timer = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    for (const path of watched.keys()) void load(path);
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") for (const path of watched.keys()) void load(path);
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export interface FileState<T> {
  data: T | undefined;
  error?: string;
  loading: boolean;
}

/**
 * A file under lab/, kept fresh while mounted. `live: false` loads it once (files that never
 * change, like images and finished runs' predictions).
 */
export function useLab<T>(path: string | null, opts: { kind?: Kind; live?: boolean } = {}): FileState<T> {
  const { kind = "json", live = true } = opts;
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!path) return;
    kinds.set(path, kind);
    if (!cache.get(path)?.value) void load(path);
    if (!live) return;
    watched.set(path, (watched.get(path) ?? 0) + 1);
    ensurePolling();
    return () => {
      const n = (watched.get(path) ?? 1) - 1;
      if (n <= 0) watched.delete(path); else watched.set(path, n);
    };
  }, [path, kind, live]);
  if (!path) return { data: undefined, loading: false };
  const e = cache.get(path);
  return { data: e?.value as T | undefined, error: e?.error, loading: !e || (!e.value && !e.error) };
}

/** Several files at once (e.g. every compared run's metrics). */
export function useLabMany<T>(paths: string[], opts: { kind?: Kind; live?: boolean } = {}): (T | undefined)[] {
  const { kind = "json", live = true } = opts;
  useSyncExternalStore(subscribe, () => version);
  const key = paths.join("\n");
  useEffect(() => {
    const list = key ? key.split("\n") : [];
    for (const p of list) { kinds.set(p, kind); if (!cache.get(p)?.value) void load(p); }
    if (!live) return;
    for (const p of list) watched.set(p, (watched.get(p) ?? 0) + 1);
    ensurePolling();
    return () => {
      for (const p of list) { const n = (watched.get(p) ?? 1) - 1; if (n <= 0) watched.delete(p); else watched.set(p, n); }
    };
  }, [key, kind, live]);
  return paths.map((p) => cache.get(p)?.value as T | undefined);
}

/** When the server last answered: drives the "live" dot. */
export function useLastSync(): number {
  useSyncExternalStore(subscribe, () => version);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  return lastOk;
}

export async function putLab(path: string, body: BodyInit, type = "application/json"): Promise<boolean> {
  const res = await fetch(API + path, { method: "PUT", body, headers: { "content-type": type }, credentials: "same-origin" }).catch(() => null);
  if (res?.ok) void load(path);
  return !!res?.ok;
}

export async function listLab(dir: string): Promise<{ files: { path: string; size: number; uploaded: string }[]; dirs: string[] } | null> {
  const res = await fetch(API + dir, { credentials: "same-origin" }).catch(() => null);
  return res?.ok ? res.json() : null;
}

/** URL of a file for <img src>. */
export const fileUrl = (path: string) => API + path.split("/").map(encodeURIComponent).join("/");

// ---- Shapes the pages share ----

export type RunRow = LabIndex["runs"][number];
export const runPath = (id: string, file = "run.json") => `runs/${id}/${file}`;
export const metricsPath = (id: string) => runPath(id, "metrics.jsonl");
export type Event = LabEvent;
export type Run = LabRun;
export type Row = LabMetricRow;

/** A metric's definition: the run's own, then the index's shared one, then one made from its key. */
export function metricDef(key: string, run?: { metrics?: Record<string, LabMetricDef> } | null, index?: LabIndex | null): LabMetricDef {
  const base = key.includes("/") ? key.slice(0, key.indexOf("/")) : key;
  const own = run?.metrics?.[key] ?? index?.metrics?.[key];
  if (own) return own;
  const parent = run?.metrics?.[base] ?? index?.metrics?.[base];
  if (parent && base !== key) return { ...parent, label: `${parent.label}: ${key.slice(base.length + 1)}`, primary: false, group: `${base} per class` };
  return { label: key, better: /loss|err|angle/i.test(key) ? "lower" : /acc|iou|score|bal/i.test(key) ? "higher" : undefined };
}

/** The headline metric for a run: the first primary one it has a value for. */
export function primaryMetric(summary: Record<string, unknown> | undefined, run?: { metrics?: Record<string, LabMetricDef> } | null, index?: LabIndex | null): { key: string; value: number; def: LabMetricDef } | null {
  if (!summary) return null;
  const keys = Object.keys(summary).filter((k) => typeof summary[k] === "number");
  const key = keys.find((k) => metricDef(k, run, index).primary) ?? keys[0];
  return key ? { key, value: summary[key] as number, def: metricDef(key, run, index) } : null;
}

export function fmt(value: number | null | undefined, def?: Pick<LabMetricDef, "unit">): string {
  if (value == null || !Number.isFinite(value)) return "–";
  const unit = def?.unit ?? "";
  if (unit === "%" && Math.abs(value) <= 1) return `${(value * 100).toFixed(1)}%`;
  const abs = Math.abs(value);
  if (unit === "°") return `${value.toFixed(1)}°`;
  const s = abs >= 1000 ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : abs >= 10 ? value.toFixed(1) : abs >= 0.01 ? value.toFixed(3) : value.toExponential(1);
  return unit && unit !== "%" ? `${s}${unit === "°" ? "°" : ` ${unit}`}` : unit === "%" ? `${s}%` : s;
}

export function ago(iso: string | undefined | number, now = Date.now()): string {
  if (iso == null) return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function duration(ms: number): string {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** A run's rows split into series per metric and split: `"val_loss"`, `"loss (train)"`… */
export function series(rows: Row[] | undefined): Map<string, { x: number; y: number }[]> {
  const out = new Map<string, { x: number; y: number }[]>();
  for (const r of rows ?? []) {
    for (const [k, y] of Object.entries(r.metrics ?? {})) {
      if (typeof y !== "number" || !Number.isFinite(y)) continue;
      const key = r.split && r.split !== "train" && !k.startsWith(`${r.split}_`) ? `${k}@${r.split}` : k;
      let s = out.get(key);
      if (!s) out.set(key, (s = []));
      s.push({ x: r.step, y });
    }
  }
  return out;
}

/** "acc/TOP@val" → { metric: "acc/TOP", split: "val" } */
export function splitKey(key: string): { metric: string; split?: string } {
  const at = key.lastIndexOf("@");
  return at < 0 ? { metric: key } : { metric: key.slice(0, at), split: key.slice(at + 1) };
}
