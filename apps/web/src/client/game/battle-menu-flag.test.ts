import { beforeEach, describe, expect, it } from "vitest";
import { battleMenusOn } from "./battle-menu-flag.ts";

describe("battleMenusOn", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;
  });

  it("is on by default; ?battlemenus=0 turns it off on the device until ?battlemenus", () => {
    expect(battleMenusOn("")).toBe(true);
    expect(battleMenusOn("?battlemenus=0")).toBe(false);
    expect(battleMenusOn("")).toBe(false);
    expect(battleMenusOn("?battlemenus")).toBe(true);
    expect(battleMenusOn("")).toBe(true);
  });

  it("keeps the old trial's remembered choice: on", () => {
    localStorage.setItem("pokehd.battleMenus", "moves");
    expect(battleMenusOn("")).toBe(true);
  });
});
