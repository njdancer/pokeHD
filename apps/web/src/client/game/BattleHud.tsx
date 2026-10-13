// The two sides' names, levels and HP as HD cards (p2-battles), in place of the Game Boy's own
// HUDs, which the battle overlay masks out. Each card shows only while the game draws its HUD.
import type { BattleMon, BattleState } from "@pokehd/emu";
import type { Side } from "@pokehd/engine/battle";
import { barColour } from "./battle.ts";

const STATUS: Record<BattleMon["status"], string | null> = {
  ok: null,
  sleep: "SLP",
  poison: "PSN",
  burn: "BRN",
  freeze: "FRZ",
  paralysis: "PAR",
};

function Card({ side, mon }: { side: Side; mon: BattleMon }) {
  const fraction = mon.maxHp > 0 ? Math.min(mon.hp / mon.maxHp, 1) : 0;
  const status = mon.hp === 0 ? "FNT" : STATUS[mon.status];
  return (
    <div className={`battle-card ${side}`} data-testid={`battle-hud-${side}`}>
      <div className="battle-card-top">
        <span className="battle-name">{mon.name}</span>
        {status && <span className="battle-status">{status}</span>}
        <span className="battle-level">Lv{mon.level}</span>
      </div>
      <div className="battle-bar" data-colour={barColour(mon.hp, mon.maxHp)}>
        <span style={{ width: `${fraction * 100}%` }} />
      </div>
      {side === "player" && <div className="battle-hp">{mon.hp}/{mon.maxHp}</div>}
    </div>
  );
}

/** `menuUp`: the HD battle menu is up at the bottom, and the player's card sits above it. */
export function BattleHud({ state, huds, menuUp = false }: { state: BattleState; huds: Record<Side, boolean>; menuUp?: boolean }) {
  return (
    <div className={menuUp ? "battle-hud menu-up" : "battle-hud"}>
      {huds.enemy && state.enemy.mon && <Card side="enemy" mon={state.enemy.mon} />}
      {huds.player && state.player.mon && <Card side="player" mon={state.player.mon} />}
    </div>
  );
}
