// The Me tab: your trainer card and badges, Saves and Settings, then your adventure in numbers
// and your firsts (tap one to see where it happened). Grown-ups' things hide inside Settings.
import { useState } from "react";
import { SPRITE_NAMES } from "@pokehd/rom";
import { BADGES, monPic, spritePic, useEnv } from "../env.tsx";
import { RowIcon } from "../icons.tsx";
import { useNav } from "../nav.tsx";
import { inBattle, type GameOptions } from "../model.ts";
import { Page, Pixel, Row, Section, Seg, Switch, Verbs } from "../ui.tsx";

export function MeScreen() {
  const env = useEnv();
  const nav = useNav();
  const { trainer, stats, firsts, savedAgo } = env.model;
  const got = trainer.badges.filter(Boolean).length;
  return (
    <Page title="Me" meta={trainer.name}>
      <div className="m-tcard">
        <div className="m-tcard-pic">
          <Pixel src={spritePic(env, SPRITE_NAMES.indexOf("RED"))} />
        </div>
        <div className="m-tcard-text">
          <span className="m-no">Trainer card</span>
          <h3>{trainer.name}</h3>
          <dl>
            <div><dt>ID No.</dt><dd>{trainer.id}</dd></div>
            <div><dt>Money</dt><dd>₽{trainer.money.toLocaleString()}</dd></div>
            <div><dt>Time</dt><dd>{trainer.played}</dd></div>
          </dl>
        </div>
      </div>
      <div className="m-card m-badges" aria-label={`${got} of 8 badges`}>
        {BADGES.map((b, i) => (
          <span key={b.name} className={`m-badge${trainer.badges[i] ? " got" : ""}`} title={trainer.badges[i] ? `${b.name} Badge` : "Not yet"}>
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d={b.shape} fill={trainer.badges[i] ? b.colour : "none"} stroke={trainer.badges[i] ? "#3e2a1c" : "#d6bf96"} strokeWidth="2" strokeDasharray={trainer.badges[i] ? undefined : "3 3"} strokeLinejoin="round" />
            </svg>
          </span>
        ))}
      </div>
      <div className="m-list">
        <Row media={<RowIcon kind="save" />} title="Saves" sub={`Saved ${savedAgo}`} onClick={() => nav.go({ k: "saves" })} />
        <Row media={<RowIcon kind="gear" />} title="Settings" sub="Game options, sound, grown-ups" onClick={() => nav.go({ k: "settings" })} />
      </div>
      <Section>Your adventure in numbers</Section>
      <div className="m-stats">
        {stats.map((s) => (
          <div key={s.label} className="m-card m-statcard">
            <b>{s.value}</b>
            <span>{s.label}</span>
            {s.sub && <small>{s.sub}</small>}
          </div>
        ))}
      </div>
      <Section right={<span className="m-faint">Tap to see where</span>}>Firsts</Section>
      <ol className="m-firsts">
        {firsts.map((f) => (
          <li key={f.title}>
            <button type="button" onClick={() => nav.tab("map", { k: "map", focus: f.place })}>
              <span className="m-first-pic">{f.dex ? <Pixel src={monPic(env, f.dex)} /> : <RowIcon kind="star" />}</span>
              <span className="m-text">
                <span className="m-title">{f.title}</span>
                <span className="m-sub">{f.text}</span>
              </span>
              <span className="m-when">{f.when}</span>
            </button>
          </li>
        ))}
      </ol>
    </Page>
  );
}

export function SavesScreen() {
  const env = useEnv();
  const { model, actions, moment } = env;
  const battle = inBattle(moment);
  const [confirm, setConfirm] = useState<number | null>(null);
  return (
    <Page title="Saves">
      <div className="m-card m-savecard">
        <div className="m-title">This adventure · {model.trainer.name}</div>
        <div className="m-sub">
          {model.trainer.badges.filter(Boolean).length} badges · {model.trainer.played} played · saved {model.savedAgo}
        </div>
        <Verbs verbs={[{ label: "Save now", off: battle ? "After the battle" : undefined, run: () => env.toast(actions.save()) }]} />
        <p className="m-foot">It also saves itself every 5 minutes and after every battle, so nothing gets lost.</p>
      </div>
      <Section>Go back to a checkpoint</Section>
      <div className="m-list">
        {model.checkpoints.map((c, i) =>
          confirm === i ? (
            <div key={c.place} className="m-card m-confirm">
              <div className="m-title">Go back to {c.place}?</div>
              <p className="m-sub">What you've done since is kept as a checkpoint too, so you can come back.</p>
              <div className="m-confirm-btns">
                <button type="button" className="m-verb" onClick={() => (env.toast(actions.goBack(i)), setConfirm(null))}>Go back</button>
                <button type="button" className="m-verb alt" onClick={() => setConfirm(null)}>Stay here</button>
              </div>
            </div>
          ) : (
            <Row key={c.place} media={<RowIcon kind="flag" />} title={c.place} sub={c.when} off={battle} onClick={() => setConfirm(i)} />
          ),
        )}
      </div>
      <Section>Other adventures</Section>
      <div className="m-list">
        <Row title="All your adventures" sub="Play another, copy this one, or start a new one" onClick={() => env.toast("That's the save manager (its own page)")} />
      </div>
    </Page>
  );
}

