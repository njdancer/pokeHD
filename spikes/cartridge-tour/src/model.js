// A byte-level model of what Pokémon Blue does to bring Pallet Town onto the screen.
// It follows the routines in vendor/pokered line by line (names match), on real ROM bytes, and
// records every write as an event with provenance (where the byte came from), so the tour can
// animate it and answer "where did this come from?" for any byte. Checked against the real game
// running in SameBoy by check.mjs. Runs in Node and in the browser (no imports).

/* eslint-disable no-bitwise */

export const PROV_INIT = -1; // the byte was already there (left over from Red's house)

export class Machine {
  /**
   * @param {object} o
   * @param {(romOffset:number)=>number} o.rom  byte at bank*0x4000 + (addr & 0x3fff)
   * @param {Uint8Array} o.ram   initial contents of $8000-$FFFF (0x8000 bytes)
   * @param {Record<string, number>} o.S  addresses: RAM symbols as addr, ROM symbols as bank*0x10000+addr
   */
  constructor({ rom, ram, S }) {
    this.romByte = rom;
    this.S = S;
    this.mem = new Uint8Array(0x10000);
    this.mem.set(ram, 0x8000);
    this.prov = new Int32Array(0x10000).fill(PROV_INIT);
    this.provs = [];
    this.romProvs = new Map();
    this.events = [];
    this.fnStack = [];
    this.bank = this.mem[0xffb8] || 1; // the MBC3 register; the game mirrors it in hLoadedROMBank
    this.frame = 0;
    this.romReads = new Set(); // ROM offsets read (for building the embedded data)
  }

  // ---- addresses -------------------------------------------------------------------------------
  /** ROM offset of a CPU address in $0000-$7FFF with the current bank. */
  romOff(addr, bank = this.bank) {
    return addr < 0x4000 ? addr : bank * 0x4000 + (addr - 0x4000);
  }
  /** A source code for an event: ROM offset + 0x10000, or a RAM address. */
  srcCode(addr) {
    return addr < 0x8000 ? 0x10000 + this.romOff(addr) : addr;
  }
  sym(name) {
    const v = this.S[name];
    if (v === undefined) throw new Error(`no symbol ${name}`);
    return v & 0xffff;
  }
  symBank(name) {
    return this.S[name] >>> 16;
  }

  // ---- reads -----------------------------------------------------------------------------------
  rb(addr) {
    addr &= 0xffff;
    if (addr < 0x8000) {
      const o = this.romOff(addr);
      this.romReads.add(o);
      return this.romByte(o);
    }
    return this.mem[addr];
  }
  rw(addr) {
    return this.rb(addr) | (this.rb(addr + 1) << 8);
  }
  pv(addr) {
    addr &= 0xffff;
    if (addr < 0x8000) return this.romProv(this.romOff(addr));
    return this.prov[addr];
  }
  romProv(o) {
    let id = this.romProvs.get(o);
    if (id === undefined) {
      id = this.provs.push({ k: "rom", o }) - 1;
      this.romProvs.set(o, id);
    }
    return id;
  }
  newProv(p) {
    return this.provs.push(p) - 1;
  }

  // ---- writes ----------------------------------------------------------------------------------
  w(addr, v, p, s = -1) {
    addr &= 0xffff;
    v &= 0xff;
    this.mem[addr] = v;
    this.prov[addr] = p;
    this.events.push({ t: "w", a: addr, v, p, s, f: this.fn });
  }
  /** ld a, [src] / ld [dst], a: a copy with provenance. `via` names the byte that chose the source. */
  cp(src, dst, via) {
    const v = this.rb(src);
    const p = this.newProv({ k: "cp", s: this.srcCode(src), from: this.pv(src), fn: this.fn, via });
    this.w(dst, v, p, this.srcCode(src));
    return v;
  }
  /** A value the code sets itself (a constant, or worked out from other bytes). */
  set(addr, v, note, deps = []) {
    const p = this.newProv({ k: "set", fn: this.fn, note, deps });
    this.w(addr, v, p);
    return v;
  }
  /** Copy n bytes (CopyData). */
  copy(src, dst, n, via) {
    for (let i = 0; i < n; i++) this.cp(src + i, dst + i, via);
  }

  // ---- control ---------------------------------------------------------------------------------
  get fn() {
    return this.fnStack[this.fnStack.length - 1] ?? "";
  }
  call(name) {
    this.onCall?.(name);
    this.fnStack.push(name);
    this.events.push({ t: "call", fn: name });
  }
  ret() {
    this.fnStack.pop();
    this.events.push({ t: "ret", fn: this.fn });
  }
  run(name, body) {
    this.call(name);
    const r = body();
    this.ret();
    return r;
  }
  beat(id) {
    this.events.push({ t: "beat", id });
  }
  /** A read the tour should point at without copying it (a lookup, a comparison). */
  look(addr, note) {
    this.events.push({ t: "look", s: this.srcCode(addr), v: this.rb(addr), note, f: this.fn });
  }
  /** Registers for the HUD. */
  reg(name, v) {
    this.events.push({ t: "reg", r: name, v });
  }
  /** ldh [hLoadedROMBank], a / ld [rROMB], a */
  switchBank(b, note) {
    const old = this.bank;
    this.set(0xffb8, b, note ?? "bank number written to hLoadedROMBank");
    this.bank = b;
    this.events.push({ t: "bank", b, old, f: this.fn });
  }
  /** call BankswitchHome / farcall: switch, run, switch back. */
  far(bank, name, body) {
    const saved = this.bank;
    this.switchBank(bank, `farcall ${name}`);
    const r = this.run(name, body);
    this.switchBank(saved, "back to the caller's bank");
    return r;
  }
  /** The end of a screen frame: the VBlank interrupt runs (once sprites are enabled). */
  endFrame() {
    this.onFrameDrawn?.();
    if (this.vblankOn) this.VBlank();
    this.frame++;
    this.events.push({ t: "frame", n: this.frame });
  }

