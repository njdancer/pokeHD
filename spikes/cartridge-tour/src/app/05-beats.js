// ---- 05 beats: the levels and what each beat shows ---------------------------------------------
const mk = (id) => {
  const i = markAt[id];
  if (i === undefined) throw new Error(`no marker ${id}`);
  return i;
};
const retAfter = (fn, from) => {
  const c = findCall(fn, from);
  let depth = 0;
  for (let i = c; i < EV.length; i++) {
    if (EV[i].t === "call") depth++;
    if (EV[i].t === "ret" && --depth === 0) return i + 1;
  }
  return -1;
};
const K = (name) => S[name];
const R = (name) => symRomKey(name);
const rk = (bank, addr) => romKey(bank, addr);
const code = (s) => `<code>${s}</code>`;
const at = (name) => code(`${name}`) + (symAddr(name) ? ` <span class="dimaddr">${symAddr(name)}</span>` : "");

// The real first bytes, read from the model state so the captions never disagree with the board.
const hdrPtr = M.headerAddr ? M.headerAddr.addr : 0x42a1;
const girlSlot = (() => {
  stateAt(mk("fill"));
  return DS.mem[0xc20e + 2 * 16];
})();
stateAt(0);

const LEVELS = [
  {
    n: 1,
    title: "The cartridge",
    blurb: "Meet the board: the cartridge, its banks, memory and the screen.",
    beats: [
      {
        cap: "This is a Game Boy with Pokémon Blue in it, laid out flat. Every cube is one byte.",
        det: `From the top: the <em>cartridge</em> (its 64 banks in a rack, bank 0, and the window where one other bank shows), the <em>CPU</em> with high RAM ($FF80), <em>work RAM</em> ($C000–$DFFF), the <em>graphics chip</em> with its registers ($FF40), OAM ($FE00) and the screen, and <em>video RAM</em> ($8000–$9FFF).<br>Only the bytes this tour touches are on the board, each at its real address. Panel names are the labels from the pret disassembly.`,
        shotOnly: ["board"],
        dim: false,
        minDur: 3,
      },
      {
        cap: "The cartridge says what it is: an MBC3 chip, 1 MB of ROM, 32 KB of save RAM.",
        det: `Three bytes of the cartridge header: ${code("$0147")} = $${hex(ROM[0x147])} (MBC3 with RAM, battery and clock), ${code("$0148")} = $${hex(ROM[0x148])} (1 MB, 64 banks) and ${code("$0149")} = $${hex(ROM[0x149])} (32 KB of RAM).`,
        looks: [
          [0x10147, "cartridge type: MBC3 + RAM + battery"],
          [0x10148, "ROM size: 1 MB"],
          [0x10149, "RAM size: 32 KB"],
        ],
        focus: [0x10147, 0x10148, 0x10149],
        shotOnly: ["bay0"],
      },
      {
        cap: "1 MB is cut into 64 banks of 16 KB. The drawers in amber hold bytes this tour uses.",
        det: "The CPU can only address 64 KB in total, so it can't see the whole cartridge at once. The cartridge's MBC3 chip decides which 16 KB bank appears in the CPU's window.",
        shotOnly: ["rack", "mbc"],
      },
      {
        cap: "The CPU can always see bank 0, at $0000–$3FFF.",
        det: "Bank 0 holds the code and tables the game needs all the time: the map header pointer table, the walkability lists, the palettes and the VBlank handler.",
        shotOnly: ["bay0"],
      },
      {
        cap: "It sees one other bank at a time, at $4000–$7FFF. Writing a bank number to $2000 swaps it.",
        det: `Right now bank $${hex(INITIAL_BANK)} is in the window (Red's house code). Writing $06 to any address in $2000–$3FFF tells the MBC3 to show bank 6 instead. The game also keeps the number in ${code("hLoadedROMBank")} ($FFB8) so it can switch back later. Here it swaps to bank 6 and back again, to show you; the game does it for real in level 2.`,
        synth: () => [
          { kind: "bank", b: 6, old: INITIAL_BANK, t: 0.8, anim: 1.0 },
          { kind: "bank", b: INITIAL_BANK, old: 6, t: 3.6, anim: 1.0 },
        ],
        shotOnly: ["rack", "mbc", "bay"],
        minDur: 5.5,
      },
      {
        cap: "Red just walked out of his front door. The game now needs Pallet Town, map $00.",
        det: `The house's exit warp set ${at("wCurMap")} to $00 and Red's square to (${RAM0[K("wXCoord") - 0x8000]}, ${RAM0[K("wYCoord") - 0x8000]}). The screen has faded to black (BGP = $${hex(RAM0[0xff47 - 0x8000])}, every colour is black). Everything from here on is ${at("LoadMapData")}.`,
        looks: [
          [K("wCurMap"), "the map to load: $00, Pallet Town"],
          [K("wYCoord"), "Red's Y"],
          [K("wXCoord"), "Red's X"],
          [0xff47, "BGP: every colour maps to black"],
        ],
        focus: [K("wCurMap"), K("wYCoord"), K("wXCoord"), 0xff47],
        shot: ["lcd"],
      },
      {
        challenge: {
          prompt: "Your turn: tap the byte that says how big the cartridge is.",
          test: (k) => k === 0x10148,
          yes: `Right: ${code("$0148")} = $${hex(ROM[0x148])}, which means 1 MB in 64 banks.`,
          hint: "It's in the cartridge header, in bank 0.",
        },
        shotOnly: ["bay0", "rack"],
      },
    ],
  },
  {
    n: 2,
    title: "Finding Pallet Town",
    blurb: "From a map number to a filled-in map header in work RAM.",
    beats: [
      {
        from: 0,
        cap: "First the screen turns off, so the CPU can write video memory whenever it likes.",
        det: `${at("LoadMapData")} calls ${at("DisableLCD")}, which clears bit 7 of LCDC ($E3 → $63). Then it zeroes the scroll registers' copies ${code("hSCX")} and ${code("hSCY")}, and points ${code("wMapViewVRAMPointer")} at the top of the background map, $9800.`,
        pace: { slow: 8 },
        shot: ["lcd"],
      },
      {
        from: mk("textbox"),
        cap: "It reloads the text-box border tiles, in case someone talks.",
        det: `${at("LoadTextBoxTilePatterns")}: ${code("TextBoxGraphics")} (${symAddr("TextBoxGraphics")}) → $9600, 512 bytes, through ${at("FarCopyData2")}, which switches to the graphics' bank, copies, and switches back. They were already there from the house, so the values don't change.`,
        pace: { slow: 3, budget: 2.5 },
      },
      {
        from: mk("mark-town"),
        cap: "It ticks Pallet Town as visited (for Fly) and lists which people can come and go.",
        det: `${at("LoadMapHeader")} starts with ${at("MarkTownVisitedAndLoadToggleableObjects")}. It sets bit 0 of ${code("wTownVisitedFlag")}, then copies Pallet's entries from ${code("ToggleableObjectStates")} into ${code("wToggleableObjectList")}: Oak is one of them (we'll see why in level 3).`,
        pace: { slow: 6 },
      },
      {
        from: mk("header-bank"),
        cap: "Which bank holds map 0's header? A table in bank 3 says bank 6.",
        det: `${at("SwitchToMapRomBank")} swaps bank 3 into the window, reads ${code("MapHeaderBanks")} + map number, keeps the answer in ${code("hMapROMBank")}, then swaps that bank in.`,
        pace: { slow: 10 },
      },
      {
        from: mk("header-ptr"),
        cap: `Bank 0's ${"MapHeaderPointers"} table says where: $${hex(hdrPtr, 4)}.`,
        det: `Entry 0 of ${at("MapHeaderPointers")} is two bytes, low first: $${hex(hdrPtr & 0xff)} $${hex(hdrPtr >> 8)} → HL = $${hex(hdrPtr, 4)}, an address inside bank 6.`,
        pace: { slow: 10 },
      },
      {
        from: mk("header-fixed"),
        cap: "Ten bytes describe the town: tileset 0, 9 blocks tall, 10 wide, block layout at $42FD.",
        det: `${code(".copyFixedHeaderLoop")} copies 10 bytes from bank 6 to ${code("wCurMapHeader")}: tileset, height, width, a pointer to the block layout, pointers to the text and script tables, and the connection flags.`,
        pace: { slow: 10 },
      },
      {
        from: mk("connections"),
        cap: "$0C means roads north and south. Each gets an 11-byte record.",
        det: `All four connection slots are set to $FF (none) first. Then each set bit of ${code("wCurMapConnections")} (north is bit 3, south bit 2) copies an 11-byte record with ${at("CopyMapConnectionHeader")}.`,
        pace: { slow: 6, budget: 2.5 },
      },
      {
        cap: "North is Route 1: copy its 10-block strip into our border.",
        det: `${code("wNorthConnectionHeader")}: connected map $${hex(RAM0[0])}, source and destination pointers, strip length, the connected map's width, and alignment bytes for walking across. Level 4 uses it.`,
        looksFrom: "north",
        lookGap: 0.9,
      },
      {
        from: mk("objects-ptr"),
        cap: "Then the object list. Its first byte, $0B, is the border block: the trees around town.",
        det: `${code(".getObjectDataPointer")} reads a 2-byte pointer, then copies the first byte of the object data into ${code("wMapBackgroundTile")}.`,
        pace: { slow: 6 },
      },
      {
        from: mk("warps"),
        cap: "Then the doors, the signs, and the three people.",
        det: "3 warps of 4 bytes go to wWarpEntries, 4 signs to wSignCoords and wSignTextIDs. The sprite slots at $C110 and $C210 are cleared, then each person gets a picture ID and a map position.",
        pace: { slow: 4, budget: 4 },
      },
      {
        from: mk("tileset-header"),
        cap: "Tileset 0's card says where its tile pictures, blocks and walkable list live.",
        det: `${at("LoadTilesetHeader")} runs from bank 3 (via predef). It copies 12 bytes from ${code("Tilesets")} + tileset × 12: the bank ($19), the block table ($45E0), the tile graphics ($4000), the walkable list ($1735) and more.`,
        pace: { slow: 4, budget: 2.5 },
      },
      {
        from: mk("warp-pos"),
        cap: "Red came from a different tileset, so his position comes from a table: square (5, 5).",
        det: `${at("LoadDestinationWarpPosition")} copies Pallet's first warp-arrival entry: a view pointer into wOverworldMap and Red's Y and X. Bit 0 of each becomes ${code("wYBlockCoord")} and ${code("wXBlockCoord")} (Red is in the second half of a block). Then the map size is doubled into two more variables and the music is looked up.`,
        pace: { slow: 6, budget: 2.5 },
      },
      {
        challenge: {
          prompt: "Tap the work RAM byte that tells the game the town is 10 blocks wide.",
          test: (k) => k === K("wCurMapWidth"),
          yes: `Yes: ${code("wCurMapWidth")} at ${h4(K("wCurMapWidth"))} = $0A. Level 4 uses it to lay out the blocks.`,
          hint: "It's one of the ten header bytes copied a moment ago.",
        },
        focus: range(K("wCurMapHeader"), 10),
      },
    ],
  },
  {
    n: 3,
    title: "People",
    blurb: "Where the pictures of the people in town come from.",
    beats: [
      {
        from: mk("sprite-set"),
        cap: "Towns don't list their people's pictures. They share a set, and Pallet uses set 1.",
        det: `${at("InitMapSprites")} runs from bank 5. ${at("InitOutsideMapSprites")} reads ${code("MapSpriteSets")} + map number.`,
        pace: { slow: 6 },
      },
      {
        from: mk("sprite-set-list"),
        cap: "Set 1 is 11 pictures, shared by Pallet Town and Viridian City.",
        det: "11 picture IDs from SpriteSets go to wSpriteSet and to each slot's picture-ID byte in sprite state 2 ($C2xD). Slot 0 is always Red.",
        pace: { slow: 4, budget: 2 },
      },
      {
        from: mk("sprite-sheets"),
        cap: "Each picture comes from its own bank: 12 standing tiles to one shelf, 12 walking tiles $800 further on.",
        det: `${at("LoadMapSpriteTilePatterns")} reads each picture's 4-byte row in ${code("SpriteSheetPointerTable")} (address, size, bank), swaps that bank in, and copies $C0 bytes to $8000 + (slot − 1) × $C0, then the walking frames to the same place + $800. The first picture goes slowly; the rest speed up.`,
        pace: { slow: 6, budget: 7, bankFast: 0.16 },
      },
      {
        from: mk("sprite-sheets-4"),
        cap: "The Poké Ball and the sleeping man never walk, so they only need 4 tiles each.",
        det: "Still pictures go to $8780 and $87C0, the end of the standing-pose shelf.",
        pace: { slow: 3, budget: 2, bankFast: 0.3 },
      },
      {
        from: mk("sprite-slots"),
        cap: "Each of the three people learns which shelf holds their picture.",
        det: `${code(".storeVRAMSlotsLoop")} looks up each person's picture ID in wSpriteSet; its position + 1 is the shelf number, kept in sprite state 2 ($C2xE).`,
        pace: { slow: 6, budget: 2 },
      },
      {
        cap: "Oak is loaded too, but hidden until his script calls him.",
        det: `${code("wToggleableObjectList")} pairs Pallet's sprite slots with global object numbers. Oak's bit in ${code("wToggleableObjectFlags")} is set, so ${code("IsObjectHidden")} says hidden and he is never drawn.`,
        looks: [
          [K("wToggleableObjectList"), "sprite slot 1 (Oak)"],
          [K("wToggleableObjectList") + 1, "his global object number"],
          [K("wToggleableObjectFlags"), "his flag is set: hidden"],
        ],
        focus: [K("wToggleableObjectList"), K("wToggleableObjectList") + 1, K("wToggleableObjectFlags")],
      },
      {
        challenge: {
          prompt: "Tap a byte on the shelf that holds the girl's walking poses.",
          test: (k) => k >= 0x8800 + (girlSlot - 1) * 0xc0 && k < 0x8800 + girlSlot * 0xc0,
          yes: `Yes: the girl is on shelf ${girlSlot}, so her walking poses are at ${h4(0x8800 + (girlSlot - 1) * 0xc0)}–${h4(0x8800 + girlSlot * 0xc0 - 1)}.`,
          hint: `She is on shelf ${girlSlot}. Walking poses are $800 after standing ones.`,
        },
        focus: [0xc22e],
        shotOnly: [RAMP.tiles],
      },
    ],
  },
  {
    n: 4,
    title: "Laying out blocks",
    blurb: "Building wOverworldMap: the town's 32×32-pixel blocks, with a border.",
    beats: [
      {
        from: mk("fill"),
        cap: "First the whole buffer is filled with the border block, $0B: trees.",
        det: `${at("LoadTileBlockMap")} copies ${code("wMapBackgroundTile")} into all ${S.wOverworldMapEnd - S.wOverworldMap} bytes of ${code("wOverworldMap")}, overwriting what was left from Red's house.`,
        pace: { slow: 5, budget: 3 },
      },
      {
        from: mk("stride"),
        cap: "Each row is the town's width plus 3 spare blocks on each side: 10 + 6 = 16.",
        det: "The 3 blocks on every side hold the border, or the edge of the next map. Pallet's first block goes 3 rows down and 3 across: $C6E8 + 3 × 16 + 3 = $C71B.",
        pace: { slow: 4 },
        focusRect: "town",
      },
      {
        from: mk("blocks"),
        cap: "Copy the town's 90 block numbers from bank 6, one row of 10 at a time.",
        det: "Row 1 goes slowly, then rows 2–9. After each row the destination jumps 16 ahead, the source only 10.",
        pace: { slow: 10, budget: 3 },
      },
      {
        from: mk("conn-north"),
        cap: "The 3 rows of Route 1 nearest the town go into the border above it.",
        det: `${at("LoadNorthSouthConnectionsTileMap")} switches to Route 1's bank and copies 3 strips of 10, stepping 10 through Route 1's layout and 16 through ours.`,
        pace: { slow: 4, budget: 2.5 },
      },
      {
        from: mk("conn-south"),
        cap: "And the top of Route 21, the sea, goes below.",
        det: "Same routine, Route 21's bank, into the 3 rows under the town.",
        pace: { slow: 2, budget: 2 },
      },
      {
        challenge: {
          prompt: "Tap the block that holds the door of Red's house.",
          test: (k) => k === 0xc73d,
          yes: "Yes: $C73D holds block $3C, the front of the house with its door. Red arrived on its door square, (5, 5).",
          hint: "Red arrived at square (5, 5). A block is 2 × 2 squares, so he is in block row 2, column 2 of the town.",
        },
        shotOnly: [RAMP.ovw],
      },
    ],
  },
  {
    n: 5,
    title: "Tile pictures",
    blurb: "96 tile pictures go into video RAM. They stay numbers for now.",
    beats: [
      {
        cap: "The tileset card says: bank $19, address $4000.",
        det: `${at("LoadTilesetTilePatternData")} reads ${code("wTilesetGfxPtr")} and ${code("wTilesetBank")}, both from level 2.`,
        looks: [
          [K("wTilesetBank"), "the graphics' bank"],
          [K("wTilesetGfxPtr"), "address, low byte"],
          [K("wTilesetGfxPtr") + 1, "high byte"],
        ],
        focus: [K("wTilesetBank"), K("wTilesetGfxPtr"), K("wTilesetGfxPtr") + 1],
      },
      {
        from: mk("gfx"),
        cap: "A tile is 16 numbers, two for each row of 8 pixels. 96 tiles, 1,536 bytes.",
        det: `${at("FarCopyData2")} copies $600 bytes from 19:4000 to $9000. The first tile goes byte by byte; then tablet by tablet. Overworld_GFX is only $5E0 bytes long, so the last two "tiles" are really the first 32 bytes of the block table. The game never draws them.`,
        pace: { slow: 16, budget: 5 },
      },
      {
        cap: "LCDC bit 4 is 0, so background tile numbers count from $9000.",
        det: "Tile $00 is at $9000, $7F at $97F0, and $80–$FF wrap back to $8800–$8FFF (shared with sprites). The text box tiles at $9600 are tiles $60–$7F.",
        looks: [
          [0x9000, "tile $00 starts here"],
          [0x92a0, "tile $2A: $9000 + $2A × 16"],
          [0x8800, "tile $80 (−128)"],
          [0xff40, "LCDC = $E3: bit 4 is 0"],
        ],
        focus: [0x9000, 0x92a0, 0x8800, 0xff40],
      },
      {
        challenge: {
          prompt: "Tap the first byte of tile $2A, the screen's top-left tile.",
          test: (k) => k === 0x92a0,
          yes: "Yes: $9000 + $2A × 16 = $92A0.",
          hint: "Tile n starts at $9000 + n × 16.",
        },
        shotOnly: [RAMP.tiles],
      },
    ],
  },
  {
    n: 6,
    title: "Building the screen",
    blurb: "Blocks become 20×18 tile numbers, then the background map.",
    beats: [
      {
        cap: "The view is 6 blocks by 5, starting at $C71B. That's a little more than the screen.",
        det: `${at("LoadCurrentMapView")} starts from ${code("wCurrentTileBlockMapViewPointer")} (level 2's warp entry) and draws 6 × 5 blocks of 4 × 4 tiles: 24 × 20 tiles, while the screen shows 20 × 18.`,
        looks: [
          [K("wCurrentTileBlockMapViewPointer"), "view pointer, low byte: $1B"],
          [K("wCurrentTileBlockMapViewPointer") + 1, "high byte: $C7"],
        ],
        focus: [K("wCurrentTileBlockMapViewPointer"), K("wCurrentTileBlockMapViewPointer") + 1],
        focusRect: "view",
      },
      {
        from: mk("view"),
        cap: "Block $52 is 16 tile numbers. Copy them as a 4×4 square.",
        det: `${at("DrawTileBlock")} multiplies the block number by 16 and adds ${code("wTilesetBlocksPtr")} ($45E0): block $52's entry is at 19:4B00. Its 16 bytes go to a 4×4 square of ${code("wSurroundingTiles")} (24 wide).`,
        pace: { slow: 16, budget: 1 },
      },
      {
        from: "draw2",
        cap: "The other 29 blocks make a 24×20 tile area.",
        det: "Same routine for each block in the 6 × 5 view.",
        pace: { slow: 0, budget: 4 },
      },
      {
        from: mk("crop"),
        cap: "Red stands in the middle of a block, so the screen starts 2 tiles in.",
        det: `${code("wYBlockCoord")} and ${code("wXBlockCoord")} are both 1, so the copy to ${code("wTileMap")} skips 2 rows and 2 columns. ${code("wTileMap")} is exactly what the screen should show, 20 × 18.`,
        pace: { slow: 6, budget: 3 },
      },
      {
        from: mk("to-vram"),
        cap: "With the screen off, the 360 tile numbers go straight into the background map.",
        det: "The BG map is 32 × 32 tiles; the screen shows a 20 × 18 window of it. Each row of 20 skips 12 to reach the next row of 32.",
        pace: { slow: 6, budget: 3.5 },
        shot: ["lcd"],
      },
      {
        challenge: {
          prompt: "Tap the blockset byte that became the BG map's top-left tile. (Bank $19 is in the window for you.)",
          test: (k) => k === rk(0x19, 0x4b0a),
          yes: "Yes: 19:4B0A, byte 10 of block $52's entry (row 2, column 2), $2A. Tap $9800 to see its whole chain.",
          hint: "The top-left tile is row 2, column 2 of the first block, $52.",
        },
        focus: [0x9800, K("wTileMap")],
        bankView: 0x19,
      },
    ],
  },
  {
    n: 7,
    title: "Lights on",
    blurb: "The screen comes back, Red's picture arrives, and the sprites go into OAM.",
    beats: [
      {
        from: mk("lcd-on"),
        cap: "The screen is on, but every colour still maps to black.",
        det: `${at("EnableLCD")} sets LCDC bit 7 ($63 → $E3). BGP and OBP0 are still $FF from the door's fade-out.`,
        pace: { slow: 4 },
        shot: ["lcd"],
      },
      {
        from: mk("red-gfx"),
        cap: "Red's picture goes on shelf 0, 8 tiles each time the screen rests.",
        det: `${at("LoadPlayerSpriteGraphics")}: the screen is on now, so video RAM can only be written during VBlank. ${at("CopyVideoData")} hands 8 tiles at a time to the VBlank handler, so 12 standing tiles + 12 walking tiles take 4 frames. Each VBlank also copies the sprite cards to OAM.`,
        pace: { slow: 4, budget: 5, frame: 0.3, bankFast: 0.06 },
      },
      {
        from: mk("enter-map-x"),
        cap: "Each 16×16 person becomes four 8×8 sprite cards in shadow OAM.",
        det: `${at("PrepareOAMData")} reads each person's sprite state at $C1x0 (image, screen Y and X) and ${code("SpriteFacingAndAnimationTable")} (bank 1), and writes 4 bytes per card to ${code("wShadowOAM")}: Y + 16, X + 8, tile number, flags.`,
        pace: { slow: 8, budget: 4, frame: 0.3, bankFast: 0.06 },
      },
      {
        from: "dma2",
        cap: "In VBlank, all 160 bytes go to the chip's own OAM in one go.",
        det: `${code("hDMARoutine")} runs from high RAM and starts an OAM DMA: the hardware copies $C300–$C39F to $FE00–$FE9F in 160 cycles.`,
        pace: { slow: 0, budget: 3, frame: 0.3, bankFast: 0.06 },
      },
      {
        from: mk("door-step"),
        cap: "The overworld loop resets the palette, and Pallet Town appears.",
        det: `On its first pass, ${at("LoadGBPal")} copies ${code("FadePal4")} (${symAddr("FadePal4")}) to BGP, OBP0 and OBP1: $E4, $D0, $E0.`,
        pace: { slow: 8 },
        shot: ["lcd"],
      },
      {
        from: "pal-done",
        cap: "Red steps off the door mat. Level 9 shows how a step works.",
        det: `${code("PlayerStepOutFromDoor")} makes Red walk one square down. The world scrolls up 16 pixels over 16 frames.`,
        pace: { slow: 0, budget: 4, frame: 0.14, bankFast: 0.04 },
        shot: ["lcd"],
      },
      {
        challenge: {
          prompt: "Tap an OAM byte that holds one of Red's tile numbers.",
          test: (k) => [0xfe02, 0xfe06, 0xfe0a, 0xfe0e].includes(k),
          yes: "Yes: Red is drawn first, so his 4 cards are OAM entries 0–3, and byte 2 of each card is the tile number.",
          hint: "Each card is 4 bytes: Y, X, tile, flags. Red's cards come first.",
        },
        shotOnly: [RAMP.oam, RAMP.soam],
      },
    ],
  },
];

