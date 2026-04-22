import { PushUI, usePushChain, usePushChainClient, usePushWalletContext } from '@pushchain/ui-kit';
import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS, RPC_URL } from '../contracts/config';

const SUPPORTED_TOKENS = [
  { address: '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3', symbol: 'USDT', chain: 'Ethereum Sepolia', badge: 'badge-eth', decimals: 6 },
  { address: '0x7A58048036206bB898008b5bBDA85697DB1e5d66', symbol: 'USDC', chain: 'Ethereum Sepolia', badge: 'badge-eth', decimals: 6 },
  { address: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34', symbol: 'USDT', chain: 'Solana Devnet',    badge: 'badge-sol', decimals: 6 },
  { address: '0x04B8F634ABC7C879763F623e0f0550a4b5c4426F', symbol: 'USDC', chain: 'Solana Devnet',    badge: 'badge-sol', decimals: 6 },
  { address: '0x2C455189D2af6643B924A981a9080CcC63d5a567', symbol: 'USDT', chain: 'Base Sepolia',     badge: 'badge-base', decimals: 6 },
  { address: '0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1', symbol: 'USDC', chain: 'Base Sepolia',     badge: 'badge-base', decimals: 6 },
  { address: '0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9', symbol: 'USDT', chain: 'Arbitrum Sepolia', badge: 'badge-arb', decimals: 6 },
  { address: '0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C', symbol: 'USDC', chain: 'Arbitrum Sepolia', badge: 'badge-arb', decimals: 6 },
  { address: '0x2f98B4235FD2BA0173a2B056D722879360B12E7b', symbol: 'USDT', chain: 'BNB Testnet',       badge: 'badge-bnb', decimals: 6 },
];

const REDEEM_ABI = [
  { inputs: [{ name: "pusdAmount", type: "uint256" }, { name: "preferredAsset", type: "address" }, { name: "allowBasket", type: "bool" }], name: "redeem", outputs: [], stateMutability: "nonpayable", type: "function" },
];
const APPROVE_ABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable", type: "function" },
];
const PUSD_ABI = ["function balanceOf(address) view returns (uint256)"];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const BASE_FEE_BPS = 5;

