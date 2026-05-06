/**
 * SplashOverlay — §02 view-swap transition.
 *
 * Two visual modes, branched on `direction`:
 *
 *   'out' — coin shower. ~40 isometric line-art coins emit from the piggy
 *           origin, scale 3.5×, scatter past the viewport edges. Used when
 *           the piggy bank breaks open and we're going from The Book to
 *           The Yield.
 *
 *   'in'  — sparkle field. ~36 four-pointed cream sparkles with magenta
 *           borders pop into existence at random viewport positions and
 *           fade back out. Used when the open chest is clicked and we're
 *           going from The Yield back to The Book — feels like the page
 *           settling into focus rather than coins flying back home.
 *
 * Lifecycle (driven by CSS keyframes; no transition on the wrapper):
 *    0  — first cohort begins
 *  520  — peak coverage; parent should swap view here so the dense layer
 *         (coins or sparkles) masks the swap
 * 1900  — fully done; parent unmounts the overlay
 */

import { useEffect, useMemo } from 'react';

type Direction = 'out' | 'in';

type Props = {
  origin: { x: number; y: number };
  direction: Direction;
  onPeak: () => void;
  onDone: () => void;
};

const COIN_COUNT = 40;
const COIN_SIZE = 64;
const COIN_DURATION = 1600;
const SPARKLE_COUNT = 44;
const SPARKLE_SIZE = 30; // px on average; varies ±35%
const SPARKLE_DURATION = 1300; // ms per pop — Lottie-twinkle feel
// Swap fires earlier so the destination view starts revealing while the
// shower is still mid-flight. Reads as immersive — the new content is
// born inside the burst rather than waiting for it to clear.
const PEAK_AT = 520;
const DONE_AT = 1900;

export function SplashOverlay({ origin, direction, onPeak, onDone }: Props) {
  useEffect(() => {
    const peakT = window.setTimeout(() => onPeak(), PEAK_AT);
    const doneT = window.setTimeout(() => onDone(), DONE_AT);
    return () => {
      window.clearTimeout(peakT);
      window.clearTimeout(doneT);
    };
  }, [onPeak, onDone]);

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        pointerEvents: 'none',
        background: 'transparent',
      }}
    >
      <style>{`
        @keyframes splash-coin-out {
          0%   { transform: translate(0, 0) scale(0.35) rotate(0deg); opacity: 0; }
          10%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translate(var(--coin-dx), var(--coin-dy)) scale(2.0) rotate(var(--coin-rot)); opacity: 0; }
        }
        /* Lottie-style twinkle: pop in with overshoot, rotate through, drift
         * upward as it fades. Combined with the dual-axis sparkle SVG (two
         * 4-point stars rotated 45° to each other) it reads as an 8-ray
         * burst that twinkles open and dissolves. */
        @keyframes splash-sparkle {
          0%   { transform: translate(-50%, -50%) translateY(6px) scale(0)    rotate(-30deg); opacity: 0; }
          18%  { transform: translate(-50%, -50%) translateY(0)    scale(1.18) rotate(40deg);  opacity: 1; }
          45%  { transform: translate(-50%, -50%) translateY(-3px) scale(0.92) rotate(120deg); opacity: 1; }
          72%  { transform: translate(-50%, -50%) translateY(-8px) scale(1.05) rotate(180deg); opacity: 0.9; }
          100% { transform: translate(-50%, -50%) translateY(-16px) scale(0.2) rotate(240deg); opacity: 0; }
        }
      `}</style>

      {direction === 'out' ? <Coins origin={origin} /> : <Sparkles />}
    </div>
  );
}

/** Coin shower — emits from origin, scatters outward. */
function Coins({ origin }: { origin: { x: number; y: number } }) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const maxDist = Math.hypot(vw, vh);

  const coins = Array.from({ length: COIN_COUNT }, (_, i) => {
    const baseAngle = (i / COIN_COUNT) * Math.PI * 2;
    const jitter = ((i * 41) % 100) / 100 - 0.5;
    const angle = baseAngle + jitter * 0.45;
    const ringMul = i % 3 === 0 ? 0.7 : i % 3 === 1 ? 0.95 : 1.15;
    const dist = maxDist * ringMul;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 60;
    const rot = (i % 2 === 0 ? 1 : -1) * (240 + (i * 31) % 280);
    const delay = (i % 6) * 14;
    return { i, dx, dy, rot, delay };
  });

  return (
    <div
      style={{
        position: 'fixed',
        left: origin.x,
        top: origin.y,
        width: 0,
        height: 0,
        zIndex: 9001,
      }}
    >
      {coins.map((c) => (
        <span
          key={c.i}
          style={
            {
              position: 'absolute',
              top: -COIN_SIZE / 2,
              left: -COIN_SIZE / 2,
              width: COIN_SIZE,
              height: COIN_SIZE,
              animation: `splash-coin-out ${COIN_DURATION}ms ${c.delay}ms cubic-bezier(0.18, 0.74, 0.4, 1) forwards`,
              '--coin-dx': `${c.dx}px`,
              '--coin-dy': `${c.dy}px`,
              '--coin-rot': `${c.rot}deg`,
              willChange: 'transform, opacity',
            } as React.CSSProperties
          }
        >
          <CoinSVG />
        </span>
      ))}
    </div>
  );
}

