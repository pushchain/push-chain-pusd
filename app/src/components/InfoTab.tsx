import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS, RPC_URL } from '../contracts/config';

const PUSD_ABI = [
  "function totalSupply() external view returns (uint256)",
];
const MANAGER_ABI = [
  "function baseFee() external view returns (uint256)",
  "function getSupportedTokensCount() external view returns (uint256)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

const TOKENS = [
  { symbol: 'USDT', chain: 'Ethereum Sepolia', badge: 'badge-eth', dot: '#8ba3f7' },
  { symbol: 'USDC', chain: 'Ethereum Sepolia', badge: 'badge-eth', dot: '#8ba3f7' },
  { symbol: 'USDT', chain: 'Solana Devnet',    badge: 'badge-sol', dot: '#c084fc' },
  { symbol: 'USDC', chain: 'Solana Devnet',    badge: 'badge-sol', dot: '#c084fc' },
  { symbol: 'USDT', chain: 'Base Sepolia',     badge: 'badge-base', dot: '#60a5fa' },
  { symbol: 'USDC', chain: 'Base Sepolia',     badge: 'badge-base', dot: '#60a5fa' },
  { symbol: 'USDT', chain: 'Arbitrum Sepolia', badge: 'badge-arb', dot: '#38bdf8' },
  { symbol: 'USDC', chain: 'Arbitrum Sepolia', badge: 'badge-arb', dot: '#38bdf8' },
  { symbol: 'USDT', chain: 'BNB Testnet',      badge: 'badge-bnb', dot: '#fbbf24' },
];

const STEPS = [
  { n: '01', title: 'Connect Wallet', desc: 'Use any EVM wallet, Google, or email — Push Chain connects from any origin chain.' },
  { n: '02', title: 'Deposit Stablecoin', desc: 'Send USDT or USDC from Ethereum, Solana, Base, Arbitrum or BNB. All accepted 1:1.' },
  { n: '03', title: 'Receive PUSD',    desc: 'PUSD is minted to your Universal Account on Push Chain instantly.' },
  { n: '04', title: 'Redeem Anytime',  desc: 'Burn PUSD and receive any supported stablecoin back. Preferred, basket, or emergency paths.' },
];

const S: Record<string, React.CSSProperties> = {
  hero: {
    padding: '64px 0 48px',
    textAlign: 'center',
    position: 'relative',
    background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(79,142,247,0.14) 0%, transparent 70%)',
  },
  badge: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 14px', borderRadius: 99,
    background: 'rgba(79,142,247,0.1)', border: '1px solid rgba(79,142,247,0.25)',
    fontSize: 12, fontWeight: 600, color: 'var(--accent)',
    marginBottom: 20,
  },
  h1: {
    fontSize: 'clamp(36px, 6vw, 64px)', fontWeight: 800,
    lineHeight: 1.1, letterSpacing: '-1.5px', margin: '0 0 20px',
  },
  sub: {
    fontSize: 18, color: 'var(--text-secondary)',
    maxWidth: 560, margin: '0 auto 40px', lineHeight: 1.6,
  },
  statsRow: {
    display: 'flex', gap: 1,
    background: 'var(--border)',
    border: '1px solid var(--border)',
    borderRadius: 16, overflow: 'hidden',
    maxWidth: 700, margin: '0 auto 56px',
  },
  statCell: {
    flex: 1, padding: '20px 24px', textAlign: 'center',
    background: 'var(--bg-card)',
  },
  statVal: { fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px' },
  statLbl: { fontSize: 12, color: 'var(--text-muted)', marginTop: 4 },
  section: { marginBottom: 48 },
  sectionTitle: { fontSize: 20, fontWeight: 700, marginBottom: 20, letterSpacing: '-0.3px' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 },
  tokenCard: {
    padding: '16px 18px',
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8,
    transition: 'border-color 0.15s',
  },
  stepsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 },
  stepCard: {
    padding: '24px', background: 'var(--bg-card)',
    border: '1px solid var(--border)', borderRadius: 14,
  },
  stepNum: {
    fontSize: 11, fontWeight: 700, color: 'var(--accent)',
    letterSpacing: 1, marginBottom: 12,
  },
  stepTitle: { fontSize: 15, fontWeight: 700, marginBottom: 8 },
  stepDesc: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 },
  addrPanel: {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 14, overflow: 'hidden',
  },
  addrRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', gap: 8, padding: '16px 20px',
    borderBottom: '1px solid var(--border)',
  },
  addrLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', minWidth: 120 },
  addrVal: {
    fontFamily: 'monospace', fontSize: 12, color: 'var(--accent)',
    wordBreak: 'break-all',
  },
};

