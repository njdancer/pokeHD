// ROM test for the HD map following the game's own blocks: CUT on the tree beside Vermilion's Gym
// (the game's UsedCut, as the Pokédex menu runs it) swaps block $35 for $4C in wOverworldMap
// (CutTreeBlockSwaps); BlockWatch sends the map's blocks and the live world builds Vermilion again
// with them. Loading the map afresh grows the tree back, in the game and in HD. Skips without the
// dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { parseWorld, SYMBOLS, type SymbolName } from "@pokehd/rom";
import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createLiveWorld } from "@pokehd/engine/world";
import type { ChunkJob } from "../../../../../packages/engine/src/world/chunk.ts";
import type { ChunkBuilder } from "../../../../../packages/engine/src/world/chunk-builder.ts";
import { BlockWatch, type LiveBlocks } from "../../../../../packages/emu/src/block-watch.ts";
import { Button, GameBoy } from "../../../../../packages/emu/src/core.ts";
import { GameActions, type ActionResult } from "../../../../../packages/emu/src/game/actions.ts";
import { playIntro, setParty } from "../../../../../packages/emu/src/testing.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

const VERMILION_CITY = 5;
const WIDTH = 20;
const SQUIRTLE = 0xb1;
const CUT = 0x0f;
/** The tree's block: (7, 9), holding the tree at step (15, 18). */
const TREE = 9 * WIDTH + 7;
const addr = (name: SymbolName) => SYMBOLS[name].address;

describe.skipIf(!existsSync(ROM_PATH))("the HD map follows the game's blocks (ROM)", () => {
  it("builds Vermilion again without the tree the player cut, and with it once the map reloads", async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    setParty(gb, rom, [{ species: SQUIRTLE, level: 20 }]);
    gb.write(addr("wPartyMons") + 8 + 3, CUT);
    gb.write(addr("wPartyMons") + 29 + 3, 30);
    gb.write(addr("wObtainedBadges"), 0b10); // the CASCADEBADGE
    const sent: LiveBlocks[] = [];
    const watch = new BlockWatch(gb, (b) => sent.push(b));
    const withFrames = (n: number) => {
      for (let i = 0; i < n; i++) {
        gb.runFrame();
        watch.frame();
      }
    };
    // Where the QA player stood (QA bug 69): (14, 18), just left of the tree.
    const enter = () => {
      let entered = false;
      const remove = gb.addHook("OverworldLoop", (g) => {
        if (entered) return;
        entered = true;
        g.write(addr("wCurMap"), VERMILION_CITY);
        g.write(addr("wXCoord"), 14);
        g.write(addr("wYCoord"), 18);
        const view = addr("wOverworldMap") + 7 + WIDTH + (WIDTH + 6) * 9 + 7;
        g.write(addr("wCurrentTileBlockMapViewPointer"), view & 0xff);
        g.write(addr("wCurrentTileBlockMapViewPointer") + 1, view >> 8);
        g.write(addr("wYBlockCoord"), 0);
        g.write(addr("wXBlockCoord"), 0);
        g.setRegisters({ pc: addr("EnterMap") });
      });
      withFrames(300);
      remove();
    };
    enter();
    // The map load (LoadTileBlockMap) sent Vermilion as the ROM has it.
    const world = parseWorld(rom);
    const vermilion = world.maps[VERMILION_CITY]!;
    expect(sent.at(-1)).toMatchObject({ map: VERMILION_CITY, width: 20, height: 18 });
    expect(sent.at(-1)!.blocks).toEqual(vermilion.blocks);
    expect(vermilion.blocks[TREE]).toBe(0x35);

    // The live world, fed what the page feeds it, with a builder that only notes its jobs.
    const jobs: ChunkJob[] = [];
    const builder: ChunkBuilder = {
      build: (job) => {
        jobs.push(job);
        return { group: new THREE.Group(), rootX: 0, rootY: 0, mainMs: 0, totalMs: 0 };
      },
      dispose() {},
    };
    const live = createLiveWorld(world, { builder });
    const camera = new THREE.PerspectiveCamera();
    const update = () => live.update(0, camera, new THREE.Vector3(), false);
    const player = { x: 14, y: 18, step: null, animFrame: 0, facing: "right" as const };
    live.push({ mapId: VERMILION_CITY, player, npcs: [], fade: 0 });
    for (const b of sent) live.setBlocks(b.map, b.blocks);
    for (let i = 0; i < 8; i++) update(); // Vermilion and the maps around it
    expect(jobs.filter((j) => j.map === VERMILION_CITY)).toHaveLength(1);
    expect(jobs[0]!.blocks).toBeUndefined();

    // Face the tree and CUT it, with the game's UsedCut.
    gb.setButtons(Button.Right);
    withFrames(4);
    gb.setButtons(0);
    withFrames(30);
    sent.length = 0;
    const game = new GameActions(gb, { rom });
    let result: ActionResult | undefined;
    game.run({ kind: "cut", mon: 0 }, (r) => (result = r));
    for (let i = 0; i < 1200 && !result; i++) withFrames(1);
    expect(result?.ok).toBe(true);
    withFrames(2);
    expect(sent.at(-1)?.map).toBe(VERMILION_CITY);
    expect(sent.at(-1)!.blocks[TREE]).toBe(0x4c);
    // Only the tree's block differs from the ROM's.
    const changed = [...sent.at(-1)!.blocks].flatMap((b, i) => (b === vermilion.blocks[i] ? [] : [i]));
    expect(changed).toEqual([TREE]);

    for (const b of sent) live.setBlocks(b.map, b.blocks);
    update();
    const rebuilt = jobs.at(-1)!;
    expect(rebuilt.map).toBe(VERMILION_CITY);
    expect(rebuilt.blocks?.[TREE]).toBe(0x4c);

    // Loading Vermilion again (as a warp or a battle's end does) grows the tree back.
    sent.length = 0;
    enter();
    expect(sent.at(-1)!.blocks[TREE]).toBe(0x35);
    for (const b of sent) live.setBlocks(b.map, b.blocks);
    expect(live.liveBlocks.size).toBe(0);
    update();
    expect(jobs.at(-1)!.map).toBe(VERMILION_CITY);
    expect(jobs.at(-1)!.blocks).toBeUndefined();
    live.dispose();
    watch.dispose();
  }, 60_000);
});
