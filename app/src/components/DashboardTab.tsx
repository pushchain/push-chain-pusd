import { PushUI, usePushChainClient, usePushWalletContext } from '@pushchain/ui-kit';
import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS, RPC_URL } from '../contracts/config';

const PUSD_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];
const MANAGER_ABI = [
  "function getSupportedTokensCount() view returns (uint256)",
  "function baseFee() view returns (uint256)",
  "function getSupportedTokenAt(uint256) view returns (address)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

type Reserve = { symbol: string; balance: number; decimals: number };

function fmt(n: number, dec = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function shortAddr(a: string) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'; }

export function DashboardTab() {
  const { connectionStatus } = usePushWalletContext();
  const { pushChainClient } = usePushChainClient();

  const [userBalance, setUserBalance]   = useState(0);
  const [totalSupply, setTotalSupply]   = useState(0);
  const [tokensCount, setTokensCount]   = useState(0);
  const [baseFee, setBaseFee]           = useState('—');
  const [reserves, setReserves]         = useState<Reserve[]>([]);
  const [loading, setLoading]           = useState(true);

  const isConnected = connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.CONNECTED;
  const account = pushChainClient?.universal?.account ?? '';

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const pusd = new ethers.Contract(PUSD_ADDRESS, PUSD_ABI, provider);
        const mgr  = new ethers.Contract(PUSD_MANAGER_ADDRESS, MANAGER_ABI, provider);

        const [supply, count, fee] = await Promise.all([
          pusd.totalSupply(),
          mgr.getSupportedTokensCount(),
          mgr.baseFee(),
        ]);

        setTotalSupply(Number(ethers.formatUnits(supply, 6)));
        setTokensCount(Number(count));
        setBaseFee((Number(fee) / 100).toFixed(2) + '%');

        const n = Number(count);
        const resArr: Reserve[] = [];
        for (let i = 0; i < n; i++) {
          try {
            const addr = await mgr.getSupportedTokenAt(i);
            const tok  = new ethers.Contract(addr, ERC20_ABI, provider);
            const [sym, dec, bal] = await Promise.all([
              tok.symbol(), tok.decimals(), tok.balanceOf(PUSD_MANAGER_ADDRESS),
            ]);
            resArr.push({ symbol: sym, decimals: Number(dec), balance: Number(ethers.formatUnits(bal, dec)) });
          } catch { /* skip bad tokens */ }
        }
        setReserves(resArr);

        if (isConnected && account) {
          const b = await pusd.balanceOf(account);
          setUserBalance(Number(ethers.formatUnits(b, 6)));
        }
      } catch { /* no-op */ }
      setLoading(false);
    };

    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [isConnected, account]);

  const totalReserve = reserves.reduce((s, r) => s + r.balance, 0);

  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 14, padding: '20px 22px', ...extra,
  });

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* ── Page header ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 6 }}>Dashboard</div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Live protocol stats and your PUSD position — refreshes every 15 seconds.</div>
      </div>

      {/* ── User balance (connected only) ── */}
      {isConnected && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          {/* Balance hero */}
          <div style={{
            ...card(),
            background: 'linear-gradient(135deg, rgba(79,142,247,0.15) 0%, rgba(124,95,247,0.15) 100%)',
            border: '1px solid rgba(79,142,247,0.3)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 600, letterSpacing: 0.5 }}>YOUR PUSD BALANCE</div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1px', color: 'var(--accent)' }}>
              {loading ? '…' : `$${fmt(userBalance)}`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              ≈ {fmt(userBalance)} PUSD · 1:1 USD peg
            </div>
          </div>
          {/* Wallet */}
          <div style={card()}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 600, letterSpacing: 0.5 }}>UNIVERSAL ACCOUNT</div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-all', marginBottom: 8 }}>
              {account || '—'}
            </div>
            {account && (
              <a href={`https://donut.push.network/address/${account}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, color: 'var(--accent)' }}>
                View on Explorer ↗
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Protocol stats strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        {[
          { label: 'Total PUSD Supply', value: loading ? '…' : `$${fmt(totalSupply)}`, sub: 'PUSD minted' },
          { label: 'Collateral Ratio',  value: '100%', sub: 'Fully backed' },
          { label: 'Supported Tokens',  value: loading ? '…' : String(tokensCount), sub: 'Stablecoins' },
          { label: 'Base Fee',          value: loading ? '…' : baseFee, sub: 'Per redemption' },
        ].map(s => (
          <div key={s.label} style={{ ...card(), textAlign: 'center' }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-glow)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.sub}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, opacity: 0.7 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Reserves ── */}
      <div style={card({ marginBottom: 24 })}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Reserve Breakdown</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Total: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>${fmt(totalReserve)}</span>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>Loading reserves…</div>
        ) : reserves.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>No reserves found</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {reserves
              .sort((a, b) => b.balance - a.balance)
              .map((r, i) => {
                const pct = totalReserve > 0 ? (r.balance / totalReserve) * 100 : 0;
                const barColor = i % 3 === 0 ? '#4f8ef7' : i % 3 === 1 ? '#22d3a5' : '#7c5ff7';
                return (
                  <div key={r.symbol + i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: barColor }} />
                        <span style={{ fontWeight: 600 }}>{r.symbol}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, color: 'var(--text-secondary)' }}>
                        <span>{fmt(r.balance, 4)}</span>
                        <span style={{ minWidth: 48, textAlign: 'right', color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`, borderRadius: 4,
                        background: barColor, transition: 'width 0.6s ease',
                      }} />
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* ── Contract addresses ── */}
      <div style={card()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Contracts</div>
        {[
          { label: 'PUSD Token',    addr: PUSD_ADDRESS },
          { label: 'PUSDManager',   addr: PUSD_MANAGER_ADDRESS },
        ].map((c, i, arr) => (
          <div key={c.label} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 8,
            padding: '12px 0',
            borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>{c.label}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{shortAddr(c.addr)}</div>
            </div>
            <a href={`https://donut.push.network/address/${c.addr}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {c.addr}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
