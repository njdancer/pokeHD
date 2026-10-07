import { useEffect, useState, type FormEvent } from "react";
import type { PlayerInfo } from "@pokehd/protocol";
import { deviceCode, join, me, signOut, type JoinError } from "./account.ts";
import "./join.css";

const messages: Record<JoinError, string> = {
  "invalid-code": "That code doesn't work. It may be mistyped, already used or expired.",
  "bad-name": "Pick a name of 1 to 16 letters, digits, spaces or _ - . '",
  "name-taken": "Someone already has that name. Try another.",
  network: "Couldn't reach the server. Check your connection and try again.",
};

/**
 * `/join`: become a player with an invite code and a name, or sign in with a device code from
 * your other device (D19). Signed in, it shows who you are and makes device codes.
 */
export function Join() {
  const [player, setPlayer] = useState<PlayerInfo | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    me().then(setPlayer, () => setLoadError(true));
  }, []);

  return (
    <main className="cartridge join">
      <h1>pokeHD</h1>
      {loadError ? (
        <p className="status bad" role="alert">{messages.network}</p>
      ) : player === undefined ? (
        <p>Checking…</p>
      ) : player ? (
        <SignedIn player={player} onSignedOut={() => setPlayer(null)} />
      ) : (
        <JoinForm onJoined={setPlayer} />
      )}
    </main>
  );
}

function JoinForm({ onJoined }: { onJoined(player: PlayerInfo): void }) {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("code") ?? "");
  const [name, setName] = useState("");
  const [error, setError] = useState<JoinError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await join(code, name);
    setBusy(false);
    if ("player" in result) onJoined(result.player);
    else setError(result.error);
  };

  return (
    <form onSubmit={submit}>
      <p>Enter the code a friend sent you. On another of your devices? Use a device code and leave the name empty.</p>
      <label>
        Code
        <input
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
      </label>
      <label>
        Your name <small>(new players)</small>
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={16} autoComplete="nickname" />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Joining…" : "Join"}</button>
      {error && <p className="status bad" role="alert">{messages[error]}</p>}
    </form>
  );
}

function SignedIn({ player, onSignedOut }: { player: PlayerInfo; onSignedOut(): void }) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState(false);

  const makeCode = async () => {
    setError(false);
    try {
      setCode(await deviceCode());
    } catch {
      setError(true);
    }
  };

  return (
    <>
      <p>
        You're in as <strong className="who">{player.name}</strong>.
      </p>
      <div className="actions">
        <a className="button primary" href="/">Play</a>
        <button type="button" onClick={makeCode}>Sign in another device</button>
        <button type="button" onClick={() => signOut().then(onSignedOut)}>Sign out</button>
      </div>
      {code && (
        <p className="device-code">
          On your other device, open <code>/join</code> and enter <strong>{code.code}</strong>. It works once, until{" "}
          {new Date(code.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
        </p>
      )}
      {error && <p className="status bad" role="alert">{messages.network}</p>}
    </>
  );
}
