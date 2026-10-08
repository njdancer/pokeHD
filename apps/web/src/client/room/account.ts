// The friends API (D23) from the browser: sign in by email, who am I, sign out, and the admin's
// player list. The session cookie is HttpOnly, so the browser carries it and this code never
// sees it.
import type { PlayerInfo } from "@pokehd/protocol";

export interface Account {
  player: PlayerInfo;
  email: string | null;
  /** Nick: can add and remove friends, and gets the test ROM. */
  admin: boolean;
}

export type SignInError = "bad-email" | "invalid-code" | "send-failed" | "network";

async function post<T>(path: string, body: unknown, method = "POST"): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, body: json } : { ok: false, error: json.error ?? "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Asks for a code by email. Succeeds whether or not the address belongs to a player. */
export async function requestCode(email: string): Promise<{ ok: true } | { error: SignInError }> {
  const result = await post("/api/auth/request", { email });
  return result.ok ? { ok: true } : { error: result.error as SignInError };
}

export async function verifyCode(email: string, code: string): Promise<Account | { error: SignInError }> {
  const result = await post<Account>("/api/auth/verify", { email, code });
  return result.ok ? result.body : { error: result.error as SignInError };
}

/** The signed-in account, or null if there's no session. Throws on network errors. */
export async function me(): Promise<Account | null> {
  const res = await fetch("/api/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/me: ${res.status}`);
  return (await res.json()) as Account;
}

export async function signOut(): Promise<void> {
  await fetch("/api/sign-out", { method: "POST" });
}

// Admin (Nick's session).

export interface FriendEntry {
  id: string;
  name: string;
  email: string | null;
  admin: boolean;
}

export interface Invite {
  link: string;
  expiresAt: number;
  /** Whether the email went out (when asked for). */
  sent: boolean;
}

export type AddError = "bad-email" | "bad-name" | "name-taken" | "email-taken" | "network";

export async function listFriends(): Promise<FriendEntry[]> {
  const res = await fetch("/api/admin/players");
  if (!res.ok) throw new Error(`/api/admin/players: ${res.status}`);
  return ((await res.json()) as { players: FriendEntry[] }).players;
}

export async function addFriend(email: string, name: string, send: boolean): Promise<Invite | { error: AddError }> {
  const result = await post<Invite>("/api/admin/players", { email, name, send });
  return result.ok ? result.body : { error: result.error as AddError };
}

export async function newLink(id: string, send: boolean): Promise<Invite | { error: string }> {
  const result = await post<Invite>(`/api/admin/players/${encodeURIComponent(id)}/link`, { send });
  return result.ok ? result.body : { error: result.error };
}

export async function setFriendEmail(id: string, email: string): Promise<{ ok: true } | { error: AddError }> {
  const result = await post(`/api/admin/players/${encodeURIComponent(id)}`, { email }, "PATCH");
  return result.ok ? { ok: true } : { error: result.error as AddError };
}

export async function removeFriend(id: string): Promise<boolean> {
  const res = await fetch(`/api/admin/players/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
  return !!res?.ok;
}
