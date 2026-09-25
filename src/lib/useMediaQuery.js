import { useEffect, useState } from "react";

const matches = (query) => {
  try {
    return globalThis.matchMedia?.(query)?.matches === true;
  } catch {
    return false;
  }
};

/** Tracks a CSS media query, following rotation, resizing and input changes. */
export function useMediaQuery(query) {
  const [matched, setMatched] = useState(() => matches(query));
  useEffect(() => {
    const list = globalThis.matchMedia?.(query);
    if (!list) return undefined;
    const update = () => setMatched(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matched;
}
