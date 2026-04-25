/**
 * ProofTypewriter — § 03 · PROOF · EDITORIAL · ROTATING.
 *
 * A typewriter cycles editorial proofs ("Backed, not printed.", "A unit of
 * settlement, not of speculation.", …) while a live ledger row below holds
 * the numbers that make each statement true. Reads like a newspaper ticker,
 * prints like a receipt.
 *
 * The component is purely visual; it pulls live numbers from the protocol
 * via `useReserves` + `usePUSDBalance` (same hooks the home page already
 * uses) so the ledger row never drifts from the §02 PROOF OF RESERVES
 * table further down the page.
 */

import { useEffect, useRef, useState } from 'react';

/** Default editorial proofs used when no `phrases` prop is supplied. */
const DEFAULT_PROOFS: readonly string[] = [
  'Ethereum, Solana, BNB, Base and more.',
  'Backed, not printed.',
  'Every dollar, every chain, every status is on-chain.',
  'Mint 1:1. Redeem at par. No rebases.',
  'The book is the source of truth.',
];

const TYPE_MS = 38; // per-character type speed
const DELETE_MS = 18; // per-character delete speed (a bit faster — feels right)
const HOLD_MS = 1_400; // pause on a fully-typed line
const GAP_MS = 320; // pause after a line is fully erased

type State = {
  /** Index into PROOFS. */
  phrase: number;
  /** Number of characters currently displayed from the active phrase. */
  chars: number;
  /** What the typewriter is doing right now. */
  phase: 'typing' | 'holding' | 'deleting' | 'gap';
};

/** Single-action reducer — every dispatch advances the typewriter one step. */
function reduce(state: State, phrases: readonly string[]): State {
  const target = phrases[state.phrase] ?? '';
  switch (state.phase) {
    case 'typing':
      if (state.chars >= target.length) return { ...state, phase: 'holding' };
      return { ...state, chars: state.chars + 1 };
    case 'holding':
      return { ...state, phase: 'deleting' };
    case 'deleting':
      if (state.chars <= 0) return { ...state, phase: 'gap' };
      return { ...state, chars: state.chars - 1 };
    case 'gap':
      return {
        phrase: (state.phrase + 1) % phrases.length,
        chars: 0,
        phase: 'typing',
      };
  }
}

type Props = {
  phrases?: readonly string[];
};

export function ProofTypewriter({ phrases = DEFAULT_PROOFS }: Props) {
  const [state, setState] = useState<State>({
    phrase: 0,
    chars: 0,
    phase: 'typing',
  });

  // Drive the typewriter on a single interval; the delay between ticks
  // depends on the current phase. We keep the delay in a ref so the effect
  // can read the latest value without re-subscribing every render.
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;

  useEffect(() => {
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      let delay = TYPE_MS;
      switch (phaseRef.current) {
        case 'typing':
          delay = TYPE_MS;
          break;
        case 'holding':
          delay = HOLD_MS;
          break;
        case 'deleting':
          delay = DELETE_MS;
          break;
        case 'gap':
          delay = GAP_MS;
          break;
      }
      window.setTimeout(() => {
        setState((prev) => reduce(prev, phrases));
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      stopped = true;
    };
  }, []);

  const visible = phrases[state.phrase]?.slice(0, state.chars) ?? '';

  return (
    <div
        className="proof-tw__line"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="proof-tw__caret" aria-hidden="true">
          ▶
        </span>
        <span className="proof-tw__text">{visible}</span>
        <span className="proof-tw__cursor" aria-hidden="true">
          ▌
        </span>
      </div>
  );
}