  // ====== LoadMapData (home/overworld.asm) =====================================================
  LoadMapData() {
    const S = (n) => this.sym(n);
    this.call("LoadMapData");
    const savedBank = this.bank;
    this.beat("lcd-off");
    this.run("DisableLCD", () => this.set(0xff40, this.mem[0xff40] & 0x7f, "LCDC bit 7 cleared: screen off"));
    this.set(S("wMapViewVRAMPointer") + 1, 0x98, "HIGH(vBGMap0)");
    this.set(S("wMapViewVRAMPointer"), 0x00, "LOW(vBGMap0)");
    this.set(S("hSCY"), 0, "xor a");
    this.set(S("hSCX"), 0, "xor a");
    this.set(S("wWalkCounter"), 0, "xor a");
    this.set(S("wUnusedCurMapTilesetCopy"), 0, "xor a");
    this.set(S("wWalkBikeSurfStateCopy"), 0, "xor a");
    this.set(S("wSpriteSetID"), 0, "xor a");
    this.beat("textbox");
    this.run("LoadTextBoxTilePatterns", () => {
      const src = S("TextBoxGraphics");
      const n = this.sym("TextBoxGraphicsEnd") - src;
      this.FarCopyData2(this.symBank("TextBoxGraphics"), src, 0x9600, n);
    });
    this.LoadMapHeader();
    this.InitMapSprites();
    this.LoadTileBlockMap();
    this.LoadTilesetTilePatternData();
    this.LoadCurrentMapView();
    this.beat("to-vram");
    // copy current map view to VRAM (the screen is off, so straight in)
    let hl = S("wTileMap");
    let de = 0x9800;
    for (let y = 0; y < 18; y++) {
      for (let x = 0; x < 20; x++) this.cp(hl++, de++);
      de += 32 - 20;
    }
    this.set(S("wUpdateSpritesEnabled"), 1, "ld a, $01");
    this.beat("lcd-on");
    this.run("EnableLCD", () => this.set(0xff40, this.mem[0xff40] | 0x80, "LCDC bit 7 set: screen on"));
    this.vblankOn = true; // with the screen on, the VBlank interrupt runs at the end of every frame
    this.run("RunPaletteCommand", () => this.look(S("wOnSGB"), "wOnSGB is 0: not a Super Game Boy, nothing to do"));
    this.beat("red-gfx");
    this.LoadPlayerSpriteGraphics();
    this.ret();
    void savedBank;
  }

  FarCopyData2(bank, src, dst, n) {
    this.run("FarCopyData2", () => {
      const saved = this.bank;
      this.set(0xff8b, bank, "hROMBankTemp"); // ldh [hROMBankTemp], a
      this.switchBank(bank);
      this.run("CopyData", () => {
        this.reg("HL", src);
        this.reg("DE", dst);
        this.copy(src, dst, n);
      });
      this.switchBank(saved, "pop af: back to the saved bank");
    });
  }

  SwitchToMapRomBank(map) {
    const S = (n) => this.sym(n);
    this.run("SwitchToMapRomBank", () => {
      // BankswitchHome
      this.set(S("wBankswitchHomeTemp"), this.symBank("MapHeaderBanks"), "BANK(MapHeaderBanks)");
      this.cp(0xffb8, S("wBankswitchHomeSavedROMBank"));
      this.switchBank(this.symBank("MapHeaderBanks"), "BankswitchHome: BANK(MapHeaderBanks)");
      const entry = S("MapHeaderBanks") + map;
      this.look(entry, "MapHeaderBanks + map number");
      this.cp(entry, S("hMapROMBank"));
      this.switchBank(this.mem[S("wBankswitchHomeSavedROMBank")], "BankswitchBack");
      const b = this.mem[S("hMapROMBank")];
      this.switchBank(b, "the map's bank, from hMapROMBank");
      this.prov[0xffb8] = this.newProv({ k: "cp", s: S("hMapROMBank"), from: this.prov[S("hMapROMBank")], fn: this.fn });
    });
  }

  // ====== LoadMapHeader ========================================================================
  LoadMapHeader() {
    const S = (n) => this.sym(n);
    this.call("LoadMapHeader");
    this.beat("mark-town");
    this.far(this.symBank("MarkTownVisitedAndLoadToggleableObjects"), "MarkTownVisitedAndLoadToggleableObjects", () => {
      // Pallet is town 0: set bit 0 of wTownVisitedFlag. (The toggleable-object list it also builds
      // only decides who is hidden; Oak's hidden flag is already set from the new game.)
      const map = this.mem[S("wCurMap")];
      const tv = S("wTownVisitedFlag") + (map >> 3);
      this.set(tv, this.mem[tv] | (1 << (map & 7)), "town visited (for Fly)");
      // the map's entries in ToggleableObjectStates (3 bytes: map, sprite, state) → wToggleableObjectList
      const ptrAddr = S("ToggleableObjectMapPointers") + map * 2;
      this.look(ptrAddr, "ToggleableObjectMapPointers + map × 2");
      let hl = this.rw(ptrAddr);
      let global = (hl - S("ToggleableObjectStates")) / 3;
      let de = S("wToggleableObjectList");
      while (this.rb(hl) === map) {
        this.cp(hl + 1, de++);
        this.set(de++, global++, "global toggleable object number", [this.pv(hl)]);
        hl += 3;
      }
      this.set(de, 0xff, "end of list");
    });
    this.cp(S("wCurMapTileset"), S("wUnusedCurMapTilesetCopy"));
    this.beat("header-ptr");
    const map = this.mem[S("wCurMap")];
    this.SwitchToMapRomBank(map);
    const prevTileset = this.mem[S("wCurMapTileset")];
    this.set(S("wCurMapTileset"), prevTileset & 0x7f, "res BIT_NO_PREVIOUS_MAP");
    this.cp(S("wCurMapTileset"), S("hPreviousTileset"));
    // hl = MapHeaderPointers + map * 2 (bank 0)
    const ptrAddr = S("MapHeaderPointers") + map * 2;
    this.look(ptrAddr, "MapHeaderPointers + map × 2: low byte");
    this.look(ptrAddr + 1, "high byte");
    let hl = this.rw(ptrAddr);
    this.reg("HL", hl);
    this.headerAddr = { bank: this.bank, addr: hl, ptrAddr };
    this.beat("header-fixed");
    // .copyFixedHeaderLoop: wCurMapHeader .. wCurMapHeaderEnd (10 bytes)
    this.reg("DE", S("wCurMapHeader"));
    for (let i = 0; i < 10; i++) this.cp(hl++, S("wCurMapHeader") + i);
    this.beat("connections");
    for (const n of ["wNorthConnectedMap", "wSouthConnectedMap", "wWestConnectedMap", "wEastConnectedMap"])
      this.set(S(n), 0xff, "$ff: no connection unless the header says so");
    const conn = this.mem[S("wCurMapConnections")];
    const order = [
      [3, "wNorthConnectionHeader"],
      [2, "wSouthConnectionHeader"],
      [1, "wWestConnectionHeader"],
      [0, "wEastConnectionHeader"],
    ];
    for (const [bit, name] of order) {
      this.look(S("wCurMapConnections"), `bit ${bit}`);
      if (!(conn & (1 << bit))) continue;
      this.run("CopyMapConnectionHeader", () => {
        for (let i = 0; i < 11; i++) this.cp(hl++, S(name) + i);
      });
    }
    this.beat("objects-ptr");
    // .getObjectDataPointer
    this.cp(hl++, S("wObjectDataPointerTemp"));
    this.cp(hl++, S("wObjectDataPointerTemp") + 1);
    const afterHeader = hl;
    hl = this.mem[S("wObjectDataPointerTemp")] | (this.mem[S("wObjectDataPointerTemp") + 1] << 8);
    this.reg("HL", hl);
    this.beat("border");
    this.cp(hl++, S("wMapBackgroundTile"));
    this.beat("warps");
    const nWarps = this.cp(hl++, S("wNumberOfWarps"));
    for (let i = 0; i < nWarps * 4; i++) this.cp(hl++, S("wWarpEntries") + i);
    this.beat("signs");
    const nSigns = this.cp(hl++, S("wNumSigns"));
    for (let i = 0; i < nSigns; i++) {
      this.cp(hl++, S("wSignCoords") + i * 2);
      this.cp(hl++, S("wSignCoords") + i * 2 + 1);
      this.cp(hl++, S("wSignTextIDs") + i);
    }
    this.beat("sprites");
    const nSprites = this.cp(hl++, S("wNumSprites"));
    for (let i = 0; i < 0xf0; i++) {
      this.set(0xc110 + i, 0, "zero sprite state 1");
      this.set(0xc210 + i, 0, "zero sprite state 2");
    }
    for (let i = 1; i < 16; i++) this.set(0xc100 + i * 16 + 2, 0xff, "image index $ff: not drawn");
    for (let c = 0; c < nSprites; c++) {
      const base = 0xc110 + c * 16;
      this.cp(hl++, base); // picture ID
      this.cp(hl++, base + 0x100 + 4); // map Y
      this.cp(hl++, base + 0x100 + 5); // map X
      this.cp(hl++, base + 0x100 + 6); // movement byte 1
      const mov2 = hl++;
      const text = hl++;
      this.cp(mov2, S("hLoadSpriteTemp1"));
      this.cp(text, S("hLoadSpriteTemp2"));
      this.cp(mov2, S("wMapSpriteData") + c * 2);
      this.cp(text, S("wMapSpriteData") + c * 2 + 1);
      this.cp(text, S("hLoadSpriteTemp1"));
      this.set(S("wMapSpriteData") + c * 2 + 1, this.rb(text) & 0x3f, "text ID: and $3f", [this.pv(text)]);
      // regular sprites (all of Pallet's): zero the extra data
      this.set(S("wMapSpriteExtraData") + c * 2, 0, "regular sprite");
      this.set(S("wMapSpriteExtraData") + c * 2 + 1, 0, "regular sprite");
    }
    const warpsTo = hl; // the def_warps_to list follows the object data
    // .finishUp
    this.beat("tileset-header");
    this.LoadTilesetHeader(warpsTo);
    this.beat("map-size2");
    this.set(S("wCurrentMapHeight2"), this.mem[S("wCurMapHeight")] * 2, "height × 2", [this.prov[S("wCurMapHeight")]]);
    this.set(S("wCurrentMapWidth2"), this.mem[S("wCurMapWidth")] * 2, "width × 2", [this.prov[S("wCurMapWidth")]]);
    this.beat("music");
    const saved = this.bank;
    this.switchBank(this.symBank("MapSongBanks"), "BANK(MapSongBanks)");
    this.cp(S("MapSongBanks") + map * 2, S("wMapMusicSoundID"));
    this.cp(S("MapSongBanks") + map * 2 + 1, S("wMapMusicROMBank"));
    this.switchBank(saved, "pop af");
    this.ret();
    void afterHeader;
  }

