/**
 * ScrollToHash — scrolls to the element matching `location.hash` on every
 * navigation. Enables cross-page permalinks like `/#faq` (the FAQ section on
 * the homepage) clicked from another route or opened directly, and re-fires
 * when the same hash link is clicked again (keyed on `location.key`).
 *
 * React Router doesn't restore hash scroll positions itself. The wrinkle: the
 * homepage streams in async content ABOVE the target (the reserves book, the
 * Blockscout dispatch feed) for a few seconds after mount — the page grows
 * from ~6.5k to ~9k px and the dispatch feed in particular lands on its own
 * network timing. A one-shot scroll (or a fixed-duration re-pin) lands short.
 *
 * So we re-pin every tick until the target's ABSOLUTE document position holds
 * steady for a few consecutive frames (content has settled), with a hard cap
 * as a backstop — and we bail the instant the user scrolls so we never fight
 * them.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const TICK_MS = 100;
const HARD_CAP_MS = 6000;
const STABLE_TICKS = 5; // ~500ms of <2px movement = settled

export function ScrollToHash() {
  const { hash, key } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));

    let userMoved = false;
    const onUserMove = () => {
      userMoved = true;
    };
    window.addEventListener('wheel', onUserMove, { passive: true });
    window.addEventListener('touchmove', onUserMove, { passive: true });
    window.addEventListener('keydown', onUserMove);

    const startedAt = performance.now();
    let interval = 0;
    let lastDocTop: number | null = null;
    let stableCount = 0;

    const stop = () => window.clearInterval(interval);

    const tick = () => {
      if (userMoved) return stop();
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        // Absolute position in the document — re-pinning keeps the *viewport*
        // offset fixed, so we track doc position to detect when content above
        // has stopped reflowing.
        const docTop = Math.round(el.getBoundingClientRect().top + window.scrollY);
        if (lastDocTop !== null && Math.abs(docTop - lastDocTop) < 2) {
          if (++stableCount >= STABLE_TICKS) return stop();
        } else {
          stableCount = 0;
        }
        lastDocTop = docTop;
      }
      if (performance.now() - startedAt >= HARD_CAP_MS) stop();
    };

    const raf = requestAnimationFrame(tick);
    interval = window.setInterval(tick, TICK_MS);

    return () => {
      stop();
      cancelAnimationFrame(raf);
      window.removeEventListener('wheel', onUserMove);
      window.removeEventListener('touchmove', onUserMove);
      window.removeEventListener('keydown', onUserMove);
    };
  }, [hash, key]);

  return null;
}
