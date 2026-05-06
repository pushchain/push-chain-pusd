/**
 * ChestTrigger — line-drawn open treasure chest in the right column of
 * The Yield, after the NAV total. Click triggers the splash transition
 * back to The Book — coins fly INTO the chest as it closes.
 *
 * Mirror of PiggyTrigger: ink-stroke SVG, magenta "PUSD" label rendered
 * INSIDE the chest body. One self-contained unit, no absolute positioning,
 * responsive by default.
 */

import { useRef, useState, type MouseEvent } from 'react';

type Props = {
  onTrigger: (origin: { x: number; y: number }) => void;
};

export function ChestTrigger({ onTrigger }: Props) {
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
      aria-label="Switch to The Book"
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
        @keyframes chest-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
        @keyframes chest-burst {
          0%   { transform: rotate(0) scale(1); opacity: 1; }
          30%  { transform: rotate(-6deg) scale(1.06); }
          65%  { transform: rotate(10deg) scale(0.92); opacity: 0.85; }
          100% { transform: rotate(-14deg) scale(0.55); opacity: 0; }
        }
      `}</style>

      <span
        style={{
          display: 'inline-block',
          animation: breaking
            ? 'chest-burst 480ms cubic-bezier(0.4, 0, 0.6, 1) forwards'
            : 'chest-bob 3.6s ease-in-out infinite',
          transformOrigin: 'center bottom',
        }}
      >
        <ChestSVG />
      </span>

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

function ChestSVG() {
  return (
    <svg
      width="124"
      height="92"
      viewBox="0 0 110 80"
      fill="none"
      stroke="var(--c-ink)"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
      aria-hidden
    >
      {/* Open lid — back leaning, hinged at the body's top edge. Dashed
       * line traces the lid's inside front edge for depth. */}
      <path d="M 22 42 L 18 16 Q 55 4 92 16 L 88 42" fill="var(--c-cream)" />
      <path d="M 18 16 Q 55 28 92 16" strokeDasharray="2 3" strokeWidth={1.2} />

      {/* Lock plate on the now-up-facing front of the lid. */}
      <rect x="50" y="20" width="10" height="6" />
      <circle cx="55" cy="23" r="1" fill="var(--c-magenta)" stroke="none" />

      {/* Chest body — the box itself. */}
      <rect x="22" y="42" width="66" height="32" rx="2" fill="var(--c-cream)" />

      {/* Vertical bands. */}
      <line x1="34" y1="42" x2="34" y2="74" />
      <line x1="76" y1="42" x2="76" y2="74" />

      {/* Coins peeking over the body's top edge — chest is full. */}
      <ellipse cx="42" cy="42" rx="4" ry="2" fill="var(--c-cream)" />
      <ellipse cx="55" cy="40" rx="5" ry="2.5" fill="var(--c-cream)" />
      <ellipse cx="68" cy="42" rx="4" ry="2" fill="var(--c-cream)" />

      {/* PUSD label tucked inside the body — magenta only. */}
      <text
        x="55"
        y="62"
        textAnchor="middle"
        fontFamily="var(--f-display)"
        fontSize="11"
        fontWeight={700}
        fill="var(--c-magenta)"
        stroke="none"
        letterSpacing="-0.4"
      >
        PUSD
      </text>
    </svg>
  );
}
