import { Pane, type FolderApi } from "tweakpane";
import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
import type { FpsGraphBladeApi } from "@tweakpane/plugin-essentials";
import type { Engine, LookParams } from "../index.ts";
import { LOOK_SCHEMA, type FieldSpec } from "../look/params.ts";
import { BUILT_IN_PRESETS, DEFAULT_LOOK } from "../look/presets.ts";

// Look-dev panel (mounted with `?lookdev`): every LookParams field, generated from the schema,
// plus performance readouts and preset load/save. Saved presets live in localStorage and
// export as JSON files; paste one into presets.ts to make it a built-in.

const STORAGE_KEY = "pokehd.lookdev.presets";
const FOLDERS_OPEN = new Set(["time", "grade"]);

function loadSaved(): Record<string, LookParams> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, LookParams>;
  } catch {
    return {};
  }
}

function storeSaved(saved: Record<string, LookParams>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Private windows can refuse storage; download still works.
  }
}

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "preset";

export function mountLookdevPanel(engine: Engine, hooks: { before?: () => void; after?: () => void }) {
  const look = engine.look;
  // Handle for scripted captures and console poking. Claimed each frame, so it always names
  // the engine that's actually running (React StrictMode mounts a throwaway one first).
  const handle = globalThis as { __lookdev?: Engine };
  const pane = new Pane({ title: "Look-dev" });
  pane.registerPlugin(EssentialsPlugin);
  const host = pane.element.parentElement!;
  Object.assign(host.style, { width: "min(320px, calc(100vw - 16px))", maxHeight: "calc(100vh - 16px)", overflowY: "auto", zIndex: "20" });
  // On a phone the panel would cover the scene; start it folded (tap the title to open).
  if (innerWidth < 700) pane.expanded = false;

  // Performance.
  const perf = pane.addFolder({ title: "Performance" });
  const fps = perf.addBlade({ view: "fpsgraph", label: "fps", rows: 2 }) as FpsGraphBladeApi;
  hooks.before = () => {
    handle.__lookdev = engine;
    fps.begin();
  };
  hooks.after = () => fps.end();
  perf.addBinding(engine.stats, "cpuMs", { label: "CPU ms", readonly: true, format: (v: number) => v.toFixed(2) });
  const res = { size: "" };
  perf.addBinding(res, "size", { label: "buffer", readonly: true });
  const resTimer = setInterval(() => (res.size = `${engine.stats.width}×${engine.stats.height} ${engine.backend}`), 500);
  const pin = { pin1440: false };
  perf.addBinding(pin, "pin1440", { label: "pin 2560×1440" }).on("change", (e) => {
    engine.setFixedSize(e.value ? { width: 2560, height: 1440 } : null);
  });

  // Presets.
  const presets = pane.addFolder({ title: "Presets" });
  let saved = loadSaved();
  const state = { preset: "Diorama", name: "" };
  const presetOptions = () =>
    Object.fromEntries([...Object.keys(BUILT_IN_PRESETS), ...Object.keys(saved).map((k) => `★ ${k}`)].map((k) => [k, k]));
  let picker = presets.addBinding(state, "preset", { options: presetOptions() });
  const lookup = (name: string) => BUILT_IN_PRESETS[name] ?? saved[name.replace(/^★ /, "")];
  const wirePicker = () =>
    picker.on("change", (e) => {
      const p = lookup(e.value);
      if (p) apply(p);
    });
  wirePicker();
  const refreshPicker = () => {
    const index = presets.children.indexOf(picker);
    picker.dispose();
    picker = presets.addBinding(state, "preset", { options: presetOptions(), index });
    wirePicker();
  };
  presets.addBinding(state, "name", { label: "save as" });
  presets.addButton({ title: "Save to browser" }).on("click", () => {
    const name = state.name.trim() || `Preset ${Object.keys(saved).length + 1}`;
    saved = { ...saved, [name]: structuredClone(look.params) };
    storeSaved(saved);
    state.preset = `★ ${name}`;
    refreshPicker();
  });
  presets.addButton({ title: "Delete saved preset" }).on("click", () => {
    const name = state.preset.replace(/^★ /, "");
    if (!state.preset.startsWith("★ ") || !saved[name]) return;
    const { [name]: _removed, ...rest } = saved;
    saved = rest;
    storeSaved(saved);
    state.preset = "Diorama";
    refreshPicker();
  });
  presets.addButton({ title: "Download JSON" }).on("click", () => {
    const json = JSON.stringify(look.params, null, 2);
    download(`${slug(state.name || state.preset)}.look.json`, new Blob([json], { type: "application/json" }));
  });
  presets.addButton({ title: "Copy JSON" }).on("click", () => {
    void navigator.clipboard.writeText(JSON.stringify(look.params, null, 2));
  });
  presets.addButton({ title: "Load JSON file…" }).on("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        apply(JSON.parse(await file.text()));
      } catch (err) {
        console.error("[lookdev] not a look preset", err);
      }
    };
    input.click();
  });
  presets.addButton({ title: "Reset to default" }).on("click", () => apply(DEFAULT_LOOK));
  presets.addButton({ title: "Capture PNG" }).on("click", async () => {
    download(`pokehd-${slug(state.preset)}.png`, await engine.capture());
  });

  // Every parameter, from the schema.
  const live: { refresh(): void }[] = [];
  for (const [group, fields] of Object.entries(LOOK_SCHEMA) as [keyof LookParams, Record<string, FieldSpec>][]) {
    const folder: FolderApi = pane.addFolder({ title: group, expanded: FOLDERS_OPEN.has(group) });
    const target = look.params[group] as unknown as Record<string, unknown>;
    for (const [key, spec] of Object.entries(fields)) {
      const opts: Record<string, unknown> = { label: spec.label ?? key };
      if (spec.kind === "number") Object.assign(opts, { min: spec.min, max: spec.max, step: spec.step });
      if (spec.kind === "color") opts.view = "color";
      if (spec.kind === "options") opts.options = spec.options;
      const binding = folder.addBinding(target, key, opts);
      binding.on("change", () => look.changed(`${group}.${key}`));
      // Fields the engine animates (drifting time, orbiting camera) need refreshing.
      if (`${group}.${key}` === "time.phase" || `${group}.${key}` === "camera.yaw") live.push(binding);
    }
  }
  const liveTimer = setInterval(() => live.forEach((b) => b.refresh()), 200);

  function apply(next: unknown) {
    look.set(next);
    pane.refresh();
  }

  return () => {
    clearInterval(resTimer);
    clearInterval(liveTimer);
    hooks.before = hooks.after = undefined;
    if (handle.__lookdev === engine) delete handle.__lookdev;
    pane.dispose();
  };
}
