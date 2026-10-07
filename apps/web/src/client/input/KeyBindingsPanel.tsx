import { useEffect, useState } from "react";
import { BUTTON_NAMES, keyLabel, type ButtonName } from "./bindings.ts";
import type { JoypadInput } from "./joypad.ts";
import "./key-bindings.css";

/** Lists each button's keys; clicking one waits for the next key press and binds it. */
export function KeyBindingsPanel({ input }: { input: JoypadInput }) {
  const [bindings, setBindings] = useState(input.keyBindings);
  const [waiting, setWaiting] = useState<ButtonName | null>(null);

  useEffect(() => {
    if (!waiting) return;
    let live = true;
    void input.captureNextKey().then((code) => {
      if (!live) return;
      if (code) input.bindKey(waiting, code);
      setBindings(input.keyBindings);
      setWaiting(null);
    });
    return () => {
      live = false;
      input.cancelCapture();
    };
  }, [input, waiting]);

  const reset = () => {
    input.resetKeyBindings();
    setBindings(input.keyBindings);
  };

  return (
    <section className="key-bindings" aria-label="Keyboard controls">
      <h2>Keyboard</h2>
      <ul>
        {BUTTON_NAMES.map((name) => (
          <li key={name}>
            <span>{name}</span>
            <button
              type="button"
              data-button={name}
              aria-pressed={waiting === name}
              onClick={() => setWaiting(waiting === name ? null : name)}
            >
              {waiting === name ? "Press a key…" : bindings[name].map(keyLabel).join(", ") || "unbound"}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={reset}>Reset to defaults</button>
    </section>
  );
}
