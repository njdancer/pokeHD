// Developer conveniences for getting a ROM without the file picker.
// - Local dev server: fetches the gitignored rom/pokeblue.gb.
// - Deployed: fetches Nick's private test ROM, which the Worker serves only to his session
//   (D23). Everyone else gets a 404 and loads their own.

export async function fetchDevRom(): Promise<Uint8Array | null> {
  const res = await fetch(import.meta.env.DEV ? "/__dev/rom" : "/api/dev-rom").catch(() => null);
  return res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}
