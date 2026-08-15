import { useEffect, useRef, useState } from "react";

/**
 * The rendered width of an element, tracked as it changes.
 *
 * Needed wherever a layout has to be computed in pixels rather than expressed
 * in CSS — a grid of fixed-size cells that should fill its container can only
 * pick a cell size once it knows how much room there is.
 *
 * Starts at 0, which callers must treat as "not measured yet" rather than
 * "no space": the first paint happens before the observer fires.
 */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Some test environments and older webviews have no ResizeObserver. A
    // single measurement is a better fallback than throwing.
    if (typeof ResizeObserver === "undefined") {
      setWidth(element.getBoundingClientRect().width);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
