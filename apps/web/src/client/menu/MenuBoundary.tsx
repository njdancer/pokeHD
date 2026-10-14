// A fence around the Pokédex menu: a bug in a menu screen must never blank the game behind it
// (QA bug 49 took the whole page down from one bad team row). React reports what it catches
// (main.tsx, onCaughtError); here the menu just steps aside and tries again a moment later, as a
// bad read of the game is usually gone by the next one.
import { Component, type ReactNode } from "react";

const RETRY_MS = 1000;

export class MenuBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  #retry: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(): void {
    clearTimeout(this.#retry);
    this.#retry = setTimeout(() => this.setState({ failed: false }), RETRY_MS);
  }

  override componentWillUnmount(): void {
    clearTimeout(this.#retry);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
