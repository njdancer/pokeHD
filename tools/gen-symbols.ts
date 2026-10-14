// Generates packages/rom/src/generated/symbols.ts from the pret disassembly's pokeblue.sym, and
// generated/names.ts (map, tileset and sprite constant names) from its constants/*.asm.
// Only allowlisted symbols are emitted, so the generated file stays small and reviewable.
// Usage: pnpm rom:symbols (builds the disassembly first), or `node tools/gen-symbols.ts --check`
// to verify the committed file is current without writing it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Symbols the codebase uses. Extend as tasks need more; keep each group sorted. */
export const ALLOWLIST: readonly string[] = [
  // Code addresses for emulator hooks and tests (p1-emu)
  "DelayFrame",
  "OverworldLoop",
  // Link cable routines hooked as messages, and where a waiting core idles (p3-link, D17)
  "CableClubNPC.establishConnectionLoop",
  "CableClubNPC.failedToEstablishConnection",
  "LinkBattleExchangeData.syncLoop1",
  "Serial_ExchangeBytes",
  "Serial_ExchangeLinkMenuSelection",
  "Serial_SyncAndExchangeNybble",
  "WaitLoop_15Iterations",
  // Map headers (p0-extract)
  "MapHeaderBanks",
  "MapHeaderPointers",
  // Tilesets and their semantic tables (p0-extract, p0-labels)
  "BookshelfTileIDs",
  "CutTreeBlockSwaps",
  "DoorTileIDPointers",
  "LedgeTiles",
  "Tilesets",
  "TilePairCollisionsLand",
  "TilePairCollisionsWater",
  "WarpPadAndHoleData",
  "FacilitySpinnerArrows",
  "GymSpinnerArrows",
  "WarpTileIDPointers",
  "WarpTileListPointers",
  "WaterTilesets",
  // Overworld sprite sheets (p1-npc-sprites); the player's bike sheet isn't in the table
  "RedBikeSprite",
  "SpriteSheetPointerTable",
  // Super Game Boy palettes (p1-colour, D11)
  "SuperPalettes",
  // The trainer card's badges and their SGB colours (the QA stream's badge row)
  "BlkPacket_TrainerCard",
  "GymLeaderFaceAndBadgeTileGraphics",
  "PalPacket_TrainerCard",
  // Overworld state in WRAM and HRAM (p1-emu, p1-state-read)
  "hWY",
  "wCurMap",
  "wCurMapHeight",
  "wCurMapTileset",
  "wCurMapWidth",
  "wCurrentMapScriptFlags",
  "wEventFlags",
  "wGrassRate",
  "wIsInBattle",
  "wJoyIgnore",
  "wLastMap",
  "wNumSprites",
  "wPlayerDirection",
  "wPlayerMovingDirection",
  "wSpriteStateData1",
  "wSpriteStateData2",
  "wTileMap",
  "wToggleableObjectFlags",
  "wToggleableObjectList",
  "wWalkBikeSurfState",
  "wWalkCounter",
  "wWarpedFromWhichMap",
  "wXBlockCoord",
  "wXCoord",
  "wYBlockCoord",
  "wYCoord",
  // Battle state in WRAM and HRAM (p2-battle-read)
  "hWhoseTurn",
  "wAnimSoundID",
  "wAnimationID",
  "wBattleMon",
  "wBattleMonNick",
  "wBattleType",
  "wCurOpponent",
  "wEnemyBattleStatus3",
  "wEnemyMon",
  "wEnemyMonNick",
  "wEnemyPartyCount",
  "wEscapedFromBattle",
  "wFirstMonsNotOutYet",
  "wLinkState",
  "wPartyCount",
  "wPlayerBattleStatus3",
  "wSubAnimSubEntryAddr",
  // HD battles (p2-battles): each Pokémon's SGB palette, and moves' types for their effects
  "MonsterPalettes",
  "Moves",
  // Text and menus: font graphics, the screen buffer and menu state (p2-text-read)
  "FontGraphics",
  "FontGraphicsEnd",
  "HpBarAndStatusGraphics",
  "HpBarAndStatusGraphicsEnd",
  "TextBoxGraphics",
  "TextBoxGraphicsEnd",
  "hAutoBGTransferEnabled",
  "hDownArrowBlinkCount1",
  "wCurrentMenuItem",
  "wListMenuID",
  "wListScrollOffset",
  "wNumBagItems",
  "wOptions",
  // Link cable state in WRAM and HRAM (p3-link)
  "hSerialConnectionStatus",
  "hSerialIgnoringInitialData",
  "wLinkMenuSelectionReceiveBuffer",
  "wLinkMenuSelectionSendBuffer",
  "wSerialExchangeNybbleReceiveData",
  "wSerialExchangeNybbleSendData",
  "wSerialSyncAndExchangeNybbleReceiveData",
  "wUnknownSerialCounter",
  // Gifts (D20): the safe point, the game routines it calls and the data they touch (p3-gifts)
  "AddEnemyMonToPlayerParty",
  "AddItemToInventory",
  "AddBCDPredefPredef",
  "Bankswitch",
  "FlagActionPredefPredef",
  "IndexToPokedexPredef",
  "Predef",
  "PredefPointers",
  "RemoveItemFromInventory",
  "RemovePokemon",
  "SaveCurrentBoxData",
  "SaveGameData",
  "SaveMainData",
  "SavePartyAndDexData",
  "SubBCDPredefPredef",
  "sMainDataCheckSum",
  "ItemNames",
  "KeyItemFlags",
  "MonsterNames",
  "PokedexOrder",
  "hMoney",
  "wBoxCount",
  "wBoxMonNicks",
  "wBoxMonOT",
  "wBoxMons",
  "wBoxSpecies",
  "wCurItem",
  "wCurPartySpecies",
  "wEnemyMon1Nick",
  "wEnemyMon1OT",
  "wItemQuantity",
  "wLoadedMon",
  "wMovementFlags",
  "wNPCMovementScriptPointerTableNum",
  "wPartyMonNicks",
  "wPartyMonOT",
  "wPartyMons",
  "wPartySpecies",
  "wPlayerMoney",
  "wPokedexNum",
  "wPokedexOwned",
  "wPokedexSeen",
  "wRemoveMonFromBox",
  "wSafariZoneGameOver",
  "wStatusFlags3",
  "wStatusFlags4",
  "wStatusFlags5",
  // How fast the game prints letters (PrintLetterDelay): whole messages wait as long (QA bug 26)
  "wLetterPrintingDelayFlags",
  "hClearLetterPrintingDelayFlags",
  "wStatusFlags6",
  "wStatusFlags7",
  "wWhichPokemon",
  // Gift tests: a friend's game makes Pokémon with AddPartyMon
  "AddPartyMon",
  "wCurEnemyLevel",
  "wMonDataLocation",
  "wPlayerID",
  "wPlayerName",
  // Autosave: where the save file keeps its checksummed data and trainer ID
  "sGameData",
  "sHallOfFame",
  "sGameDataEnd",
  "sMainData",
  "wMainDataStart",
  // Kid-proofing: the save menu's "older file will be erased" prompt, and what a save shows
  "OlderFileWillBeErasedText",
  "SaveMenu",
  "SaveTheGame_YesOrNo",
  "wObtainedBadges",
  "wPlayTimeHours",
  "wPlayTimeMinutes",
  // Tap-first UI: the intro's name questions and the naming screen, answered from the page
  "ChoosePlayerName",
  "IntroducePlayerText",
  "PrintText",
  // Whole messages from the script (tap-first UI): where messages start, wait and end
  "CloseTextDisplay",
  "EnemyText",
  "HandleMenuInput",
  "ManualTextScroll",
  "PrintText_NoCreatingTextBox",
  "WaitForTextScrollButtonPress",
  "WaitForSoundToFinish",
  // Where the game waits for buttons, for scripted play (packages/emu input-wait.ts): the ends of
  // the waits' routines, the overworld loop's second DelayFrame, and a scripted walk's pad
  "LoadGBPal",
  "Multiply",
  "OverworldLoopLessDelay",
  "PlaceMenuCursor",
  "wSimulatedJoypadStatesIndex",
  "hLoadedROMBank",
  "ChooseRivalName",
  "DefaultNamesPlayerList",
  "DefaultNamesRivalList",
  "DisplayNamingScreen",
  "DisplayNamingScreen.inputLoop",
  "DisplayNamingScreen.submitNickname",
  "wCurPartySpecies",
  "wNamingScreenType",
  "wRivalName",
  "wStringBuffer",
  // The HD Pokédex (p2-dex): where the game opens and leaves its own, and the data it shows
  "BaseStats",
  "CompressedMap",
  "DisplayTextID",
  "EndTrainerBattle",
  "ExternalMapEntries",
  "InternalMapEntries",
  "MewBaseStats",
  "MewPicFront",
  "PokedexEntryPointers",
  "PokedexTileGraphics",
  "RhydonPicFront",
  "ShowPokedexData",
  "ShowPokedexDataInternal.waitForButtonPress",
  "ShowPokedexMenu",
  "ShowPokedexMenu.exitPokedex",
  "StarterDex",
  "wSpriteIndex",
  "TrainerNames",
  "TrainerPicAndMoneyPointers",
  "TypeNames",
  "WildDataPointers",
  "WorldMapTileGraphics",
  "YoungsterPic",
  "hSpriteIndex",
  "wRivalName",
  "wTownVisitedFlag",
  // The Pokédex menu's game actions and the prompts it answers (dex-menu, packages/emu game/)
  "DisplayChooseQuantityMenu",
  "DisplayListMenuID",
  "GetItemPrice",
  "GoBackToPartyMenu",
  "ItemPrices",
  "hHalveItemPrices",
  // The Poké Mart's sell list: the only bag list whose caller is between these two
  "DisplayPokemartDialogue_.sellMenuLoop",
  "DisplayPokemartDialogue_.unsellableItem",
  // Where the field items work: the game's own tileset lists (ItemUseEscapeRope, IsBikeRidingAllowed)
  "BikeRidingTilesets",
  "EscapeRopeTilesets",
  // Tests that start on a given map: EnterMap loads wCurMap from its header, as a warp does; and
  // where an Escape Rope (or a blackout) takes the player.
  "EnterMap",
  "wLastBlackoutMap",
  // and where on it the player stands: the block map view a warp sets (event_displacement)
  "wCurrentTileBlockMapViewPointer",
  "wOverworldMap",
  "EvosMovesPointerTable",
  "Moves",
  "TechnicalMachines",
  "TwoOptionMenuStrings",
  "DisplayPokemonCenterDialogue_",
  "wMaxMenuItem",
  "wBattleMonSpecies",
  "wPlayerMonNumber",
  "hItemPrice",
  "hJoy7",
  "wBattleMonHP",
  "wChosenMenuItem",
  "wItemPrices",
  "wListPointer",
  "wMaxItemQuantity",
  "wNameBuffer",
  "DisplayPartyMenu",
  "DisplayTextBoxID",
  "LoadFontTilePatterns",
  "DisplayTextIDInit",
  "SwitchPartyMon_InitVarOrSwapData",
  "UsableItems_PartyMenu",
  "MoveNames",
  "UseItem",
  "hSwapTemp",
  "hTextID",
  "wActionResultOrTookBattleTurn",
  "wBattleMonSpecies2",
  "wCurrentBoxNum",
  "wMenuExitMethod",
  "wMenuItemToSwap",
  "wNumBoxItems",
  "wPartyMenuTypeOrMessageID",
  "wPlayTimeFrames",
  "wPlayTimeSeconds",
  "wPseudoItemID",
  "wRepelRemainingSteps",
  "wSwappedMenuItem",
  "wSwitchPartyMonTempBuffer",
  "wTextBoxID",
  "wTwoOptionMenuID",
  "wUpdateSpritesEnabled",
  // HD battle menus (p2-tapfirst): the battle menu's and the move list's waits for input, and
  // what the page shows and answers there
  "DisplayBattleMenu.AButtonPressed",
  "DisplayBattleMenu.leftColumn_WaitForInput",
  "DisplayBattleMenu.rightColumn",
  "DisplayBattleMenu.rightColumn_WaitForInput",
  "HandleMenuInput_.getJoypadState",
  "hDownArrowBlinkCount2",
  "SelectMenuItem.notB",
  "SelectMenuItem.select",
  "hUILayoutFlags",
  "wBattleMonMoves",
  "wBattleMonPP",
  "wEnemyMonMoves",
  "wMenuCursorLocation",
  "wMenuWrappingEnabled",
  "wMoveMenuType",
  "wNumMovesMinusOne",
  "wNumSafariBalls",
  "wPartyMenuAnimMonEnabled",
  "wPlayerDisabledMove",
  "wPlayerSelectedMove",
  "wTopMenuItemX",
  "wTopMenuItemY",
  // Learning a fifth move (LearnMove, from a TM or a level): its questions, asked by the page,
  // told apart by their caller in LearnMove … LearnedMove1Text (QA bugs 47, 48)
  "HMMoves",
  "LearnMove",
  "LearnedMove1Text",
  "wLearnMoveMonName",
  "wMoveNum",
  "wMoves",
  // The play journal (dex menu): battles, catches, items, gifts, badges and evolutions, read at
  // the routines that make them happen
  "AddItemToInventory_",
  "AddItemToInventory_.done",
  "DisplayPokemartDialogue_",
  "EndOfBattle",
  "HiddenItems",
  "InitBattleCommon",
  "ItemUseBall.skip6",
  "ItemUseBall.skipShowingPokedexData",
  "LoadEnemyMonData",
  "LoadMainData",
  "PickUpItem",
  "PlayerPCDeposit",
  "PlayerPCWithdraw",
  "RemoveItemFromInventory_",
  "RenameEvolvedMon",
  "SendNewMonToBox",
  "TossItem_",
  "VendingMachineMenu",
  "_AddEnemyMonToPlayerParty",
  "wBattleResult",
  "wCapturedMonSpecies",
  "wEnemyMonHP",
  "wEnemyMonLevel",
  "wEnemyMonSpecies2",
  "wEnemyMons",
  "wEvoNewSpecies",
  "wEvoOldSpecies",
  "wTrainerNo",
];

