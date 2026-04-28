/**
 * ChangelogPage — /changelog route. Editorial release notes.
 *
 * Hand-maintained, newest entry first. Tags map to colour pills:
 *   FEAT — new user-facing flow or primitive
 *   FIX  — bug or regression resolved
 *   OPS  — deployment, RPC, infra
 *   DOCS — docs-only or cosmetic
 *
 * We deliberately keep this hand-written rather than scraped from git —
 * it's a reader product, not a log file. When a release lands, add an
 * entry at the top; everything else shifts down.
 */

type Tag = 'FEAT' | 'FIX' | 'OPS' | 'DOCS';

type Entry = {
  date: string;       // human label like "APR 23, 2026"
  tag: Tag;
  title: string;      // may contain <em> via markdown-free template below
  emphasis?: string;  // italic word inside the title
  body: string;
  bullets?: string[];
};

const ENTRIES: Entry[] = [
  {
    date: 'APR 23, 2026',
    tag: 'FIX',
    title: 'Dispatch + Activity feeds return',
    emphasis: 'return',
    body:
      'Both the home-page Dispatch tape and the Activity history table were silently failing on Donut Testnet because the RPC caps eth_getLogs at ~2,048 blocks per call. We were asking for 20k and 10k. Windowed scans are now bounded to 2k, which stays under the cap and comes back with real rows.',
    bullets: [
      'useProtocolDispatch: WINDOW_BLOCKS 20,000 → 2,000',
      'useUserHistory: WINDOW_BLOCKS 10,000 → 2,000',
      'UI labels updated on HistoryPage, DispatchFeed, ReservesPage',
    ],
  },
  {
    date: 'APR 23, 2026',
    tag: 'FEAT',
    title: 'Focused /reserves route with distribution + by-chain bars',
    emphasis: 'Focused',
    body:
      'The / route is still the editorial home. /reserves is now a dedicated book view — collateral ratio up top, a full-width allocation distribution bar with a colour-keyed legend, aggregate by origin chain, and the complete asset table below. If you only care about solvency, this is your page.',
  },
  {
    date: 'APR 23, 2026',
    tag: 'FEAT',
    title: 'EditorialBand + Ticker surface protocol health, not latency',
    emphasis: 'protocol health',
    body:
      'The masthead band used to show BLOCK / DONUT / LATENCY. That is accurate but not interesting to a holder. It now shows PEG, SUPPLY, RATIO, RESERVES — the numbers you would want to glance at before signing anything. Block and latency moved into the Ticker, where speed-of-RPC belongs.',
  },
  {
    date: 'APR 23, 2026',
    tag: 'FEAT',
    title: 'Convert / History empty states — show both paths',
    emphasis: 'both paths',
    body:
      'Before signing in, the Convert and History empty screens now present MINT and REDEEM (or HISTORY and CONVERT) as secondary routes. The vertical rhythm inside the gate was tight; it now breathes.',
  },
  {
    date: 'APR 22, 2026',
    tag: 'FEAT',
    title: 'Redeem supports Route 2 payout to origin chains',
    emphasis: 'Route 2',
    body:
      'Advanced redeem can now send the unwound reserve token from Push Chain back to the holder on Ethereum Sepolia, Base Sepolia, Solana Devnet, Arbitrum Sepolia, or BNB Testnet — in a single universal transaction. Note: Ethereum Sepolia is gated at the SDK level for CEA operations; if unsupported on the client, we surface the limitation inline.',
  },
  {
    date: 'APR 21, 2026',
    tag: 'FEAT',
    title: 'Editorial home — par-backed narrative + proof of reserves',
    emphasis: 'editorial',
    body:
      'Complete rewrite of / as an Issue 01 editorial: hero with inline Convert, stat strip, live ticker, slogan band, The Promise, Proof of Reserves book, three-column manifesto, and the Dispatch tape.',
  },
  {
    date: 'APR 20, 2026',
    tag: 'OPS',
    title: 'Deployment 2 — PUSDManager live on Donut Testnet',
    emphasis: 'live',
    body:
      'PUSD and PUSDManager deployed, reserve asset registry populated with USDC and USDT on five origin chains, base redemption fee set to 10 bps. Contract addresses pinned in contracts/config.ts.',
  },
  {
    date: 'APR 18, 2026',
    tag: 'DOCS',
    title: 'ADR-0003 — two-tier architecture',
    emphasis: 'two-tier',
    body:
      'Rewrote the product architecture decision: a tight PUSDManager custody layer plus a second-tier Uniswap V3 LP strategy that only activates on board vote. Reserves live in plain ERC-20 balance until then.',
  },
];

const TAG_CLASS: Record<Tag, string> = {
  FEAT: 'changelog__tag--feat',
  FIX: 'changelog__tag--fix',
  OPS: 'changelog__tag--ops',
  DOCS: 'changelog__tag--docs',
};

function renderTitle(title: string, emphasis?: string) {
  if (!emphasis) return title;
  const idx = title.toLowerCase().indexOf(emphasis.toLowerCase());
  if (idx < 0) return title;
  const before = title.slice(0, idx);
  const match = title.slice(idx, idx + emphasis.length);
  const after = title.slice(idx + emphasis.length);
  return (
    <>
      {before}
      <em>{match}</em>
      {after}
    </>
  );
}

export default function ChangelogPage() {
  return (
    <div className="container">
      <section className="section">
        <div className="section__header">
          <span>§ CHANGELOG · ISSUE 01</span>
          <span>HAND-WRITTEN · NEWEST FIRST</span>
        </div>
        <h1 className="hero__title" style={{ fontSize: 'clamp(40px, 4.5vw, 60px)', margin: '0 0 16px' }}>
          What <em>shipped</em>.
        </h1>
        <p className="hero__lead" style={{ maxWidth: '68ch', marginBottom: 32 }}>
          A record of the protocol and the product, written in the order it happened.
          If an entry is not here, it did not ship.
        </p>

        <div className="changelog">
          {ENTRIES.map((entry, i) => (
            <div className="changelog__entry" key={`${entry.date}-${i}`}>
              <div className="changelog__date">{entry.date}</div>
              <div className={`changelog__tag ${TAG_CLASS[entry.tag]}`}>{entry.tag}</div>
              <div className="changelog__body">
                <h3>{renderTitle(entry.title, entry.emphasis)}</h3>
                <p>{entry.body}</p>
                {entry.bullets && (
                  <ul>
                    {entry.bullets.map((b, bi) => (
                      <li key={bi}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
