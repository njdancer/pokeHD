// The friends API (D19) from the browser: join with a code, who am I, device codes, sign out.
// The session cookie is HttpOnly, so the browser carries it and this code never sees it.
import type { PlayerInfo } from "@pokehd/protocol";

export type JoinError = "invalid-code" | "bad-name" | "name-taken" | "network";

export async function join(code: string, name: string): Promise<{ player: PlayerInfo } | { error: JoinError }> {
  try {
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    const body = (await res.json()) as { player?: PlayerInfo; error?: JoinError };
    if (res.ok && body.player) return { player: body.player };
    return { error: body.error ?? "network" };
  } catch {
    return { error: "network" };
  }
}

/** The signed-in player, or null if there's no session. Throws on network errors. */
export async function me(): Promise<PlayerInfo | null> {
  const res = await fetch("/api/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/me: ${res.status}`);
  return ((await res.json()) as { player: PlayerInfo }).player;
}

/** A one-hour code that signs this player in on another device. */
export async function deviceCode(): Promise<{ code: string; expiresAt: number }> {
  const res = await fetch("/api/me/device-code", { method: "POST" });
  if (!res.ok) throw new Error(`/api/me/device-code: ${res.status}`);
  return (await res.json()) as { code: string; expiresAt: number };
}

export async function signOut(): Promise<void> {
  await fetch("/api/sign-out", { method: "POST" });
}
