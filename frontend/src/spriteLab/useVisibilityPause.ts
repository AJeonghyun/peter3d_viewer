import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

export function useVisibilityPause(
  target: RefObject<HTMLElement | null>,
  pauseWhenOffscreen = true,
) {
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [elementVisible, setElementVisible] = useState(true);

  useEffect(() => {
    const updatePageVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', updatePageVisibility);
    return () => document.removeEventListener('visibilitychange', updatePageVisibility);
  }, []);

  useEffect(() => {
    if (!pauseWhenOffscreen) {
      setElementVisible(true);
      return undefined;
    }
    const element = target.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setElementVisible(entry?.isIntersecting ?? true),
      { rootMargin: '80px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [pauseWhenOffscreen, target]);

  return pageVisible && elementVisible;
}