export function SettingsScreen() {
  const env = useEnv();
  const nav = useNav();
  const { options: o, app: a } = env.model;
  const set = <K extends keyof GameOptions>(k: K) => (v: GameOptions[K]) => env.actions.setOption(k, v);
  return (
    <Page title="Settings">
      <Section>The game's own options</Section>
      <div className="m-card m-opts">
        <div>
          <span className="m-title">Words appear</span>
          <Seg label="Text speed" value={o.speed} onChange={set("speed")} options={[["Fast", "Fast"], ["Medium", "Medium"], ["Slow", "Slow"]]} />
        </div>
        <div>
          <span className="m-title">Battle animations</span>
          <Seg label="Battle animations" value={o.animations ? "on" : "off"} onChange={(v) => set("animations")(v === "on")} options={[["on", "On"], ["off", "Off"]]} />
        </div>
        <div>
          <span className="m-title">Battle style</span>
          <Seg label="Battle style" value={o.style} onChange={set("style")} options={[["Shift", "Shift"], ["Set", "Set"]]} />
          <span className="m-sub">{o.style === "Shift" ? "You can swap Pokémon when a trainer's one faints." : "No swapping between a trainer's Pokémon."}</span>
        </div>
      </div>
      <Section>This app</Section>
      <div className="m-card m-toggles">
        <Switch on={a.sound} onChange={(v) => env.actions.setApp("sound", v)} label="Sound" />
        <Switch on={a.readAloud} onChange={(v) => env.actions.setApp("readAloud", v)} label="“Read it to me” buttons" />
        <Switch on={a.gameBoyScreen} onChange={(v) => env.actions.setApp("gameBoyScreen", v)} label="Game Boy screen in the corner" />
      </div>
      <div className="m-list">
        <Row media={<RowIcon kind="lock" />} title="Grown-ups" sub="Saves, backups, friends, this device" onClick={() => nav.go({ k: "grownups" })} />
      </div>
    </Page>
  );
}

export function GrownupsScreen() {
  const env = useEnv();
  const [open, setOpen] = useState(false);
  const [q] = useState(() => {
    const a = 6 + Math.floor(Math.random() * 4);
    const b = 6 + Math.floor(Math.random() * 4);
    const right = a * b;
    const wrong = [right - a, right + b].sort(() => Math.random() - 0.5);
    return { a, b, right, answers: [right, ...wrong].sort((x, y) => x - y) };
  });
  if (!open)
    return (
      <Page title="Grown-ups">
        <div className="m-card m-gate">
          <span className="m-gate-lock" aria-hidden="true" />
          <div className="m-title">Ask a grown-up</div>
          <p className="m-sub">
            What's {q.a} × {q.b}?
          </p>
          <div className="m-gate-answers">
            {q.answers.map((n) => (
              <button key={n} type="button" className="m-verb alt" onClick={() => (n === q.right ? setOpen(true) : env.toast("Not quite. Ask a grown-up!"))}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </Page>
    );
  return (
    <Page title="Grown-ups" meta="Unlocked">
      <Section>Saves</Section>
      <div className="m-list">
        <Row title="Manage saves" sub="Every adventure on this account" onClick={() => env.toast("The save manager")} />
        <Row title="Back up or restore a save file" onClick={() => env.toast("Backups")} />
      </div>
      <Section>Friends</Section>
      <div className="m-list">
        <Row title="Invite a friend" sub="By email, or a link they tap" onClick={() => env.toast("Invites")} />
        <Row title="Who can use Nick's cartridge" onClick={() => env.toast("Cartridge sharing")} />
      </div>
      <Section>This device</Section>
      <div className="m-list">
        <Row title="Keyboard and controller" onClick={() => env.toast("Controls")} />
        <Row title="Forget the ROM on this device" onClick={() => env.toast("Forget the ROM")} />
      </div>
    </Page>
  );
}
