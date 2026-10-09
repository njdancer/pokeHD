// ---- 07 level 9: walking ----------------------------------------------------------------------
const findMark = (id, from) => findEv((e) => e.t === "beat" && e.id === id, from);
const walkShot = () => [RAMP.tilemap, RAMP.bgmap, "lcd"];
const P_ = (...ids) => ids.map((id) => (typeof id === "string" && RAMP[id] ? RAMP[id] : id));
const walkPace = { slow: 0, budget: 2, frame: 0.1, bankFast: 0.04 };
const DIRNAME = { up: "up", down: "down", left: "left", right: "right" };

/** Run one step in the model and return the event range. */
function genStep(dir) {
  const a = EV.length;
  const ok = M.step(dir);
  return { a, b: EV.length, ok };
}
function stepBeats(dir, opts = {}) {
  const { a, b, ok } = genStep(dir);
  if (!ok) {
    const blocked = EV.slice(a, b).reverse().find((e) => e.t === "blocked");
    return [
      {
        i0: a,
        i1: b,
        cap: blocked?.why === "person" ? "Someone is standing there, so Red just turns." : "That tile isn't on the walkable list, so Red just turns to face it.",
        det: `${at("CollisionCheckOnLand")} looked up the tile in front of Red ($${hex(blocked?.tile ?? 0)}) in ${code("Overworld_Coll")} and reached the $FF end marker without finding it.`,
        pace: { slow: 0, budget: 2.5, frame: 0.14, bankFast: 0.04 },
        shotOnly: walkShot(),
        free: opts.free,
      },
    ];
  }
  if (!opts.breakdown) {
    return [
      {
        i0: a,
        i1: b,
        cap: opts.cap || `Red walks ${DIRNAME[dir]}: a new ${dir === "up" || dir === "down" ? "row" : "column"} of tiles slides in.`,
        det:
          opts.det ||
          `The same work as the first step: on the first pass the view pointer moves, ${at("LoadCurrentMapView")} rebuilds ${code("wTileMap")}, the new edge is copied to ${code("wRedrawRowOrColumnSrcTiles")} and drawn into the BG map in the next VBlank. Then 8 passes nudge the scroll by 2 pixels each, one every other frame.`,
        pace: walkPace,
        shotOnly: walkShot(),
        free: opts.free,
        after: opts.after,
      },
    ];
  }
  // the first step, taken apart
  const col = findCall("CollisionCheckOnLand", a);
  const wc = findEv((e) => e.t === "w" && e.a === S.wWalkCounter && e.v === 8, col);
  const wv = findMark("walk-view", a);
  const ws = findMark("walk-schedule", a);
  const wsc = findMark("walk-scroll", a);
  const red = retAfter("RedrawRowOrColumn", wsc);
  const cuts = [a, col, wc, wv, ws, wsc, red, b];
  const info = [
    {
      cap: `You pressed ${dir}. The overworld loop reads the joypad and Red turns to face ${dir === "right" ? "right" : dir}.`,
      det: `${at("OverworldLoop")} runs every other frame. It stores the button in ${code("hJoyHeld")} and ${code("wPlayerDirection")}, and ${at("UpdateSprites")} picks Red's facing.`,
      pace: { slow: 8, budget: 2 },
      shotOnly: P_("hram", "tilemap", "lcd"),
    },
    {
      cap: "Can Red stand there? Only if the tile in front of him is on the walkable list.",
      det: `${at("CollisionCheckOnLand")} copies the tile number in front of Red's feet from ${code("wTileMap")} to ${code("wTileInFrontOfPlayer")}, then walks the tileset's list (${code("Overworld_Coll")}, ${symAddr("Overworld_Coll")}) until it finds it or reaches $FF.`,
      pace: { slow: 4, budget: 2.5 },
      shot: P_("tilemap"),
    },
    {
      cap: "Yes. The walk counter is set to 8, and the view moves half a block.",
      det: `${at("AdvancePlayerSprite")}: ${code("wWalkCounter")} = 8 passes. On the first pass, ${code("wMapViewVRAMPointer")} moves 2 tiles (wrapping at 32), and ${code("wXBlockCoord")} goes 1 → 2 → 0, so ${code("wCurrentTileBlockMapViewPointer")} moves one block.`,
      pace: { slow: 10, budget: 2 },
      shotOnly: P_("ovw", ...PANELS.filter((p) => p.vars && p.keys.includes(S.wWalkCounter))),
    },
    {
      cap: "The game redraws its whole idea of the screen, wTileMap, from the blocks.",
      det: `${at("LoadCurrentMapView")} again, exactly as in level 6, from the new view pointer. It is slow enough that a frame ends (and VBlank runs) before it finishes.`,
      pace: { slow: 0, budget: 3, frame: 0.3, bankFast: 0.04 },
      shotOnly: P_("ovw", "surr", "tilemap"),
    },
    {
      cap: "Only the new edge needs to reach the chip: 2 columns of 18 tiles.",
      det: `${at("ScheduleEastColumnRedraw")} copies wTileMap's last 2 columns to ${code("wRedrawRowOrColumnSrcTiles")} and leaves the BG map address and a request ($01, a column) in high RAM.`,
      pace: { slow: 4, budget: 2 },
      shotOnly: P_("tilemap", "redraw"),
    },
    {
      cap: "While the chip rests, the edge goes into the BG map, just past the screen's right side.",
      det: `In the next VBlank, ${code("hSCX")} becomes SCX (0 → 2) and ${at("RedrawRowOrColumn")} copies the 36 bytes into the BG map column, wrapping at 32.`,
      pace: { slow: 4, budget: 2.5, frame: 0.3, bankFast: 0.04 },
      shotOnly: P_("redraw", "bgmap", "lcd"),
    },
    {
      cap: "Red stays in the middle. The world slides under him, 2 pixels at a time.",
      det: "7 more passes, every other frame: SCX + 2 each time, and every other person's screen position − 2 so they stay put on the map. Red's walking frame changes every 4 passes.",
      pace: { slow: 0, budget: 3, frame: 0.18, bankFast: 0.04 },
      shotOnly: P_("bgmap", "lcd", "oam"),
    },
  ];
  return info.map((x, j) => ({ i0: cuts[j], i1: cuts[j + 1], ...x }));
}