export interface ParsedSymbol {
  bank: number;
  address: number;
}

/** Parses rgblink `.sym` text (`BB:AAAA Name` per line). The first definition of a name wins. */
export function parseSym(text: string): Map<string, ParsedSymbol> {
  const out = new Map<string, ParsedSymbol>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]+):([0-9a-f]{4}) (\S+)$/i.exec(line.trim());
    if (!m || out.has(m[3]!)) continue;
    out.set(m[3]!, { bank: parseInt(m[1]!, 16), address: parseInt(m[2]!, 16) });
  }
  return out;
}

const hex = (n: number, width: number) => `0x${n.toString(16).padStart(width, "0")}`;

/** Renders the generated module. Throws if an allowlisted symbol is missing. */
export function renderSymbols(symText: string, allowlist: readonly string[] = ALLOWLIST): string {
  const parsed = parseSym(symText);
  const missing = allowlist.filter((name) => !parsed.has(name));
  if (missing.length) throw new Error(`Symbols not found in pokeblue.sym: ${missing.join(", ")}`);
  const names = [...new Set(allowlist)].sort();
  const lines = names.map((name) => {
    const { bank, address } = parsed.get(name)!;
    // Local labels (`Routine.label`) aren't identifiers, so they're quoted.
    const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
    return `  ${key}: { bank: ${hex(bank, 2)}, address: ${hex(address, 4)} },`;
  });
  return [
    "// Generated by tools/gen-symbols.ts from vendor/pokered/pokeblue.sym. Do not edit by hand;",
    "// add names to the allowlist in the script and run `pnpm rom:symbols`.",
    'import type { RomSymbol } from "../symbols.ts";',
    "",
    "export const SYMBOLS = {",
    ...lines,
    "} as const satisfies Record<string, RomSymbol>;",
    "",
    "export type SymbolName = keyof typeof SYMBOLS;",
    "",
  ].join("\n");
}