export function InfoTab() {
  const [totalSupply, setTotalSupply] = useState('—');
  const [baseFee, setBaseFee] = useState('—');
  const [tokenCount, setTokenCount] = useState('—');

  useEffect(() => {
    (async () => {
      try {
        const pusd = new ethers.Contract(PUSD_ADDRESS, PUSD_ABI, provider);
        const mgr  = new ethers.Contract(PUSD_MANAGER_ADDRESS, MANAGER_ABI, provider);
        const [supply, fee, count] = await Promise.all([
          pusd.totalSupply(),
          mgr.baseFee(),
          mgr.getSupportedTokensCount(),
        ]);
        setTotalSupply(Number(ethers.formatUnits(supply, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        setBaseFee((Number(fee) / 100).toFixed(2) + '%');
        setTokenCount(String(Number(count)));
      } catch { /* silently use defaults */ }
    })();
  }, []);

  return (
    <div>
      {/* ── Hero ── */}
      <div style={S.hero}>
        <div style={S.badge}>◈ Push Chain Donut Testnet</div>
        <h1 style={S.h1}>
          The Universal<br />
          <span style={{ background: 'linear-gradient(90deg, #4f8ef7, #7c5ff7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Stablecoin
          </span>
        </h1>
        <p style={S.sub}>
          PUSD is a 1:1 backed stablecoin on Push Chain — deposit USDT or USDC from any chain, redeem back to any supported asset.
        </p>

        {/* Live stats strip */}
        <div style={S.statsRow}>
          {[
            { label: 'Total Supply',       value: `$${totalSupply}` },
            { label: 'Supported Tokens',   value: tokenCount },
            { label: 'Base Redemption Fee', value: baseFee },
            { label: 'Backing',            value: '100%' },
          ].map((s, i) => (
            <div key={i} style={S.statCell}>
              <div style={S.statVal}>{s.value}</div>
              <div style={S.statLbl}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── How it works ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>How it works</div>
        <div style={S.stepsGrid}>
          {STEPS.map(s => (
            <div key={s.n} style={S.stepCard}>
              <div style={S.stepNum}>STEP {s.n}</div>
              <div style={S.stepTitle}>{s.title}</div>
              <div style={S.stepDesc}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Supported tokens ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Supported collateral ({TOKENS.length} assets)</div>
        <div style={S.grid2}>
          {TOKENS.map((t, i) => (
            <div key={i} style={S.tokenCard}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-glow)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 13, fontWeight: 700, color: t.dot,
                  border: `1px solid ${t.dot}40`,
                }}>{t.symbol[1]}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{t.symbol}</div>
                  <span className={`token-pill ${t.badge}`} style={{ marginTop: 2 }}>{t.chain}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Properties ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Protocol properties</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {[
            { icon: '🔒', title: 'Fully Collateralised', desc: 'Every PUSD is backed 1:1 by real stablecoins held in the reserve manager. No algorithmic component.' },
            { icon: '⚡', title: 'Multi-Chain Origins', desc: 'Users deposit from Ethereum, Solana, Base, Arbitrum or BNB. Push Chain acts as the unified settlement layer.' },
            { icon: '🔀', title: 'Flexible Redemption', desc: 'Redeem into your preferred asset, or let the basket algorithm distribute across all reserves proportionally.' },
            { icon: '🛡️', title: 'Upgradeable & Safe', desc: 'UUPS proxy pattern with role-gated upgrades. Emergency redeem mode drains risky positions without protocol pause.' },
          ].map((f, i) => (
            <div key={i} style={{ ...S.stepCard, display: 'flex', gap: 14 }}>
              <span style={{ fontSize: 24, lineHeight: 1, marginTop: 2 }}>{f.icon}</span>
              <div>
                <div style={S.stepTitle}>{f.title}</div>
                <div style={S.stepDesc}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Contract addresses ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Contract addresses</div>
        <div style={S.addrPanel}>
          {[
            { label: 'PUSD Token (Proxy)', addr: PUSD_ADDRESS },
            { label: 'PUSDManager (Proxy)', addr: PUSD_MANAGER_ADDRESS },
          ].map((c, i, arr) => (
            <div key={c.label} style={{ ...S.addrRow, borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={S.addrLabel}>{c.label}</span>
              <a href={`https://donut.push.network/address/${c.addr}`}
                target="_blank" rel="noopener noreferrer" style={S.addrVal}
                onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline'}
                onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none'}
              >{c.addr}</a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
