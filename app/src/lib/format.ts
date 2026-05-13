/**
 * Formatting helpers. All numeric output uses tabular figures.
 * Decimal values are stored as bigint at their contract decimals
 * and only converted to display strings here.
 */

/** Truncate 0x-address to first 6 + last 4 hex characters. */
export function truncAddr(addr?: string | null, head = 6, tail = 4): string {
  if (!addr) return '';
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Truncate tx hash to first 8 + last 6 characters. */
export function truncHash(hash?: string | null): string {
  return truncAddr(hash, 8, 6);
}

/**
 * Compact a 6-decimal bigint amount with k/M/B/T suffix once it crosses
 * 10,000 whole units. Below the threshold returns a normal grouped string
 * with up to 2 fractional digits.
 *
 *   6_500_000n           → "6.50"
 *   12_345_000_000n      → "12.34k"
 *   1_500_000_000_000n   → "1.50M"
 *   676_767_677_479_000_000n → "676.77B"
 */
export function formatShortAmount(amount: bigint | undefined | null, decimals = 6): string {
  if (amount === undefined || amount === null) return '0';
  const sign = amount < 0n ? '-' : '';
  const abs = amount < 0n ? -amount : amount;
  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;

  // Below 10,000 whole units render at full precision (no suffix).
  if (whole < 10_000n) return sign + formatAmount(abs, decimals, { maxFractionDigits: 2 });

  const tiers = [
    { suffix: 'T', threshold: 1_000_000_000_000n },
    { suffix: 'B', threshold: 1_000_000_000n },
    { suffix: 'M', threshold: 1_000_000n },
    { suffix: 'k', threshold: 1_000n },
  ] as const;

  for (const t of tiers) {
    if (whole >= t.threshold) {
      const scaled = (whole * 100n) / t.threshold;
      const intPart = scaled / 100n;
      const fracPart = scaled % 100n;
      return `${sign}${intPart}.${fracPart.toString().padStart(2, '0')}${t.suffix}`;
    }
  }
  return sign + whole.toString();
}

/**
 * Format a bigint amount given token decimals into a grouped decimal string.
 *
 * When the value is non-zero but rounds to all-zero at the requested precision
 * (e.g. `123n` of a 6-decimal token formatted with `maxFractionDigits: 2`),
 * the function returns a sentinel like `"< 0.01"` (or `"> -0.01"` for negative
 * values). This keeps small-but-non-zero amounts visible in feeds instead of
 * silently rendering as `0.00`. Pass `epsilonHint: false` to opt out.
 */
export function formatAmount(
  amount: bigint | undefined | null,
  decimals: number,
  opts: {
    maxFractionDigits?: number;
    minFractionDigits?: number;
    withGrouping?: boolean;
    epsilonHint?: boolean;
  } = {},
): string {
  if (amount === undefined || amount === null) return '0.00';
  const {
    maxFractionDigits = 2,
    minFractionDigits = 2,
    withGrouping = true,
    epsilonHint = true,
  } = opts;
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, '0');
  const truncated = fracStr.slice(0, maxFractionDigits);

  // Detect "non-zero but rounds to 0 at the requested precision" and surface
  // the smallest representable digit instead.
  if (epsilonHint && abs > 0n && whole === 0n && /^0+$/.test(truncated)) {
    if (maxFractionDigits === 0) return neg ? '> -1' : '< 1';
    const epsilon = `0.${'0'.repeat(Math.max(0, maxFractionDigits - 1))}1`;
    return neg ? `> -${epsilon}` : `< ${epsilon}`;
  }

  const padded = truncated.padEnd(Math.max(minFractionDigits, truncated.length), '0');
  const wholeStr = withGrouping ? addGrouping(whole.toString()) : whole.toString();
  const sign = neg ? '-' : '';
  return padded.length > 0 ? `${sign}${wholeStr}.${padded}` : `${sign}${wholeStr}`;
}

/** Safe integer percentage formatter. */
export function formatPct(numerator: bigint, denominator: bigint, digits = 2): string {
  if (denominator === 0n) return digits === 0 ? '0%' : `0.${'0'.repeat(digits)}%`;
  // Scale: numerator * 100 (percent) * 10^digits (fractional places).
  const scale = 10n ** BigInt(digits + 2);
  const scaled = (numerator * scale) / denominator;
  if (digits === 0) return `${scaled / 100n}%`;
  const fracDivisor = 10n ** BigInt(digits);
  const intPart = scaled / fracDivisor;
  const fracPart = scaled % fracDivisor;
  const fracStr = fracPart.toString().padStart(digits, '0');
  return `${intPart}.${fracStr}%`;
}

/** Format a plain integer block number with thousands grouping. */
export function formatBlockNumber(n: number | bigint): string {
  return addGrouping(n.toString());
}

/** Group thousands with a comma. */
export function addGrouping(s: string): string {
  if (!/^-?\d+$/.test(s)) return s;
  const neg = s.startsWith('-');
  const digits = neg ? s.slice(1) : s;
  const rev = digits.split('').reverse().join('');
  const chunks = rev.match(/.{1,3}/g) ?? [];
  const grouped = chunks.map((c) => c.split('').reverse().join('')).reverse().join(',');
  return neg ? `-${grouped}` : grouped;
}

/** Time delta in seconds → "12s ago" / "3m ago" / "2h ago" / "yesterday" / "YYYY-MM-DD". */
export function formatRelative(updatedAt: number, now = Date.now()): string {
  if (!updatedAt) return '—';
  const deltaSec = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (deltaSec < 5) return 'just now';
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ago`;
  if (deltaSec < 2 * 86_400) return 'yesterday';
  const d = new Date(updatedAt);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** "2026-04-22 14:22" UTC-agnostic local format. */
export function formatTimestamp(epochSec: number): string {
  if (!epochSec) return '—';
  const d = new Date(epochSec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** BlockScout explorer URLs. */
export function explorerAddress(addr: string): string {
  return `https://donut.push.network/address/${addr}`;
}

export function explorerTx(hash: string): string {
  return `https://donut.push.network/tx/${hash}`;
}
