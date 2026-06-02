/**
 * FaqSection — plain-language FAQ explaining PUSD (par-backed) and PUSD+
 * (yield-bearing) for visitors. Two grouped accordions, one per product.
 *
 * Native <details>/<summary> for zero-JS, accessible collapse. The first
 * item in each group opens by default so the section reads as content, not
 * an empty stack of toggles. Styling lives in global.css (.faq*) — all from
 * design tokens, no stray color.
 */

import { type ReactNode } from 'react';
import { analytics } from '../lib/analytics';

type QA = { q: string; a: ReactNode };

const PUSD_FAQ: QA[] = [
  {
    q: 'What is PUSD?',
    a: (
      <>
        PUSD is a dollar stablecoin native to Push Chain, backed <strong>1:1</strong> by a
        basket of USDC and USDT. Every PUSD in circulation is redeemable for $1 of real
        reserves. No algorithmic peg, no rehypothecation.
      </>
    ),
  },
  {
    q: 'How is PUSD kept fully backed?',
    a: (
      <>
        Each PUSD is collateralised by USDC/USDT held by the PUSDManager contract. The
        protocol never lends out or rehypothecates reserves, so the collateral ratio stays at
        or above <strong>100%</strong>. You can verify it live on the{' '}
        <a href="/reserves">Reserves</a> page.
      </>
    ),
  },
  {
    q: 'How do I mint PUSD?',
    a: (
      <>
        Deposit any supported USDC or USDT and receive PUSD 1:1. From an external wallet
        (MetaMask, Phantom…) the approve + deposit ride in a <strong>single signature</strong>,
        and the protocol automatically moves your tokens onto Push Chain for you if they live on another
        chain.
      </>
    ),
  },
  {
    q: 'How do I redeem PUSD?',
    a: (
      <>
        Burn PUSD to get a reserve token back, 1:1 minus a small fee. Keep the payout on Push
        Chain, or have it delivered to your wallet on an external chain in the same flow.
      </>
    ),
  },
  {
    q: 'What does it cost?',
    a: (
      <>
        Minting is <strong>free</strong> (0%). Redeeming charges a small base fee (0.05% by
        default) plus a preferred-asset premium that scales with how liquid that token is.
        Choosing <strong>basket</strong> redemption pays the base fee only.
      </>
    ),
  },
  {
    q: 'Which chains are supported?',
    a: (
      <>
        Funds and payload bridging currently run on <strong>Ethereum Sepolia, Arbitrum
        Sepolia, Base Sepolia, BNB Testnet, and Solana Devnet</strong>. You hold and redeem
        PUSD on Push Chain; the origin and destination chains are just routing.
      </>
    ),
  },
  {
    q: 'Do I have to bridge before minting?',
    a: (
      <>
        No. Push Chain's universal transaction layer collapses “bridge, approve, deposit” into
        one signature. Your chain of origin is a routing detail, not a step you manage.
      </>
    ),
  },
];

const PLUS_FAQ: QA[] = [
  {
    q: 'What is PUSD+?',
    a: (
      <>
        PUSD+ is the <strong>yield-bearing</strong> companion to PUSD. Hold it and its value
        grows automatically as the protocol earns trading fees from stablecoin liquidity on
        Push Chain.
      </>
    ),
  },
  {
    q: 'Where does the yield come from?',
    a: (
      <>
        The vault supplies reserves to Uniswap V3 pools that swap <strong>only between
        stablecoins</strong> (e.g. USDC↔USDT) and harvests the trading fees. Because both
        sides are dollars, there is no directional market exposure.
      </>
    ),
  },
  {
    q: 'How does my balance grow?',
    a: (
      <>
        PUSD+ uses a <strong>NAV-per-share</strong> model. Your number of PUSD+ tokens stays
        the same; each one becomes redeemable for more PUSD over time as NAV rises, and NAV
        only moves up.
      </>
    ),
  },
  {
    q: 'Is PUSD+ riskier than PUSD?',
    a: (
      <>
        The strategy is stablecoin-only, so it carries no price-direction risk, and PUSD's 1:1
        promise is never touched. PUSD+ assets back PUSD+ holders directly. The trade-off is
        redemption <em>timing</em>, not principal.
      </>
    ),
  },
  {
    q: 'How do I mint and redeem PUSD+?',
    a: (
      <>
        Mint with any reserve token, or <strong>wrap PUSD</strong> you already hold, in one
        call. Redeem back to PUSD or a reserve token: fulfilment is instant when the vault has
        idle liquidity, drawn from the basket next, or queued (FIFO) and settled when liquidity
        returns. Your NAV is locked the moment you burn.
      </>
    ),
  },
  {
    q: 'PUSD or PUSD+, which should I hold?',
    a: (
      <>
        Hold <strong>PUSD</strong> for a pure 1:1 dollar with instant redemption. Hold{' '}
        <strong>PUSD+</strong> to earn passive yield on idle dollars while keeping the same
        1:1 backing guarantees underneath.
      </>
    ),
  },
];

function FaqGroup({
  product,
  tag,
  sub,
  items,
}: {
  product: 'pusd' | 'pusd-plus';
  tag: ReactNode;
  sub: string;
  items: QA[];
}) {
  return (
    <div className="faq__group">
      <div className="faq__group-head">
        <span className="faq__group-tag">{tag}</span>
        <span className="faq__group-sub">{sub}</span>
      </div>
      {items.map((item, i) => (
        <details
          className="faq__item"
          key={item.q}
          open={i === 0}
          onToggle={(e) => {
            if (e.currentTarget.open) {
              analytics.event('faq_item_toggle', { product, question: item.q });
            }
          }}
        >
          <summary className="faq__q">{item.q}</summary>
          <div className="faq__a">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

export function FaqSection() {
  return (
    <div className="faq">
      <FaqGroup
        product="pusd"
        tag="PUSD"
        sub="PAR · 1:1 · FULLY BACKED"
        items={PUSD_FAQ}
      />
      <FaqGroup
        product="pusd-plus"
        tag={<>PUSD<em style={{ color: 'var(--c-magenta)', fontStyle: 'normal' }}>+</em></>}
        sub="YIELD · NAV-BEARING"
        items={PLUS_FAQ}
      />
    </div>
  );
}
