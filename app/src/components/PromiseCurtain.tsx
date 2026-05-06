/**
 * PromiseCurtain — drag-to-switch wrapper used on the home page.
 *
 * Floating-chip variant: the PUSD content covers the section by default;
 * a magenta-bordered chip pinned at the bottom-left slides bottom-right
 * as the user drags, sliding the PUSD layer rightward to reveal PUSD+.
 * Releases past 30% snap fully open; from open, 15% travel back closes.
 *
 * Pure layout — neither side's design is changed. The curtain mechanism
 * sits on top of the same markup as the original section.
 *
 * The wrapper also fades the front content as the curtain pulls aside and
 * reports progress to a parent via `onProgress` so adjacent elements (like
 * a section header above this) can fade in lock-step.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

type Props = {
  /** Content that is shown by default — the curtain itself. */
  front: ReactNode;
  /** Content revealed when the curtain is pulled aside. */
  back: ReactNode;
  /** Label rendered on the chip when the curtain is closed. */
  frontLabel?: string;
  /** Label that replaces frontLabel once the curtain is fully open. */
  backLabel?: string;
  /** Optional progress callback (0 = closed, 1 = open). */
  onProgress?: (open: number) => void;
};

export function PromiseCurtain({
  front,
  back,
  frontLabel = 'DRAG FOR PUSD+',
  backLabel = 'DRAG FOR PUSD',
  onProgress,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(0); // 0 = covered, 1 = uncovered
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);
  // Captured at the start of each drag so the release snap can use an
  // asymmetric threshold — pulling back from open is easier than pulling
  // open from closed.
  const dragStartOpen = useRef(0);

  useEffect(() => {
    onProgress?.(open);
  }, [open, onProgress]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const clientX =
        'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      // Drag right → ratio increases → curtain opens. Reading direction.
      const ratio = (clientX - r.left) / r.width;
      setOpen(Math.max(0, Math.min(1, ratio)));
    };
    const onUp = () => {
      setDragging(false);
      setOpen((o) => {
        // Asymmetric snap: closing (started open) only needs ~15% travel
        // back, so the curtain pulls back easily once it's open. Opening
        // (started closed) keeps the standard 30% travel threshold.
        if (dragStartOpen.current > 0.5) {
          return o < 0.85 ? 0 : 1;
        }
        return o > 0.3 ? 1 : 0;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging]);

  function start() {
    dragStartOpen.current = open;
    setDragging(true);
    setTouched(true);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setTouched(true);
      setOpen((o) => (o > 0.5 ? 0 : 1));
    }
  }

  // Fade the front content as the curtain pulls aside. Stays at 1 for the
  // first ~10% of drag so the start of the gesture feels solid, then ramps
  // down so the user sees the front receding before they let go.
  const frontFadeStart = 0.1;
  const frontOpacity = Math.max(
    0,
    1 - Math.max(0, open - frontFadeStart) / (1 - frontFadeStart),
  );

  // Direction-dependent arrow: pointing right while we still need to open,
  // pointing left once open (so the user knows they can drag back).
  const isOpen = open > 0.5;
  const arrow = isOpen ? '←' : '→';
  const arrowKeyframe = isOpen ? 'pp-arrow-pulse-x-left' : 'pp-arrow-pulse-x-right';

  // Chip placement: 18px from the container's leading edge in each end-state.
  //   open=0 → left: 18px               (bottom-left, PUSD shown)
  //   open=1 → left: calc(100% - 198px) (bottom-right, PUSD+ shown)
  // 180px chip + 18px gutter = 198px total reservation when right-anchored.
  const chipPxOffset = 18 - 216 * open;
  const chipLeft = `calc(${open * 100}% + ${chipPxOffset}px)`;

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        overflow: 'visible',
        userSelect: dragging ? 'none' : 'auto',
      }}
    >
      <style>{`
        @keyframes pp-arrow-pulse-x-left {
          0%, 100% { transform: translateX(0); opacity: 0.7; }
          50%      { transform: translateX(-4px); opacity: 1; }
        }
        @keyframes pp-arrow-pulse-x-right {
          0%, 100% { transform: translateX(0); opacity: 0.7; }
          50%      { transform: translateX(4px); opacity: 1; }
        }
        @keyframes pp-tab-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255, 61, 165, 0.55); }
          50%      { box-shadow: 0 0 0 10px rgba(255, 61, 165, 0); }
        }
      `}</style>

      {/* Back layer (PUSD+) sits underneath. The wrapper height matches the
       * front so the absolute-positioned curtain has something to cover.
       * Bottom padding reserves space for the floating chip so revealed
       * paragraph 03 is never hidden behind it. */}
      <div style={{ position: 'absolute', inset: 0, padding: '0 24px 76px 24px' }}>
        {back}
      </div>

      {/* Front layer (PUSD). Slides RIGHT as the user pulls; magenta border
       * sits on its LEFT edge so the trailing edge is the visible curtain
       * line. We render it relatively so the wrapper sizes to the front
       * content; the absolute back layer stretches to match. The inner is
       * opacity-faded so the receding front telegraphs the swap. Bottom
       * padding mirrors the back layer to keep the chip clear of text. */}
      <div
        style={{
          position: 'relative',
          background: 'var(--c-cream)',
          borderLeft: '3px solid var(--c-magenta)',
          transform: `translateX(${open * 100}%)`,
          transition: dragging
            ? 'none'
            : 'transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          willChange: 'transform',
        }}
      >
        <div
          style={{
            padding: '0 24px 76px 24px',
            opacity: frontOpacity,
            transition: dragging ? 'none' : 'opacity 360ms ease-out',
          }}
        >
          {front}
        </div>
      </div>

      {/* Floating chip. Pinned to the bottom of the curtain wrapper, slides
       * horizontally with `open`. Closed → bottom-left; open → bottom-right.
       * Same chip in all viewports — no breakpoint logic. */}
      <div
        onMouseDown={start}
        onTouchStart={start}
        onKeyDown={onKey}
        role="button"
        tabIndex={0}
        aria-label={isOpen ? backLabel : frontLabel}
        style={{
          position: 'absolute',
          bottom: 18,
          left: chipLeft,
          cursor: 'grab',
          background: 'var(--c-ink)',
          color: 'var(--c-cream)',
          border: '2px solid var(--c-magenta)',
          padding: '12px 18px',
          fontFamily: 'var(--f-mono)',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.18em',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          transition: dragging
            ? 'none'
            : 'left 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          animation: !touched ? 'pp-tab-pulse 1.6s ease-in-out infinite' : undefined,
          zIndex: 10,
          touchAction: 'none',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            color: 'var(--c-magenta)',
            animation: !touched ? `${arrowKeyframe} 1.4s ease-in-out infinite` : undefined,
          }}
        >
          {arrow}
        </span>
        {isOpen ? backLabel : frontLabel}
      </div>
    </div>
  );
}
