// The loading screen: up from the first paint (index.html draws the same markup before any
// script runs) until the HD world has drawn its first finished frame, so the page never shows a
// black screen or a half-built world. Its styles live in index.html, so they're there at once.

/** `leaving` fades it out; the page unmounts it after `LOADING_FADE_MS`. */
export function LoadingScreen({ leaving = false }: { leaving?: boolean }) {
  return (
    <div className="boot" data-leaving={leaving || undefined} role="status" aria-label="Loading" data-testid="loading">
      <div className="boot-ball" />
      <div className="boot-shadow" />
      <p className="boot-words">Getting your world ready…</p>
    </div>
  );
}

/** How long the loading screen takes to fade out (matches `.boot[data-leaving]` in index.html). */
export const LOADING_FADE_MS = 450;
