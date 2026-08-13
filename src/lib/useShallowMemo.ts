import { useRef } from 'react';

function shallowEqual(left: object, right: object): boolean {
  if (left === right) return true;

  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;

  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;

  for (const key of keys) {
    // Object.is so NaN compares equal and ±0 do not.
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Preserves an object's identity across renders while its values are unchanged.
 *
 * React context values are the motivating case: building the value inline means
 * a fresh object on every render, so every consumer re-renders even when
 * nothing it reads has changed. `useMemo` solves this too, but needs a
 * hand-maintained dependency array — for a context with dozens of fields that
 * list is long and easy to get wrong.
 *
 * Callbacks passed in must already be stable (`useCallback`), or the identity
 * changes every render and this does nothing.
 */
export function useShallowMemo<T extends object>(value: T): T {
  const ref = useRef(value);
  if (!shallowEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
}