// Level 2's tap-through of the north connection record
{
  const b = LEVELS[1].beats.find((x) => x.looksFrom === "north");
  const h = K("wNorthConnectionHeader");
  stateAt(mk("objects-ptr"));
  const m = DS.mem;
  const w2 = (a) => m[a] | (m[a + 1] << 8);
  b.looks = [
    [h, `connected map $${hex(m[h])}: Route 1`],
    [h + 1, `strip source, low byte ($${hex(w2(h + 1), 4)})`],
    [h + 2, "high byte"],
    [h + 3, `strip destination in wOverworldMap, low ($${hex(w2(h + 3), 4)})`],
    [h + 4, "high byte"],
    [h + 5, `strip length: ${m[h + 5]} blocks`],
    [h + 6, `Route 1's width: ${m[h + 6]}`],
    [h + 7, "Y alignment (where Red lands when he walks north)"],
    [h + 8, "X alignment"],
    [h + 9, "window pointer, low"],
    [h + 10, "window pointer, high"],
  ];
  b.focus = range(h, 11);
  b.det = `${code("wNorthConnectionHeader")}: Route 1 is map $${hex(m[h])}. The strip starts at $${hex(w2(h + 1), 4)} in Route 1's bank and lands at $${hex(w2(h + 3), 4)} in our buffer, ${m[h + 5]} blocks per row, stepping by Route 1's width (${m[h + 6]}). The alignment and window bytes are for walking across the edge.`;
  b.cap = `North is Route 1: ${m[h + 5]} blocks per row, from its $${hex(w2(h + 1), 4)} to our $${hex(w2(h + 3), 4)}.`;
  stateAt(0);
}

