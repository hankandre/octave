// A value that follows its input only after the input has held still for `ms` (DESIGN.md §9: the backdrop follows focus after
// 300 ms). The first value is returned at once; each change restarts the wait, so a value passed over quickly is never returned.
import { useEffect, useState } from "react";

export function useDwell<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return undefined;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, settled, ms]);
  return settled;
}
