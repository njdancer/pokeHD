// The People tab: friends first (playing now, gifts waiting), then everyone met in the game, from
// the journal. A friend's page sends gifts and asks for trades and battles; a person's page
// remembers what they said.
import { useState } from "react";
import { personPic, useEnv } from "../env.tsx";
import { useNav } from "../nav.tsx";
import { RowIcon } from "../icons.tsx";
import type { Friend, PersonKind } from "../model.ts";
import { Chips, Page, Pixel, ReadButton, Row, Section, Seg, Verbs } from "../ui.tsx";

type Who = "all" | "friends" | "game";
type Kind = "all" | PersonKind;

export function Avatar({ friend, big }: { friend: Friend; big?: boolean }) {
  return (
    <span className={`m-avatar${big ? " big" : ""}${friend.online ? " online" : ""}`} style={{ background: friend.colour }}>
      {friend.name[0]}
      {friend.online && <i aria-label="Playing now" />}
    </span>
  );
}

export function PeopleScreen() {
  const env = useEnv();
  const nav = useNav();
  const { friends, people } = env.model;
  const [who, setWho] = useState<Who>("all");
  const [kind, setKind] = useState<Kind>("all");
  const gift = friends.find((f) => f.gift);
  const shown = people.filter((p) => kind === "all" || p.kind === kind);
  return (
    <Page title="People" meta={`${friends.filter((f) => f.online).length} friends playing`}>
      <Seg label="Show" value={who} onChange={setWho} options={[["all", "All"], ["friends", "Friends"], ["game", "In the game"]]} />
      {who === "game" && (
        <Chips label="Kind" value={kind} onChange={setKind} options={[["all", "Everyone"], ["Leader", "Leaders"], ["Trainer", "Trainers"], ["Helper", "Helpers"], ["Townsfolk", "Townsfolk"]]} />
      )}
      {who !== "game" && (
        <>
          {gift && (
            <button type="button" className="m-gift" onClick={() => nav.go({ k: "friend", id: gift.id })}>
              <RowIcon kind="gift" />
              <span className="m-text">
                <span className="m-title">A present from {gift.name}!</span>
                <span className="m-sub">It's {gift.gift}. It pops into your bag next time you're walking around.</span>
              </span>
            </button>
          )}
          {who === "all" && <Section>Friends</Section>}
          <div className="m-list">
            {friends.map((f) => (
              <Row key={f.id} media={<Avatar friend={f} />} title={f.name} sub={f.online ? `Playing now · ${f.where}` : f.where} onClick={() => nav.go({ k: "friend", id: f.id })} />
            ))}
          </div>
        </>
      )}
      {who !== "friends" && (
        <>
          {who === "all" && <Section right={<span className="m-faint">{people.length} met</span>}>People in the game</Section>}
          <div className="m-list">
            {shown.map((p) => (
              <Row
                key={p.key}
                media={<Pixel className={"trainer" in p.picture ? "m-trainer" : "m-sprite"} src={personPic(env, p)} />}
                title={p.name}
                sub={`${p.place} · ${p.status}`}
                right={p.kind === "Leader" ? <span className={`m-tag${p.beaten ? " won" : ""}`}>{p.beaten ? "Beaten" : "Leader"}</span> : undefined}
                onClick={() => nav.go({ k: "person", key: p.key })}
              />
            ))}
          </div>
        </>
      )}
      <p className="m-foot">Only people you've met are here. They're added as you meet them.</p>
    </Page>
  );
}

export function PersonScreen({ id }: { id: string }) {
  const env = useEnv();
  const nav = useNav();
  const p = env.model.people.find((x) => x.key === id)!;
  return (
    <Page title={p.name} meta={p.kind}>
      <div className="m-hero person">
        <div className={`m-hero-pic${"trainer" in p.picture ? "" : " sprite"}`}>
          <Pixel src={personPic(env, p)} />
        </div>
        <div className="m-hero-text">
          <span className="m-no">{p.kind === "Townsfolk" ? "Lives here" : p.kind}</span>
          <h3>{p.name}</h3>
          <span className="m-sub">{p.place}</span>
          <span className={`m-tag${p.beaten ? " won" : ""}`}>{p.status}</span>
        </div>
      </div>
      {p.said && (
        <figure className="m-said">
          <blockquote>{p.said}</blockquote>
          <figcaption>What {p.name} said when you met</figcaption>
        </figure>
      )}
      {p.note && <div className="m-card m-note"><p>{p.note}</p></div>}
      <Verbs verbs={[{ label: "Show on the map", alt: true, run: () => nav.tab("map", { k: "map", focus: p.place }) }]} />
      <ReadButton text={`${p.name}. ${p.said ? `${p.name} said: ${p.said}` : ""} ${p.note ?? ""}`} />
    </Page>
  );
}

export function FriendScreen({ id }: { id: string }) {
  const env = useEnv();
  const nav = useNav();
  const f = env.model.friends.find((x) => x.id === id)!;
  const ask = (what: "trade" | "battle") => env.toast(env.actions.ask(f.id, what));
  return (
    <Page title={f.name} meta={f.online ? "Playing now" : undefined}>
      <div className="m-hero friend">
        <Avatar friend={f} big />
        <div className="m-hero-text">
          <span className="m-no">Friend</span>
          <h3>{f.name}</h3>
          <span className="m-sub">{f.online ? `Playing now, in ${f.where}` : f.where}</span>
        </div>
      </div>
      {f.gift && (
        <div className="m-gift still">
          <RowIcon kind="gift" />
          <span className="m-text">
            <span className="m-title">{f.name} sent you {f.gift}</span>
            <span className="m-sub">It pops into your bag next time you're walking around.</span>
          </span>
        </div>
      )}
      <div className="m-bigverbs">
        <button type="button" onClick={() => nav.go({ k: "bag", for: { giftTo: f.id } })}>
          <RowIcon kind="gift" />
          Send an item
        </button>
        <button type="button" onClick={() => nav.go({ k: "team", for: { giftTo: f.id } })}>
          <RowIcon kind="ball" />
          Send a Pokémon
        </button>
        <button type="button" disabled={!f.online} onClick={() => ask("trade")}>
          <RowIcon kind="trade" />
          Trade
          {!f.online && <small>When they're playing</small>}
        </button>
        <button type="button" disabled={!f.online} onClick={() => ask("battle")}>
          <RowIcon kind="battle" />
          Battle
          {!f.online && <small>When they're playing</small>}
        </button>
      </div>
      {f.online && <Verbs verbs={[{ label: `Show ${f.name} on the map`, alt: true, run: () => nav.tab("map", { k: "map", focus: f.where }) }]} />}
      <p className="m-foot">Trades and battles happen upstairs in any Pokémon Center, as in the game.</p>
    </Page>
  );
}