  LoadTilesetHeader(warpsTo) {
    const S = (n) => this.sym(n);
    // predef: switches to the predef's bank, remembering the caller's in wPredefParentBank
    const parent = this.bank;
    this.cp(0xffb8, S("wPredefParentBank"));
    this.switchBank(this.symBank("Tilesets"), "predef LoadTilesetHeader");
    this.call("LoadTilesetHeader");
    const ts = this.mem[S("wCurMapTileset")];
    let hl = S("Tilesets") + ts * 12;
    this.look(S("wCurMapTileset"), "tileset × 12");
    this.reg("HL", hl);
    for (let i = 0; i < 11; i++) this.cp(hl++, S("wTilesetBank") + i);
    this.cp(hl, S("hTileAnimations"));
    this.set(S("hMovingBGTilesCounter1"), 0, "xor a");
    // dungeon tilesets list: is this tileset in it?
    let dungeon = false;
    for (let a = S("DungeonTilesets"); ; a++) {
      const t = this.rb(a);
      if (t === 0xff) break;
      if (t === ts) dungeon = true;
    }
    const prev = this.mem[S("hPreviousTileset")];
    if (dungeon || prev !== ts) {
      this.look(S("hPreviousTileset"), `previous tileset ${prev} ≠ ${ts}: Red came from a different tileset`);
      const id = this.mem[S("wDestinationWarpID")];
      if (id !== 0xff) {
        this.beat("warp-pos");
        this.run("LoadDestinationWarpPosition", () => {
          const saved = this.bank;
          this.switchBank(this.mem[S("wPredefParentBank")], "wPredefParentBank: the map's bank");
          const src = warpsTo + id * 4;
          this.reg("HL", src);
          this.copy(src, S("wCurrentTileBlockMapViewPointer"), 4);
          this.switchBank(saved, "pop af");
        });
        this.set(S("wYBlockCoord"), this.mem[S("wYCoord")] & 1, "wYCoord and 1", [this.prov[S("wYCoord")]]);
        this.set(S("wXBlockCoord"), this.mem[S("wXCoord")] & 1, "wXCoord and 1", [this.prov[S("wXCoord")]]);
      }
    }
    this.ret();
    this.switchBank(parent, "predef returns to the caller's bank");
  }

  // ====== InitMapSprites (engine/overworld/map_sprites.asm) =====================================
  InitMapSprites() {
    const S = (n) => this.sym(n);
    this.beat("sprite-set");
    this.far(this.symBank("InitMapSprites"), "InitMapSprites", () => {
      this.call("InitOutsideMapSprites");
      const map = this.mem[S("wCurMap")];
      const setAddr = S("MapSpriteSets") + map;
      this.look(setAddr, "MapSpriteSets + map");
      const setId = this.rb(setAddr);
      // (no split set for Pallet; wFontLoaded bit 0 clear; wSpriteSetID 0 ≠ set ID, so load it)
      this.set(S("wSpriteSetID"), setId, "the sprite set ID", [this.pv(setAddr)]);
      let de = S("SpriteSets") + (setId - 1) * 11;
      this.set(0xc20d, 0x01, "SPRITE_RED for the player slot"); // wSpritePlayerStateData2PictureID
      for (let i = 0; i < 11; i++) {
        this.cp(de, 0xc20d + (i + 1) * 16); // x#SPRITESTATEDATA2_PICTUREID
        this.cp(de, S("wSpriteSet") + i);
        de++;
      }
      for (let i = 12; i < 16; i++) this.set(0xc20d + i * 16, 0, "zero the remaining slots");
      const numSprites = this.mem[S("wNumSprites")];
      this.set(S("wNumSprites"), 11, "SPRITE_SET_LENGTH");
      this.beat("sprite-sheets");
      this.LoadMapSpriteTilePatterns();
      this.set(S("wNumSprites"), numSprites, "pop af: restore the map's sprite count");
      for (let i = 1; i < 16; i++) this.set(0xc20e + i * 16, 0, "zero the set's VRAM slots");
      this.beat("sprite-slots");
      // .storeVRAMSlotsLoop: each map sprite's picture ID is found in wSpriteSet; index+1 = VRAM slot
      for (let i = 1; i < 16; i++) {
        const pic = this.mem[0xc100 + i * 16];
        let c = 0;
        const deps = [this.prov[0xc100 + i * 16]];
        if (pic) {
          let k = 0;
          for (;;) {
            c++;
            const a = S("wSpriteSet") + k++;
            if (this.mem[a] === pic) {
              this.look(a, `picture $${pic.toString(16)} found at position ${k}`);
              deps.push(this.prov[a]);
              break;
            }
          }
          c++;
        }
        this.set(0xc20d + i * 16 + 1, c, pic ? "position in the sprite set + 1" : "slot unused", deps);
      }
      this.ret();
    });
  }

