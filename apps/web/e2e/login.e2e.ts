import { expect, test, type Page } from "@playwright/test";
import { addFriend, adminToken, friendLink, uniqueName } from "./friends.ts";

// The friends flow (D23, p3-rooms-client) in real browsers against `pnpm dev`: sign in from a
// link, ask for an emailed code, Nick adds a friend from the friends list, and two players see
// each other in the room. Local dev simulates Email Service, so emailed codes aren't read here.
// Needs ADMIN_TOKEN in apps/web/.dev.vars (or POKEHD_ADMIN_TOKEN) to add players.

test.skip(!adminToken(), "no ADMIN_TOKEN in apps/web/.dev.vars");

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

test("sign in with a link, then by email on another device", async ({ page, browser }) => {
  const name = uniqueName("Sam");
  const { link } = await addFriend(page.request, name);
  await page.goto(link);
  await expect(page.getByText(`You're in as ${name}`)).toBeVisible();
  // The code leaves the address bar, and a link works only once.
  expect(new URL(page.url()).hash).toBe("");

  const phone = await browser.newContext();
  const phonePage = await phone.newPage();
  await phonePage.goto(link);
  await expect(phonePage.getByRole("alert")).toContainText("doesn't work");
  await phonePage.getByLabel("Email").fill(`${name.toLowerCase()}@example.com`);
  await phonePage.getByRole("button", { name: "Send code" }).click();
  await expect(phonePage.getByText("a six-digit code is on its way")).toBeVisible();
  await phonePage.getByLabel("Code").fill("000000");
  await phonePage.getByRole("button", { name: "Sign in" }).click();
  await expect(phonePage.getByRole("alert")).toContainText("doesn't work");
  await phone.close();

  // The session survives a reload, and signing out ends it.
  await page.reload();
  await expect(page.getByText(`You're in as ${name}`)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("Nick adds a friend and copies their link", async ({ page, browser }) => {
  // Nick's player is made when he first asks for a code; a link from the admin API signs him in.
  expect((await page.request.post("/api/auth/request", { data: { email: "nick@dncr.me" } })).ok()).toBe(true);
  const players = await page.request.get("/api/admin/players", { headers: { authorization: `Bearer ${adminToken()}` } });
  const nick = ((await players.json()) as { players: { id: string; admin: boolean }[] }).players.find((p) => p.admin)!;
  await page.goto(await friendLink(page.request, nick.id));
  await expect(page.getByRole("heading", { name: "Friends" })).toBeVisible();

  const name = uniqueName("Kai");
  await page.getByLabel("Friend's email").fill(`${name.toLowerCase()}@example.com`);
  await page.getByLabel("Friend's name").fill(name);
  await page.getByRole("button", { name: "Add and copy link" }).click();
  const link = await page.getByLabel(`Sign-in link for ${name}`).inputValue();
  await expect(page.getByText(`${name.toLowerCase()}@example.com`)).toBeVisible();

  const friend = await (await browser.newContext()).newPage();
  await friend.goto(link);
  await expect(friend.getByText(`You're in as ${name}`)).toBeVisible();
  await expect(friend.getByRole("heading", { name: "Friends" })).toHaveCount(0);
  await friend.context().close();
});

test("two players see each other in the room", async ({ page, browser }) => {
  const other = await (await browser.newContext()).newPage();
  for (const [p, base] of [[page, "Ana"], [other, "Ben"]] as const) {
    await p.goto((await addFriend(p.request, uniqueName(base))).link);
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
  await tab2.goto("/login");
  await connect(tab2, null);
  await expect.poll(async () => (await roomState(tab2)).status).toBe("open");
  await expect.poll(async () => (await roomState(other)).status, { timeout: 10_000 }).toBe("replaced");

  // Ben leaves.
  await other.context().close();
  await expect.poll(async () => Object.keys((await roomState(page)).friends)).toEqual([]);
});
