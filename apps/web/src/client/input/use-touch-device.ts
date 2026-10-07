import { useEffect, useState } from "react";

const COARSE = "(pointer: coarse)";

/** True when the primary pointer is a finger (phones, tablets), tracking changes. */
export function useTouchDevice(): boolean {
  const [touch, setTouch] = useState(() => matchMedia(COARSE).matches);
  useEffect(() => {
    const query = matchMedia(COARSE);
    const onChange = () => setTouch(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return touch;
}
