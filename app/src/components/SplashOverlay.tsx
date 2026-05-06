/**
 * SplashOverlay — coin-shower transition between The Book and The Yield.
 *
 * No background wash — the coins themselves are the visual. They're drawn
 * as isometric line-art (ink stroke on cream fill, edge grooves to suggest
 * thickness), grow ~3.5× as they travel, and number enough (40) to read
 * as occupying the whole viewport at peak burst.
 *
 * Two directions:
 *   'out' — coins emit FROM origin and scatter past the viewport edges.
 *           Used when the piggy bank breaks open.
 *   'in'  — coins start past the viewport edges at full size and shrink
 *           into origin. Used when the open chest collects them back.
 *
 * Lifecycle (driven by CSS keyframes; no transition on the wrapper):
 *    0  — coins begin trajectory at small scale (or large for 'in')
 *  650  — peak coverage; parent should swap view here so the swap is
 *         visually masked by the densest coin layer
 * 1300  — fully done; parent unmounts the overlay
 */

import { useEffect } from 'react';

type Direction = 'out' | 'in';

type Props = {
  origin: { x: number; y: number };
  direction: Direction;
  onPeak: () => void;
  onDone: () => void;
};

const COIN_COUNT = 40;
const COIN_SIZE = 64; // px — base size; CSS scale animates 0.35 → 2.0
const COIN_DURATION = 1600; // ms — flight time per coin
const PEAK_AT = 720; // ~45% of flight; densest coin layer covers the swap
const DONE_AT = 1900; // overlay unmounts shortly after the last coin fades

export function SplashOverlay({ origin, direction, onPeak, onDone }: Props) {
  useEffect(() => {
    const peakT = window.setTimeout(() => onPeak(), PEAK_AT);
    const doneT = window.setTimeout(() => onDone(), DONE_AT);
    return () => {
      window.clearTimeout(peakT);
      window.clearTimeout(doneT);
    };
  }, [onPeak, onDone]);

  // Each coin gets a deterministic trajectory: even angle distribution with
  // a small jitter so the burst doesn't read as a perfect star pattern.
  // Distance is tuned so coins clearly clear the viewport at end-state, even
  // when the trigger sits near a corner.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const maxDist = Math.hypot(vw, vh);

  const coins = Array.from({ length: COIN_COUNT }, (_, i) => {
    const baseAngle = (i / COIN_COUNT) * Math.PI * 2;
    const jitter = ((i * 41) % 100) / 100 - 0.5; // -0.5..0.5
    const angle = baseAngle + jitter * 0.45;
    // Layered radii so coins occupy more of the screen (mid + far rings).
    const ringMul = i % 3 === 0 ? 0.7 : i % 3 === 1 ? 0.95 : 1.15;
    const dist = maxDist * ringMul;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 60; // slight upward bias
    const rot = (i % 2 === 0 ? 1 : -1) * (240 + (i * 31) % 280);
    const delay = (i % 6) * 14;
    return { i, dx, dy, rot, delay };
  });

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
        @keyframes splash-coin-in {
          0%   { transform: translate(var(--coin-dx), var(--coin-dy)) scale(2.0) rotate(var(--coin-rot)); opacity: 0; }
          15%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translate(0, 0) scale(0.35) rotate(0deg); opacity: 0; }
        }
      `}</style>

      {/* Anchor div lives at the trigger origin; coins position themselves
       * relative to it via negative offsets so transform: translate(dx, dy)
       * keeps the coin's center on its trajectory throughout the animation. */}
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
                animation:
                  direction === 'out'
                    ? `splash-coin-out ${COIN_DURATION}ms ${c.delay}ms cubic-bezier(0.18, 0.74, 0.4, 1) forwards`
                    : `splash-coin-in ${COIN_DURATION}ms ${c.delay}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`,
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
    </div>
  );
}

/**
 * Isometric coin in line-art style. Tilted-forward face ellipse on top, a
 * curved underside arc to suggest depth, and short vertical groove marks
 * along the edge. Strokes are ink on a cream fill so the coin reads as
 * editorial pen-and-ink rather than a UI chip.
 */
function CoinSVG() {
  // 16 groove marks distributed along the visible underside arc. Each
  // groove sits a hair shorter near the edges so the curvature reads
  // honestly as the coin's rim falling away into perspective.
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
      {/* Underside — closes the bottom half of the rim so the coin reads
       * as a 3D object rather than a flat sticker. Cream fill so the
       * grooves and inner detail render against a solid base. */}
      <path
        d="M 10 50 Q 10 65, 28 67 L 72 67 Q 90 65, 90 50"
        fill="var(--c-cream)"
        stroke="var(--c-ink)"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Edge grooves — vertical hash marks tracing the visible bottom rim.
       * 14 marks at varying length give the coin a milled-edge texture. */}
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

      {/* Top face — visible side of the coin, tilted forward. */}
      <ellipse
        cx="50"
        cy="50"
        rx="40"
        ry="14"
        fill="var(--c-cream)"
        stroke="var(--c-ink)"
        strokeWidth={1.7}
      />

      {/* Subtle bevel — second ellipse just inside the rim for depth. */}
      <ellipse
        cx="50"
        cy="50"
        rx="36"
        ry="12"
        fill="none"
        stroke="var(--c-ink)"
        strokeWidth={0.9}
      />

      {/* Inner ring framing the glyph. */}
      <ellipse
        cx="50"
        cy="50"
        rx="22"
        ry="7.5"
        fill="none"
        stroke="var(--c-ink)"
        strokeWidth={0.8}
      />

      {/* Dollar glyph in magenta, centered on the face. */}
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
