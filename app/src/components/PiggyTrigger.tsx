/**
 * PiggyTrigger — line-drawn piggy bank that sits in the right column of
 * the §02 Book, after the gross-reserves total. Click breaks it open and
 * triggers the splash transition to The Yield.
 *
 * Visual: ink-stroke SVG (no fill except cream body), with a magenta
 * "PUSD+" label rendered INSIDE the pig's body. The whole illustration is
 * one self-contained unit so it flows naturally with the surrounding
 * layout — no absolute positioning, responsive by default.
 *
 * Interaction: cursor is hidden inside the trigger zone and replaced with
 * a small magenta dot that follows the mouse — same pattern as the
 * SloganBand torch, scaled to button size.
 */

import { useRef, useState, type MouseEvent } from 'react';

type Props = {
  onTrigger: (origin: { x: number; y: number }) => void;
};

export function PiggyTrigger({ onTrigger }: Props) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [breaking, setBreaking] = useState(false);

  function onMouseMove(e: MouseEvent<HTMLButtonElement>) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  }

  function onMouseLeave() {
    setPos(null);
  }

  function onClick(e: MouseEvent<HTMLButtonElement>) {
    if (breaking) return;
    setBreaking(true);
    const r = e.currentTarget.getBoundingClientRect();
    onTrigger({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }

  return (
    <button
      ref={ref}
      type="button"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      aria-label="Switch to The Yield"
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: pos ? 'none' : 'pointer',
        display: 'inline-block',
        position: 'relative',
        marginTop: 8,
      }}
    >
      <style>{`
        @keyframes piggy-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
        @keyframes piggy-tilt {
          0%   { transform: rotate(0) scale(1); opacity: 1; }
          25%  { transform: rotate(-12deg) scale(1.05); }
          60%  { transform: rotate(8deg) scale(0.95); opacity: 0.85; }
          100% { transform: rotate(20deg) scale(0.6); opacity: 0; }
        }
      `}</style>

      <span
        style={{
          display: 'inline-block',
          animation: breaking
            ? 'piggy-tilt 480ms cubic-bezier(0.4, 0, 0.6, 1) forwards'
            : 'piggy-bob 3.6s ease-in-out infinite',
          transformOrigin: 'center bottom',
        }}
      >
        <PiggySVG />
      </span>

      {/* Custom cursor dot — magenta, follows mouse inside the trigger. */}
      {pos && !breaking && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            width: 14,
            height: 14,
            transform: 'translate(-50%, -50%)',
            borderRadius: '999px',
            background: 'var(--c-magenta)',
            boxShadow: '0 0 0 2px var(--c-cream), 0 0 16px rgba(255, 61, 165, 0.45)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        />
      )}
    </button>
  );
}

function PiggySVG() {
  return (
    <svg
      width="124"
      height="84"
      viewBox="0 0 110 75"
      fill="none"
      stroke="var(--c-ink)"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
      aria-hidden
    >
      {/* Curly tail — drawn first so the body stacks over it. */}
      <path d="M 16 38 Q 8 36 8 42 Q 8 48 16 46" />

      {/* Body — compact pill, snout-end slightly taller for honest piggy
       * proportions. Cream fill so the magenta label reads cleanly. */}
      <path
        d="M 18 38
           Q 18 18 50 18
           Q 84 18 90 32
           Q 94 34 94 38
           Q 94 42 90 44
           Q 86 58 64 60
           L 30 60
           Q 16 58 16 44
           Q 16 40 18 38 Z"
        fill="var(--c-cream)"
      />

      {/* Snout — small ellipse with two nostril dots. */}
      <ellipse cx="92" cy="38" rx="5.5" ry="4.5" fill="var(--c-cream)" />
      <circle cx="90" cy="37" r="0.9" fill="var(--c-ink)" stroke="none" />
      <circle cx="94" cy="37" r="0.9" fill="var(--c-ink)" stroke="none" />

      {/* Eye. */}
      <circle cx="76" cy="30" r="1.4" fill="var(--c-ink)" stroke="none" />

      {/* Ear — small leaf shape. */}
      <path d="M 56 18 L 52 9 L 62 14 Z" fill="var(--c-cream)" />

      {/* Coin slot. */}
      <line x1="40" y1="22" x2="56" y2="22" strokeWidth={2.6} />

      {/* Front legs. */}
      <path d="M 64 60 L 64 68" />
      <path d="M 56 60 L 56 68" />
      {/* Back legs. */}
      <path d="M 32 60 L 32 68" />
      <path d="M 24 60 L 24 68" />

      {/* PUSD+ label tucked inside the body — magenta only, small enough
       * to clear the eye, slot, and snout. */}
      <text
        x="50"
        y="46"
        textAnchor="middle"
        fontFamily="var(--f-display)"
        fontSize="11"
        fontWeight={700}
        fill="var(--c-magenta)"
        stroke="none"
        letterSpacing="-0.4"
      >
        PUSD+
      </text>
    </svg>
  );
}
