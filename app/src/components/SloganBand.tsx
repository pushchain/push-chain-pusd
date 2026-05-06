/**
 * SloganBand — italic editorial strip beneath the ticker.
 *
 *   Boring is the feature. · Unit of settlement, not speculation. · …
 *
 * Now dual-channel:
 *
 *   - Default channel: PUSD slogans (par-backed brand voice).
 *   - Reveal channel:  PUSD+ slogans (yield brand voice), painted on a
 *                      magenta layer.
 *
 * Desktop: a soft magenta "torch" follows the cursor across the band. Wherever
 *          the torch lights up, the PUSD+ slogans replace the PUSD ones via
 *          a clip-path circle. Costs nothing once cursor leaves.
 *
 * Mobile / touch: an IntersectionObserver watches the band; once it scrolls
 *                 fully into view the whole band briefly tints magenta and
 *                 swaps to the PUSD+ slogans for ~1.6s before settling back.
 *                 Tapping the band re-triggers the reveal manually.
 */

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const PUSD_SLOGANS: readonly string[] = [
  'Boring is the feature.',
  'Unit of settlement, not speculation.',
  'Backed, not printed.',
  'Universally Available.',
];

const PLUS_SLOGANS: readonly string[] = [
  'Yield is the feature.',
  'Grows per share, monotonic.',
  'Harvested from real LPs.',
  'Safest yield.',
];

const TORCH_RADIUS = 240; // px — full radius of the magenta clip on desktop
const TORCH_GROW_MS = 320; // grow-from-zero duration on first cursor entry

