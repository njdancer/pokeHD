// Making players for end-to-end tests (D23): the admin API adds a friend by email and returns a
// sign-in link; its fragment carries the email and code that /api/auth/verify takes.
import { readFileSync } from "node:fs";
import { expect, type APIRequestContext } from "@playwright/test";

/** The dev server's ADMIN_TOKEN, from POKEHD_ADMIN_TOKEN or apps/web/.dev.vars. */
export function adminToken(): string | undefined {
  if (process.env.POKEHD_ADMIN_TOKEN) return process.env.POKEHD_ADMIN_TOKEN;
  try {
    return /^ADMIN_TOKEN\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))?.[1];
  } catch {
    return undefined;
  }
}

export const uniqueName = (base: string) => `${base}${Date.now() % 100000}`;

/** Adds a friend; returns their id and a one-time sign-in link. */
export async function addFriend(request: APIRequestContext, name: string) {
  const res = await request.post("/api/admin/players", {
    headers: { authorization: `Bearer ${adminToken()}` },
    data: { email: `${name.toLowerCase()}@example.com`, name },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { player: { id: string }; link: string };
}

/** A fresh sign-in link for an existing friend. */
export async function friendLink(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.post(`/api/admin/players/${id}/link`, {
    headers: { authorization: `Bearer ${adminToken()}` },
    data: {},
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { link: string }).link;
}

/** Signs `request`'s browser context in with a sign-in link, as the page would. */
export async function signInWith(request: APIRequestContext, link: string) {
  const res = await request.post("/api/auth/verify", {
    data: Object.fromEntries(new URLSearchParams(new URL(link).hash.slice(1))),
  });
  expect(res.ok(), await res.text()).toBe(true);
}
