// Dev-only: HD battles (p2-battles) replayed from a recorded emulator state, frame-exact, for
// look comparisons and screenshots, with the same battle overlay and HD cards as the game page. Open /dev/battle. Record the states first with
// `node tools/record-battles.ts` (they stay in the gitignored rom/fixtures/).
// URL options: ?fixture=wild|rival picks the battle; ?arena=field|bases|stage the look;
// ?frame=N plays N Game Boy frames (mashing A) at once and holds there; ?phase=0.5 holds the
// time of day; ?size=1440 pins the drawing buffer to 2560×1440. Without ?frame it plays on in
// real time. Once it holds, window.__battle.ready is true; ?shot=name also posts a render to
// /__dev/shot (shots/name.png). ?battlemenus answers the battle's menus with the
// HD battle menu (BattleMenus); with ?frame it holds at the first question instead.
import { useEffect, useRef, useState } from "react";
import {
  BATTLE_WATCHES, BattleMenus, Button, GameBoy, OVERWORLD_WATCHES, OverworldDecoder, SCREEN_HEIGHT, SCREEN_WIDTH, ScreenTextDecoder, TEXT_WATCHES,
  type BattleAnswer, type BattleAsk, type BattleScreen, type BattleState, type OverworldWatched, type TextWatched, type Watch,
} from "@pokehd/emu";
import { createEngine, type Engine } from "@pokehd/engine";
import { ARENA_STYLES, type ArenaStyle } from "@pokehd/engine/battle";
import { createLiveWorld, type LiveWorld } from "@pokehd/engine/world";
import { parseWorld, readGlyphs } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { BattleTracker, battleMenuShown, battleText, maskBattleScreen } from "../game/battle.ts";
import { BattleHud } from "../game/BattleHud.tsx";
import { BattleMenu } from "../game/BattleMenu.tsx";
import { screenLayout, type ScreenLayout } from "../game/screen.ts";
import "../game/game.css";

const query = new URLSearchParams(location.search);
const fixture = query.get("fixture") ?? "wild";
const arena = (ARENA_STYLES as readonly string[]).includes(query.get("arena") ?? "") ? (query.get("arena") as ArenaStyle) : "field";
const holdAt = query.has("frame") ? Number(query.get("frame")) : null;
const phase = query.has("phase") ? Number(query.get("phase")) : null;
const shot = query.get("shot");
const withMenus = query.has("battlemenus");
/** The whole screen, as a box for the mask to clear. */
const WHOLE_SCREEN = [{ x: 0, y: 0, width: 20, height: 18, lines: [] }];

declare global {
  interface Window {
    __battle?: { ready: boolean; frame: number };
  }
}

function readAll(gb: GameBoy, watches: Record<string, Watch>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [name, [address, length]] of Object.entries(watches)) out[name] = gb.readBytes(address, length);
  return out;
}