// generate the guided walk now (it is fixed), and remember where free play starts
const L9 = { beats: [] };
L9.beats.push(...stepBeats("right", { breakdown: true }));
L9.beats.push(...stepBeats("right", { cap: "Again: the next column comes from the next half of a block." }));
L9.beats.push(...stepBeats("right", { cap: "And once more." }));
L9.beats.push(...stepBeats("up", { cap: "Up works the same way, with a row of 20 instead of a column." }));
L9.beats.push(...stepBeats("up", { cap: "Up again. The top of the town reaches the screen's top edge." }));
L9.beats.push(
  ...stepBeats("up", {
    cap: "These rows of grass came from Route 1's bank back in level 4. Now they reach the screen.",
    det: "The new top row's tiles were drawn from blocks in wOverworldMap's border, which LoadNorthSouthConnectionsTileMap copied from Route 1's layout in bank 7. Tap any of the new BG map cells and follow the chain back.",
    after: "route1",
  }),
);
const FREE_AT = EV.length;
L9.beats.push({
  i0: FREE_AT,
  i1: FREE_AT,
  cap: "Your turn. Walk anywhere in Pallet Town with the arrows.",
  det: "Trees, water, houses and fences block you, exactly like the game (it's the same walkable list). The girl and the fisherman stand still here; in the real game they wander. North of the town the real game sends Oak to stop you, so here you stop at the edge.",
  shot: walkShot(),
  free: true,
  dim: false,
  shotOnly: walkShot(),
});
addLevel({ n: 9, title: "Walking", blurb: "Drive Red yourself and watch every step's bytes.", beats: L9.beats });
