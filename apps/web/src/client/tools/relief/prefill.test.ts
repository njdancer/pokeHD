import { describe, expect, it } from "vitest";
import { parseReliefLink, reliefLink } from "./link.ts";
import { FRONT, hip, slope, TOP, type Normal } from "./normals.ts";
import { decodeLayer, overlayPrediction, pickLayer, tilesFromPrediction, type Prediction } from "./prefill.ts";

const grey = (...v: number[]) => v.flatMap((g) => [g, g, g, 255]);
const close = (a: Normal | null | undefined, b: Normal) => { expect(a).not.toBeNull(); a!.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, 2)); };

describe("decodeLayer", () => {
  it("turns face indices into the editor's presets, 255 into nothing", () => {
    const out = decodeLayer("faces", grey(0, 1, 2, 3, 4, 255), 30)!;
    expect(out.slice(0, 2)).toEqual([TOP, FRONT]);
    expect(out[2]).toEqual(slope(30));
    expect(out[3]).toEqual(hip(-1, 30));
    expect(out[4]).toEqual(hip(1, 30));
    expect(out[5]).toBeNull();
  });

  it("reads normals from RGB, alpha 0 as nothing", () => {
    const out = decodeLayer("normals", [127.5, 255, 127.5, 255, 128, 128, 255, 255, 0, 0, 0, 0], 30)!;
    close(out[0], TOP);
    close(out[1], FRONT);
    expect(out[2]).toBeNull();
  });

  it("can't prefill from other encodings", () => {
    expect(decodeLayer("depth", grey(0), 30)).toBeNull();
    expect(decodeLayer("rgb", grey(0), 30)).toBeNull();
  });
});

describe("tilesFromPrediction", () => {
  // 16×8 pixels: two tiles side by side, both tile 7; the left one is all TOP, the right all FRONT.
  const pred: Prediction = Array.from({ length: 128 }, (_, i) => (i % 16 < 8 ? TOP : FRONT));
  it("takes a tile from its first appearance", () => {
    const tiles = tilesFromPrediction(16, 8, pred, () => 7, () => false);
    expect([...tiles.keys()]).toEqual([7]);
    expect(tiles.get(7)!.every((n) => n === TOP)).toBe(true);
  });
  it("leaves out tiles already painted", () => {
    const tiles = tilesFromPrediction(16, 8, pred, (tx) => tx, (t) => t === 0);
    expect([...tiles.keys()]).toEqual([1]);
    expect(tiles.get(1)!.every((n) => n === FRONT)).toBe(true);
  });
  it("overlays only predicted pixels", () => {
    const into: Normal[] = [FRONT, FRONT];
    overlayPrediction(into, [null, TOP]);
    expect(into).toEqual([FRONT, TOP]);
  });
});

describe("pickLayer", () => {
  const manifest = {
    schema: 1, title: "Real maps", view: "map",
    layers: { pred: { label: "Prediction", encoding: "faces" } },
    items: [{ id: "map:PALLET_TOWN:2,3,4,3", width: 128, height: 96, files: { pred: "real-maps/p0/pred.png" } }],
  };
  it("finds the file beside the manifest", () => {
    expect(pickLayer(manifest, "runs/r1/preds/real-maps.json", "map:PALLET_TOWN:2,3,4,3", "pred"))
      .toEqual({ file: "runs/r1/preds/real-maps/p0/pred.png", encoding: "faces", label: "Prediction", title: "Real maps" });
  });
  it("says why when it can't", () => {
    expect(pickLayer(manifest, "x.json", "map:NOPE", "pred")).toMatch(/no sample/);
    expect(pickLayer(manifest, "x.json", "map:PALLET_TOWN:2,3,4,3", "rule")).toMatch(/no layer/);
    expect(pickLayer({}, "x.json", "a", "b")).toMatch(/can read/);
  });
});

describe("reliefLink", () => {
  it("round-trips", () => {
    const opts = { map: "PALLET_TOWN", area: [2, 3, 5, 3] as [number, number, number, number], seed: "runs/r1/preds/real-maps.json", sample: "map:PALLET_TOWN:2,3,5,3", layer: "pred" };
    const url = reliefLink(opts);
    expect(url.startsWith("/tools/relief?")).toBe(true);
    expect(parseReliefLink(url.slice(url.indexOf("?")))).toEqual(opts);
    expect(parseReliefLink(reliefLink({ dex: 25 }).split("?")[1]!)).toEqual({ dex: 25 });
    expect(reliefLink({})).toBe("/tools/relief");
  });
});
