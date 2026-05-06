/**
 * AnimationPreviewPage — /preview/animations
 *
 * Throwaway internal page. Four curtain/edge-drag variants — every one
 * fully hides one product and fully reveals the other. Pick the variant
 * that lands and we promote it; the rest get deleted.
 *
 * NOT linked from the masthead — direct URL only.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

const PUSD = {
  title: 'Every PUSD is a dollar.',
  tag: 'PAR · 1:1',
  accent: 'var(--c-ink)',
  items: [
    ['01', 'Mint is 1:1.', 'Deposit USDC or USDT from any chain. Bridge, approve, and deposit collapse into one universal tx.'],
    ['02', 'Redemption is redemption.', 'Burn PUSD, take a reserve at par. Basket fallback ensures the protocol always redeems.'],
    ['03', 'The book is on-chain.', 'Every token, balance, and status is a contract read. The collateral ratio refreshes live.'],
  ],
} as const;

const PLUS = {
  title: 'Every PUSD+ grows.',
  tag: 'YIELD · NAV',
  accent: 'var(--c-magenta)',
  items: [
    ['01', 'NAV per share, monotonic.', 'Each rebalance harvests Uniswap V3 stable pair fees and re-prices PUSD+ upward.'],
    ['02', 'Tier-cascaded redeem.', 'Burn at NAV. Walk three tiers: instant, basket, FIFO queue. Always a real reserve token.'],
    ['03', 'Permissionless rebalance.', 'Anyone calls rebalance() once the cooldown elapses. A keeper outage does not pause harvest.'],
  ],
} as const;

type Product = typeof PUSD | typeof PLUS;

export default function AnimationPreviewPage() {
  return (
    <>
      <section className="hero hero--compact">
        <div className="container">
          <div className="hero__kicker">
            <span style={{ color: 'var(--c-magenta)' }}>§ ANIMATION PREVIEW · INTERNAL</span>
            <span>FOUR CURTAIN VARIANTS</span>
          </div>
          <h1 className="hero__title" style={{ fontSize: 'clamp(40px, 5vw, 64px)' }}>
            Drag for <em>PUSD+</em>.
          </h1>
          <p className="hero__lead" style={{ maxWidth: '72ch' }}>
            Every variant has a prominent <em>DRAG FOR PUSD+</em> affordance.
            Try the right edge, the top edge, the floating chip, and the
            two-handed split. Pull, release, repeat.
          </p>
        </div>
      </section>

      <div className="container" style={{ paddingTop: 32, paddingBottom: 64 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 32,
          }}
        >
          <Card
            label="A · CURTAIN · BIG MAGENTA TAB"
            blurb="The right-edge handle is a full-height magenta pillar with bold DRAG FOR PUSD+ text. Pulsing arrows hint at motion. Past 30% open snaps fully across."
          >
            <Curtain />
          </Card>

          <Card
            label="B · TOP CURTAIN · PULL DOWN"
            blurb="Drag down from the top edge like a window shade. PUSD slides down out of view; PUSD+ is revealed below. The handle has a notched grip and the same prominent label."
          >
            <TopCurtain />
          </Card>

          <Card
            label="C · FLOATING TAB · BOTTOM-LEFT"
            blurb="A magnetic chip floats at the bottom-left, always visible. Drag it across to reveal PUSD+. Once dropped on the other side it stays there. The chip itself reads the current target."
          >
            <FloatingTab />
          </Card>

          <Card
            label="D · TWO-HANDED · SPLIT FROM CENTER"
            blurb="A vertical seam runs down the middle. Drag either half outward and the seam splits, revealing the other product underneath. Snaps to fully closed or fully open."
          >
            <CenterSplit />
          </Card>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Layout primitives
// ============================================================================

function Card({ label, blurb, children }: { label: string; blurb: string; children: ReactNode }) {
  return (
    <div
      style={{
        border: 'var(--rule-thin)',
        background: 'var(--c-paper)',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        minHeight: 560,
      }}
    >
      <div>
        <div
          className="mono"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            color: 'var(--c-magenta)',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--c-ink-dim)', margin: '6px 0 0' }}>
          {blurb}
        </p>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function PromiseSheet({ product }: { product: Product }) {
  return (
    <div style={{ padding: '20px 22px', height: '100%', overflow: 'hidden' }}>
      <div
        className="mono"
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.18em',
          color: 'var(--c-ink-mute)',
        }}
      >
        {product.tag}
      </div>
      <h3
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 26,
          fontWeight: 500,
          margin: '8px 0 18px',
          letterSpacing: '-0.01em',
        }}
      >
        {product.title.split(/(PUSD\+?)/).map((seg, i) =>
          seg === 'PUSD' || seg === 'PUSD+' ? (
            <em key={i} style={{ color: product.accent, fontStyle: 'italic' }}>
              {seg}
            </em>
          ) : (
            <span key={i}>{seg}</span>
          ),
        )}
      </h3>
      {product.items.map(([n, t, b]) => (
        <div
          key={n}
          style={{
            display: 'grid',
            gridTemplateColumns: '36px 1fr',
            gap: 14,
            padding: '12px 0',
            borderBottom: '1px solid var(--c-ink-mute)',
          }}
        >
          <div style={{ fontFamily: 'var(--f-mono)', color: product.accent, fontSize: 14 }}>
            {n}
          </div>
          <div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 15, fontWeight: 500 }}>
              {t}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--c-ink-dim)', marginTop: 4 }}>
              {b}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Reusable hint pulse — appears on the affordance when no drag has happened yet.
const PULSE_KEYFRAMES = `
  @keyframes pp-arrow-pulse {
    0%, 100% { transform: translateX(0); opacity: 0.7; }
    50%      { transform: translateX(-4px); opacity: 1; }
  }
  @keyframes pp-arrow-pulse-y {
    0%, 100% { transform: translateY(0); opacity: 0.7; }
    50%      { transform: translateY(4px); opacity: 1; }
  }
  @keyframes pp-tab-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 61, 165, 0.55); }
    50%      { box-shadow: 0 0 0 8px rgba(255, 61, 165, 0); }
  }
`;

// ============================================================================
// A · CURTAIN · BIG MAGENTA TAB
// ============================================================================

function Curtain() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const ratio = 1 - (e.clientX - r.left) / r.width;
      setOpen(Math.max(0, Math.min(1, ratio)));
    };
    const onUp = () => {
      setDragging(false);
      setOpen((o) => (o > 0.3 ? 1 : 0));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        height: '100%',
        background: 'var(--c-paper)',
        userSelect: dragging ? 'none' : 'auto',
      }}
    >
      <style>{PULSE_KEYFRAMES}</style>
      <div style={{ position: 'absolute', inset: 0 }}>
        <PromiseSheet product={PLUS} />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--c-paper)',
          borderRight: '3px solid var(--c-magenta)',
          transform: `translateX(${-open * 100}%)`,
          transition: dragging ? 'none' : 'transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <PromiseSheet product={PUSD} />
      </div>

      {/* Big magenta drag tab */}
      <div
        onMouseDown={() => {
          setDragging(true);
          setTouched(true);
        }}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `calc(${(1 - open) * 100}% - 30px)`,
          width: 60,
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: dragging ? 'none' : 'left 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          zIndex: 10,
        }}
      >
        <div
          style={{
            background: 'var(--c-magenta)',
            color: 'var(--c-cream)',
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            padding: '24px 8px',
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            border: '2px solid var(--c-ink)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            animation: !touched ? 'pp-tab-pulse 1.6s ease-in-out infinite' : undefined,
          }}
        >
          <span
            style={{
              animation: !touched ? 'pp-arrow-pulse 1.4s ease-in-out infinite' : undefined,
            }}
          >
            ←
          </span>
          {open > 0.5 ? 'DRAG FOR PUSD' : 'DRAG FOR PUSD+'}
          <span
            style={{
              animation: !touched ? 'pp-arrow-pulse 1.4s ease-in-out infinite 0.7s' : undefined,
            }}
          >
            ←
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// B · TOP CURTAIN · PULL DOWN
// ============================================================================

