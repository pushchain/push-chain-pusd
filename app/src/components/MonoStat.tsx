/**
 * MonoStat — large mono numeric + caption tile.
 *
 * Used on the Reserves page headline stats strip. Accepts either a
 * pre-formatted string (`value`) or a bigint + decimals pair (`amount`,
 * `decimals`). When both are given, `value` wins.
 */

import type { ReactNode } from 'react';
import { formatAmount } from '../lib/format';

export type MonoStatProps = {
  label: string;
  caption?: ReactNode;
  value?: string;
  amount?: bigint | null;
  decimals?: number;
  unit?: string;
  loading?: boolean;
  minFractionDigits?: number;
  maxFractionDigits?: number;
  className?: string;
};

export function MonoStat({
  label,
  caption,
  value,
  amount,
  decimals = 6,
  unit,
  loading = false,
  minFractionDigits,
  maxFractionDigits,
  className,
}: MonoStatProps) {
  const resolved = (() => {
    if (loading) return '…';
    if (value !== undefined) return value;
    if (amount !== undefined && amount !== null) {
      return formatAmount(amount, decimals, {
        minFractionDigits: minFractionDigits ?? 2,
        maxFractionDigits: maxFractionDigits ?? 2,
      });
    }
    return '—';
  })();

  return (
    <div className={['stat', className].filter(Boolean).join(' ')}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">
        {resolved}
        {unit && !loading && <span className="stat__unit">{unit}</span>}
      </div>
      {caption && <div className="stat__label" style={{ marginTop: 6 }}>{caption}</div>}
    </div>
  );
}
