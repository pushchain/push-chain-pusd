/**
 * MintPage — testnet faucet directory for the supported reserve stablecoins.
 *
 * Every supported reserve token on its source chain exposes a public
 * `faucet()` function (no args, mints a fixed amount to msg.sender).
 * Each row links straight to that chain's explorer Write Contract tab so
 * the user can connect their wallet there and call faucet() directly.
 * No universal transaction, no CEA derivation, no per-row signing here.
 *
 * Solana SPL tokens don't have a Write Contract page; that row links to
 * the mint address on Solscan and notes the airdrop flow lives off-app.
 */

import { usePushChain } from '@pushchain/ui-kit';
import { useMemo } from 'react';
import { TokenPill } from '../components/TokenPill';
import { TOKENS, type ReserveToken } from '../contracts/tokens';
import { explorerAddressForChain } from '../lib/externalRpc';
import { resolveMoveableToken } from '../lib/wallet';

/** Source-chain contract address for a (chain, symbol) pair via the SDK
 *  MOVEABLE registry. Returns '' when the SDK doesn't expose one. */
function getSourceAddress(constants: unknown, chainKey: string, symbolKey: string): string {
  const moveable = resolveMoveableToken(constants, chainKey, symbolKey) as
    | { address?: string }
    | undefined;
  return moveable?.address ?? '';
}

const isSolanaChainKey = (k: string) => k.toUpperCase().startsWith('SOLANA_');

function truncAddress(addr: string): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Per-token faucet URL.
 *
 *  Most EVM source tokens are upgradeable proxies whose faucet() is the
 *  third writable function — that's the default (`#writeProxyContract#F3`).
 *  Plenty of USDCs differ (non-proxy, different function index, or a
 *  different anchor convention on Arbiscan), so they go in the override
 *  table. Solana USDC routes to Circle's official testnet faucet instead
 *  of Solscan — it's the cleanest mint path on devnet. */
type FaucetOverride = { hash?: string; url?: string; label?: string };
const FAUCET_OVERRIDES: Record<string, FaucetOverride> = {
  // chainKey|symbol
  'ETHEREUM_SEPOLIA|USDC': { hash: '#writeContract#F4' },
  'BASE_SEPOLIA|USDC': { hash: '#writeContract#F4' },
  'ARBITRUM_SEPOLIA|USDC': { hash: '#writeContract#F4' },
  'BNB_TESTNET|USDC': { hash: '#writeProxyContract#F4' },
  'SOLANA_DEVNET|USDC': { url: 'https://faucet.circle.com/' },
  'SOLANA_DEVNET|USDT': { url: 'https://discord.com/invite/pushchain', label: 'ASK IN DISCORD ↗' },
};

function faucetUrl(chainKey: string, symbol: string, address: string): string {
  const override = FAUCET_OVERRIDES[`${chainKey}|${symbol}`];
  if (override?.url) return override.url;
  const base = explorerAddressForChain(address, chainKey);
  if (isSolanaChainKey(chainKey)) return base;
  return `${base}${override?.hash ?? '#writeProxyContract#F3'}`;
}

export default function MintPage() {
  const { PushChain } = usePushChain();

  const grouped = useMemo(() => {
    const set = new Set<string>();
    for (const t of TOKENS) set.add(t.chainLabel);
    return set.size;
  }, []);

  return (
    <div className="container">
      <section className="section">
        <div className="section__header">
          <span>§ MINT · TESTNET STABLECOIN FAUCET</span>
          <span>USDC · USDT</span>
        </div>

        <div className="book">
          <div>
            <h2 className="book__title">
              Mint <em>stablecoins.</em>
            </h2>
            <div className="book__sub">
              Every supported reserve token exposes a public <code>faucet()</code>{' '}
              on its native chain. Click OPEN FAUCET to jump to that chain&rsquo;s
              block explorer, connect the wallet you want to fund, and call{' '}
              <code>faucet()</code> with no arguments. The mint lands on the
              wallet you connect, on the source chain. To use the token on Push
              Chain afterwards, bridge it through the{' '}
              <a className="link-mono" href="/convert/mint">
                convert page
              </a>
              .
            </div>
          </div>
          <div className="book__totals">
            <span className="book__totals-value">{TOKENS.length}</span>
            <div className="book__totals-label">RESERVES · {grouped} CHAINS</div>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 20 }}>
          <table className="table table--responsive mint-table">
            <thead>
              <tr>
                <th>ASSET</th>
                <th className="cell-md-up">CONTRACT</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {TOKENS.map((t) => (
                <FaucetRow key={t.address} token={t} PushChain={PushChain} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="meta-sm" style={{ marginTop: 18, maxWidth: '60ch' }}>
          Each faucet mints a fixed amount per call. Repeat the call to top up.
          Rate limits vary by token; if a call reverts, wait a minute and try
          again. Solana SPL tokens do not expose a faucet on the explorer; use
          your favourite Solana devnet airdrop tool for that mint authority.
        </div>
      </section>
    </div>
  );
}

function FaucetRow({
  token,
  PushChain,
}: {
  token: ReserveToken;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PushChain: any;
}) {
  const [chainKey, symbolKey] = token.moveableKey;
  const sourceAddress = PushChain
    ? getSourceAddress(PushChain.CONSTANTS, chainKey, symbolKey)
    : '';
  const solana = isSolanaChainKey(chainKey);
  const hasAddress = !!sourceAddress;
  // Rows that route to a real faucet (EVM tokens + the Circle override for
  // Solana USDC) get "OPEN FAUCET"; rows that only link to the explorer's
  // address page get "VIEW MINT".
  const override = FAUCET_OVERRIDES[`${chainKey}|${token.symbol}`];
  const isExplorerOnly = solana && !override?.url;

  return (
    <tr>
      <td>
        <TokenPill symbol={token.symbol} chainShort={token.chainShort} size="sm" />
      </td>
      <td className="addr cell-md-up">
        {hasAddress ? (
          <a
            className="link-mono"
            href={explorerAddressForChain(sourceAddress, chainKey)}
            target="_blank"
            rel="noreferrer"
            title={sourceAddress}
          >
            {truncAddress(sourceAddress)} ↗
          </a>
        ) : (
          <span className="meta-sm" style={{ color: 'var(--c-oxblood)' }}>
            NO SOURCE ADDR
          </span>
        )}
      </td>
      <td>
        {hasAddress ? (
          <a
            className="mint-row-btn"
            href={faucetUrl(chainKey, token.symbol, sourceAddress)}
            target="_blank"
            rel="noreferrer"
          >
            {override?.label ?? (isExplorerOnly ? 'VIEW MINT ↗' : 'OPEN FAUCET ↗')}
          </a>
        ) : (
          <button type="button" className="mint-row-btn" disabled>
            FAUCET N/A
          </button>
        )}
      </td>
    </tr>
  );
}