function TopCurtain() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const ratio = (e.clientY - r.top) / r.height;
      setOpen(Math.max(0, Math.min(1, ratio)));
    };
    const onUp = () => {
      setDragging(false);
      setOpen((o) => (o > 0.3 ? 1 : 0));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        height: '100%',
        background: 'var(--c-paper)',
        userSelect: dragging ? 'none' : 'auto',
      }}
    >
      <style>{PULSE_KEYFRAMES}</style>
      <div style={{ position: 'absolute', inset: 0 }}>
        <PromiseSheet product={PLUS} />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--c-paper)',
          borderBottom: '3px solid var(--c-magenta)',
          transform: `translateY(${-open * 100}%)`,
          transition: dragging ? 'none' : 'transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <PromiseSheet product={PUSD} />
      </div>

      {/* Top notched handle */}
      <div
        onMouseDown={() => {
          setDragging(true);
          setTouched(true);
        }}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: `calc(${open * 100}% - 26px)`,
          height: 52,
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: dragging ? 'none' : 'top 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          zIndex: 10,
        }}
      >
        <div
          style={{
            background: 'var(--c-magenta)',
            color: 'var(--c-cream)',
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.2em',
            padding: '10px 24px',
            border: '2px solid var(--c-ink)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            animation: !touched ? 'pp-tab-pulse 1.6s ease-in-out infinite' : undefined,
          }}
        >
          <span
            style={{
              fontSize: 16,
              animation: !touched ? 'pp-arrow-pulse-y 1.4s ease-in-out infinite' : undefined,
            }}
          >
            ↓
          </span>
          {open > 0.5 ? 'DRAG UP FOR PUSD' : 'DRAG DOWN FOR PUSD+'}
          <span
            style={{
              fontSize: 16,
              animation: !touched ? 'pp-arrow-pulse-y 1.4s ease-in-out infinite 0.7s' : undefined,
            }}
          >
            ↓
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// C · FLOATING TAB · BOTTOM-LEFT
// ============================================================================

