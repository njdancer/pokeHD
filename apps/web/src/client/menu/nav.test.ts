import { describe, expect, it } from "vitest";
import { rootOf, TABS, withoutPicks, type Screen } from "./nav.tsx";
import type { TabId } from "./icons.tsx";

const stacks = (inv: Screen[]) => ({ ...(Object.fromEntries(TABS.map((t) => [t.id, [rootOf(t.id)]])) as Record<TabId, Screen[]>), inv });

describe("withoutPicks (QA bug 54)", () => {
  it("drops a one-off pick and what's above it, keeping the screen it started from", () => {
    const place = { tab: "inv" as TabId, stacks: stacks([{ k: "inv" }, { k: "item", id: 0xd4 }, { k: "team", for: { teach: 0xd4 } }, { k: "mon", i: 0, for: { teach: 0xd4 } }]) };
    expect(withoutPicks(place).stacks.inv).toEqual([{ k: "inv" }, { k: "item", id: 0xd4 }]);
    expect(withoutPicks(place).tab).toBe("inv");
  });

  it("keeps a plain place as it is", () => {
    const place = { tab: "inv" as TabId, stacks: stacks([{ k: "inv" }, { k: "mon", i: 1 }]) };
    expect(withoutPicks(place)).toBe(place);
  });
});