/**
 * Sparkle field — random four-pointed sparkles pop in across the entire
 * viewport. Cream fill, magenta stroke. Each twinkles independently with
 * a staggered delay so the field reads as ambient rather than scripted.
 */
function Sparkles() {
  // Each sparkle's position, size, and start time is randomized per overlay
  // mount via Math.random. The overlay only mounts once per chest click and
  // is gone before the next click, so the values are stable for the
  // animation but fresh on every transition (no diagonal patterning from
  // sequential-index LCGs).
  //
  // ~30% of the sparkles are deliberately oversized (1.5–2.2× the base) so
  // the field has obvious depth — a few statement sparkles among many
  // smaller ones, rather than a uniform field.
  const sparkles = useMemo(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const margin = 16;
    return Array.from({ length: SPARKLE_COUNT }, (_, i) => {
      const x = margin + Math.random() * (vw - margin * 2);
      const y = margin + Math.random() * (vh - margin * 2);
      const big = Math.random() < 0.3;
      const scale = big
        ? 1.5 + Math.random() * 0.7   // hero sparkles: 1.5..2.2
        : 0.55 + Math.random() * 0.75; // ambient: 0.55..1.3
      const delay = Math.random() * 850; // 0..850ms uncorrelated stagger
      return { i, x, y, size: SPARKLE_SIZE * scale, delay };
    });
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9001 }}>
      {sparkles.map((s) => (
        <span
          key={s.i}
          style={{
            position: 'absolute',
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            transform: 'translate(-50%, -50%)',
            animation: `splash-sparkle ${SPARKLE_DURATION}ms ${s.delay}ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards`,
            willChange: 'transform, opacity',
          }}
        >
          <SparkleSVG />
        </span>
      ))}
    </div>
  );
}

/**
 * Lottie-style 4-point sparkle with concave edges — the classic twinkle
 * shape. Each edge between two adjacent points is a quadratic Bezier
 * pulled toward the center, so the rays read as long pointed petals
 * meeting at a tight center pinch. Cream fill, magenta border.
 */
function SparkleSVG() {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
    >
      <path
        d="M 12 0
           Q 12 12, 24 12
           Q 12 12, 12 24
           Q 12 12, 0 12
           Q 12 12, 12 0 Z"
        fill="var(--c-cream)"
        stroke="var(--c-magenta)"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Isometric coin in line-art style. Tilted-forward face ellipse on top, a
 * curved underside arc to suggest depth, and short vertical groove marks
 * along the edge. Strokes are ink on a cream fill so the coin reads as
 * editorial pen-and-ink rather than a UI chip.
 */
function CoinSVG() {
  const grooves = [
    { x: 14, top: 56, bot: 60 },
    { x: 19, top: 58.5, bot: 63 },
    { x: 24, top: 60, bot: 65 },
    { x: 29, top: 61, bot: 66 },
    { x: 34, top: 62, bot: 66.6 },
    { x: 40, top: 62.5, bot: 67 },
    { x: 46, top: 63, bot: 67.2 },
    { x: 52, top: 63, bot: 67.2 },
    { x: 58, top: 62.8, bot: 67 },
    { x: 64, top: 62.3, bot: 66.7 },
    { x: 70, top: 61.5, bot: 66 },
    { x: 76, top: 60.5, bot: 65 },
    { x: 81, top: 59, bot: 63.5 },
    { x: 86, top: 57, bot: 60.5 },
  ];

  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <path
        d="M 10 50 Q 10 65, 28 67 L 72 67 Q 90 65, 90 50"
        fill="var(--c-cream)"
        stroke="var(--c-ink)"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {grooves.map((g) => (
        <line
          key={g.x}
          x1={g.x}
          y1={g.top}
          x2={g.x}
          y2={g.bot}
          stroke="var(--c-ink)"
          strokeWidth={1.2}
          strokeLinecap="round"
        />
      ))}
      <ellipse
        cx="50"
        cy="50"
        rx="40"
        ry="14"
        fill="var(--c-cream)"
        stroke="var(--c-ink)"
        strokeWidth={1.7}
      />
      <ellipse
        cx="50"
        cy="50"
        rx="36"
        ry="12"
        fill="none"
        stroke="var(--c-ink)"
        strokeWidth={0.9}
      />
      <ellipse
        cx="50"
        cy="50"
        rx="22"
        ry="7.5"
        fill="none"
        stroke="var(--c-ink)"
        strokeWidth={0.8}
      />
      <text
        x="50"
        y="57"
        textAnchor="middle"
        fontFamily="var(--f-display)"
        fontSize="22"
        fontWeight={700}
        fill="var(--c-magenta)"
        stroke="none"
      >
        $
      </text>
    </svg>
  );
}