  LoadMapSpriteTilePatterns() {
    const S = (n) => this.sym(n);
    this.call("LoadMapSpriteTilePatterns");
    // copy picture IDs to image base offsets
    for (let i = 0; i < 16; i++) this.cp(0xc20d + i * 16, 0xc20e + i * 16);
    let fourTile = 0;
    this.set(S("hFourTileSpriteCount"), 0, "xor a");
    for (let i = 1; i <= 11; i++) {
      const slotAddr = 0xc20e + i * 16;
      const pic = this.mem[slotAddr];
      // (no earlier slot in the set repeats a picture)
      // next free VRAM slot among the first 10: max of earlier slots, + 1
      let b = 1;
      for (let j = 1; j < i; j++) {
        const s = this.mem[0xc20e + j * 16];
        if (s < 11 && s >= b) b = s;
      }
      let slot = b + 1;
      if (pic >= this.firstStillSprite) slot = fourTile + 11;
      this.set(slotAddr, slot, "VRAM slot", [this.prov[slotAddr]]);
      this.set(S("hVRAMSlot"), slot, "VRAM slot");
      const tbl = S("SpriteSheetPointerTable") + (pic - 1) * 4;
      this.look(tbl, `SpriteSheetPointerTable entry for picture $${pic.toString(16)}`);
      const src = this.rw(tbl);
      const size = this.rb(tbl + 2);
      const bank = this.rb(tbl + 3);
      let dst;
      if (slot < 11) dst = 0x8000 + (slot - 1) * 0xc0;
      else {
        dst = fourTile ? 0x8000 + 0x7c * 16 : 0x8000 + 0x78 * 16;
        if (!fourTile) this.set(S("hFourTileSpriteCount"), 1, "first 4-tile sprite loaded");
        fourTile = 1;
      }
      this.events.push({ t: "sheet", pic, slot, src, size, bank, dst });
      this.FarCopyData2(bank, src, dst, size);
      if (slot < 11) this.FarCopyData2(bank, src + 0xc0, dst + 0x800, size);
    }
    // the picture IDs in state 2 are no longer needed, so zero them
    for (let i = 0; i < 16; i++) this.set(0xc20d + i * 16, 0, "no longer needed");
    this.ret();
  }

