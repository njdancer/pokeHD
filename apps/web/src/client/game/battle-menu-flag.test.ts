import { beforeEach, describe, expect, it } from "vitest";
import { battleMenuLayout } from "./battle-menu-flag.ts";

describe("battleMenuLayout", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;
  });

  it("is off until asked, then remembers the layout", () => {
    expect(battleMenuLayout("")).toBe(null);
    expect(battleMenuLayout("?battlemenus")).toBe("moves");
    expect(battleMenuLayout("")).toBe("moves");
    expect(battleMenuLayout("?battlemenus=classic")).toBe("classic");
    expect(battleMenuLayout("?battlemenus=0")).toBe(null);
    expect(battleMenuLayout("")).toBe(null);
  });
});