/** Names of `const`/`map_const` entries after `const_def`, in order. */
function constNames(text: string, macro: "const" | "map_const"): string[] {
  const names: string[] = [];
  let started = false;
  for (const line of text.split(/\r?\n/)) {
    const code = line.replace(/;.*/, "").trim();
    if (code === "const_def") started = true;
    const m = new RegExp(`^${macro}\\s+(\\w+)`).exec(code);
    if (started && m) names.push(m[1]!);
  }
  return names;
}

/** Renders map and tileset names, indexed by ID. Unused map slots become `null`. */
export function renderNames(mapConstants: string, tilesetConstants: string, spriteConstants = ""): string {
  const maps = constNames(mapConstants, "map_const");
  const tilesets = constNames(tilesetConstants, "const");
  if (maps.length === 0 || tilesets.length === 0) throw new Error("No map or tileset constants found");
  const mapLines = maps.map((n, i) => `  ${n.startsWith("UNUSED_MAP_") ? "null" : JSON.stringify(n)}, // ${hex(i, 2)}`);
  return [
    "// Generated by tools/gen-symbols.ts from vendor/pokered/constants. Do not edit by hand.",
    "",
    "/** Map constant names indexed by map ID; `null` for the unused slots. */",
    "export const MAP_NAMES: readonly (string | null)[] = [",
    ...mapLines,
    "];",
    "",
    "/** Tileset constant names indexed by tileset ID. */",
    "export const TILESET_NAMES: readonly string[] = [",
    ...tilesets.map((n, i) => `  ${JSON.stringify(n)}, // ${i}`),
    "];",
    "",
    "/** Overworld sprite constant names without SPRITE_ (\"OAK\"), indexed by sprite ID. */",
    "export const SPRITE_NAMES: readonly string[] = [",
    ...constNames(spriteConstants, "const").map((n, i) => `  ${JSON.stringify(n.replace(/^SPRITE_/, ""))}, // ${hex(i, 2)}`),
    "];",
    "",
  ].join("\n");
}