  // ====== LoadTileBlockMap =====================================================================
  LoadTileBlockMap() {
    const S = (n) => this.sym(n);
    this.call("LoadTileBlockMap");
    this.beat("fill");
    const start = S("wOverworldMap");
    const end = S("wOverworldMapEnd");
    this.reg("HL", start);
    for (let a = start; a < end; a++) this.cp(S("wMapBackgroundTile"), a);
    this.beat("stride");
    const width = this.mem[S("wCurMapWidth")];
    this.cp(S("wCurMapWidth"), S("hMapWidth"));
    this.set(S("hMapStride"), width + 6, "width + MAP_BORDER × 2", [this.prov[S("wCurMapWidth")]]);
    let hl = start + (width + 6) * 3 + 3;
    let de = this.mem[S("wCurMapDataPtr")] | (this.mem[S("wCurMapDataPtr") + 1] << 8);
    this.reg("HL", de);
    this.reg("DE", hl);
    this.beat("blocks");
    const height = this.mem[S("wCurMapHeight")];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) this.cp(de++, hl + x);
      hl += width + 6;
    }
    for (const [dir, name] of [
      ["North", "wNorthConnectedMap"],
      ["South", "wSouthConnectedMap"],
    ]) {
      const h = S(name);
      const m = this.mem[h];
      if (m === 0xff) continue;
      this.beat(`conn-${dir.toLowerCase()}`);
      this.SwitchToMapRomBank(m);
      const src = this.mem[h + 1] | (this.mem[h + 2] << 8);
      const dst = this.mem[h + 3] | (this.mem[h + 4] << 8);
      this.cp(h + 5, S("hNorthSouthConnectionStripWidth"));
      this.cp(h + 6, S("hNorthSouthConnectedMapWidth"));
      this.run("LoadNorthSouthConnectionsTileMap", () => {
        const len = this.mem[h + 5];
        const cw = this.mem[h + 6];
        let s = src;
        let d = dst;
        for (let r = 0; r < 3; r++) {
          this.reg("HL", s);
          this.reg("DE", d);
          for (let i = 0; i < len; i++) this.cp(s + i, d + i);
          s += cw;
          d += width + 6;
        }
      });
    }
    this.ret();
  }

  // ====== LoadTilesetTilePatternData ===========================================================
  LoadTilesetTilePatternData() {
    const S = (n) => this.sym(n);
    this.beat("gfx");
    this.run("LoadTilesetTilePatternData", () => {
      const src = this.mem[S("wTilesetGfxPtr")] | (this.mem[S("wTilesetGfxPtr") + 1] << 8);
      this.FarCopyData2(this.mem[S("wTilesetBank")], src, 0x9000, 0x600);
    });
  }

  // ====== LoadCurrentMapView ===================================================================
  LoadCurrentMapView() {
    const S = (n) => this.sym(n);
    this.beat("view");
    this.call("LoadCurrentMapView");
    const saved = this.bank;
    this.switchBank(this.mem[S("wTilesetBank")], "wTilesetBank");
    let de = this.mem[S("wCurrentTileBlockMapViewPointer")] | (this.mem[S("wCurrentTileBlockMapViewPointer") + 1] << 8);
    let hl = S("wSurroundingTiles");
    const blocks = this.mem[S("wTilesetBlocksPtr")] | (this.mem[S("wTilesetBlocksPtr") + 1] << 8);
    const width = this.mem[S("wCurMapWidth")];
    for (let by = 0; by < 5; by++) {
      for (let bx = 0; bx < 6; bx++) {
        const blockAddr = de + bx;
        const block = this.mem[blockAddr];
        const out = hl + bx * 4;
        this.run("DrawTileBlock", () => {
          this.look(blockAddr, `block $${block.toString(16).padStart(2, "0")}`);
          const entry = blocks + block * 16;
          this.reg("HL", entry);
          for (let ty = 0; ty < 4; ty++)
            for (let tx = 0; tx < 4; tx++) this.cp(entry + ty * 4 + tx, out + ty * 24 + tx, this.prov[blockAddr]);
        });
      }
      de += width + 6;
      hl += 24 * 4;
    }
    this.beat("crop");
    let src = S("wSurroundingTiles");
    if (this.mem[S("wYBlockCoord")]) src += 24 * 2;
    if (this.mem[S("wXBlockCoord")]) src += 2;
    let dst = S("wTileMap");
    for (let y = 0; y < 18; y++) {
      for (let x = 0; x < 20; x++) this.cp(src + x, dst++);
      src += 24;
    }
    this.switchBank(saved, "pop af");
    this.ret();
  }

  // ====== LoadPlayerSpriteGraphics =============================================================
  LoadPlayerSpriteGraphics() {
    const S = (n) => this.sym(n);
    this.call("LoadPlayerSpriteGraphics");
    // walking state 0 → LoadWalkingPlayerSpriteGraphics
    this.call("LoadWalkingPlayerSpriteGraphics");
    const red = S("RedSprite");
    const bank = this.symBank("RedSprite");
    this.CopyVideoData(bank, red, 0x8000, 12);
    this.CopyVideoData(bank, red + 0xc0, 0x8800, 12);
    this.ret();
    this.ret();
  }

  /** Copies tiles 8 per VBlank (the screen is on, so only VBlank may touch VRAM). */
  CopyVideoData(bank, src, dst, tiles) {
    this.call("CopyVideoData");
    const saved = this.bank;
    this.switchBank(bank);
    let left = tiles;
    while (left > 0) {
      const n = Math.min(8, left);
      // the VBlank handler's VBlankCopy does the copying, 8 tiles at most per frame
      this.call("VBlankCopy");
      this.copy(src, dst, n * 16);
      this.ret();
      this.endFrame();
      src += n * 16;
      dst += n * 16;
      left -= n;
    }
    this.switchBank(saved, "back to hROMBankTemp's bank");
    this.ret();
  }

  get firstStillSprite() {
    return this.S.FIRST_STILL_SPRITE ?? 0x3d;
  }

  // ====== Every frame: VBlank (home/vblank.asm) ================================================
  VBlank() {
    const S = (n) => this.sym(n);
    this.call("VBlank");
    const saved = this.bank;
    this.cp(S("hSCX"), 0xff43);
    this.cp(S("hSCY"), 0xff42);
    this.RedrawRowOrColumn();
    this.UpdateMovingBgTiles();
    this.run("hDMARoutine", () => {
      for (let i = 0; i < 0xa0; i++) this.cp(0xc300 + i, 0xfe00 + i);
    });
    this.switchBank(this.symBank("PrepareOAMData"), "BANK(PrepareOAMData)");
    this.PrepareOAMData();
    this.switchBank(saved, "the interrupted code's bank");
    this.ret();
  }

  RedrawRowOrColumn() {
    const S = (n) => this.sym(n);
    const mode = this.mem[S("hRedrawRowOrColumnMode")];
    if (!mode) return;
    this.call("RedrawRowOrColumn");
    this.set(S("hRedrawRowOrColumnMode"), 0, "xor a: done");
    let hl = S("wRedrawRowOrColumnSrcTiles");
    let de = this.mem[S("hRedrawRowOrColumnDest")] | (this.mem[S("hRedrawRowOrColumnDest") + 1] << 8);
    this.reg("HL", hl);
    this.reg("DE", de);
    if (mode === 1) {
      // REDRAW_COL: 18 rows of 2 tiles, wrapping bottom to top
      for (let c = 0; c < 18; c++) {
        this.cp(hl++, de);
        this.cp(hl++, (de & 0xffe0) | ((de + 1) & 0x1f));
        de = (de + 32) & 0xffff;
        de = (de & 0x03ff) | 0x9800;
      }
    } else {
      // REDRAW_ROW: two rows of 20, wrapping right edge to left
      const half = (start) => {
        let e = start;
        for (let c = 0; c < 10; c++) {
          this.cp(hl++, e);
          e = (e & 0xffe0) | ((e + 1) & 0x1f);
          this.cp(hl++, e);
          e = (e & 0xffe0) | ((e + 1) & 0x1f);
        }
      };
      half(de);
      half((de & 0xff00) | ((de + 32) & 0xff));
    }
    this.ret();
  }

  UpdateMovingBgTiles() {
    const S = (n) => this.sym(n);
    const anim = this.mem[S("hTileAnimations")];
    if (!anim) return;
    const c1 = (this.mem[S("hMovingBGTilesCounter1")] + 1) & 0xff;
    this.set(S("hMovingBGTilesCounter1"), c1, "inc a");
    if (c1 < 20) return;
    this.call("UpdateMovingBgTiles");
    if (c1 === 21) {
      this.set(S("hMovingBGTilesCounter1"), 0, "xor a");
      const k = this.mem[S("wMovingBGTilesCounter2")] & 3;
      const src = k < 2 ? S("FlowerTile1") : k === 2 ? S("FlowerTile2") : S("FlowerTile3");
      this.copy(src, 0x9000 + 3 * 16, 16);
    } else {
      const c2 = (this.mem[S("wMovingBGTilesCounter2")] + 1) & 7;
      this.set(S("wMovingBGTilesCounter2"), c2, "inc a; and 7");
      const left = c2 & 4;
      for (let i = 0; i < 16; i++) {
        const a = 0x9000 + 0x14 * 16 + i;
        const v = this.mem[a];
        const r = left ? ((v << 1) | (v >> 7)) & 0xff : ((v >> 1) | (v << 7)) & 0xff;
        this.set(a, r, left ? "rlca: water ripples left" : "rrca: water ripples right", [this.prov[a]]);
      }
      if (anim & 1) this.set(S("hMovingBGTilesCounter1"), 0, "xor a");
    }
    this.ret();
  }

  PrepareOAMData() {
    const S = (n) => this.sym(n);
    this.call("PrepareOAMData");
    if (this.mem[S("wUpdateSpritesEnabled")] !== 1) {
      this.ret();
      return;
    }
    let oam = 0;
    const table = S("SpriteFacingAndAnimationTable");
    for (let off = 0; off < 0x100; off += 0x10) {
      const base = 0xc100 + off;
      if (!this.mem[base]) continue;
      const img = this.mem[base + 2];
      // GetSpriteScreenXY also refreshes the adjusted Y/X bytes
      const sy = this.mem[base + 4];
      const sx = this.mem[base + 6];
      this.set(base + 0xa, (sy + 4) & 0xf0, "screen Y + 4, and $f0", [this.prov[base + 4]]);
      this.set(base + 0xb, sx & 0xf0, "screen X and $f0", [this.prov[base + 6]]);
      if (img === 0xff) continue;
      let entry = img < 0xa0 ? img & 0xf : (img & 0xf) + 0x10;
      const prio = this.mem[base + 0x100 + 7] & 0x80;
      const ptr = table + entry * 4;
      this.look(base + 2, `image index $${img.toString(16)}: row ${entry} of SpriteFacingAndAnimationTable`);
      let bc = this.rw(ptr);
      let hl = this.rw(ptr + 2);
      const deps = [this.prov[base + 2], this.prov[base + 4], this.prov[base + 6]];
      for (;;) {
        const y = (sy + 16 + this.rb(hl)) & 0xff;
        const x = (sx + 8 + this.rb(hl + 1)) & 0xff;
        this.set(0xc300 + oam, y, "screen Y + 16 + this tile's Y offset", [...deps, this.romProv(this.romOff(hl))]);
        this.set(0xc300 + oam + 1, x, "screen X + 8 + this tile's X offset", [...deps, this.romProv(this.romOff(hl + 1))]);
        const tileOff = this.rb(bc++);
        let hi = (img >> 4) & 0xf;
        hi = hi === 0xb ? 0xa * 12 + 4 : hi * 12;
        this.set(0xc300 + oam + 2, (hi + tileOff) & 0xff, "picture slot × 12 + this frame's tile", [...deps, this.romProv(this.romOff(bc - 1))]);
        let flags = this.rb(hl + 2);
        if (flags & 0x02 /* UNDER_GRASS */) flags |= prio;
        this.set(0xc300 + oam + 3, flags, "flags (flip, palette, priority)", [...deps, this.romProv(this.romOff(hl + 2))]);
        hl += 3;
        oam += 4;
        if (flags & 0x01 /* BIT_END_OF_OAM_DATA */) break;
      }
    }
    for (; oam < 0xa0; oam += 4) if (this.mem[0xc300 + oam] !== 160) this.set(0xc300 + oam, 160, "unused: Y 160 hides it");
    this.ret();
  }

  /** The rest of EnterMap, then OverworldLoop's two DelayFrames before its first pass. */
  enterMap() {
    this.beat("enter-map");
    this.run("EnterMap", () => this.UpdateSprites());
    this.endFrame();
    this.endFrame();
  }

  /** Walk one step (8 passes, 2 frames each); returns false if blocked. */
  step(dir, simulated = false) {
    const r = this.OverworldPass(dir, simulated);
    this.endFrame();
    this.endFrame();
    if (r === "blocked") return false;
    while (this.mem[this.sym("wWalkCounter")]) {
      this.OverworldPass(null);
      this.endFrame();
      this.endFrame();
    }
    return true;
  }
  idle(passes = 1) {
    for (let i = 0; i < passes; i++) {
      this.OverworldPass(null);
      this.endFrame();
      this.endFrame();
    }
  }

  // ====== The overworld loop ====================================================================
  /** One pass of OverworldLoop (it runs every other frame). `dir` is the D-pad: down/up/left/right or null. */
  OverworldPass(dir, simulated = false) {
    const S = (n) => this.sym(n);
    this.call("OverworldLoop");
    this.run("LoadGBPal", () => {
      const off = this.mem[S("wMapPalOffset")];
      const src = S("FadePal4") - off;
      this.cp(src, 0xff47);
      this.cp(src + 1, 0xff48);
      this.cp(src + 2, 0xff49);
    });
    let result = "idle";
    if (this.mem[S("wWalkCounter")] === 0) {
      if (dir) {
        const bit = { right: 1, left: 2, down: 4, up: 8 }[dir];
        this.set(S("hJoyHeld"), { right: 0x10, left: 0x20, up: 0x40, down: 0x80 }[dir], "joypad", []);
        this.set(S("wPlayerDirection"), bit, "the direction pressed");
        this.cp(S("wPlayerDirection"), S("wPlayerMovingDirection"));
        this.UpdateSprites();
        const ok = simulated || this.CollisionCheckOnLand(dir);
        if (!ok) {
          this.ret();
          return "blocked";
        }
        this.set(S("wWalkCounter"), 8, "ld a, $08: 8 passes per step");
        const v = { right: [0, 1], left: [0, -1], down: [1, 0], up: [-1, 0] }[dir];
        this.set(S("wSpritePlayerStateData1YStepVector"), v[0] & 0xff, "step vector");
        this.set(S("wSpritePlayerStateData1XStepVector"), v[1] & 0xff, "step vector");
        result = "step";
      } else {
        this.set(S("wPlayerMovingDirection"), 0, "no button");
        this.set(S("wSpritePlayerStateData1YStepVector"), 0, "xor a");
        this.set(S("wSpritePlayerStateData1XStepVector"), 0, "xor a");
        this.UpdateSprites();
        this.ret();
        return "idle";
      }
    } else {
      this.UpdateSprites();
      result = "moving";
    }
    this.AdvancePlayerSprite();
    this.ret();
    return result;
  }

  UpdateSprites() {
    const S = (n) => this.sym(n);
    this.call("UpdateSprites");
    // UpdatePlayerSprite
    const walk = this.mem[S("wWalkCounter")];
    this.cp(S("wTileMap") + 9 * 20 + 8, S("hTilePlayerStandingOn"));
    if (!walk) {
      const d = this.mem[S("wPlayerMovingDirection")];
      const facing = d & 4 ? 0 : d & 8 ? 4 : d & 2 ? 8 : d & 1 ? 0xc : -1;
      if (facing < 0) {
        this.set(0xc107, 0, "not moving: zero the animation counters");
        this.set(0xc108, 0, "not moving: zero the animation counters");
      } else {
        this.set(0xc109, facing, "facing from the direction pressed", [this.prov[S("wPlayerMovingDirection")]]);
      }
    }
    if (walk || this.mem[S("wPlayerMovingDirection")]) {
      const c = (this.mem[0xc107] + 1) & 0xff;
      if (c === 4) {
        this.set(0xc107, 0, "every 4 passes…");
        this.set(0xc108, (this.mem[0xc108] + 1) & 3, "…the next walking frame");
      } else this.set(0xc107, c, "count passes");
    }
    this.set(0xc102, (this.mem[0xc109] + this.mem[0xc108]) & 0xff, "facing + walking frame", [this.prov[0xc109], this.prov[0xc108]]);
    const grass = this.mem[S("hTilePlayerStandingOn")] === this.mem[S("wGrassTile")];
    this.set(S("wSpritePlayerStateData2GrassPriority"), grass ? 0x80 : 0, grass ? "standing on grass: behind the background" : "not on grass");
    // The people: they stand still in this model (in the game they wander).
    for (let i = 1; i < 16; i++) {
      const b1 = 0xc100 + i * 16;
      if (!this.mem[b1]) continue;
      const b2 = b1 + 0x100;
      const hidden = this.isObjectHidden(i);
      const my = this.mem[b2 + 4];
      const mx = this.mem[b2 + 5];
      const y = this.mem[S("wYCoord")];
      const x = this.mem[S("wXCoord")];
      const visible = !hidden && my >= y && my <= y + 8 && mx >= x && mx <= x + 9;
      if (!this.mem[b1 + 1]) {
        // first update: InitializeSpriteScreenPosition
        this.set(b1 + 1, 1, "movement status: ready");
        this.set(b1 + 4, ((my - y) * 16 - 4) & 0xff, "(map Y − Red's Y) × 16 − 4", [this.prov[b2 + 4], this.prov[S("wYCoord")]]);
        this.set(b1 + 6, ((mx - x) * 16) & 0xff, "(map X − Red's X) × 16", [this.prov[b2 + 5], this.prov[S("wXCoord")]]);
      }
      if (!visible) {
        if (this.mem[b1 + 2] !== 0xff) this.set(b1 + 2, 0xff, hidden ? "hidden" : "off screen");
      } else if (!walk) {
        const base = this.mem[b2 + 0xe];
        this.set(b1 + 2, (((base - 1) << 4) + this.mem[b1 + 9] + this.mem[b1 + 8]) & 0xff, "(picture slot − 1) × 16 + facing", [this.prov[b2 + 0xe]]);
      }
    }
    this.ret();
  }

  /** IsObjectHidden: is this sprite slot in wToggleableObjectList with its flag set? */
  isObjectHidden(slot) {
    const S = (n) => this.sym(n);
    for (let a = S("wToggleableObjectList"); this.mem[a] !== 0xff; a += 2) {
      if (this.mem[a] !== slot) continue;
      const g = this.mem[a + 1];
      return !!(this.mem[S("wToggleableObjectFlags") + (g >> 3)] & (1 << (g & 7)));
    }
    return false;
  }

  CollisionCheckOnLand(dir) {
    const S = (n) => this.sym(n);
    this.call("CollisionCheckOnLand");
    // people in the way (simplified: the target square holds a visible person)
    const y = this.mem[S("wYCoord")] + (dir === "down" ? 1 : dir === "up" ? -1 : 0);
    const x = this.mem[S("wXCoord")] + (dir === "right" ? 1 : dir === "left" ? -1 : 0);
    for (let i = 1; i < 16; i++) {
      const b1 = 0xc100 + i * 16;
      if (!this.mem[b1] || this.mem[b1 + 2] === 0xff) continue;
      if (this.mem[b1 + 0x104] - 4 === y && this.mem[b1 + 0x105] - 4 === x) {
        this.events.push({ t: "blocked", why: "person", slot: i });
        this.ret();
        return false;
      }
    }
    // GetTileAndCoordsInFrontOfPlayer: the tile in front of Red's feet in wTileMap
    const [cx, cy] = { down: [8, 11], up: [8, 7], left: [6, 9], right: [10, 9] }[dir];
    const tileAddr = S("wTileMap") + cy * 20 + cx;
    this.cp(tileAddr, S("wTileInFrontOfPlayer"));
    const tile = this.mem[tileAddr];
    // CheckTilePassable: walk the tileset's list of walkable tiles until $ff
    let a = this.mem[S("wTilesetCollisionPtr")] | (this.mem[S("wTilesetCollisionPtr") + 1] << 8);
    for (;;) {
      const t = this.rb(a);
      if (t === 0xff) {
        this.look(a, "end of the list: not walkable");
        this.events.push({ t: "blocked", why: "tile", tile });
        this.ret();
        return false;
      }
      if (t === tile) {
        this.look(a, `$${t.toString(16).padStart(2, "0")} is on the walkable list`);
        this.ret();
        return true;
      }
      a++;
    }
  }

  AdvancePlayerSprite() {
    const S = (n) => this.sym(n);
    this.call("AdvancePlayerSprite");
    const b = (this.mem[S("wSpritePlayerStateData1YStepVector")] << 24) >> 24;
    const c = (this.mem[S("wSpritePlayerStateData1XStepVector")] << 24) >> 24;
    const wc = (this.mem[S("wWalkCounter")] - 1) & 0xff;
    this.set(S("wWalkCounter"), wc, "dec [hl]");
    if (wc === 0) {
      this.set(S("wYCoord"), (this.mem[S("wYCoord")] + b) & 0xff, "step done: Y + step", [this.prov[S("wYCoord")]]);
      this.set(S("wXCoord"), (this.mem[S("wXCoord")] + c) & 0xff, "step done: X + step", [this.prov[S("wXCoord")]]);
    }
    if (wc === 7) {
      // first pass of the step: move the VRAM pointer, the block coords, and redraw
      const vp = S("wMapViewVRAMPointer");
      let lo = this.mem[vp];
      let hi = this.mem[vp + 1];
      if (c === 1) this.set(vp, (lo & 0xe0) | ((lo + 2) & 0x1f), "2 tiles right, wrapping at 32");
      else if (c === -1) this.set(vp, (lo & 0xe0) | ((lo - 2) & 0x1f), "2 tiles left, wrapping at 32");
      else if (b === 1) {
        const n = lo + 0x40;
        this.set(vp, n & 0xff, "2 rows down");
        if (n > 0xff) this.set(vp + 1, (((hi + 1) & 3) | 0x98), "wrap at the bottom of the BG map");
      } else if (b === -1) {
        const n = lo - 0x40;
        this.set(vp, n & 0xff, "2 rows up");
        if (n < 0) this.set(vp + 1, (((hi - 1) & 3) | 0x98), "wrap at the top of the BG map");
      }
      void hi;
      const ptr = S("wCurrentTileBlockMapViewPointer");
      const movePtr = (delta, note) => {
        const p = (this.mem[ptr] | (this.mem[ptr + 1] << 8)) + delta;
        this.set(ptr, p & 0xff, note, [this.prov[ptr]]);
        this.set(ptr + 1, (p >> 8) & 0xff, note, [this.prov[ptr + 1]]);
      };
      const width = this.mem[S("wCurMapWidth")];
      if (c) {
        const xb = (this.mem[S("wXBlockCoord")] + c) & 0xff;
        this.set(S("wXBlockCoord"), xb, "half-block X + step");
        if (xb === 2) {
          this.set(S("wXBlockCoord"), 0, "into the next block east");
          this.set(S("wXOffsetSinceLastSpecialWarp"), (this.mem[S("wXOffsetSinceLastSpecialWarp")] + 1) & 0xff, "inc");
          movePtr(1, "view pointer: one block east");
        } else if (xb === 0xff) {
          this.set(S("wXBlockCoord"), 1, "into the next block west");
          this.set(S("wXOffsetSinceLastSpecialWarp"), (this.mem[S("wXOffsetSinceLastSpecialWarp")] - 1) & 0xff, "dec");
          movePtr(-1, "view pointer: one block west");
        }
      } else {
        const yb = (this.mem[S("wYBlockCoord")] + b) & 0xff;
        this.set(S("wYBlockCoord"), yb, "half-block Y + step");
        if (yb === 2) {
          this.set(S("wYBlockCoord"), 0, "into the next block south");
          this.set(S("wYOffsetSinceLastSpecialWarp"), (this.mem[S("wYOffsetSinceLastSpecialWarp")] + 1) & 0xff, "inc");
          movePtr(width + 6, "view pointer: one row of blocks south");
        } else if (yb === 0xff) {
          this.set(S("wYBlockCoord"), 1, "into the next block north");
          this.set(S("wYOffsetSinceLastSpecialWarp"), (this.mem[S("wYOffsetSinceLastSpecialWarp")] - 1) & 0xff, "dec");
          movePtr(-(width + 6), "view pointer: one row of blocks north");
        }
      }
      this.beat("walk-view");
      this.LoadCurrentMapView();
      // LoadCurrentMapView is slow: a frame ends (and VBlank runs) before it finishes
      this.endFrame();
      this.beat("walk-schedule");
      if (b === 1) this.ScheduleRowRedraw("South");
      else if (b === -1) this.ScheduleRowRedraw("North");
      else if (c === 1) this.ScheduleColumnRedraw("East");
      else if (c === -1) this.ScheduleColumnRedraw("West");
    }
    this.beat("walk-scroll");
    this.set(S("hSCY"), (this.mem[S("hSCY")] + 2 * b) & 0xff, "SCY + 2 × step", [this.prov[S("hSCY")]]);
    this.set(S("hSCX"), (this.mem[S("hSCX")] + 2 * c) & 0xff, "SCX + 2 × step", [this.prov[S("hSCX")]]);
    const n = this.mem[S("wNumSprites")];
    for (let i = 1; i <= n; i++) {
      const b1 = 0xc100 + i * 16;
      this.set(b1 + 4, (this.mem[b1 + 4] - 2 * b) & 0xff, "shift against Red's step", [this.prov[b1 + 4]]);
      this.set(b1 + 6, (this.mem[b1 + 6] - 2 * c) & 0xff, "shift against Red's step", [this.prov[b1 + 6]]);
    }
    this.ret();
  }

  ScheduleRowRedraw(dir) {
    const S = (n) => this.sym(n);
    this.call(`Schedule${dir}RowRedraw`);
    const src = S("wTileMap") + (dir === "North" ? 0 : 16 * 20);
    this.run("CopyToRedrawRowOrColumnSrcTiles", () => this.copy(src, S("wRedrawRowOrColumnSrcTiles"), 40));
    let dest = this.mem[S("wMapViewVRAMPointer")] | (this.mem[S("wMapViewVRAMPointer") + 1] << 8);
    if (dir === "South") dest = (((dest + 0x200) >> 8) & 3 | 0x98) << 8 | ((dest + 0x200) & 0xff);
    this.set(S("hRedrawRowOrColumnDest"), dest & 0xff, "where in the BG map", [this.prov[S("wMapViewVRAMPointer")]]);
    this.set(S("hRedrawRowOrColumnDest") + 1, dest >> 8, "where in the BG map", [this.prov[S("wMapViewVRAMPointer") + 1]]);
    this.set(S("hRedrawRowOrColumnMode"), 2, "REDRAW_ROW");
    this.ret();
  }

  ScheduleColumnRedraw(dir) {
    const S = (n) => this.sym(n);
    this.call(`Schedule${dir}ColumnRedraw`);
    let hl = S("wTileMap") + (dir === "East" ? 18 : 0);
    this.run("ScheduleColumnRedrawHelper", () => {
      let de = S("wRedrawRowOrColumnSrcTiles");
      for (let r = 0; r < 18; r++) {
        this.cp(hl, de++);
        this.cp(hl + 1, de++);
        hl += 20;
      }
    });
    const vp = this.mem[S("wMapViewVRAMPointer")];
    const lo = dir === "East" ? (vp & 0xe0) | ((vp + 18) & 0x1f) : vp;
    this.set(S("hRedrawRowOrColumnDest"), lo, "where in the BG map", [this.prov[S("wMapViewVRAMPointer")]]);
    this.cp(S("wMapViewVRAMPointer") + 1, S("hRedrawRowOrColumnDest") + 1);
    this.set(S("hRedrawRowOrColumnMode"), 1, "REDRAW_COL");
    this.ret();
  }
}

