import { useEffect, useRef, useState, type FormEvent } from "react";
import { me, requestCode, signOut, verifyCode, type Account, type SignInError } from "./account.ts";
import { Friends } from "./Friends.tsx";
import { standalone } from "../standalone.ts";
import "./login.css";

const messages: Record<SignInError, string> = {
  "bad-email": "That doesn't look like an email address.",
  "invalid-code": "That code doesn't work. It may be mistyped, already used or expired.",
  "send-failed": "Couldn't send the email just now. Try again in a minute.",
  network: "Couldn't reach the server. Check your connection and try again.",
};

/** A sign-in link's email and code, from the fragment (which never reaches a server). */
function linkParams(): { email: string; code: string } | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const email = params.get("email");
  const code = params.get("code");
  return email && code ? { email, code } : null;
}

/**
 * `/login`: sign in with your email and the code it's sent (D23), or straight from a sign-in
 * link. Signed in, it shows who you are, and Nick gets the friends list.
 */
export function Login() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [error, setError] = useState<SignInError | null>(null);

  const started = useRef(false);

  useEffect(() => {
    // Once only: a sign-in link's code works once, and StrictMode runs effects twice in dev.
    if (started.current) return;
    started.current = true;
    const link = linkParams();
    if (link) {
      history.replaceState(null, "", location.pathname + location.search);
      void verifyCode(link.email, link.code).then((result) => {
        if ("error" in result) {
          setError(result.error);
          // A spent link on a device that's already in is fine.
          me().then(setAccount, () => setAccount(null));
        } else {
          setAccount(result);
        }
      });
      return;
    }
    me().then(setAccount, () => setError("network"));
  }, []);

  return (
    <main className="cartridge login">
      <h1>pokeHD</h1>
      {account === undefined ? (
        error ? <p className="status bad" role="alert">{messages[error]}</p> : <p>Checking…</p>
      ) : account ? (
        <SignedIn account={account} onSignedOut={() => setAccount(null)} />
      ) : (
        <SignInForm initialError={error} onSignedIn={setAccount} />
      )}
    </main>
  );
}

function SignInForm({ initialError, onSignedIn }: { initialError: SignInError | null; onSignedIn(a: Account): void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<SignInError | null>(initialError);
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await requestCode(email);
    setBusy(false);
    if ("error" in result) setError(result.error);
    else setSentTo(email.trim());
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await verifyCode(sentTo!, code);
    setBusy(false);
    if ("error" in result) setError(result.error);
    else onSignedIn(result);
  };

  const alert = error && <p className="status bad" role="alert">{messages[error]}</p>;

  if (sentTo) {
    return (
      <form onSubmit={verify}>
        <p>
          If <strong className="who">{sentTo}</strong> is on the list, a six-digit code is on its way. Enter it here.
        </p>
        {standalone() && (
          // Home-screen apps keep their own sign-in: the email's link would sign in Safari instead.
          <p>Type the code rather than opening the link, so this app stays signed in.</p>
        )}
        <label>
          Code
          <input
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            required
            autoFocus
          />
        </label>
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        {alert}
        <p>
          <button type="button" className="link-button" onClick={() => { setSentTo(null); setCode(""); setError(null); }}>
            Use a different email
          </button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={send}>
      <p>Sign in with the email address you were invited with. We'll send you a code.</p>
      <label>
        Email
        <input
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          spellCheck={false}
          required
        />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send code"}</button>
      {alert}
    </form>
  );
}

function SignedIn({ account, onSignedOut }: { account: Account; onSignedOut(): void }) {
  return (
    <>
      <p>
        You're in as <strong className="who">{account.player.name}</strong>.
      </p>
      <div className="actions">
        <a className="button primary" href="/">Play</a>
        <button type="button" onClick={() => signOut().then(onSignedOut)}>Sign out</button>
      </div>
      {account.admin && <Friends />}
    </>
  );
}
