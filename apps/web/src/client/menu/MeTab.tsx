// The Me tab: the trainer card and badges from the game, saving (with the game's own save
// routine), the game's options (wOptions, written at an idle point), the page's grown-up settings
// behind a sum, and the adventure in numbers and its firsts from the play journal.
import { useMemo, useState } from "react";
import { monName } from "@pokehd/rom";
import { niceName } from "../dex/catalogue.ts";
import { personPicture } from "../dex/pictures.ts";
import { useMenu } from "./context.ts";
import { money, playTime } from "./items.ts";
import { BadgeIcon, Head, Seg } from "./parts.tsx";

const SPRITE_RED = 0x01;
const BADGES = ["Boulder", "Cascade", "Thunder", "Rainbow", "Soul", "Marsh", "Volcano", "Earth"];
const LEADERS = ["Brock", "Misty", "Lt. Surge", "Erika", "Koga", "Sabrina", "Blaine", "Giovanni"];

const ago = (at: number) => {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} minute${m === 1 ? "" : "s"} ago` : `${Math.round(m / 60)} hours ago`;
};

export function Me() {
  const { game, rom, world, journal, journalVersion, open, savedAt } = useMenu();
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- the journal changes in place; its version says when
  const stats = useMemo(() => journal?.stats(), [journal, journalVersion]);
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- as above
  const firsts = useMemo(() => journal?.firsts(), [journal, journalVersion]);
  if (!game) return <Head title="Me" />;
  const sheet = world.sprites[SPRITE_RED];
  const badges = BADGES.map((_, i) => (game.badges >> i) & 1);
  const count = badges.filter(Boolean).length;
  const next = badges.indexOf(0);
  const b = stats?.battles;
  return (
    <>
      <Head title="Me" pill={niceName(game.player)} />
      <div className="dm-body">
        <div className="dm-card-trainer">
          <span className="face">{sheet && <img src={personPicture(rom, sheet, 0)} alt="" />}</span>
          <div>
            <small>Trainer card</small>
            <h3>{game.player}</h3>
            <dl>
              <dt>ID No.</dt>
              <dd>{String(game.playerId).padStart(5, "0")}</dd>
              <dt>Money</dt>
              <dd>{money(game.money)}</dd>
              <dt>Time</dt>
              <dd>{playTime(game.playTime)}</dd>
            </dl>
          </div>
        </div>
        <div className="dm-c dm-badges" aria-label={`${count} of 8 badges`}>
          {badges.map((has, i) => (
            <span key={i} className={has ? "" : "no"} title={has ? `${BADGES[i]} Badge` : "Not yet"}>
              <BadgeIcon n={i} />
            </span>
          ))}
        </div>
        <button type="button" className="dm-c dm-row" onClick={() => open({ kind: "saves" })}>
          <span className="dm-icon">💾</span>
          <span className="grow">
            <span>Saves</span>
            <span className="sub">{savedAt ? `Saved ${ago(savedAt)}` : "Save your adventure"}</span>
          </span>
          <span className="chev">›</span>
        </button>
        <button type="button" className="dm-c dm-row" onClick={() => open({ kind: "settings" })}>
          <span className="dm-icon">⚙</span>
          <span className="grow">
            <span>Settings</span>
            <span className="sub">Game options, grown-ups</span>
          </span>
          <span className="chev">›</span>
        </button>
        <div className="dm-section">
          <span>Your adventure in numbers</span>
        </div>
        <div className="dm-numbers">
          <div className="dm-c">
            <b>{playTime(game.playTime)}</b>
            <span>Played</span>
          </div>
          {stats && (
            <div className="dm-c">
              <b>{stats.steps.toLocaleString("en")}</b>
              <span>Steps</span>
              <small>about {Math.max(1, Math.round((stats.steps * 0.5) / 1000))} km</small>
            </div>
          )}
          {b && (
            <div className="dm-c">
              <b>{b.won}</b>
              <span>Battles won</span>
              <small>
                {b.lost} lost · ran from {b.ran}
              </small>
            </div>
          )}
          <div className="dm-c">
            <b>{game.owned.size}</b>
            <span>Caught</span>
            <small>{game.seen.size} seen</small>
          </div>
          {stats && (
            <div className="dm-c">
              <b>{money(stats.earned)}</b>
              <span>Earned</span>
              <small>{money(stats.spent)} spent</small>
            </div>
          )}
          <div className="dm-c">
            <b>{count} of 8</b>
            <span>Badges</span>
            {next >= 0 && <small>next: {LEADERS[next]}</small>}
          </div>
          {stats?.star && (
            <div className="dm-c">
              <b>{niceName(monName(rom, stats.star.species))}</b>
              <span>Star of the team</span>
              <small>out for {stats.star.wins} wins</small>
            </div>
          )}
        </div>
        {firsts && Object.keys(firsts).length > 0 && (
          <>
            <div className="dm-section">
              <span>Firsts</span>
            </div>
            <div className="dm-c dm-lines">
              {firsts.pokemon && (
                <div>
                  <span className="k">First Pokémon</span>
                  <span>{niceName(monName(rom, firsts.pokemon.species))}</span>
                </div>
              )}
              {firsts.catch && (
                <div>
                  <span className="k">First catch</span>
                  <span>
                    {niceName(monName(rom, firsts.catch.species))}, level {firsts.catch.level}
                  </span>
                </div>
              )}
              {firsts.trainerBeaten && (
                <div>
                  <span className="k">First trainer beaten</span>
                  <span>{new Date(firsts.trainerBeaten.at).toLocaleDateString()}</span>
                </div>
              )}
              {firsts.badge && (
                <div>
                  <span className="k">First badge</span>
                  <span>{BADGES[firsts.badge.badge]} Badge</span>
                </div>
              )}
              {firsts.evolution && (
                <div>
                  <span className="k">First to grow</span>
                  <span>
                    {niceName(monName(rom, firsts.evolution.from))} → {niceName(monName(rom, firsts.evolution.to))}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function SavesPage() {
  const { act, savedAt, lookOnly } = useMenu();
  const [saving, setSaving] = useState(false);
  return (
    <>
      <Head title="Saves" back />
      <div className="dm-body">
        <div className="dm-c dm-text">
          <p>{savedAt ? `Your adventure was saved ${ago(savedAt)}.` : "Your adventure saves itself as you play."}</p>
        </div>
        <button
          type="button"
          className="dm-verb"
          disabled={saving || lookOnly}
          onClick={() => {
            setSaving(true);
            void act({ kind: "save" }).finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving…" : "Save now"}
        </button>
      </div>
    </>
  );
}

type Speed = "fast" | "medium" | "slow";
const SPEEDS: Record<Speed, number> = { fast: 1, medium: 3, slow: 5 };

export function SettingsPage() {
  const { game, act, grownUps, lookOnly } = useMenu();
  const [unlocked, setUnlocked] = useState(false);
  if (!game) return <Head title="Settings" back />;
  const o = game.options;
  const speed: Speed = (o & 15) <= 1 ? "fast" : (o & 15) <= 3 ? "medium" : "slow";
  const set = (next: number) => void act({ kind: "options", options: next });
  return (
    <>
      <Head title="Settings" back />
      <div className="dm-body">
        <div className="dm-section">
          <span>Words appear</span>
        </div>
        <Seg label="Text speed" value={speed} onChange={(v) => !lookOnly && set((o & ~15) | SPEEDS[v])} options={[["fast", "Fast"], ["medium", "Medium"], ["slow", "Slow"]]} />
        <div className="dm-section">
          <span>Battle moves</span>
        </div>
        <Seg label="Battle animations" value={o & 0x80 ? "off" : "on"} onChange={(v) => !lookOnly && set(v === "off" ? o | 0x80 : o & ~0x80)} options={[["on", "Show them"], ["off", "Skip them"]]} />
        <div className="dm-section">
          <span>After beating a Pokémon</span>
        </div>
        <Seg
          label="Battle style"
          value={o & 0x40 ? "set" : "shift"}
          onChange={(v) => !lookOnly && set(v === "set" ? o | 0x40 : o & ~0x40)}
          options={[["shift", "Ask to switch"], ["set", "Keep going"]]}
        />
        <div className="dm-section">
          <span>Grown-ups</span>
        </div>
        {unlocked ? grownUps : <GrownUpGate onOpen={() => setUnlocked(true)} />}
      </div>
    </>
  );
}

/** A sum a young player can't do yet, in front of the grown-up settings. */
function GrownUpGate({ onOpen }: { onOpen(): void }) {
  const [sum] = useState(() => [12 + Math.floor(Math.random() * 30), 7 + Math.floor(Math.random() * 20)] as const);
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState(false);
  return (
    <form
      className="dm-c"
      style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (Number(answer) === sum[0] + sum[1]) onOpen();
        else setWrong(true);
      }}
    >
      <label>
        What is {sum[0]} + {sum[1]}?
        <input
          inputMode="numeric"
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value);
            setWrong(false);
          }}
          style={{ display: "block", width: "100%", marginTop: 8, padding: 10, font: "inherit", borderRadius: 10, border: "2px solid var(--dm-edge2)" }}
        />
      </label>
      {wrong && <span className="dm-hint">Not quite. Ask a grown-up!</span>}
      <button type="submit" className="dm-verb">
        Open
      </button>
    </form>
  );
}
