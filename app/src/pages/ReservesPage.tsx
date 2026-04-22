/**
 * ReservesPage — default route (`/`).
 *
 * Three sections:
 *   §A Headline numbers (full width, 4-col grid of MonoStat tiles)
 *   §B Reserve table (full width)
 *   §C Editorial explanation (2/3 column prose)
 */

import { ReserveTable } from '../components/ReserveTable';
import { MonoStat } from '../components/MonoStat';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { useReserves } from '../hooks/useReserves';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { formatAmount } from '../lib/format';

export default function ReservesPage() {
  const reserves = useReserves();
  const { totalSupply, loading: supplyLoading } = usePUSDBalance();
  const stats = useProtocolStats();

  return (
    <>
      {/* §A — Headline stats */}
      <section className="section">
        <div className="stat-grid">
          <MonoStat
            label="TOTAL SUPPLY"
            amount={totalSupply}
            decimals={6}
            unit=" PUSD"
            loading={supplyLoading}
            caption="PUSD · 6 DECIMALS"
          />
          <MonoStat
            label="BACKING"
            amount={reserves.totalReserves}
            decimals={6}
            unit=" USD"
            loading={reserves.loading}
            caption={`${reserves.rows.length} TOKEN${reserves.rows.length === 1 ? '' : 'S'} · NORMALIZED`}
          />
          <MonoStat
            label="BASE FEE"
            value={stats.loading ? '…' : (stats.baseFeeBps / 100).toFixed(2)}
            unit="%"
            caption="REDEMPTION · BPS"
          />
          <MonoStat
            label="FEE INCOME"
            amount={stats.accruedFeesTotal}
            decimals={6}
            loading={stats.loading}
            caption="ACCRUED · NOT SWEPT"
          />
        </div>
      </section>

      {/* §B — Reserve table */}
      <section className="section">
        <div className="section__head">
          <h2>Reserves</h2>
          <p>
            All tokens PUSDManager currently holds. Balances shown in each token's native decimals;
            percentages use values normalized to PUSD precision (6). Click a header to sort.
          </p>
        </div>
        <ReserveTable rows={reserves.rows} loading={reserves.loading} />
        {reserves.error && (
          <div className="feedback feedback--error" style={{ marginTop: 16 }}>
            <div className="feedback__title">RPC ERROR</div>
            <div>{reserves.error.message}</div>
          </div>
        )}
      </section>

      {/* §C — Editorial explanation */}
      <section className="section">
        <div className="section__head">
          <h2>How PUSD works</h2>
        </div>
        <div className="prose" style={{ maxWidth: 720 }}>
          <p>
            PUSD is a par-backed stablecoin on Push Chain. Every unit is minted against an
            equivalent deposit of <em>USDC</em> or <em>USDT</em> from a supported external-chain
            origin — Ethereum, Solana, Base, Arbitrum, or BNB. Reserves sit idle inside the
            PUSDManager contract and do not accrue yield in this version.
          </p>
          <p>
            Deposits are free. Redemptions pay a{' '}
            <em>{stats.loading ? '…' : (stats.baseFeeBps / 100).toFixed(2)}%</em> protocol fee.
            When a preferred redemption asset is unavailable, users can opt into a{' '}
            <em>basket redemption</em> that distributes across all reserves proportionally.
          </p>
          <p>
            The ribbon above tracks the solvency invariant in real time — Σ reserves ≥ total PUSD
            supply. It refreshes every twelve seconds. If it ever turns red, mint and redeem
            actions halt automatically until the check clears.
          </p>
          <p>
            Total normalized reserves stand at{' '}
            <strong>{formatAmount(reserves.totalReserves, 6)} USD</strong> against{' '}
            <strong>{formatAmount(totalSupply, 6)} PUSD</strong> outstanding.
          </p>
        </div>
      </section>
    </>
  );
}