const readVendor = (path: string) => readFileSync(new URL(`../vendor/pokered/${path}`, import.meta.url), "utf8");

/** Renders both generated files from the disassembly, keyed by output path. */
export function renderAll(): Map<URL, string> {
  return new Map([
    [OUT_PATH, renderSymbols(readFileSync(SYM_PATH, "utf8"))],
    [NAMES_PATH, renderNames(readVendor("constants/map_constants.asm"), readVendor("constants/tileset_constants.asm"), readVendor("constants/sprite_constants.asm"))],
  ]);
}

export const SYM_PATH = new URL("../vendor/pokered/pokeblue.sym", import.meta.url);
export const OUT_PATH = new URL("../packages/rom/src/generated/symbols.ts", import.meta.url);
export const NAMES_PATH = new URL("../packages/rom/src/generated/names.ts", import.meta.url);

if (import.meta.main) {
  if (!existsSync(SYM_PATH)) {
    console.error("vendor/pokered/pokeblue.sym is missing; run `pnpm rom:build-disasm` first.");
    process.exit(1);
  }
  const check = process.argv.includes("--check");
  let stale = false;
  for (const [path, next] of renderAll()) {
    const name = path.pathname.split("/").pop();
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (next === current) {
      console.log(`${name} is up to date.`);
    } else if (check) {
      console.error(`packages/rom/src/generated/${name} is stale; run \`pnpm rom:symbols\`.`);
      stale = true;
    } else {
      writeFileSync(path, next);
      console.log(`Wrote ${name}.`);
    }
  }
  if (stale) process.exit(1);
}