// resolve start indices: named markers, "draw2", "dma2", "pal-done"
const ANCHOR = {
  draw2: () => findCall("DrawTileBlock", mk("view"), 2),
  dma2: () => findCall("hDMARoutine", mk("enter-map-x"), 2),
  "pal-done": () => retAfter("LoadGBPal", mk("door-step")),
};
const BEATS = [];
for (const L of LEVELS)
  L.beats.forEach((b, j) => {
    b.level = L.n;
    b.num = `${L.n}.${j + 1}`;
    if (typeof b.from === "string") b.from = ANCHOR[b.from]();
    BEATS.push(b);
  });
// each event beat ends where the next one starts; static beats sit between them
{
  let pos = 0;
  const evBeats = BEATS.filter((b) => b.from !== undefined);
  for (const b of BEATS) {
    if (b.from !== undefined) {
      const k = evBeats.indexOf(b);
      b.i0 = b.from;
      b.i1 = k + 1 < evBeats.length ? evBeats[k + 1].from : EV_LOADED;
      pos = b.i1;
    } else {
      b.i0 = pos;
      b.i1 = pos;
    }
  }
}
// a beat's static rectangles (drawn when it starts)
function beatRects(b) {
  if (b.focusRect === "town") {
    const p = RAMP.ovw;
    markRect(p.x + 3, p.z + LABEL_H + 3, 10, 9);
  }
  if (b.focusRect === "view") {
    const p = RAMP.ovw;
    markRect(p.x + 3, p.z + LABEL_H + 3, 6, 5);
    b.focus = [...(b.focus || []), ...range(0xc71b, 6), ...range(0xc71b + 16 * 4, 6)];
  }
}