function FloatingTab() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<'pusd' | 'plus'>('pusd');
  const [chipX, setChipX] = useState(0); // 0 = left, 1 = right
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const x = (e.clientX - r.left - 80) / (r.width - 160);
      setChipX(Math.max(0, Math.min(1, x)));
    };
    const onUp = () => {
      setDragging(false);
      setChipX((x) => {
        const dest = x > 0.5 ? 1 : 0;
        setSide(dest === 1 ? 'plus' : 'pusd');
        return dest;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  // Reveal mask: a curtain that follows the chip horizontally.
  const reveal = side === 'pusd' ? chipX : 1 - chipX;

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        height: '100%',
        background: 'var(--c-paper)',
        userSelect: dragging ? 'none' : 'auto',
      }}
    >
      <style>{PULSE_KEYFRAMES}</style>
      <div style={{ position: 'absolute', inset: 0 }}>
        <PromiseSheet product={side === 'pusd' ? PLUS : PUSD} />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--c-paper)',
          borderRight: '3px solid var(--c-magenta)',
          transform: `translateX(${-reveal * 100}%)`,
          transition: dragging ? 'none' : 'transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <PromiseSheet product={side === 'pusd' ? PUSD : PLUS} />
      </div>

      {/* Floating chip */}
      <div
        onMouseDown={() => {
          setDragging(true);
          setTouched(true);
        }}
        style={{
          position: 'absolute',
          bottom: 18,
          left: `calc(${chipX * 100}% + ${chipX * -80}px + 18px)`,
          cursor: 'grab',
          background: 'var(--c-ink)',
          color: 'var(--c-cream)',
          padding: '12px 18px',
          fontFamily: 'var(--f-mono)',
          fontSize: 12,
          letterSpacing: '0.18em',
          fontWeight: 700,
          border: '2px solid var(--c-magenta)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          transition: dragging ? 'none' : 'left 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          animation: !touched ? 'pp-tab-pulse 1.6s ease-in-out infinite' : undefined,
          zIndex: 10,
        }}
      >
        <span
          style={{
            color: 'var(--c-magenta)',
            animation: !touched ? 'pp-arrow-pulse 1.4s ease-in-out infinite' : undefined,
          }}
        >
          {side === 'pusd' ? '→' : '←'}
        </span>
        DRAG FOR {side === 'pusd' ? 'PUSD+' : 'PUSD'}
      </div>
    </div>
  );
}

