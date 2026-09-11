import { useEffect, useState } from "react";

export const useVirtualRows = (
  count: number,
  rowHeight: number,
  element: HTMLElement | null,
): { start: number; end: number; totalHeight: number } => {
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  useEffect(() => {
    if (!element) return;
    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setViewport({ top: element.scrollTop, height: element.clientHeight });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return (): void => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [element]);
  const visibleCount = Math.ceil(viewport.height / rowHeight) + 12;
  const lastStart = Math.max(0, count - visibleCount);
  const start = Math.min(lastStart, Math.max(0, Math.floor(viewport.top / rowHeight) - 6));
  return {
    start,
    end: Math.min(count, start + visibleCount),
    totalHeight: count * rowHeight,
  };
};
