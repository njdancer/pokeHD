// Where the player is, as far as the light goes (D42). The game keeps no "indoors" flag, but every
// map names a tileset, and the game itself treats OVERWORLD and PLATEAU as the outside (its
// CheckIfInOutsideMap). FOREST (Viridian Forest, the Safari Zone) is open sky too, so it keeps the
// day. CAVERN is every cave: Mt Moon, Rock Tunnel, Diglett's Cave, Seafoam Islands, Victory Road
// and the Cerulean Cave. Everything else is a building.

export type Setting = "outdoors" | "indoors" | "cave";

const OUTDOORS: ReadonlySet<string> = new Set(["OVERWORLD", "PLATEAU", "FOREST"]);

export function settingOfTileset(name: string | undefined): Setting {
  if (name === undefined || OUTDOORS.has(name)) return "outdoors";
  return name === "CAVERN" ? "cave" : "indoors";
}

/** Indoors and in caves the light stands still at this phase: the sun overhead. */
export const FIXED_PHASE = 0.5;
