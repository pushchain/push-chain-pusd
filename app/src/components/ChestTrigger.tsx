/**
 * ChestTrigger — chip-style button that swaps §02 from The Yield back to
 * The Book. Mirror of PiggyTrigger — same chip, opposite arrow.
 *
 * Pulse state is controlled by the parent so the chest doesn't restart
 * pulsing after the user has already engaged with the piggy side.
 */

import { type MouseEvent } from 'react';

type Props = {
  onTrigger: (origin: { x: number; y: number }) => void;
  engaged: boolean;
  onEngage: () => void;
};

export function ChestTrigger({ onTrigger, engaged, onEngage }: Props) {
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
      aria-label="Show PUSD Book"
      className={`proof-switch-chip${engaged ? ' proof-switch-chip--engaged' : ''}`}
    >
      SHOW PUSD BOOK
    </button>
  );
}
