// Developer conveniences for getting a ROM without the file picker.
// - Local dev server: fetches the gitignored rom/pokeblue.gb.
// - Deployed: a link ending in #dev=<token> fetches the private test ROM. The token lives in
//   the URL fragment, which browsers never send to servers, and is removed from the address bar.
//   It's then remembered in this browser's localStorage, so later links work without it; a
//   token the server stops accepting (rotated) is forgotten.

const TOKEN_KEY = "pokehd.devToken";

function rememberedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function remember(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked (private window): the token just isn't remembered.
  }
}

export async function fetchDevRom(): Promise<Uint8Array | null> {
  const fromUrl = new URLSearchParams(location.hash.slice(1)).get("dev");
  if (fromUrl) history.replaceState(null, "", location.pathname + location.search);
  const token = fromUrl ?? rememberedToken();
  if (token) {
    const res = await fetch("/api/dev-rom", { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) {
      remember(token);
      return new Uint8Array(await res.arrayBuffer());
    }
    if (res.status === 404 || res.status === 401) remember(null);
    return null;
  }
  if (import.meta.env.DEV) {
    const res = await fetch("/__dev/rom").catch(() => null);
    return res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  }
  return null;
}
