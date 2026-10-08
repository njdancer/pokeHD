// Screenshot regression tests for the HD view: each scene is one map on /dev/shots, standing
// still with time frozen, rendered at a fixed size and compared with the last accepted render.
// Needs the ROM at rom/pokeblue.gb. Run: pnpm test:e2e shots.
// Baselines are renders of the ROM's graphics, so they never enter git (they live in the
// gitignored e2e/baselines/, per machine and renderer: GPUs don't draw identical pixels). The
// first run on a machine writes them and fails; after a deliberate look change, accept the new
// renders with: pnpm test:e2e shots --update-snapshots. Diffs land in test-results/.
import { expect, test } from "@playwright/test";
import { hasRom } from "./game.ts";

test.skip(!hasRom, "Needs rom/pokeblue.gb");

const SCENES: { name: string; query: string }[] = [
  { name: "pallet-town", query: "map=PALLET_TOWN" },
  { name: "pallet-town-morning", query: "map=PALLET_TOWN&phase=0.05" },
  { name: "pallet-town-evening", query: "map=PALLET_TOWN&phase=1" },
  { name: "route-1", query: "map=ROUTE_1" },
  { name: "viridian-city", query: "map=VIRIDIAN_CITY" },
  { name: "oaks-lab", query: "map=OAKS_LAB&at=5,6" },
  // The tier phones get, at an iPhone 13's portrait size in CSS pixels.
  { name: "pallet-town-phone", query: "map=PALLET_TOWN&quality=mobile&size=390x844" },
];

for (const { name, query } of SCENES) {
  test(name, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/dev/shots?${query}`);
    await expect(page.getByTestId("shots-status")).toHaveText(/^Ready/, { timeout: 150_000 });
    const png = await page.evaluate(async () => {
      const shots = (window as { __shots?: { capture(): Promise<string> } }).__shots!;
      return (await shots.capture()).split(",")[1]!;
    });
    expect(errors).toEqual([]);
    // A little slack for driver-level noise (dithering, float rounding); a look change moves far
    // more than this.
    expect(Buffer.from(png, "base64")).toMatchSnapshot(`${name}.png`, { threshold: 0.1, maxDiffPixelRatio: 0.002 });
  });
}
