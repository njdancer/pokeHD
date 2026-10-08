import { useEffect, useState, type FormEvent } from "react";
import {
  addFriend,
  listFriends,
  newLink,
  removeFriend,
  setFriendEmail,
  setFriendRomAccess,
  type AddError,
  type FriendEntry,
  type Invite,
} from "./account.ts";
import "./friends.css";

const addMessages: Record<AddError, string> = {
  "bad-email": "That doesn't look like an email address.",
  "bad-name": "Pick a name of 1 to 16 letters, digits, spaces or _ - . '",
  "name-taken": "Someone already has that name.",
  "email-taken": "Someone already has that email.",
  network: "Couldn't reach the server.",
};

/** The last link made, for whom, and whether it was emailed. */
interface Made extends Invite {
  name: string;
  emailed: boolean;
}

/**
 * Nick's friends list (D23): add a friend by email and either email them a sign-in link or copy
 * it to send yourself; make a fresh link; give a D19 player an email; stop sharing the cartridge
 * with someone, or share it again (D25); remove someone.
 */
export function Friends() {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => listFriends().then(setFriends, () => setLoadError(true));
  useEffect(() => void reload(), []);

  const show = (name: string, invite: Invite | { error: string }, emailed: boolean) => {
    if ("error" in invite) return setError(addMessages[invite.error as AddError] ?? "Something went wrong.");
    setError(null);
    setMade({ ...invite, name, emailed });
  };

  const link = async (friend: FriendEntry, send: boolean) => show(friend.name, await newLink(friend.id, send), send);

  const share = async (friend: FriendEntry, romAccess: boolean) => {
    if (!romAccess && !confirm(`Stop sharing your cartridge with ${friend.name}? They'll need their own ROM to keep playing.`)) return;
    if (await setFriendRomAccess(friend.id, romAccess)) void reload();
    else setError("Couldn't change that.");
  };

  const remove = async (friend: FriendEntry) => {
    if (!confirm(`Remove ${friend.name}? Their sessions end, and their cloud saves stay until you delete them.`)) return;
    if (await removeFriend(friend.id)) void reload();
    else setError("Couldn't remove them.");
  };

  return (
    <section className="friends">
      <h2>Friends</h2>
      {loadError && <p className="bad" role="alert">Couldn't load your friends.</p>}
      {friends && (
        <ul>
          {friends.map((f) => (
            <li key={f.id}>
              <span>
                <span className="who">{f.name}</span>{" "}
                <span className="email">{f.email ?? "no email yet"}</span>
                {!f.admin && <span className="email">{f.romAccess ? " · plays on your cartridge" : " · own ROM only"}</span>}
              </span>
              {f.admin ? null : f.email ? (
                <div className="row">
                  <button type="button" onClick={() => link(f, false)}>Copy link</button>
                  <button type="button" onClick={() => link(f, true)}>Email link</button>
                  <button type="button" onClick={() => share(f, !f.romAccess)}>
                    {f.romAccess ? "Stop sharing" : "Share cartridge"}
                  </button>
                  <button type="button" onClick={() => remove(f)}>Remove</button>
                </div>
              ) : (
                <AddEmail friend={f} onDone={reload} />
              )}
            </li>
          ))}
        </ul>
      )}
      <AddFriend
        onAdded={(name, invite, emailed) => {
          show(name, invite, emailed);
          void reload();
        }}
      />
      {made && <MadeLink key={made.link} made={made} />}
      {error && <p className="bad" role="alert">{error}</p>}
    </section>
  );
}

function AddFriend({ onAdded }: { onAdded(name: string, invite: Invite, emailed: boolean): void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<AddError | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const send = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "email";
    setBusy(true);
    setError(null);
    const result = await addFriend(email, name, send);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    onAdded(name.trim(), result, send);
    setEmail("");
    setName("");
  };

  return (
    <form onSubmit={add} aria-label="Add a friend">
      <div className="row">
        <input name="email" type="email" placeholder="Email" aria-label="Friend's email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input name="name" placeholder="Name" aria-label="Friend's name" maxLength={16} value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="row">
        <button type="submit" value="copy" disabled={busy}>Add and copy link</button>
        <button type="submit" value="email" disabled={busy}>Add and email</button>
      </div>
      {error && <p className="bad" role="alert">{addMessages[error]}</p>}
    </form>
  );
}

function AddEmail({ friend, onDone }: { friend: FriendEntry; onDone(): void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<AddError | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const result = await setFriendEmail(friend.id, email);
    if ("error" in result) setError(result.error);
    else onDone();
  };
  return (
    <form onSubmit={save} className="row">
      <input type="email" placeholder="Their email" aria-label={`${friend.name}'s email`} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit">Save</button>
      {error && <span className="bad" role="alert">{addMessages[error]}</span>}
    </form>
  );
}

function MadeLink({ made }: { made: Made }) {
  const [copied, setCopied] = useState(false);
  const copy = (link: string) => navigator.clipboard.writeText(link).then(() => setCopied(true), () => {});
  // Copying straight after the request often fails (the click's permission has lapsed), so
  // the link also shows with its own Copy button.
  useEffect(() => {
    if (!made.emailed) void copy(made.link);
  }, [made]);

  const until = new Date(made.expiresAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return (
    <div>
      {made.emailed && (
        <p className={made.sent ? "note" : "note bad"} role="status">
          {made.sent ? `Emailed ${made.name} a sign-in link.` : `Couldn't email ${made.name}; send them this link instead.`}
        </p>
      )}
      <div className="link">
        <input readOnly value={made.link} aria-label={`Sign-in link for ${made.name}`} onFocus={(e) => e.target.select()} />
        <button type="button" onClick={() => copy(made.link)}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="note">Signs {made.name} in once, until {until}. After that they sign in with their email.</p>
    </div>
  );
}