// ====== The graphics chip ========================================================================
/** Draws one 160×144 frame from VRAM, OAM and the registers in `mem`; returns colour shades 0–3. */
export function renderFrame(mem) {
  const out = new Uint8Array(160 * 144);
  const lcdc = mem[0xff40];
  if (!(lcdc & 0x80)) return out.fill(0);
  const scx = mem[0xff43];
  const scy = mem[0xff42];
  const bgp = mem[0xff47];
  const obp = [mem[0xff48], mem[0xff49]];
  const bgIdx = new Uint8Array(160);
  for (let ly = 0; ly < 144; ly++) {
    // mode 2: up to 10 sprites on this line, in OAM order
    const sprites = [];
    if (lcdc & 0x02)
      for (let i = 0; i < 40 && sprites.length < 10; i++) {
        const y = mem[0xfe00 + i * 4] - 16;
        if (ly >= y && ly < y + 8) sprites.push(i);
      }
    // mode 3: background
    for (let x = 0; x < 160; x++) {
      let ci = 0;
      if (lcdc & 0x01) {
        const by = (ly + scy) & 0xff;
        const bx = (x + scx) & 0xff;
        const mapBase = lcdc & 0x08 ? 0x9c00 : 0x9800;
        const tile = mem[mapBase + (by >> 3) * 32 + (bx >> 3)];
        const addr = lcdc & 0x10 ? 0x8000 + tile * 16 : 0x9000 + ((tile << 24) >> 24) * 16;
        const row = addr + (by & 7) * 2;
        const bit = 7 - (bx & 7);
        ci = ((mem[row] >> bit) & 1) | (((mem[row + 1] >> bit) & 1) << 1);
      }
      bgIdx[x] = ci;
      out[ly * 160 + x] = (bgp >> (ci * 2)) & 3;
    }
    // sprites: lower X wins, then lower OAM index
    const drawn = new Int16Array(160).fill(-1);
    for (const i of sprites) {
      const y = mem[0xfe00 + i * 4] - 16;
      const sx = mem[0xfe00 + i * 4 + 1] - 8;
      const tile = mem[0xfe00 + i * 4 + 2];
      const flags = mem[0xfe00 + i * 4 + 3];
      let r = ly - y;
      if (flags & 0x40) r = 7 - r;
      const row = 0x8000 + tile * 16 + r * 2;
      for (let px = 0; px < 8; px++) {
        const x = sx + px;
        if (x < 0 || x >= 160) continue;
        if (drawn[x] >= 0 && mem[0xfe00 + drawn[x] * 4 + 1] - 8 <= sx) continue;
        const bit = flags & 0x20 ? px : 7 - px;
        const ci = ((mem[row] >> bit) & 1) | (((mem[row + 1] >> bit) & 1) << 1);
        if (!ci) continue;
        if (drawn[x] < 0 || mem[0xfe00 + drawn[x] * 4 + 1] - 8 > sx) {
          drawn[x] = i;
          if (flags & 0x80 && bgIdx[x]) continue;
          out[ly * 160 + x] = (obp[(flags >> 4) & 1] >> (ci * 2)) & 3;
        }
      }
    }
  }
  return out;
}