export function RedeemTab() {
  const { connectionStatus } = usePushWalletContext();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();

  const [selectedToken, setSelectedToken] = useState(SUPPORTED_TOKENS[0]);
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState('0');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');
  const [showSelector, setShowSelector] = useState(false);
  const [basketMode, setBasketMode] = useState(false);

  const isConnected = connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.CONNECTED;
  const amountNum = parseFloat(amount) || 0;
  const feeNum = amountNum * (BASE_FEE_BPS / 10000);
  const receiveNum = Math.max(0, amountNum - feeNum);

  useEffect(() => {
    if (!isConnected || !pushChainClient?.universal.account) { setBalance('0'); return; }
    const fetch = async () => {
      try {
        const c = new ethers.Contract(PUSD_ADDRESS, PUSD_ABI, provider);
        const b = await c.balanceOf(pushChainClient.universal.account);
        setBalance(ethers.formatUnits(b, 6));
      } catch { setBalance('0'); }
    };
    fetch();
    const id = setInterval(fetch, 12000);
    return () => clearInterval(id);
  }, [isConnected, pushChainClient]);

  const handleRedeem = async () => {
    if (!amountNum || !pushChainClient || !PushChain) return;
    setIsRedeeming(true); setError(''); setTxHash('');
    try {
      const amountBigInt = PushChain.utils.helpers.parseUnits(amount, 6);

      const approveData = PushChain.utils.helpers.encodeTxData({
        abi: APPROVE_ABI, functionName: 'approve',
        args: [PUSD_MANAGER_ADDRESS, amountBigInt],
      });
      const redeemData = PushChain.utils.helpers.encodeTxData({
        abi: REDEEM_ABI, functionName: 'redeem',
        args: [amountBigInt, selectedToken.address, basketMode],
      });

      const tx = await pushChainClient.universal.sendTransaction({
        to: '0x0000000000000000000000000000000000000000',
        value: BigInt(0),
        data: [
          { to: PUSD_ADDRESS,         value: BigInt(0), data: approveData },
          { to: PUSD_MANAGER_ADDRESS, value: BigInt(0), data: redeemData },
        ],
      });

      setTxHash(tx.hash);
      await tx.wait();
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsRedeeming(false);
    }
  };

  const card: React.CSSProperties = {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 16, padding: '24px',
  };
  const inputRow: React.CSSProperties = {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '16px 18px',
    display: 'flex', alignItems: 'center', gap: 12,
  };
  const bigInput: React.CSSProperties = {
    flex: 1, background: 'none', border: 'none', outline: 'none',
    fontSize: 28, fontWeight: 700, color: 'var(--text-primary)',
    fontFamily: 'inherit', width: 0,
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 6 }}>Redeem PUSD</div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Burn PUSD and receive your preferred stablecoin (minus a {(BASE_FEE_BPS / 100).toFixed(2)}% fee).</div>
      </div>

      <div style={card}>
        {!isConnected ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🔗</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Connect your wallet</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Use the Connect Wallet button in the top-right to get started.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* ── You burn ── */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, paddingLeft: 4 }}>
                <span>YOU BURN</span>
                <span style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => setAmount(balance)}>
                  Balance: {parseFloat(balance).toFixed(4)} PUSD → MAX
                </span>
              </div>
              <div style={inputRow}>
                <input type="number" min="0" value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00" style={bigInput}
                />
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '8px 14px',
                }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#4f8ef7,#7c5ff7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>P</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>PUSD</div>
                </div>
              </div>
            </div>

            {/* ── Arrow ── */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--text-secondary)' }}>↓</div>
            </div>

            {/* ── You receive ── */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, paddingLeft: 4 }}>YOU RECEIVE</div>
              <div style={{ ...inputRow, borderColor: receiveNum > 0 ? 'rgba(34,211,165,0.3)' : 'var(--border)' }}>
                <div style={{ flex: 1, fontSize: 28, fontWeight: 700, color: receiveNum > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
                  {receiveNum > 0 ? receiveNum.toFixed(6) : '0.00'}
                </div>
                <button onClick={() => setShowSelector(s => !s)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '8px 14px', cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'border-color 0.15s',
                }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-glow)'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'}
                >
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{selectedToken.symbol}</div>
                  <span className={`token-pill ${selectedToken.badge}`}>{selectedToken.chain.split(' ')[0]}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 2 }}>▼</span>
                </button>
              </div>
            </div>

            {/* ── Token dropdown ── */}
            {showSelector && (
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {SUPPORTED_TOKENS.map(t => (
                  <button key={t.address} onClick={() => { setSelectedToken(t); setShowSelector(false); }} style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                    padding: '12px 16px', background: t.address === selectedToken.address ? 'var(--accent-dim)' : 'none',
                    border: 'none', borderBottom: '1px solid var(--border)',
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'background 0.1s',
                  }}
                    onMouseEnter={e => { if (t.address !== selectedToken.address) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card)'; }}
                    onMouseLeave={e => { if (t.address !== selectedToken.address) (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', minWidth: 44 }}>{t.symbol}</div>
                    <span className={`token-pill ${t.badge}`}>{t.chain}</span>
                    {t.address === selectedToken.address && <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 14 }}>✓</span>}
                  </button>
                ))}
              </div>
            )}

            {/* ── Basket mode toggle ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)', borderRadius: 10, padding: '12px 16px' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Basket redemption</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Distribute across all reserve tokens if preferred has insufficient liquidity</div>
              </div>
              <button onClick={() => setBasketMode(b => !b)} style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: basketMode ? 'var(--accent)' : 'var(--border)',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}>
                <span style={{
                  position: 'absolute', top: 3, left: basketMode ? 23 : 3,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s',
                }} />
              </button>
            </div>

            {/* ── Fee breakdown ── */}
            {amountNum > 0 && (
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '12px 16px', fontSize: 13 }}>
                {[
                  { label: 'Burn amount', value: `${amountNum.toFixed(6)} PUSD` },
                  { label: `Redemption fee (${(BASE_FEE_BPS / 100).toFixed(2)}%)`, value: `−${feeNum.toFixed(6)} PUSD` },
                  { label: 'You receive', value: `${receiveNum.toFixed(6)} ${basketMode ? '(basket)' : selectedToken.symbol}`, bold: true, green: true },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: r.green ? 'var(--green)' : 'var(--text-secondary)', fontWeight: r.bold ? 700 : 400 }}>
                    <span>{r.label}</span><span>{r.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── CTA ── */}
            <button onClick={handleRedeem} disabled={!amountNum || isRedeeming || amountNum > parseFloat(balance)} style={{
              width: '100%', padding: '16px', borderRadius: 12, border: 'none',
              background: !amountNum || isRedeeming ? 'var(--bg-elevated)' : 'linear-gradient(135deg, #22d3a5, #4f8ef7)',
              color: !amountNum || isRedeeming ? 'var(--text-muted)' : '#fff',
              fontFamily: 'inherit', fontSize: 16, fontWeight: 700,
              cursor: !amountNum || isRedeeming ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s',
            }}>
              {isRedeeming ? '⏳ Redeeming…' : !amountNum ? 'Enter an amount' : amountNum > parseFloat(balance) ? 'Insufficient PUSD' : `Redeem ${amountNum.toFixed(2)} PUSD`}
            </button>

            {error && (
              <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--red)' }}>
                ⚠ {error}
              </div>
            )}
            {txHash && (
              <div style={{ background: 'var(--green-dim)', border: '1px solid var(--green)', borderRadius: 10, padding: '12px 16px', fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 4 }}>✓ Redemption successful!</div>
                <a href={`https://donut.push.network/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--accent)', fontSize: 12, fontFamily: 'monospace' }}>
                  {txHash.slice(0, 20)}… View on Explorer ↗
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
