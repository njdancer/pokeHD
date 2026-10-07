import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The friends flow (D19, p3-rooms-client) in real browsers against `pnpm dev`: join with an
// invite, sign in a second device with a device code, and two players see each other in the room.
// Needs ADMIN_TOKEN in apps/web/.dev.vars (or POKEHD_ADMIN_TOKEN) to make invites.

function adminToken(): string | undefined {
  if (process.env.POKEHD_ADMIN_TOKEN) return process.env.POKEHD_ADMIN_TOKEN;
  try {
    return /^ADMIN_TOKEN\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))?.[1];
  } catch {
    return undefined;
  }
}
const token = adminToken();
test.skip(!token, "no ADMIN_TOKEN in apps/web/.dev.vars");

async function invite(page: Page): Promise<string> {
  const res = await page.request.post("/api/admin/invites", { headers: { authorization: `Bearer ${token}` }, data: {} });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { code: string }).code;
}

const uniqueName = (base: string) => `${base}${Date.now() % 100000}`;

/** Opens the room from the page with the real RoomClient (Vite serves the source module). */
async function connect(page: Page, presence: object | null) {
  await page.evaluate(async (presence) => {
    // Vite serves the source; a variable keeps TypeScript from resolving the URL as a path.
    const url = "/src/client/room/client.ts";
    const { RoomClient } = (await import(/* @vite-ignore */ url)) as typeof import("../src/client/room/client.ts");
    const client = new RoomClient();
    (window as unknown as { room: unknown }).room = client;
    client.sendPresence(presence as never);
    client.connect();
  }, presence);
}

const roomState = (page: Page) =>
  page.evaluate(() => {
    const room = (window as unknown as { room: { store: { getState(): unknown } } }).room;
    return JSON.parse(JSON.stringify(room.store.getState())) as {
      status: string;
      you: { id: string; name: string } | null;
      friends: Record<string, { name: string; presence: { x: number } | null }>;
    };
  });

test("join with an invite, then sign in another device", async ({ page, browser }) => {
  const name = uniqueName("Sam");
  await page.goto(`/join?code=${await invite(page)}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByText(`You're in as ${name}`)).toBeVisible();

  // A spent code fails with a clear message.
  const phone = await browser.newContext();
  const phonePage = await phone.newPage();
  await phonePage.goto("/join");
  await phonePage.getByLabel("Code").fill("AAAA-AAAA-AAAA");
  await phonePage.getByRole("button", { name: "Join" }).click();
  await expect(phonePage.getByRole("alert")).toContainText("doesn't work");

  await page.getByRole("button", { name: "Sign in another device" }).click();
  const code = await page.locator(".device-code strong").textContent();
  await phonePage.getByLabel("Code").fill(code!);
  await phonePage.getByRole("button", { name: "Join" }).click();
  await expect(phonePage.getByText(`You're in as ${name}`)).toBeVisible();

  // The session survives a reload, and signing out ends it.
  await phonePage.reload();
  await expect(phonePage.getByText(`You're in as ${name}`)).toBeVisible();
  await phonePage.getByRole("button", { name: "Sign out" }).click();
  await expect(phonePage.getByLabel("Code")).toBeVisible();
  await phone.close();
});

test("two players see each other in the room", async ({ page, browser }) => {
  const other = await (await browser.newContext()).newPage();
  for (const [p, base] of [[page, "Ana"], [other, "Ben"]] as const) {
    await p.goto(`/join?code=${await invite(p)}`);
    await p.getByLabel("Your name").fill(uniqueName(base));
    await p.getByRole("button", { name: "Join" }).click();
    await expect(p.getByText("You're in as")).toBeVisible();
  }
  const presence = { mapId: 0, x: 4, y: 5, facing: "down", step: null, animFrame: 0, transport: "walk", mode: "overworld" };
  await connect(page, presence);
  await expect.poll(async () => (await roomState(page)).status).toBe("open");
  await connect(other, null);
  await expect.poll(async () => (await roomState(other)).status).toBe("open");
  const anaId = (await roomState(page)).you!.id;
  const benId = (await roomState(other)).you!.id;
  await expect.poll(async () => (await roomState(other)).friends[anaId]?.presence?.x).toBe(4);
  await expect.poll(async () => (await roomState(page)).friends[benId]?.name).toMatch(/^Ben/);

  // Ben opens a second tab: the first gives way rather than fighting for the connection.
  const tab2 = await other.context().newPage();
  await tab2.goto("/join");
  await connect(tab2, null);
  await expect.poll(async () => (await roomState(tab2)).status).toBe("open");
  await expect.poll(async () => (await roomState(other)).status, { timeout: 10_000 }).toBe("replaced");

  // Ben leaves.
  await other.context().close();
  await expect.poll(async () => Object.keys((await roomState(page)).friends)).toEqual([]);
});
