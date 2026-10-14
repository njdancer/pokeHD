// The game page: the player's ROM running in the emulator, its overworld state decoded every
// frame and rendered as the live HD world, with its text boxes and menus re-typeset over it
// (p2-text), battles staged in HD (p2-battles), and the Game Boy's own screen beside it for the
// rest (p1-play). Tap-first: the page's own start screen, Oak's introduction in HD, names typed on
// the device's keyboard, and menus with real buttons. URL options: ?stats shows frame rate and
// decoded state; ?classic keeps the game's own title and naming screens; in dev,
// ?fixture=battle-wild starts from a recorded state (tools/record-battles.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BATTLE_WATCHES,
  Button,
  EmulatorHost,
  type NameAsk,
  OVERWORLD_WATCHES,
  saveSummary,
  type SaveSummary,
  OverworldDecoder,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  ScreenTextDecoder,
  TEXT_WATCHES,
  type BattleScreen,
  type BattleState,
  type OverworldState,
  type OverworldWatched,
  type ScreenText,
  type TextWatched,
  decodeSnapshot,
  dexProgress,
  fromBcd,
  SNAPSHOT_RANGES,
  type AskAnswer,
  type BattleAnswer,
  type BattleAsk,
  type GameAsk,
  type GameSnapshot,
} from "@pokehd/emu";
import { createEngine, type Engine } from "@pokehd/engine";
import { createLiveWorld, type LiveWorld } from "@pokehd/engine/world";
import { decodeText, encodeName, parseWorld, pokedexNumber, readGlyphs, SYMBOLS, type RomHeader, type WorldData } from "@pokehd/rom";
import { JoypadInput, KeyBindingsPanel, TouchPad, useTouchDevice } from "../input/index.ts";
import { SaveControls } from "../saves/SaveControls.tsx";
import { cloudBackup } from "../saves/cloud-save.ts";
import { loadSave, openSaveSlot, storeSave } from "../saves/save-store.ts";
import { EarlierSaves } from "../saves/EarlierSaves.tsx";
import { keepSave } from "../saves/history.ts";
import { SaveLock, type LockHolder } from "../saves/lock.ts";
import { giftStorage } from "../saves/gift-store.ts";
import {
  deleteResumePoint,
  fetchCloudResumePoint,
  gameLeaving,
  gameLeft,
  loadAutosave,
  pickResumePoint,
  readResumePoint,
  saveAutosave,
  uploadResumePoint,
} from "../saves/resume-store.ts";
import { ResumeKeeper } from "../saves/resume-keeper.ts";
import { listPlayers, me, setMyName, type Account } from "../room/account.ts";
import { Friends } from "../room/Friends.tsx";
import { AdminTools } from "../admin/AdminTools.tsx";
import { RoomClient, type Friend, type RoomStatus } from "../room/client.ts";
import { RoomLink } from "../room/link.ts";
import { LinkPicker } from "../room/LinkPicker.tsx";
import { GiftCourier } from "../room/gifts.ts";
import { GiftNotices, GiftPanel } from "../room/GiftPanel.tsx";
import { decodeGiftables, describeGift, GIFT_REASONS, GIFTABLE_RANGES } from "../room/giftables.ts";
import { toGhosts, toPresence } from "./presence.ts";
import { inWorldTracker, mapOnlyTracker, screenLayout, type BattleScene, type ScreenLayout } from "./screen.ts";
import {
  BattleItemUse, BattleMenuCover, BattleTracker, battleCovered, battleText, battleTextShown, maskBattleScreen, partyScreenMessage, type BattleFrame,
} from "./battle.ts";
import { BattleHud } from "./BattleHud.tsx";
import { BattleMenu, type BattleKey } from "./BattleMenu.tsx";
import { battleMenusOn } from "./battle-menu-flag.ts";
import { EraseConfirm, GrownUps, SavedToast } from "./KidProof.tsx";
import { TextOverlay, type TextActions } from "./TextOverlay.tsx";
import { battleTextFits, hdTextFits, introTextFits, textKey } from "./hd-text.ts";
import { NamePrompt } from "./NamePrompt.tsx";
import { StartScreen } from "./StartScreen.tsx";
import { IntroStage } from "./IntroStage.tsx";
import { liftPictures, STAGE_HEIGHT } from "./intro-pictures.ts";
import { LockScreen } from "./LockScreen.tsx";
import { Starter, type StartChoice } from "./onboarding.ts";
import { newScriptView, scriptTap, scriptView, withScriptState, type ScriptView } from "./script-view.ts";
import { MessageLog, pageInput, type LoggedLine, type PageInput, type PageInputFacts } from "./qa-signals.ts";
import { DialogJoiner } from "./dialog-join.ts";
import { uiLook } from "./ui-look.ts";
import { Pokedex } from "../dex/Pokedex.tsx";
import { LoadingScreen, LOADING_FADE_MS } from "../LoadingScreen.tsx";
import { buildCatalogue, type DexProgress } from "../dex/catalogue.ts";
import { DexJournal } from "../dex/journal.ts";
import type { DexMenuProps } from "../menu/DexMenu.tsx";
import type { LiveActions } from "../menu/live.ts";
import { LiveMenu } from "../menu/LiveMenu.tsx";
import { MenuBoundary } from "../menu/MenuBoundary.tsx";
import type { AppOptions } from "../menu/model.ts";
import { PlayJournal } from "../menu/journal.ts";
import { loadDexLook, saveDexLook, type DexSetting } from "../dex/settings.ts";
import { noteRenderer, reportError } from "../errors.ts";
import { PerfSampler } from "../perf.ts";
import { QA_RUN } from "../qa.ts";
import "./game.css";

const showStats = new URLSearchParams(location.search).has("stats");
/** Dev: ?render=0 skips the 3D renderer (the page and its UI without a GPU, e.g. headless checks). */
const noRender = import.meta.env.DEV && new URLSearchParams(location.search).get("render") === "0";
/** ?classic: the game's own title screen and naming screens, as on the Game Boy (scripted play-throughs use it). */
const classic = new URLSearchParams(location.search).has("classic");
/** HD battle menus (D44): on unless this device turned them off (battle-menu-flag.ts). */
const BATTLE_MENUS = battleMenusOn();
/** The joypad's buttons as the HD battle menu's keys. */
const BATTLE_KEYS: [number, BattleKey][] = [[Button.Up, "up"], [Button.Down, "down"], [Button.Left, "left"], [Button.Right, "right"], [Button.A, "a"], [Button.B, "b"]];

declare global {
  interface Window {
    /** Set with ?stats, for scripted play-throughs. */
    __pokehd?: {
      readonly state: OverworldState | null;
      readonly inWorld: boolean;
      readonly frames: number;
      read(address: number, length: number): Promise<number[]>;
      /** The team, badges, play time and the rest, as the Pokédex menu reads them (the stream page's party). */
      snapshot(): Promise<GameSnapshot>;
      readonly page: object;
      readonly slow: SlowFrame[];
      /** Whether the page would take the player's next input now (qa-signals.ts). */
      readonly input: PageInput | null;
      /** This page's message log (qa-signals.ts): `boot` changes when the game restarts. */
      messages(after: number): { boot: string; lines: LoggedLine[] };
    };
  }
}
/** A display frame over 50 ms, with what the page was doing (for ?stats perf checks). */
interface SlowFrame {
  at: number;
  ms: number;
  updateMs: number;
  renderMs: number;
  /** A chunk build that started during the frame. */
  build: string | null;
  map: number | null;
  mode: string | null;
  fade: number | null;
  layout: string;
}

/**
 * Behind the start screen and Oak's introduction: Pallet Town in HD, the player at their front
 * door, until the game's own world loads.
 */
const TITLE_BACKDROP: OverworldState = {
  mode: "overworld",
  mapId: 0,
  lastMap: 0,
  player: { x: 5, y: 6, facing: "down", step: null, animFrame: 0, transport: "walk" },
  npcs: [],
  fade: 0,
  palettes: { bgp: 0xe4, obp0: 0xd0, obp1: 0xe0 },
};

/** Where the TextOverlay's buttons go: the game's buttons, pressed the game's own way. */
const PRESS: Record<Parameters<TextActions["press"]>[0], number> = { A: Button.A, B: Button.B, Up: Button.Up, Down: Button.Down };

/**
 * The page's own start (tap-first UI): `choose` while the start screen waits for the player,
 * `starting` while the page presses the game's buttons for the choice, `intro` while Oak's
 * introduction plays in HD; null in the world, or when the game's own screens show instead.
 */
type Onboarding = { phase: "choose" } | { phase: "starting"; choice: StartChoice } | { phase: "intro" } | null;

/**
 * How often a resume point is taken and stored while playing (also whenever the page is hidden,
 * and after a save): what a reload or a crash can lose. The page can't take one as it goes (see
 * resume-keeper.ts), so this is kept short.
 */
