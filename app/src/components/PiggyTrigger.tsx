/**
 * PiggyTrigger — chip-style button that swaps §02 from The Book to The
 * Yield. Sits in the right column of the .book block.
 *
 * The pulsing magenta glow is controlled by the `engaged` prop. The
 * parent (HomePage) flips it to true on the user's first interaction
 * with EITHER trigger so the chest side doesn't restart the pulse after
 * the first swap.
 */

import { type MouseEvent } from 'react';

type Props = {
  onTrigger: (origin: { x: number; y: number }) => void;
  /** True once the user has hovered or clicked any §02 switch chip. */
  engaged: boolean;
  /** Called on first hover/click so the parent can persist the engaged
   *  flag across swaps. */
  onEngage: () => void;
};

export function PiggyTrigger({ onTrigger, engaged, onEngage }: Props) {
  function onClick(e: MouseEvent<HTMLButtonElement>) {
    onEngage();
    const r = e.currentTarget.getBoundingClientRect();
    onTrigger({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onEngage}
      aria-label="Show PUSD+ Yield"
      className={`proof-switch-chip${engaged ? ' proof-switch-chip--engaged' : ''}`}
    >
      SHOW PUSD+ YIELD
    </button>
  );
}