export function BattleDev() {
  const holder = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Loading…");
  const [layout, setLayout] = useState<ScreenLayout>("hidden");
  const [hud, setHud] = useState<{ state: BattleState; huds: BattleScreen["huds"] } | null>(null);
  const [ask, setAsk] = useState<{ id: number; ask: BattleAsk; rom: Uint8Array; answer(a: BattleAnswer): void } | null>(null);

  useEffect(() => {
    let disposed = false;
    let engine: Engine | null = null;
    let live: LiveWorld | null = null;
    let raf = 0;
    const canvas = document.createElement("canvas");
    canvas.className = "scene";
    holder.current!.prepend(canvas);
    window.__battle = { ready: false, frame: 0 };
    (async () => {
      const rom = await fetchDevRom();
      if (!rom) return setStatus("No ROM: this page needs the dev server's rom/pokeblue.gb.");
      const state = await fetch(`/__dev/fixture/battle-${fixture}.state`);
      if (!state.ok) return setStatus(`No rom/fixtures/battle-${fixture}.state: run node tools/record-battles.ts.`);
      const gb = await GameBoy.create({ rom });
      gb.loadState(new Uint8Array(await state.arrayBuffer()));
      const world = parseWorld(rom);
      live = createLiveWorld(world, { arena });
      engine = await createEngine(canvas, { world: live });
      if (disposed) return engine.dispose();
      live.setLook(engine.look);
      if (phase !== null) Object.assign(engine.look.params.time, { drift: false, phase });
      if (query.get("size") === "1440") engine.setFixedSize({ width: 2560, height: 1440 });

      const ctx = screenRef.current!.getContext("2d")!;
      const image = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
      const overworld = new OverworldDecoder();
      let watches: Record<string, Watch> = {};
      const tracker = new BattleTracker(rom, { ...OVERWORLD_WATCHES, ...BATTLE_WATCHES, ...TEXT_WATCHES }, (next) => (watches = next));
      const text = new ScreenTextDecoder(readGlyphs(rom));
      let resume = () => {};
      const menus: BattleMenus | null = withMenus
        ? new BattleMenus(gb, {
            rom,
            onAsk: (id, a) =>
              setAsk({ id, ask: a, rom, answer: (answer) => {
                menus!.answer(id, answer);
                setAsk(null);
                resume();
              } }),
          })
        : null;
      // The recording starts as the battle does; show the tracker the overworld before it.
      tracker.frame(Object.fromEntries(Object.entries(BATTLE_WATCHES).map(([k, [, n]]) => [k, new Uint8Array(n)])));
      let frame = 0;
      let masked: BattleScreen | null = null;
      let choosing = false;
      const step = () => {
        gb.setButtons(!menus?.asking && frame % 16 < 2 ? Button.A : 0);
        gb.runFrame();
        frame++;
        const watched = readAll(gb, watches);
        const world = overworld.decode(watched as OverworldWatched);
        live!.push(world);
        const fight = tracker.frame(watched);
        live!.setBattle(fight.scene ? fight.view : null);
        masked = fight.scene === "scene" ? fight.screen : null;
        choosing = !!menus && !!masked && (!!menus.asking || battleMenuShown(text.decode(battleText(watched as TextWatched, masked))));
        // The game's own mode, so the way out of the battle (and the map after) lays out as on the game page.
        setLayout(screenLayout(world.mode, true, false, false, fight.scene));
        setHud(masked && fight.state ? { state: fight.state, huds: masked.huds } : null);
        setStatus(fight.state ? `frame ${frame} · ${fight.state.phase}${fight.state.animation ? ` · animation ${fight.state.animation.id}` : ""}` : `frame ${frame}`);
      };
      const draw = () => {
        image.data.set(gb.frame);
        if (masked) maskBattleScreen(image.data, masked, choosing ? WHOLE_SCREEN : []);
        ctx.putImageData(image, 0, 0);
      };

      if (holdAt !== null) {
        while (frame < holdAt && !menus?.asking) step();
        draw();
        // Let the camera finish its swing and the map chunks build before calling it ready.
        setTimeout(async () => {
          if (disposed) return;
          if (shot) await fetch(`/__dev/shot?name=${shot}`, { method: "POST", body: await engine!.capture() });
          window.__battle = { ready: true, frame };
        }, 3000);
        if (!menus) return;
      }
      let start = performance.now();
      let ticking = false;
      const tick = () => {
        ticking = true;
        raf = requestAnimationFrame(tick);
        const due = Math.floor(((performance.now() - start) / 1000) * 59.7275);
        for (let n = 0; frame < due && n < 4; n++) step();
        if (frame < due - 4) start = performance.now() - (frame / 59.7275) * 1000;
        draw();
        window.__battle!.frame = frame;
      };
      resume = () => {
        if (ticking) return;
        start = performance.now() - (frame / 59.7275) * 1000;
        tick();
      };
      if (holdAt === null) tick();
    })().catch((e: unknown) => setStatus(String(e)));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      engine?.dispose();
      live?.dispose();
      canvas.remove();
    };
  }, []);

  return (
    <div className="game" ref={holder}>
      <canvas ref={screenRef} className={`gb-screen ${layout}`} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} />
      {hud && layout === "battle" && <BattleHud state={hud.state} huds={hud.huds} menuUp={!!ask} />}
      {ask && (
        <BattleMenu key={ask.id} ask={ask.ask} rom={ask.rom} who={hud?.state.player.mon?.name ?? null} bindKeys={() => {}} onAnswer={ask.answer} />
      )}
      <div className="game-hud">
        <span role="status">{status}</span>
      </div>
    </div>
  );
}
