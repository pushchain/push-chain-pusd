/**
 * TokenPill — "USDC · ETH SEPOLIA" chip.
 *
 * Two variants by size (default `md`, compact `sm`). Pure display component —
 * no hooks, no state.
 */

import type { ReserveToken } from '../contracts/tokens';

export type TokenPillProps = {
  symbol: ReserveToken['symbol'] | string;
  chainShort: string;
  size?: 'sm' | 'md';
  className?: string;
};

export function TokenPill({ symbol, chainShort, size = 'md', className }: TokenPillProps) {
  const cls = ['token-pill', size === 'sm' ? 'token-pill--sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls}>
      <span className="token-pill__symbol">{symbol}</span>
      <span className="token-pill__chain">· {chainShort}</span>
    </span>
  );
}