const RESUME_POINT_MS = 2000;
/** How often the newest resume point goes to the cloud (also whenever the page is hidden). */
const RESUME_UPLOAD_MS = 60_000;
/** The loading screen gives up waiting for the HD world after this long, rather than stay up for good. */
const LOADING_GIVE_UP_MS = 12_000;
/** How long start-up waits for the cloud (a save for an empty device, a resume point). */
const CLOUD_WAIT_MS = 4000;

/** `promise`, or `fallback` once `ms` have passed. */
const within = <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([promise.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

const PIP_KEY = "pokehd.screen.pip.v1";
/** Toggles the picture-in-picture screen, unless the player has bound it to a button. */
const PIP_TOGGLE_CODE = "KeyP";

function loadPip(): boolean {
  if (QA_RUN) return false;
  try {
    return localStorage.getItem(PIP_KEY) !== "off";
  } catch {
    return true;
  }
}
function savePip(on: boolean) {
  try {
    localStorage.setItem(PIP_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked (some private windows): the choice lasts until reload.
  }
}

interface Stats {
  fps: number;
  worstMs: number;
  emuFps: number;
  cpuMs: number;
  /** Dynamic resolution's render scale, and whether depth of field is on. */
  scale: number;
  dof: boolean;
  /** 3D frames drawn per second (still views skip frames, D34). */
  drawn: number;
  shadowsCached: boolean;
  backend: string;
  state: OverworldState | null;
  inWorld: boolean;
}

interface Props {
  rom: Uint8Array;
  romKey: string;
  header: RomHeader;
  onForget(): void;
  /**
   * Set by a menu in front of the game (the intro, /dev/saves): while true the game loads and
   * draws its world behind the menu, paused, with none of its own buttons. Once false the player
   * plays on from where the save left off; with no resume point the game's start screen is
   * passed by itself (Continue, or a new game for an empty slot). Left out, the game shows its
   * own start screen as before.
   */
  held?: boolean;
  /**
   * The Pokédex menu (p2-dex-menu, /dev/menu only until Nick picks): one menu in place of the
   * game's Start menu, with Start and Select gone; the game's questions (bag and team in
   * battle, Mart, PC) come as sheets; the play journal records as the game runs.
   */
  menu?: boolean;
  /** Called once the world has drawn behind a menu (or there won't be one), so it can show. */
  onReady?(): void;
}

export function Game({ rom, romKey, header, onForget, held, onReady, menu = false }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const heldRef = useRef(held ?? false);
  /** The game sits behind a page's menu (held is given), rather than starting on its own. */
  const behindMenu = useRef(held !== undefined);
  const menuRef = useRef(menu);
  /** The Pokédex menu is open (and where it opened), or the game asked a question as a sheet. */
  const [menuOpen, setMenuOpenState] = useState<DexMenuProps["start"] | null>(null);
  const [ask, setAskState] = useState<{ id: number; ask: GameAsk; game: GameSnapshot | null } | null>(null);
  /** While either is up, the player's buttons are the menu's, not the game's. */
  const menuUpRef = useRef(false);
  /** `ask`: the kind of question the sheet is asking, if one is up. */
  const menuStateRef = useRef<{ open: boolean; ask: GameAsk["kind"] | null }>({ open: false, ask: null });
  const setMenuOpen = (next: DexMenuProps["start"] | null) => {
    menuStateRef.current.open = !!next;
    menuUpRef.current = menuStateRef.current.open || !!menuStateRef.current.ask;
    if (menuUpRef.current) hostRef.current?.setButtons(0);
    setMenuOpenState(next);
  };
  /**
   * The game's last question, for what its answer starts (BattleItemUse): every one, including
   * those the menu answers itself from what it was told up front (the bag's "Use POTION on
   * GEODUDE" answers the party question the game asks next, QA bug 57).
   */
  const lastAskRef = useRef<{ id: number; ask: GameAsk } | null>(null);
  /** An item used in a battle: its party screen stays behind the HD battle (QA bug 55). */
  const battleItemRef = useRef(new BattleItemUse());
  const setAsk = (next: { id: number; ask: GameAsk; game: GameSnapshot | null } | null) => {
    menuStateRef.current.ask = next?.ask.kind ?? null;
    menuUpRef.current = menuStateRef.current.open || !!menuStateRef.current.ask;
    if (menuUpRef.current) hostRef.current?.setButtons(0);
    setAskState(next);
  };
  /** The game's Pokédex is held behind the menu (it opened it): closing the menu lets it go. */
  const dexHeldRef = useRef(false);
  const [playJournal, setPlayJournal] = useState<PlayJournal | null>(null);
  const playJournalRef = useRef<PlayJournal | null>(null);
  /** The Pokédex menu's actions: the game's questions go to them first. */
  const liveActionsRef = useRef<LiveActions | null>(null);
  /** The emulator has run its first frame, so pausing it now won't hold up the loading screen. */
  const emuRanRef = useRef(false);
  const screenRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<EmulatorHost>(null);
  const [pip, setPip] = useState(loadPip);
  const pipRef = useRef(pip);
  const [layout, setLayout] = useState<ScreenLayout>("full");
  const [input, setInput] = useState<JoypadInput>();
  const [sound, setSound] = useState(false);
  const [settings, setSettings] = useState(false);
  /** Nick: the friends list shows in Settings. */
  const [admin, setAdmin] = useState(false);
  const [message, setMessage] = useState<string>("Starting…");
  const [stats, setStats] = useState<Stats>();
  const [noHd, setNoHd] = useState(false);
  /**
   * Start-up, for the loading screen: the emulator has run a frame, and the HD world has drawn a
   * finished frame (or there won't be one: no renderer, or start-up failed).
   */
  const [startup, setStartup] = useState({ emu: false, world: false });
  /** The start (`boot`) whose loading screen has faded out, or given up waiting. */
  const [loaderGoneFor, setLoaderGoneFor] = useState(-1);
  const [gaveUpFor, setGaveUpFor] = useState(-1);
  /** The shared world: how we're connected and how many friends are in it. */
  const [room, setRoom] = useState<{ status: RoomStatus; friends: Friend[] } | null>(null);
  /** The link cable over the room, once the room has said who we are. */
  const [link, setLink] = useState<RoomLink | null>(null);
  /** Gifts to and from friends (D20), once the room is set up. */
  const [gifts, setGifts] = useState<GiftCourier | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  /** Another device backed up a newer save than this browser's; restoring it is in Settings. */
  const [cloudNewer, setCloudNewer] = useState(false);
  const [autosave, setAutosave] = useState(loadAutosave);
  /** Started from the resume point: offer the save file instead, for a while. */
  const [resumed, setResumed] = useState(false);
  /** The game is asking whether to erase the older save (NEW GAME): the save it would replace. */
  const [erasing, setErasing] = useState<{ old: SaveSummary | null } | null>(null);
  /** When the last autosave landed, for the "Saved" toast. */
  const [savedAt, setSavedAt] = useState(0);
  const touch = useTouchDevice();
  const glyphs = useMemo(() => readGlyphs(rom), [rom]);
  /** The text on screen, while the HD text layer can show it. */
  const [hdText, setHdText] = useState<ScreenText | null>(null);
  /** The message box's lines when more than the game's two are read at once (DialogJoiner). */
  const [dialogLines, setDialogLines] = useState<string[] | null>(null);
  /** Whole messages from the script (ScriptText), in place of the game's pages. */
  const scriptRef = useRef<ScriptView | null>(null);
  /**
   * The HD message box shows that message this frame. Once the game prints its own words in the
   * box ("SQUIRTLE's ATTACK fell!" after "Enemy BULBASAUR used GROWL!"), a tap on it is for those,
   * not the message before (QA bug 56).
   */
  const scriptShownRef = useRef(false);
  const look = useMemo(() => uiLook(), []);
  /** The signed-in player (their name is the one Oak checks, and kept the same as theirs). */
  const [account, setAccount] = useState<Account | null>(null);
  /** Everyone on the server, for the Pokédex menu (the room only knows who's online). */
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([]);
  /** The game is asking for a name: the page asks instead (tap-first UI). */
  const [nameAsk, setNameAsk] = useState<NameAsk | null>(null);
  const [onboarding, setOnboardingState] = useState<Onboarding>(null);
  const onboardingRef = useRef<Onboarding>(null);
  const setOnboarding = (next: Onboarding) => {
    onboardingRef.current = next;
    setOnboardingState(next);
  };
  const starterRef = useRef<Starter | null>(null);
  /** The save the start screen offers to continue. */
  const [startSave, setStartSave] = useState<SaveSummary | null>(null);
  /**
   * One device per save (D41): another device has this save (the game waits to start), is
   * keeping its progress for a takeover, or has taken it over from this one (the game stopped).
   */
  const [lockUi, setLockUi] = useState<{ kind: "in-use" | "waiting" | "lost"; other: LockHolder; mine: string } | null>(null);
  /** Takes the save over from the device that has it, while the game waits to start. */
  const takeRef = useRef(() => {});
  /** The next start takes the save over at once ("Play here" after it was taken from this one). */
  const takeNextRef = useRef(false);
  const introCanvas = useRef<HTMLCanvasElement>(null);
  // Bumped by a .sav import: restarts the emulator on the imported save.
  const [boot, setBoot] = useState(0);
  // The latest mode and map flag, so the layout can be recomputed when the player toggles pip.
  const sceneRef = useRef<{ mode: OverworldState["mode"]; inWorld: boolean; hdText: boolean; battle?: BattleScene; onboarding?: boolean }>({ mode: "overworld", inWorld: false, hdText: false });
  /** The HD Pokédex (p2-dex): its look, and while it's up what it shows. */
  const [dexLook, setDexLook] = useState<DexSetting>(loadDexLook);
  const dexLookRef = useRef(dexLook);
  const [dex, setDex] = useState<{ progress: DexProgress; openOn?: number } | null>(null);
  /** Bumped by the B button: asks the open Pokédex to close. */
  const [dexB, setDexB] = useState(0);
  const dexBRef = useRef(() => {});
  useEffect(() => {
    dexBRef.current = () => dex && setDexB((n) => n + 1);
  });
  const [world, setWorld] = useState<WorldData | null>(null);
  const catalogue = useMemo(() => world && buildCatalogue(rom, world), [rom, world]);
  /** The battle's HD cards: the state they show and which the game draws now. */
  const [battleHud, setBattleHud] = useState<{ state: BattleState; huds: BattleScreen["huds"] } | null>(null);
  /** The battle waits for the player's choice (HD battle menus): the HD menu answers. */
  const [battleAsk, setBattleAskState] = useState<{ id: number; ask: BattleAsk } | null>(null);
  const battleAskRef = useRef<{ id: number; ask: BattleAsk } | null>(null);
  const setBattleAsk = (next: { id: number; ask: BattleAsk } | null) => {
    battleAskRef.current = next;
    setBattleAskState(next);
  };
  /** Whether the HD battle menu covers the Game Boy screen, from its questions and answers. */
  const battleCoverRef = useRef(new BattleMenuCover());
  /** The HD battle menu's key handler while it's up. */
  const battleKeysRef = useRef<((key: BattleKey) => void) | null>(null);

  const enableSound = async () => {
    await hostRef.current?.enableAudio().catch(() => {}); // not a gesture the browser accepts
    setSound(hostRef.current?.audioEnabled ?? false);
  };

  // iOS only starts audio on a gesture's end (touchend, pointerup, click) or a key, not on the
  // pointerdown a touch press arrives as. It also suspends audio when the app is backgrounded,
  // and the game is paced by the audio clock, so any later tap must be able to restart it.
  useEffect(() => {
    const onGesture = () => {
      if (hostRef.current && !hostRef.current.audioEnabled) void enableSound();
    };
    // Back from the background: a fresh audio output, started by the next tap (see restartAudio).
    let hidden = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hidden = true;
      else if (hidden) {
        hidden = false;
        if (hostRef.current?.restartAudio()) setSound(false);
      }
    };
    const types = ["pointerup", "touchend", "click", "keydown"] as const;
    for (const type of types) window.addEventListener(type, onGesture, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      for (const type of types) window.removeEventListener(type, onGesture, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const togglePip = () => {
    pipRef.current = !pipRef.current;
    savePip(pipRef.current);
    setPip(pipRef.current);
    const { mode, inWorld, hdText, battle, onboarding } = sceneRef.current;
    setLayout(screenLayout(mode, inWorld, pipRef.current, hdText, battle, onboarding));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Bound keys and rebinding prompts call preventDefault first (JoypadInput listens earlier).
      if (QA_RUN || e.code !== PIP_TOGGLE_CODE || e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      togglePip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let disposed = false;
    let engine: Engine | null = null;
    let live: LiveWorld | null = null;
    let host: EmulatorHost | null = null;
    let roomClient: RoomClient | null = null;
    let unsubscribeRoom = () => {};
    let roomLink: RoomLink | null = null;
    let courier: GiftCourier | null = null;
    let raf = 0;
    const perf = new PerfSampler();
    let stopResumePoints = () => {};
    /** Before the game goes (another slot, the page leaving it): its save and a last resume point. */
    let finish = async () => {};
    let lock: SaveLock | null = null;
    /** This device holds the save (signed in and online): let it go when the game goes. */
    let holding = false;
    /** The page is closing: the save is free for another device straight away. */
    const onClosing = () => {
      if (holding) void lock?.release(true);
    };
    let stopJournal = () => {};
    /** Takes a resume point once a save has finished, so the newest point always holds it. */
    let pointAfterSave = () => {};
    let lastMask = 0;
    const joypad = new JoypadInput({
      onChange: (mask, source) => {
        // Behind a menu, the player's buttons are the menu's.
        if (heldRef.current) return;
        // While the page presses the game's buttons for the player's start, the player's own are
        // let go: a stray press there could pick NEW GAME.
        if (onboardingRef.current?.phase === "starting") mask = 0;
        // The Pokédex menu: Start and Select are gone, and while it's up nothing reaches the game.
        if (menuRef.current) mask = menuUpRef.current ? 0 : mask & ~(Button.Start | Button.Select);
        // B closes the HD Pokédex (the game's is held while it's up).
        const pressed = mask & ~lastMask;
        if (pressed & Button.B) dexBRef.current();
        lastMask = mask;
        // The HD battle menu takes the buttons while the battle waits on it.
        if (battleAskRef.current) {
          for (const [button, key] of BATTLE_KEYS) if (pressed & button) battleKeysRef.current?.(key);
          mask = 0;
        }
        hostRef.current?.setButtons(mask);
        // Keyboard and touch changes come from user gestures, which may start audio; gamepad polls don't.
        if (mask && source !== "gamepad") void enableSound();
      },
    });
    setInput(joypad);
    // A fresh canvas per mount: StrictMode's mount, unmount, remount must not share a GPU context.
    const canvas = document.createElement("canvas");
    canvas.className = "scene";
    holder.current!.prepend(canvas);

    (async () => {
      // A game on this slot that's still going (a remount) stores its last point first.
      await gameLeft(romKey);
      if (disposed) return;
      const world = parseWorld(rom);
      setWorld(world);
      live = createLiveWorld(world);
      // Asks the browser not to clear the save under storage pressure (Safari's eviction).
      void navigator.storage?.persist?.().catch(() => false);
      // One device per save (D41): claim it first. While another device has it, the game waits
      // here, and starts once that one lets go or this one takes it over. Signed out or offline,
      // nobody can be asked and the game plays as before.
      const l = (lock = new SaveLock(romKey));
      const claim = l.claim((s) => !disposed && setLockUi({ kind: s.state, other: s.by, mine: l.name }));
      takeRef.current = claim.take;
      if (takeNextRef.current) {
        takeNextRef.current = false;
        claim.take();
      }
      const claimed = await claim.done;
      if (disposed) {
        if (claimed.state === "held") void l.release();
        return;
      }
      holding = claimed.state === "held";
      setLockUi(null);

      // A device with no save (a new phone, or storage the browser cleared) gets the cloud's
      // back before the game starts, for signed-in players. So does one holding the save whose
      // cloud copy is newer: with one device per save, that's another device's later play, and
      // the game carries on from it. What this device had stays in Earlier saves.
      let restored = false;
      /** Whether this slot is known to have no save anywhere (here, or a cloud that answered). */
      let noSave = false;
      const local = await loadSave(romKey).catch(() => null);
      if (!local || holding) {
        const backup = cloudBackup(romKey);
        const status = await within(backup.status(), CLOUD_WAIT_MS, null);
        if (!local) noSave = status?.kind === "none" || status?.kind === "signed-out";
        if (status?.kind === "newer") {
          const here = await loadSave(romKey);
          if (!here || holding) {
            if (here) await keepSave(romKey, here, "before-restore").catch(() => {});
            await backup.restore(status.cloud);
            restored = true;
          }
        }
      }
      const slot = await openSaveSlot(romKey);
      // The newest resume point that holds this save: this device's, or one from the cloud.
      const resumePoint = await pickResumePoint(slot.sram, [
        await readResumePoint(romKey).catch(() => null),
        await within(fetchCloudResumePoint(romKey), CLOUD_WAIT_MS, null),
      ]);
      // Dev: ?fixture=<name> starts from a recorded state (tools/record-battles.ts).
      const fixture = import.meta.env.DEV && new URLSearchParams(location.search).get("fixture");
      const recorded = fixture ? await fetch(`/__dev/fixture/${fixture}.state`).then((r) => (r.ok ? r.arrayBuffer() : null)) : null;
      const resume = recorded ? new Uint8Array(recorded) : (resumePoint?.state ?? null);
      if (disposed) return;
      // The page's own start screen, unless the game's own screens are wanted.
      const custom = !recorded && !classic;
      // Behind a menu, a slot with no save here that the cloud didn't answer for (offline, or slow)
      // may still have one: the game's own title screen then, so a new game is the player's
      // choice, never one the menu's Resume makes for them.
      const unknown = behindMenu.current && !slot.sram && !noSave;
      if (custom && !resume && !unknown) setOnboarding({ phase: "choose" });
      setStartSave(slot.sram ? saveSummary(slot.sram) : null);
      if (!restored) void cloudBackup(romKey).status().then((s) => !disposed && setCloudNewer(s.kind === "newer"), () => {});

      // The emulator starts at once; the HD view joins when the renderer is ready.
      const ctx = screenRef.current!.getContext("2d")!;
      const image = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
      const decoder = new OverworldDecoder();
      const textDecoder = new ScreenTextDecoder(glyphs);
      const introImage = new ImageData(SCREEN_WIDTH, STAGE_HEIGHT);
      let shownText = "";
      const joiner = new DialogJoiner();
      /** Battles are drawn in HD once the renderer is up; until then the screen shows them. */
      let hd = false;
      let battles: BattleTracker | null = null;
      let shownHud = "";
      /** The battle screen's last HD view and HUDs, kept while an item's screens are behind them. */
      let lastBattle: { view: NonNullable<BattleFrame["view"]>; huds: BattleFrame["huds"] } | null = null;
      let trackInWorld = inWorldTracker();
      /** The window up over just the map, before the game draws its box (see mapOnlyTracker). */
      const trackMapOnly = mapOnlyTracker();
      let latest: OverworldState | null = null;
      let emuFrames = 0;
      /** ?stats: every line the message box showed, and who has the next input (qa-signals.ts). */
      const qaLog = showStats ? new MessageLog() : null;
      const qaBoot = Math.random().toString(36).slice(2);
      let qaFacts: Omit<PageInputFacts, "battleAsk" | "sheet"> | null = null;
      // The Pokédex's journal: places visited, people met and what they first said (p2-dex).
      let journal: DexJournal | null = null;
      let journalFor = -1;
      let lastMap = -1;
      /** Someone just spoke: their words are gathered from the text box until it closes. */
      let talking: { map: number; npc: number; lines: string[]; frames: number } | null = null;
      host = new EmulatorHost({
        rom,
        sram: slot.sram,
        resume: resume ?? undefined,
        autosave: loadAutosave(),
        onAutosaveSkipped: () => setMessage("Autosave is waiting until you save this new game yourself, so it can't replace the old save."),
        onSram: slot.persist,
        onSaved: (auto) => {
          if (auto) setSavedAt(Date.now());
          pointAfterSave();
        },
        onErasePrompt: () => {
          // Keep the old save before anything can replace it, then ask.
          void loadSave(romKey).then((old) => {
            if (old) void keepSave(romKey, old, "replaced");
            if (!disposed) setErasing({ old: old && saveSummary(old) });
          });
        },
        onEraseAnswered: () => setErasing(null),
        ...(custom ? { onNameAsk: (ask: NameAsk) => setNameAsk(ask) } : {}),
        onScriptMessage: ({ id, message, letterFrames }) => {
          scriptRef.current = newScriptView(id, message, letterFrames);
          // The menu's sheet stays up over the game while the game answers it, so its words would
          // sit unseen under the sheet: a purchase's "Here you are! Thank you!" is the menu's to
          // show (a notice) and read past, and a sheet the game has moved on from goes (QA bug 25).
          const heard = liveActionsRef.current?.heard(message) ?? null;
          if (heard === "reply") {
            scriptRef.current.closed = true;
            host?.readOnMessage(id);
            host?.closeMessage(id);
            return;
          }
          if (heard === "away" && menuStateRef.current.ask) setAsk(null);
          // All of it fits in one box: the game can print the rest while the player reads.
          if (scriptRef.current.boxes.length <= 1) host?.readOnMessage(id);
        },
        onScriptEnd: (id) => {
          if (scriptRef.current?.id === id) scriptRef.current.ended = true;
        },
        onScriptPress: () => readOnScript(),
        onFrame: ({ pixels, watched, count, acting, wait }) => {
          if (disposed) return; // the game is going: only its save is still wanted
          image.data.set(new Uint8Array(pixels));
          if (++emuFrames === 1) {
            setStartup((s) => ({ ...s, emu: true }));
            emuRanRef.current = true;
            if (heldRef.current) host?.setPaused(true);
          }
          const bytes = watched as OverworldWatched;
          const state = decoder.decode(bytes);
          const inWorld = trackInWorld(bytes);
          // Before the first map loads (title, intro) the state is meaningless; the HD view waits,
          // or shows Pallet Town behind the page's own start.
          if (inWorld) live!.push(state, performance.now() / 1000);
          else if (onboardingRef.current) live!.push(TITLE_BACKDROP, performance.now() / 1000);
          latest = state;
          if (inWorld && state.mapId !== lastMap && journal) {
            lastMap = state.mapId;
            journal.visit(state.mapId);
            playJournalRef.current?.visit(state.mapId);
          }
          if (inWorld) playJournalRef.current?.position(state.mapId, state.player.x, state.player.y);
          // Battles: the scene in 3D, the screen masked down to its menus and text.
          const fight = battles?.frame(watched);
          const actual = hd && inWorld ? fight?.scene : undefined;
          const textBytes = bytes as unknown as TextWatched;
          // An item used in the battle (a POTION): what the game draws for it stays behind the HD
          // battle as it last was, and only its message shows (BattleItemUse, QA bug 55).
          const item = battleItemRef.current;
          const wholeText = actual && fight && item.active ? textDecoder.decode(textBytes) : null;
          const itemUse = !!wholeText && item.using(fight!, wholeText, !!battleAskRef.current);
          const battle = itemUse ? "scene" : actual;
          if (actual === "scene" && fight?.view) lastBattle = { view: fight.view, huds: fight.huds };
          live!.setBattle(battle ? ((itemUse ? lastBattle?.view : fight?.view) ?? null) : null);
          const battleScreen = !itemUse && (battle === "scene" || battle === "evolution") ? (fight?.screen ?? null) : null;
          const hudsShown = itemUse ? lastBattle?.huds : fight?.huds;
          const huds = battle === "scene" && fight?.state && hudsShown ? { state: fight.state, huds: hudsShown } : null;
          const hudKey = huds ? JSON.stringify([huds.huds, huds.state.player.mon, huds.state.enemy.mon]) : "";
          if (hudKey !== shownHud) {
            shownHud = hudKey;
            setBattleHud(huds);
          }
          roomClient?.sendPresence(toPresence(state, inWorld));
          // Text and menus: drawn by the HD text layer when it can show all of them. On the battle
          // screen only its text and menu cells are read (the HUDs and pictures are drawn in HD).
          const onScreen = wholeText ?? textDecoder.decode(battleScreen ? battleText(textBytes, battleScreen) : textBytes);
          // On the battle screen, less the move's TYPE box: under "No PP left!" only the message shows.
          const text = itemUse ? partyScreenMessage(onScreen) : battleScreen ? battleTextShown(onScreen) : onScreen;
          if (talking) {
            const d = text.dialog;
            if (!d) {
              if (talking.lines.length) journal?.said(talking.map, talking.npc, talking.lines);
              if (talking.lines.length) playJournalRef.current?.said(talking.map, talking.npc, talking.lines);
              // Before the box opens there's nothing yet; give up if it never does.
              if (talking.lines.length || ++talking.frames > 300) talking = null;
            } else if (d.state !== "printing") {
              for (const line of d.lines) if (line && talking.lines.at(-1) !== line && !talking.lines.includes(line)) talking.lines.push(line);
            }
          }
          // The page's own start: press the game's buttons for the choice, then Oak in HD.
          let start = onboardingRef.current;
          const starter = starterRef.current;
          if (starter && start?.phase === "starting") {
            starter.frame(text, inWorld, count);
            if (starter.done) {
              starterRef.current = null;
              setOnboarding((start = starter.choice === "new" && !inWorld ? { phase: "intro" } : null));
            }
          }
          if (start && inWorld) setOnboarding((start = null));
          const intro = start?.phase === "intro";
          if (intro && introCanvas.current) {
            liftPictures(new Uint8ClampedArray(pixels), introImage);
            introCanvas.current.getContext("2d")!.putImageData(introImage, 0, 0);
          }
          // The HD battle menu stands in for the battle's menus: the Game Boy's are masked out
          // while the game asks, while it draws them either side of asking, and from an answer until
          // the game shows what comes of it (BattleMenuCover).
          // LearnMove's list at a level up draws its Game Boy box before the sheet asks which move
          // to forget: masked the same way (QA bug 48).
          const menuCovers = battleCoverRef.current.covering(BATTLE_MENUS && battleScreen && fight?.state?.type !== "link" ? onScreen : null, !!battleAskRef.current);
          const choosing = menuCovers || (!!battleScreen && menuStateRef.current.ask === "forget-move");
          // A Pokédex menu action running the game's routine (a POTION from the Inventory tab): what
          // it draws (the party menu ItemUseMedicine redraws, "recovered by 20!") is the menu's to
          // report, in its own words once the action is done, so neither the HD text layer nor the
          // Game Boy screen shows it.
          const fits = acting || choosing ? false : intro ? introTextFits(text) : battleScreen || itemUse ? battleTextFits(text) : hdTextFits(text, state.mode, inWorld);
          if (battleScreen) maskBattleScreen(image.data, battleScreen, battleCovered(onScreen, fits, choosing));
          if (itemUse) image.data.fill(0);
          ctx.putImageData(image, 0, 0);
          // Nothing on the Game Boy screen the HD view doesn't show: keep it down.
          const mapOnly = trackMapOnly((bytes as unknown as TextWatched).tileMap, state.mode, inWorld);
          const quiet = fits || mapOnly || choosing || !!acting;
          // Whole messages from the script: the page shows the message the game is printing.
          const script = scriptView(scriptRef, text, fits, (id) => host?.releaseMessage(id));
          scriptShownRef.current = !!script;
          // Otherwise whole sentences at once: read past pages that stop mid-sentence (DialogJoiner).
          // Not in battle, where the game moves on by itself between some messages.
          if (!fits || script || battleScreen || itemUse) joiner.reset();
          const joined = script ? { lines: script.lines, press: false } : fits && !battleScreen && !itemUse ? joiner.frame(text) : { lines: null, press: false };
          if (joined.press) host?.tap(Button.A);
          // A whole message's ▼ shows only when a tap reads on (QA bug 56).
          const boxText = script ? withScriptState(text, scriptRef.current) : text;
          if (qaLog) {
            const box = boxText.shown ? boxText.dialog : null;
            qaLog.show(joined.lines ?? box?.lines ?? null, !!script || box?.state !== "printing");
            const held = !!script && !scriptRef.current?.ended;
            qaFacts = { mode: state.mode, inWorld, dialog: box?.state ?? null, menu: boxText.shown && boxText.menus.some((m) => m.active), pageHolds: held, game: wait ?? null, acting: !!acting };
          }
          const key = fits ? `${textKey(boxText)}#${joined.lines?.join("|") ?? ""}` : "";
          if (key !== shownText) {
            shownText = key;
            setHdText(fits ? boxText : null);
            setDialogLines(joined.lines);
          }
          const scene = sceneRef.current;
          const onboard = start !== null;
          if (scene.mode !== state.mode || scene.inWorld !== inWorld || scene.hdText !== quiet || scene.battle !== battle || scene.onboarding !== onboard) {
            sceneRef.current = { mode: state.mode, inWorld, hdText: quiet, battle, onboarding: onboard };
            setLayout(screenLayout(state.mode, inWorld, pipRef.current, quiet, battle, onboard));
          }
        },
        onError: (text, stack) => {
          reportError("emulator", Object.assign(new Error(text), { stack }));
          setMessage(`Emulator error: ${text}`);
        },
        onGift: (event) => courier?.onGiftEvent(event),
        onDexOpen: (opened) => {
          const h = host;
          // The Pokédex menu shows instead, on the Pokémon's page if the game opened its data.
          if (menuRef.current && h) {
            dexHeldRef.current = true;
            const dexNo = opened.kind === "data" ? pokedexNumber(rom, opened.species) : 0;
            setMenuOpen({ tab: "dex", ...(dexNo ? { screen: { k: "entry", dex: dexNo } } : {}) });
            return;
          }
          if (!h || dexLookRef.current === "off") return h?.passDex();
          void h
            .read([
              [SYMBOLS.wPokedexOwned.address, 19],
              [SYMBOLS.wPokedexSeen.address, 19],
              [SYMBOLS.wPlayerID.address, 2],
              [SYMBOLS.wRivalName.address, 11],
            ])
            .then(async ([owned, seen, id, rival]) => {
              const trainer = (id![0]! << 8) | id![1]!;
              if (!journal || journalFor !== trainer) {
                journal = await DexJournal.open(romKey, trainer);
                journalFor = trainer;
              }
              if (disposed) return;
              const dexNo = opened.kind === "data" ? pokedexNumber(rom, opened.species) : 0;
              const flags = dexProgress(owned!, seen!);
              setDex({ progress: { ...journal.progress(flags.seen, flags.owned, decodeText(rival!)), onShow: flags.onShow }, openOn: dexNo || undefined });
            });
        },
        onTalk: (map, npc) => {
          journal?.met(map, npc);
          playJournalRef.current?.met(map, npc);
          talking = { map, npc, lines: [], frames: 0 };
        },
        onBeat: (map, npc) => {
          journal?.beat(map, npc);
          playJournalRef.current?.beat(map, npc);
        },
        ...(menuRef.current
          ? {
              onAsk: (id: number, question: GameAsk) => {
                lastAskRef.current = { id, ask: question };
                // The menu may already know the answer (a purchase's quantity, its "OK?", a battle
                // item's Pokémon).
                if (liveActionsRef.current?.asked(id, question)) return;
                setAsk({ id, ask: question, game: null });
                void hostRef.current?.read(SNAPSHOT_RANGES).then((bytes) => {
                  const game = decodeSnapshot(bytes);
                  setAskState((a) => (a?.id === id ? { ...a, game } : a));
                });
              },
              onJournal: (event: Parameters<PlayJournal["record"]>[0]) => playJournalRef.current?.record(event),
            }
          : {}),
        ...(BATTLE_MENUS ? { onBattleAsk: (id: number, question: BattleAsk) => setBattleAsk({ id, ask: question }) } : {}),
      });
      const watching = host;
      battles = new BattleTracker(rom, { ...OVERWORLD_WATCHES, ...TEXT_WATCHES, ...BATTLE_WATCHES }, (w) => watching.watch(w));
      host.setButtons(joypad.mask);
      hostRef.current = host;
      host.setScriptText(true);
      const started = await host.started;
      if (disposed) return;
      // The journal belongs to the trainer in the game: open it as soon as there is one.
      const h0 = host;
      const openJournal = () =>
        void h0.read([[SYMBOLS.wPlayerID.address, 2]]).then(async ([id]) => {
          const trainer = (id![0]! << 8) | id![1]!;
          if (journalFor === trainer || disposed) return;
          journalFor = trainer;
          journal = await DexJournal.open(romKey, trainer);
          lastMap = -1;
          if (menuRef.current) {
            await playJournalRef.current?.flush();
            const play = await PlayJournal.open(romKey, trainer);
            if (disposed) return;
            playJournalRef.current = play;
            setPlayJournal(play);
          }
        });
      // The play journal's money, for earned and spent.
      const readMoney = () =>
        playJournalRef.current &&
        sceneRef.current.inWorld &&
        void h0.read([[SYMBOLS.wPlayerMoney.address, 3]]).then(([bytes]) => playJournalRef.current?.money(fromBcd(bytes!)));
      const journalTimer = setInterval(() => {
        if (sceneRef.current.inWorld) openJournal();
        readMoney();
      }, 5000);
      stopJournal = () => {
        clearInterval(journalTimer);
        void journal?.flush();
        void playJournalRef.current?.flush();
        playJournalRef.current = null;
      };
      // A point the emulator turned down is stale (the save changed since) or damaged.
      if (resume && !started.resumed) void slot.enqueue(() => deleteResumePoint(romKey)).catch(() => {});
      if (custom && resume && !started.resumed) setOnboarding({ phase: "choose" });
      if (started.resumed) {
        // Before the first frame: the worker says it's ready before it runs one.
        trackInWorld = inWorldTracker(true);
        setResumed(true);
        setTimeout(() => !disposed && setResumed(false), 30_000);
      }

      // Resume points: every couple of seconds of play, after a save, and when the page is hidden
      // or closed. Only in the world: resuming to the title screen or intro would gain nothing.
      const h = host;
      // Signed-in players' points go to the cloud too, until the server says they're signed out.
      const keeper = new ResumeKeeper({
        key: romKey,
        take: () => h.resumePoint(),
        save: () => slot.latest,
        enqueue: slot.enqueue,
        upload: (state, save, keepalive) => uploadResumePoint(romKey, state, save, keepalive),
      });
      /** Emulated frames at the last point: a paused game has nothing new to keep. */
      let pointFrames = -1;
      const takeResumePoint = (leaving = false) => {
        if (!sceneRef.current.inWorld) return;
        if (!leaving && emuFrames === pointFrames) return;
        pointFrames = emuFrames;
        void keeper.take().then(() => (leaving ? keeper.upload(true) : undefined), () => {});
      };
      const resumeTimer = setInterval(() => takeResumePoint(), RESUME_POINT_MS);
      const uploadTimer = setInterval(() => void keeper.upload(), RESUME_UPLOAD_MS);
      finish = async () => {
        // Not when the game was stopped on purpose first (back to the save, an import): its
        // emulator is gone, and a point now would undo that.
        if (!sceneRef.current.inWorld || hostRef.current !== h) return;
        await keeper.take(); // hands over any newer save first
        await keeper.upload(true);
      };
      // A save makes every earlier point stale (it no longer holds the stored save), so take a
      // new one straight after; the delay lets the save routine finish its last writes.
      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      pointAfterSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => takeResumePoint(true), 2000);
      };
      const onHidden = () => document.visibilityState === "hidden" && takeResumePoint(true);
      const onPageHide = () => takeResumePoint(true);
      document.addEventListener("visibilitychange", onHidden);
      addEventListener("pagehide", onPageHide);
      stopResumePoints = () => {
        clearInterval(resumeTimer);
        clearInterval(uploadTimer);
        clearTimeout(saveTimer);
        document.removeEventListener("visibilitychange", onHidden);
        removeEventListener("pagehide", onPageHide);
      };

      // The save's heartbeat. If another device has it now, this game stops where it is: its
      // progress is kept (a resume point, the save to the cloud), then the save is let go.
      if (holding) {
        l.keep((s) => {
          if (disposed) return;
          h.setPaused(true);
          setLockUi({ kind: "lost", other: s.state === "lost" ? s.to : s.by, mine: l.name });
          void (async () => {
            await finish().catch(() => {});
            stopResumePoints();
            await cloudBackup(romKey).flush(true).catch(() => {});
            holding = false;
            if (s.state === "lost") await l.release();
          })();
        });
        addEventListener("pagehide", onClosing);
      }

      // Friends, for players signed in by email (D23); everyone else plays alone.
      void me().then(
        (account) => {
          if (disposed) return;
          if (!account) return setRoom({ status: "signed-out", friends: [] });
          setAccount(account);
          setAdmin(account.admin);
          // The Pokédex menu lists every friend, not only the ones online now.
          if (menuRef.current) void listPlayers().then((all) => !disposed && setPlayers(all));
          const client = new RoomClient();
          roomClient = client;
          // Before connecting, so the first welcome resends anything still in the outbox.
          if (host) {
            courier = new GiftCourier({ room: client, host, storage: giftStorage(slot) });
            setGifts(courier);
          }
          const show = ({ status, friends }: { status: RoomStatus; friends: Record<string, Friend> }) =>
            setRoom({ status, friends: Object.values(friends) });
          unsubscribeRoom = client.store.subscribe((next, prev) => {
            if (next.friends !== prev.friends) live!.setGhosts(toGhosts(next.friends));
            if (next.status !== prev.status || next.friends !== prev.friends) show(next);
            // The cable needs our player ID, which the first welcome brings.
            if (next.you && !roomLink && host) {
              const h = host;
              roomLink = new RoomLink({ room: client, me: next.you.id, open: (o) => h.openLink(o) });
              setLink(roomLink);
            }
          });
          client.connect();
          show(client.store.getState());
        },
        () => {}, // Offline or no server: play alone.
      );

      // Every display frame feeds the perf telemetry (../perf.ts); ?stats also shows it on screen.
      let onStatsFrame: ((now: number) => void) | null = null;
      if (showStats) {
        // For scripted play-throughs (e2e/play.e2e.ts): the newest decoded state, every frame.
        const slow: SlowFrame[] = [];
        window.__pokehd = {
          get state() {
            return latest;
          },
          get inWorld() {
            return sceneRef.current.inWorld;
          },
          get frames() {
            return emuFrames;
          },
          /** For a stuck test's report: game memory, and what the page holds back. */
          read: (address: number, length: number) => h.read([[address, length]]).then(([bytes]) => Array.from(bytes!)),
          snapshot: async () => decodeSnapshot(await h.read(SNAPSHOT_RANGES)),
          get page() {
            return { held: heldRef.current, onboarding: onboardingRef.current?.phase ?? null, starter: !!starterRef.current, script: scriptRef.current?.id ?? null };
          },
          get input() {
            const sheet = heldRef.current || menuStateRef.current.open || !!menuStateRef.current.ask || dexHeldRef.current;
            return qaFacts && pageInput({ ...qaFacts, battleAsk: !!battleAskRef.current, sheet });
          },
          messages: (after: number) => ({ boot: qaBoot, lines: qaLog?.since(after) ?? [] }),
          slow,
        };
        // Display frame times, and emulated frames per second, for perf checks.
        const times: number[] = [];
        let lastT = performance.now();
        let shown = lastT;
        let framesAtShown = 0;
        onStatsFrame = (now) => {
          times.push(now - lastT);
          if (now - lastT > 50 && slow.length < 500) {
            const build = live?.builds.at(-1);
            slow.push({
              at: Math.round(now),
              ms: +(now - lastT).toFixed(1),
              updateMs: +(engine?.stats.updateMs ?? 0).toFixed(1),
              renderMs: +(engine?.stats.renderMs ?? 0).toFixed(1),
              build: build && build.at > lastT ? `${build.map} ${build.ms.toFixed(1)} ms` : null,
              map: latest?.mapId ?? null,
              mode: latest?.mode ?? null,
              fade: latest?.fade ?? null,
              layout: screenRef.current?.dataset["layout"] ?? "",
            });
          }
          lastT = now;
          if (times.length > 240) times.shift();
          if (now - shown < 500) return;
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          setStats({
            fps: 1000 / avg,
            worstMs: Math.max(...times),
            emuFps: ((emuFrames - framesAtShown) * 1000) / (now - shown),
            cpuMs: engine?.stats.cpuMs ?? 0,
            scale: engine?.stats.scale ?? 1,
            dof: engine?.stats.dof ?? true,
            drawn: engine?.stats.drawn ?? 0,
            shadowsCached: engine?.stats.shadowsCached ?? true,
            backend: engine?.backend ?? "no renderer",
            state: latest,
            inWorld: sceneRef.current.inWorld,
          });
          shown = now;
          framesAtShown = emuFrames;
        };
      }
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const now = performance.now();
        const scene = sceneRef.current;
        perf.frame(now, engine, emuFrames, scene.inWorld ? scene.mode : null, scene.inWorld ? (latest?.mapId ?? null) : null, menuUpRef.current);
        onStatsFrame?.(now);
      };
      tick();

      if (noRender) {
        setStartup((s) => ({ ...s, world: true }));
        return setMessage("");
      }
      let created: Engine;
      try {
        created = await createEngine(canvas, { world: live });
      } catch (e) {
        // Still playable on the Game Boy screen alone.
        console.error("[pokeHD] renderer failed", e);
        reportError("error", e);
        setNoHd(true);
        setStartup((s) => ({ ...s, world: true }));
        return setMessage("The HD view couldn't start in this browser, so this is the Game Boy screen alone.");
      }
      if (disposed) return created.dispose();
      noteRenderer(created.backend === "WebGPU" ? "webgpu" : "webgl");
      engine = created;
      // The loading screen lifts once the world has drawn a finished frame.
      void created.ready.then(() => !disposed && setStartup((s) => ({ ...s, world: true })));
      live.setLook(engine.look);
      hd = true;
      setMessage(
        started.resumed
          ? "Back where you left off (your resume point)."
          : restored
            ? "Your save came back from the cloud."
            : slot.sram
              ? "No resume point to go back to, so this starts from your last save: pick CONTINUE."
              : "No save in this browser yet.",
      );
      setTimeout(() => !disposed && setMessage(""), 4000);
    })().catch((e: unknown) => {
      setStartup({ emu: true, world: true });
      setMessage(`Couldn't start: ${String(e)}`);
    });

    return () => {
      disposed = true;
      lock?.stop();
      removeEventListener("pagehide", onClosing);
      stopResumePoints();
      stopJournal();
      cancelAnimationFrame(raf);
      perf.dispose();
      joypad.dispose();
      unsubscribeRoom();
      roomLink?.dispose();
      courier?.dispose();
      roomClient?.close();
      // The game stops where it is; it goes once its save and a resume point are kept, or after
      // a while if the emulator doesn't answer.
      const h = host;
      h?.setPaused(true);
      const l = lock;
      const held = holding;
      const last = Promise.race([finish().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
      gameLeaving(romKey, last);
      void last.then(async () => {
        h?.dispose();
        if (held) {
          await cloudBackup(romKey).flush(true).catch(() => {});
          await l?.release();
        }
      });
      hostRef.current = null;
      engine?.dispose();
      live?.dispose();
      canvas.remove();
      delete window.__pokehd;
      sceneRef.current = { mode: "overworld", inWorld: false, hdText: false };
      setHdText(null);
      setDialogLines(null);
      setBattleHud(null);
      setBattleAsk(null);
      setLayout("full");
      setNoHd(false);
      setStartup({ emu: false, world: false });
      emuRanRef.current = false;
      setRoom(null);
      setLink(null);
      setGifts(null);
      setGiftOpen(false);
      setSound(false);
      setResumed(false);
      setErasing(null);
      setNameAsk(null);
      starterRef.current = null;
      setOnboarding(null);
      setDex(null);
    };
  }, [rom, romKey, boot, glyphs]);

  // The loading screen: up until the world is drawn, or the Game Boy screen is all there is to see.
  // Behind a menu the Game Boy screen is hidden, so only the world will do.
  const loaded = startup.emu && (startup.world || (layout === "full" && held === undefined));
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => {
      console.warn("[pokeHD] the world took too long to load; showing the page anyway");
      setGaveUpFor(boot);
    }, LOADING_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [boot, loaded]);
  const ready = loaded || gaveUpFor === boot;
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setLoaderGoneFor(boot), LOADING_FADE_MS);
    return () => clearTimeout(timer);
  }, [ready, boot]);
  const loaderGone = ready && loaderGoneFor === boot;
  // The menu in front shows its own loading screen, and fades it out once this says it's ready.
  // Waiting on another device counts: the page's menu can show meanwhile.
  const waitingOnDevice = lockUi?.kind === "in-use" || lockUi?.kind === "waiting";
  useEffect(() => {
    if (ready || waitingOnDevice) onReady?.();
  }, [ready, waitingOnDevice, onReady]);

  const onTouch = useMemo(() => (mask: number) => input?.setTouchMask(mask), [input]);
  // Without an emulator (it's restarting) the panel just stays on "Reading your game…".
  const readGiftables = useMemo(() => () => hostRef.current?.read(GIFTABLE_RANGES) ?? new Promise<Uint8Array[]>(() => {}), []);

  // The old emulator could still write its save after the import, so stop it first, then
  // store the imported save again before restarting on it.
  const onImported = (sram: Uint8Array) => {
    hostRef.current?.dispose();
    hostRef.current = null;
    void storeSave(romKey, sram).then(() => setBoot((n) => n + 1));
  };

  // An earlier save, back from the history: it's the save everywhere now.
  const rollBack = (sram: Uint8Array) => {
    cloudBackup(romKey).onSram(sram);
    onImported(sram);
  };

  // Back to the title screen on the save file, dropping the resume point.
  const startFromSave = () => {
    hostRef.current?.dispose();
    hostRef.current = null;
    void deleteResumePoint(romKey).then(() => setBoot((n) => n + 1));
  };

  const answerErase = (erase: boolean) => {
    hostRef.current?.answerErase(erase);
    // The game takes a moment to read the answer; the question goes when it has.
    if (!erase) setErasing(null);
  };

  const forgetRom = () => {
    if (confirm("Forget the game on this device? Your saves stay, but you'll need to load the game file again to play.")) onForget();
  };

  const toggleAutosave = (on: boolean) => {
    setAutosave(on);
    saveAutosave(on);
    hostRef.current?.setAutosave(on);
  };

  /**
   * Reads on in a whole message from the script: its next box, or done with it. A message already
   * read stays up while the game finishes it (scriptView), and taps on it go nowhere meanwhile:
   * one reaching the game as it closes the box would start the talk over. Nor do taps on a box
   * too new to have been read (scriptTap).
   */
  function readOnScript(): boolean {
    const script = scriptRef.current;
    const host = hostRef.current;
    if (!script || !host || !scriptShownRef.current) return false;
    const tap = scriptTap(script);
    if (tap === "next" && script.index === script.boxes.length - 1) host.readOnMessage(script.id);
    if (tap === "close") host.closeMessage(script.id);
    return tap !== "none";
  }

  /** The TextOverlay's buttons: a tapped choice, or a button pressed the game's own way. */
  const textActions = useMemo<TextActions>(
    () => ({
      select: (item) => hostRef.current?.select(item, true),
      press: (button) => {
        if ((button === "A" || button === "B") && readOnScript()) return;
        hostRef.current?.tap(PRESS[button]);
      },
    }),
    [],
  );

  const start = (choice: StartChoice) => {
    const host = hostRef.current;
    if (!host || onboardingRef.current?.phase !== "choose") return;
    starterRef.current = new Starter(choice, { tap: (m) => host.tap(m), select: (i, p) => host.select(i, p) });
    setOnboarding({ phase: "starting", choice });
  };

  // A menu in front pauses the game and lets it go. Let go on the start screen, the game
  // passes it by itself: the menu was the choice.
  useEffect(() => {
    if (held === undefined) return;
    heldRef.current = held;
    if (emuRanRef.current) hostRef.current?.setPaused(held);
    // A new game only for a slot known to have no save: one that may be in the cloud, unreached,
    // gets the game's own title screen instead, so a new game is the player's choice there.
    if (!held && onboarding?.phase === "choose") start(startSave ? "continue" : "new");
  }, [held, onboarding, startSave]);

  /** The page's answer to the game's name question; null hands the game's own screen back. */
  const answerName = (name: string | null) => {
    const ask = nameAsk;
    setNameAsk(null);
    hostRef.current?.answerName(name === null ? null : encodeName(name));
    // The game's keyboard is on its screen: the HD introduction steps aside for it.
    if (name === null && onboardingRef.current?.phase === "intro") setOnboarding(null);
    // Oak's name and the player's name are one: a new one here renames the player.
    if (ask?.kind === "player" && name && account && name !== account.player.name) {
      void setMyName(name).then((result) => {
        if ("error" in result) {
          if (result.error === "name-taken") setMessage(`Another player is already called ${name}, so friends still see you as ${account.player.name}.`);
          return;
        }
        setAccount(result);
      });
    }
  };

  const chooseDexLook = (look: DexSetting) => {
    dexLookRef.current = look;
    saveDexLook(look);
    setDexLook(look);
  };

  const s = stats?.state;
  /** The grown-ups' save and device controls, in Settings and in the Pokédex menu's Me tab. */
  const grownUpControls = (
    <>
      <div className="row">
        <SaveControls romKey={romKey} header={header} onImported={onImported} />
      </div>
      <div className="row">
        <EarlierSaves romKey={romKey} onRestore={rollBack} />
      </div>
      <div className="row">
        <label>
          <input type="checkbox" checked={autosave} onChange={(e) => toggleAutosave(e.target.checked)} />
          {" "}Autosave every 5 minutes and after battles
        </label>
      </div>
      <div className="row">
        <button type="button" onClick={forgetRom}>Forget ROM</button>
      </div>
      {admin && <Friends />}
    </>
  );
  /** The game as the Pokédex menu reads it, acts on it and answers it. */
  const liveGame = useMemo(
    () => ({
      read: async () => decodeSnapshot(await hostRef.current!.read(SNAPSHOT_RANGES)),
      act: (action: Parameters<EmulatorHost["act"]>[0], signal?: AbortSignal) => hostRef.current!.act(action, signal),
      answer: (id: number, answer: AskAnswer) => {
        const asked = lastAskRef.current;
        if (asked?.id === id) battleItemRef.current.answered(asked.ask, answer);
        hostRef.current?.answerAsk(id, answer);
      },
    }),
    [],
  );
  const menuFriends = useMemo(() => {
    const online = new Map((room?.friends ?? []).map((f) => [f.id, f]));
    const all = players.map((p) => ({ ...(online.get(p.id) ?? { ...p, presence: null }), online: online.has(p.id) }));
    for (const f of online.values()) if (!players.some((p) => p.id === f.id)) all.push({ ...f, online: true });
    return all;
  }, [room, players]);
  /** A gift from the Pokédex menu: the team member or item it names, sent as the Gift panel sends. */
  const sendGift = async (to: string, what: { item: number } | { mon: number }): Promise<string> => {
    const friend = room?.friends.find((f) => f.id === to);
    if (!gifts || !friend) return "They need to be playing right now to get a gift.";
    const g = decodeGiftables(rom, await readGiftables());
    const mon = "mon" in what ? g.party[what.mon] : undefined;
    const item = "item" in what ? g.bag.find((b) => b.item === what.item && !b.key) : undefined;
    const spec = mon ? { kind: "mon" as const, slot: mon.slot, species: mon.species } : item ? { kind: "item" as const, slot: item.slot, item: item.item, quantity: 1 } : null;
    if (!spec) return GIFT_REASONS["item moved"]!;
    const r = await gifts.send(friend, spec);
    return r.ok ? `Sent ${describeGift(rom, r.gift)} to ${friend.name}. Your game saved.` : (GIFT_REASONS[r.reason] ?? `Couldn't send it (${r.reason}).`);
  };
  const bindLive = useMemo(() => (actions: LiveActions) => void (liveActionsRef.current = actions), []);
  const [readAloud, setReadAloud] = useState(false);
  const appOptions = useMemo<AppOptions>(() => ({ sound, readAloud, gameBoyScreen: pip }), [sound, readAloud, pip]);
  const setApp = <K extends keyof AppOptions>(key: K, value: AppOptions[K]) => {
    if (key === "sound" && value) void enableSound();
    if (key === "readAloud") setReadAloud(!!value);
    if (key === "gameBoyScreen" && value !== pipRef.current && !QA_RUN) togglePip();
  };
  const closeMenu = () => {
    setMenuOpen(null);
    if (dexHeldRef.current) {
      dexHeldRef.current = false;
      hostRef.current?.closeDex();
    }
  };

  return (
    <div className={`game${touch ? " with-touch-pad" : ""}${held ? " held" : ""}`} ref={holder}>
      <canvas
        ref={screenRef}
        className={`gb-screen ${noHd ? "full" : layout}`}
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
        aria-label="Game Boy screen"
        data-testid="gb-screen"
        data-layout={noHd ? "full" : layout}
      />
      {onboarding?.phase === "intro" && !noHd && <IntroStage ref={introCanvas} />}
      {hdText && !noHd && !nameAsk && <TextOverlay text={hdText} dialogLines={dialogLines} actions={textActions} look={look} />}
      {/* Everything that isn't the game sits behind one button (the menu), in the HD panels' look.
          With the Pokédex menu, the dex is that button and all of this lives in it. */}
      {ready && !menu && <button
        type="button"
        className="game-menu-button"
        onClick={() => setSettings((v) => !v)}
        aria-expanded={settings}
        aria-label="Menu"
        data-look={look}
        data-alert={cloudNewer || resumed || undefined}
      >
        <i className="hd-ball" aria-hidden />
      </button>}
      {message && <div className="game-toast" role="status">{message}</div>}
      {settings && <div className="game-menu-scrim" onClick={() => setSettings(false)} />}
      {settings && (
        <div className="game-menu" data-look={look} role="dialog" aria-label="Menu">
          <i className="hd-corner tl" />
          <i className="hd-corner tr" />
          <i className="hd-corner bl" />
          <i className="hd-corner br" />
          <button type="button" className="game-menu-close" aria-label="Close" onClick={() => setSettings(false)}>×</button>
          <div className="game-settings">
          <section>
            <h2>{header.title}</h2>
            {autosave ? <p>Saves itself every 5 minutes and after battles.</p> : <p>Autosave is off.</p>}
          </section>
          {(resumed || cloudNewer) && (
            <div className="game-menu-notes">
              {resumed && <button type="button" onClick={startFromSave}>Go back to my last save instead</button>}
              {cloudNewer && <p>There's a newer save in the cloud. Grown-ups can load it below.</p>}
            </div>
          )}
          <div className="game-menu-tiles">
            <button type="button" onClick={enableSound} disabled={sound}>{sound ? "Sound on" : "Turn sound on"}</button>
            {!QA_RUN && <button type="button" onClick={togglePip} aria-pressed={pip} title="Game Boy screen in the corner (P)">Game Boy screen</button>}
            {room && <RoomBadge status={room.status} friends={room.friends.length} />}
            {gifts && room?.status === "open" && (
              <button type="button" onClick={() => { setGiftOpen((v) => !v); setSettings(false); }} aria-expanded={giftOpen}>Gift</button>
            )}
          </div>
          <div className="row">
            <label>
              Pokédex{" "}
              <select value={dexLook} onChange={(e) => chooseDexLook(e.target.value as DexSetting)}>
                <option value="device">3D device</option>
                <option value="pixel">Pixel device</option>
                <option value="storybook">Storybook panel</option>
                <option value="off">The game's own</option>
              </select>
            </label>
          </div>
          {admin && <AdminTools />}
          {input && <KeyBindingsPanel input={input} />}
          <GrownUps>{grownUpControls}</GrownUps>
          </div>
        </div>
      )}
      {showStats && stats && (
        <pre
          className="game-stats"
          data-testid="stats"
          style={QA_RUN ? { display: "none" } : undefined}
          data-fps={stats.fps.toFixed(1)}
          data-map={s?.mapId}
          data-x={s?.player.x}
          data-y={s?.player.y}
          data-mode={s?.mode}
          data-in-world={stats.inWorld}
        >
          {`${stats.backend} · ${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(1)} ms · cpu ${stats.cpuMs.toFixed(1)} ms · res ${Math.round(stats.scale * 100)}%${stats.dof ? "" : " no DoF"} · drawn ${stats.drawn}/s${stats.shadowsCached ? "" : " · uncached shadows"} · emu ${stats.emuFps.toFixed(1)} fps\n`}
          {s ? `map ${s.mapId} (${s.player.x}, ${s.player.y}) ${s.player.facing} · ${s.mode} · fade ${s.fade.toFixed(2)}` : "no state"}
        </pre>
      )}
      {link && room && <LinkPicker link={link} players={room.friends} />}
      {gifts && room && giftOpen && (
        <GiftPanel
          rom={rom}
          courier={gifts}
          friends={room.friends}
          read={readGiftables}
          onClose={() => setGiftOpen(false)}
        />
      )}
      {gifts && <GiftNotices rom={rom} courier={gifts} />}
      {battleHud && !noHd && layout === "battle" && <BattleHud state={battleHud.state} huds={battleHud.huds} menuUp={!!battleAsk} />}
      {battleAsk && BATTLE_MENUS && (
        <BattleMenu
          key={battleAsk.id}
          ask={battleAsk.ask}
          rom={rom}
          who={battleHud?.state.player.mon?.name ?? null}
          bindKeys={(handler) => (battleKeysRef.current = handler)}
          onAnswer={(answer: BattleAnswer) => {
            hostRef.current?.answerBattle(battleAsk.id, answer);
            battleCoverRef.current.answered();
            setBattleAsk(null);
          }}
        />
      )}
      {/* The pad hides while Settings is open so it can't cover the panel's forms (and unmounting releases any held button). */}
      {/* The pad is for the world: anything with buttons of its own (HD menus, messages, the start and names) hides it. */}
      {input && touch && !settings && !(hdText && !noHd) && !nameAsk && !onboarding && !dex && !menuOpen && !ask && !battleAsk && <TouchPad onChange={onTouch} menuButtons={!menu} />}
      {lockUi && !held && (
        <LockScreen
          {...lockUi}
          onTake={() => {
            if (lockUi.kind === "lost") {
              takeNextRef.current = true;
              setLockUi(null);
              setBoot((n) => n + 1);
            } else takeRef.current();
          }}
        />
      )}
      {ready && held === undefined && (onboarding?.phase === "choose" || onboarding?.phase === "starting") && (
        <StartScreen
          save={startSave}
          accountName={account?.player.name ?? null}
          look={look}
          starting={onboarding.phase === "starting" ? onboarding.choice : null}
          onStart={start}
        />
      )}
      {nameAsk && <NamePrompt ask={nameAsk} rom={rom} accountName={account?.player.name ?? null} look={look} onAnswer={answerName} />}
      {dex && world && catalogue && dexLook !== "off" && (
        <Pokedex
          rom={rom}
          world={world}
          catalogue={catalogue}
          progress={dex.progress}
          style={dexLook}
          openOn={dex.openOn}
          closeSignal={dexB}
          onClosed={() => {
            setDex(null);
            hostRef.current?.closeDex();
          }}
        />
      )}
      {menu && world && catalogue && (
        <MenuBoundary>
          <LiveMenu
            rom={rom}
            world={world}
            catalogue={catalogue}
            game={liveGame}
            bind={bindLive}
            ask={ask}
            onAskDone={() => setAsk(null)}
            open={!!menuOpen}
            // The modelled dex is the button: shut in the corner, it opens with the menu on its screen.
            onOpen={() => setMenuOpen({ tab: "dex" })}
            away={!ready || !!ask || !!onboarding || !!nameAsk}
            {...(menuOpen ? { start: menuOpen } : {})}
            onClose={closeMenu}
            journal={playJournal}
            friends={menuFriends}
            savedAt={savedAt}
            app={appOptions}
            setApp={setApp}
            sendGift={gifts && room?.status === "open" ? sendGift : undefined}
            grownUps={
              <div className="game-settings">
                {(resumed || cloudNewer) && (
                  <div className="game-menu-notes">
                    {resumed && <button type="button" onClick={startFromSave}>Go back to my last save instead</button>}
                    {cloudNewer && <p>There's a newer save in the cloud. Load it below.</p>}
                  </div>
                )}
                {admin && <AdminTools />}
                {input && <KeyBindingsPanel input={input} />}
                {grownUpControls}
              </div>
            }
          />
        </MenuBoundary>
      )}
      {savedAt > 0 && <SavedToast shownAt={savedAt} />}
      {erasing && <EraseConfirm old={erasing.old} onAnswer={answerErase} />}
      {!loaderGone && !held && <LoadingScreen leaving={ready} />}
    </div>
  );
}

function RoomBadge({ status, friends }: { status: RoomStatus; friends: number }) {
  if (status === "signed-out") return <a className="room-badge" href="/login">Play with friends</a>;
  const text: Record<RoomStatus, string> = {
    connecting: "Connecting…",
    open: friends === 1 ? "1 friend online" : `${friends} friends online`,
    reconnecting: "Reconnecting…",
    "signed-out": "",
    replaced: "Playing in another tab",
    closed: "Offline",
  };
  return <span className="room-badge" data-status={status}>{text[status]}</span>;
}