// ============================================================================
// D · TWO-HANDED · SPLIT FROM CENTER
// ============================================================================

function CenterSplit() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(0); // 0 = closed (PUSD), 1 = fully split (PUSD+)
  const [dragging, setDragging] = useState<null | 'left' | 'right'>(null);
  const [touched, setTouched] = useState(false);
  const startX = useRef(0);
  const startOpen = useRef(0);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const dx = e.clientX - startX.current;
      const dir = dragging === 'left' ? -1 : 1;
      const next = startOpen.current + (dx * dir) / (r.width / 2);
      setOpen(Math.max(0, Math.min(1, next)));
    };
    const onUp = () => {
      setDragging(null);
      setOpen((o) => (o > 0.3 ? 1 : 0));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  function start(side: 'left' | 'right', e: React.MouseEvent) {
    startX.current = e.clientX;
    startOpen.current = open;
    setDragging(side);
    setTouched(true);
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        height: '100%',
        background: 'var(--c-paper)',
        userSelect: dragging ? 'none' : 'auto',
      }}
    >
      <style>{PULSE_KEYFRAMES}</style>
      <div style={{ position: 'absolute', inset: 0 }}>
        <PromiseSheet product={PLUS} />
      </div>

      {/* Left half */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '50%',
          background: 'var(--c-paper)',
          borderRight: '2px solid var(--c-magenta)',
          transform: `translateX(${-open * 100}%)`,
          transition: dragging ? 'none' : 'transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: '200%', position: 'absolute', inset: 0 }}>
          <PromiseSheet product={PUSD} />
        </div>
      </div>

      {/* Right half */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '50%',
          background: 'var(--c-paper)',
          borderLeft: '2px solid var(--c-magenta)',
          transform: `translateX(${open * 100}%)`,
          transition: dragging ? 'none' : 'transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '200%',
            position: 'absolute',
            inset: 0,
            transform: 'translateX(-50%)',
          }}
        >
          <PromiseSheet product={PUSD} />
        </div>
      </div>

      {/* Center grip — two halves stacked with a vertical seam */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          bottom: 0,
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          zIndex: 10,
        }}
      >
        <div
          onMouseDown={(e) => start('left', e)}
          style={{
            cursor: 'grab',
            background: 'var(--c-magenta)',
            color: 'var(--c-cream)',
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            padding: '20px 10px',
            writingMode: 'vertical-rl',
            transform: `translateX(-${open * 50}px) rotate(180deg)`,
            border: '2px solid var(--c-ink)',
            transition: dragging ? 'none' : 'transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            animation: !touched ? 'pp-tab-pulse 1.6s ease-in-out infinite' : undefined,
          }}
        >
          ← DRAG
        </div>
        <div
          onMouseDown={(e) => start('right', e)}
          style={{
            cursor: 'grab',
            background: 'var(--c-magenta)',
            color: 'var(--c-cream)',
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            padding: '20px 10px',
            writingMode: 'vertical-rl',
            transform: `translateX(${open * 50}px)`,
            border: '2px solid var(--c-ink)',
            transition: dragging ? 'none' : 'transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            animation: !touched ? 'pp-tab-pulse 1.6s ease-in-out infinite 0.4s' : undefined,
          }}
        >
          DRAG →
        </div>
      </div>

      {/* Static centered prompt that fades out as the seam opens */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.2em',
          color: 'var(--c-magenta)',
          opacity: Math.max(0, 1 - open * 2),
          background: 'var(--c-cream)',
          border: 'var(--rule-thin)',
          padding: '5px 12px',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      >
        SPLIT FOR PUSD+
      </div>
    </div>
  );
}