type Pos = { x: number; y: number };

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function SloganBand() {
  const ref = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [radius, setRadius] = useState(0); // grows from 0 → TORCH_RADIUS on entry
  const [skipTransition, setSkipTransition] = useState(false);
  const [touchActive, setTouchActive] = useState(false);
  const [isCoarse, setIsCoarse] = useState(false);

  useEffect(() => {
    setIsCoarse(isCoarsePointer());
  }, []);

  // Desktop: track the cursor and animate the torch radius from 0 → full
  // on first entry so the magenta circle visibly *grows out of* the
  // mouse point instead of materialising at full size.
  //
  // Sequence:
  //   1. mouseenter: snap clip-path centre to cursor at radius=0 with
  //      transition disabled (so we don't slide-and-grow from the off-screen
  //      anchor that was last rendered).
  //   2. one frame later: re-enable the transition and bump radius to full —
  //      the circle expands in place out of the cursor.
  function onMouseEnter(e: React.MouseEvent<HTMLElement>) {
    if (isCoarse) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // flushSync forces React to commit the snapped (transition: none) state
    // *before* the next paint, so the subsequent radius change actually
    // animates from 0 → full at the cursor instead of from the previous
    // off-screen anchor.
    flushSync(() => {
      setSkipTransition(true);
      setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      setRadius(0);
    });
    requestAnimationFrame(() => {
      setSkipTransition(false);
      setRadius(TORCH_RADIUS);
    });
  }
  function onMouseMove(e: React.MouseEvent<HTMLElement>) {
    if (isCoarse) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (radius === 0 && !skipTransition) {
      requestAnimationFrame(() => setRadius(TORCH_RADIUS));
    }
  }
  function onMouseLeave() {
    // Shrink the torch back to 0 at the last cursor position before clearing.
    setRadius(0);
    window.setTimeout(() => setPos(null), TORCH_GROW_MS);
  }

  // Mobile / coarse pointer: trigger reveal once when scrolled into view, and
  // again on tap. The reveal lasts ~1.6s before the band returns to PUSD.
  useEffect(() => {
    if (!isCoarse || !ref.current) return;
    let timer: number | null = null;
    const trigger = () => {
      setTouchActive(true);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setTouchActive(false), 1600);
    };
    // Lower threshold + only fire once per scroll-into-view so we don't
    // re-trigger on micro-scrolls. Trigger again only after the band has
    // fully left the viewport.
    let armed = true;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.4 && armed) {
            armed = false;
            trigger();
          }
          if (!entry.isIntersecting) armed = true;
        }
      },
      { threshold: [0, 0.4, 0.7, 1] },
    );
    obs.observe(ref.current);
    const el = ref.current;
    el.addEventListener('touchstart', trigger, { passive: true });
    return () => {
      obs.disconnect();
      el.removeEventListener('touchstart', trigger);
      if (timer) window.clearTimeout(timer);
    };
  }, [isCoarse]);

  // The PUSD+ overlay's clip-path. Desktop: a circle whose RADIUS animates
  // from 0 to TORCH_RADIUS, anchored at the last known cursor position so
  // the torch grows out of the cursor itself. Mobile: flooded when active.
  const clip =
    isCoarse
      ? touchActive
        ? 'inset(0 0 0 0)'
        : 'inset(0 100% 0 0)'
      : pos
        ? `circle(${radius}px at ${pos.x}px ${pos.y}px)`
        : 'circle(0 at -200px -200px)';

  // Tooltip is visible only when the torch has actually grown — avoids a
  // ghost label flickering at the edge as the cursor leaves.
  const tooltipVisible = !!pos && radius > TORCH_RADIUS / 3;

  return (
    <section
      ref={ref}
      className="slogan-band"
      aria-label="Product principles"
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={() => {
        if (!isCoarse) return;
        setTouchActive(true);
        window.setTimeout(() => setTouchActive(false), 1800);
      }}
      style={{
        position: 'relative',
        cursor: !isCoarse && pos ? 'none' : 'default',
      }}
    >
      {/* PUSD slogans — default channel. */}
      <div
        className="container slogan-band__inner"
        style={{ position: 'relative', zIndex: 1 }}
      >
        {PUSD_SLOGANS.map((s) => (
          <span key={s} className="slogan-band__item">
            {s}
          </span>
        ))}
      </div>

      {/* PUSD+ slogans — reveal channel. The whole layer (including its own
       * solid magenta fill) is clipped to the cursor torch (desktop) or
       * flooded across the band (mobile). The fill is opaque, so PUSD beneath
       * is completely hidden wherever the torch falls. */}
      <div
        aria-hidden={!pos && !touchActive}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          clipPath: clip,
          WebkitClipPath: clip,
          transition: skipTransition
            ? 'none'
            : isCoarse
              ? `clip-path ${TORCH_GROW_MS}ms ease-out, -webkit-clip-path ${TORCH_GROW_MS}ms ease-out`
              : `clip-path ${TORCH_GROW_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), -webkit-clip-path ${TORCH_GROW_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
          zIndex: 2,
          background: 'var(--c-magenta)',
          color: 'var(--c-cream)',
        }}
      >
        <div
          className="container slogan-band__inner slogan-band__inner--plus"
          style={{ color: 'var(--c-cream)', position: 'relative' }}
        >
          {PLUS_SLOGANS.map((s) => (
            <span key={s} className="slogan-band__item" style={{ color: 'var(--c-cream)' }}>
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Custom cursor + PUSD+ tooltip. Replaces the default pointer with a
       * small magenta ring and an attached PUSD+ pill so the user
       * understands what the torch is revealing. */}
      {!isCoarse && pos && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 5,
            opacity: tooltipVisible ? 1 : 0,
            transition: 'opacity 200ms ease-out',
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              border: '2px solid var(--c-cream)',
              borderRadius: '50%',
              boxShadow: '0 0 0 1px var(--c-magenta)',
              background: 'transparent',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 18,
              top: -2,
              background: 'var(--c-ink)',
              color: 'var(--c-cream)',
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.18em',
              padding: '4px 8px',
              border: '1px solid var(--c-magenta)',
              whiteSpace: 'nowrap',
            }}
          >
            PUSD+
          </div>
        </div>
      )}
    </section>
  );
}
