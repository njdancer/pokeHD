// Developer conveniences for getting a ROM without the file picker.
// - Local dev server: fetches the gitignored rom/pokeblue.gb.
// - Deployed: a link ending in #dev=<token> fetches the private test ROM. The token lives in
//   the URL fragment, which browsers never send to servers, and is removed from the address bar.

export async function fetchDevRom(): Promise<Uint8Array | null> {
  const token = new URLSearchParams(location.hash.slice(1)).get("dev");
  if (token) {
    history.replaceState(null, "", location.pathname + location.search);
    const res = await fetch("/api/dev-rom", { headers: { authorization: `Bearer ${token}` } });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  }
  if (import.meta.env.DEV) {
    const res = await fetch("/__dev/rom").catch(() => null);
    return res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  }
  return null;
}
