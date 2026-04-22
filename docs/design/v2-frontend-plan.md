# v2 Frontend — Engineering Plan (Direction C: Brutalist Editorial)

Blueprint for the PUSD dApp frontend. Pairs with [ADR 0003](decisions/0003-product-architecture.md) and the [v2 contracts plan](v2-contracts-plan.md).

> **Design direction.** Direction C — brutalist editorial. Cream `#f3eee4` background, Fraunces serif for display, IBM Plex Mono for numerics, magenta `#dd44b9` as a single accent. See `mockup-c-brutalist.html` at the repo root for the visual reference. Direction C is already established in v1 (`docs/design/v1-frontend-plan.md`) — v2 inherits every token, adds surfaces for PUSD+ and Uniswap V3 LP state.
>
> **Scope.** React + Vite SPA. Connects via `@pushchain/ui-kit` (`PushUniversalWalletProvider`). Default flow mints **PUSD+**; plain **PUSD** is one toggle away. Reads pulled from RPC via viem; writes via `pushChainClient.universal.sendTransaction`. Liquidity venue is Uniswap V3 on Push Chain — one USDC/USDT pool at launch.
>
> **Non-goals.** Mobile-native app. In-app on-ramp. Governance UI (there is no governance token at launch). Cross-chain LP visualisation (same-chain only at launch, deferred to v2.1).

---

## 1. File tree

```
app/
├── index.html                      Brutalist base template (serif + mono fonts, cream bg)
├── package.json                    React 18 + Vite 5 + @pushchain/ui-kit + viem + tailwind
├── tailwind.config.ts              Custom design tokens (see §3)
├── vite.config.ts                  Standard Vite + env var plumbing
│
└── src/
    ├── main.tsx                    Root: PushUniversalWalletProvider wraps <App/>
    ├── App.tsx                     Route layout: / (Stablecoin) + /mint + /reserves
    │
    ├── routes/
    │   ├── Stablecoin.tsx          I. — landing: what is PUSD, what is PUSD+, live stats
    │   ├── Mint.tsx                II. — default PUSD+ mint card + toggle for plain PUSD
    │   ├── Redeem.tsx              III. — unwrap PUSD+ or redeem plain PUSD
    │   └── Reserves.tsx            IV. — live reserve breakdown (par + yield-share)
    │
    ├── components/
    │   ├── layout/
    │   │   ├── Masthead.tsx        "THE PUSD LEDGER · VOL. II" + date + connected-wallet pill
    │   │   ├── Nav.tsx             Roman-numeral section nav (I. II. III. IV.)
    │   │   ├── Rule.tsx            Horizontal rule component (double / thick / hairline variants)
    │   │   └── Footer.tsx          Colophon: invariants ribbon, audit links, version
    │   │
    │   ├── mint/
    │   │   ├── MintCard.tsx        Composite card: token picker, amount, PUSD/PUSD+ toggle, submit
    │   │   ├── TokenPicker.tsx     Source stablecoin dropdown — 9 USDC/USDT origins (same as v1)
    │   │   ├── AmountInput.tsx     Big brutalist numeric input; mono; no borders, underline only
    │   │   ├── ModeToggle.tsx      "MINT & EARN (PUSD+)" | "PLAIN PUSD" segmented control
    │   │   └── QuoteBlock.tsx      "You will receive" block: shares@pps, fees, ETA, source slice
    │   │
    │   ├── redeem/
    │   │   ├── RedeemCard.tsx      Unified: switches to Unwrap flow when input token is PUSD+
    │   │   ├── RouteExplainer.tsx  Shows active path: Preferred / Basket / Emergency (for PUSD)
    │   │   └── UnwindBudget.tsx    For PUSD+: idle + instant-unwind + LP-unwind cost info
    │   │
    │   ├── reserves/
    │   │   ├── ReserveTable.tsx    Two-column table: parReserve vs yieldShareReserve per token
    │   │   ├── PositionRail.tsx    LP position cards: pool, tick range, in-range, fees, share of yield slice
    │   │   ├── PPSChart.tsx        PUSD+ pps over time (line, mono style)
    │   │   └── Invariants.tsx      Live ribbon: I-01 OK / I-01b OK / I-12 OK / I-13 OK
    │   │
    │   ├── common/
    │   │   ├── Metric.tsx          Big number + small label, mono font
    │   │   ├── Tag.tsx             Single-word status tag (ENABLED, REDEEM_ONLY, ...)
    │   │   ├── MagentaLink.tsx     Hand-drawn underline hover effect — the one accent
    │   │   ├── CopyRow.tsx         Address copy pattern
    │   │   ├── InlineError.tsx     Small red-ink rule + message for tx errors
    │   │   └── TxStatus.tsx        Pending / mining / success / reverted badges
    │   │
    │   └── wallet/
    │       ├── ConnectPill.tsx     Wraps PushUniversalAccountButton with brutalist theme overrides
    │       └── NetworkBadge.tsx    Push Chain Donut / mainnet indicator
    │
    ├── hooks/
    │   ├── usePUSDConfig.ts        Read MAX_TOKENS, baseFee, preferredFee, vaultHaircut
    │   ├── useSupportedTokens.ts   Read tokenList + TokenInfo for each
    │   ├── useReserveSlices.ts     Read parReserveOf / yieldShareReserveOf per token
    │   ├── useLPPositions.ts       PUSDLiquidity.positions → pool, range, in-range flag, valuation, fees
    │   ├── usePoolPrice.ts         Read spot tick / slot0 from the USDC/USDT UniV3 pool for peg display
    │   ├── usePPS.ts               Compute PUSD+ price-per-share from totalAssets/totalSupply
    │   ├── useUserBalances.ts      User's token balances, PUSD, PUSD+
    │   ├── useMintQuote.ts         Preview deposit: output shares + fees + route
    │   ├── useRedeemQuote.ts       Preview redeem: output token + route + slippage
    │   ├── useUnwindCapacity.ts    For PUSD+ redeems: idle + per-position instant unwind
    │   ├── useTxHistory.ts         Event-log cached recent tx list (no localStorage — in-memory only)
    │   ├── useInvariantPulse.ts    Polls I-01 / I-01b / I-12 / I-13 every 15s for the live ribbon
    │   └── useContracts.ts         Returns viem contract clients keyed by network
    │
    ├── lib/
    │   ├── decimals.ts             normaliseToPUSD / convertFromPUSD mirroring on-chain math
    │   ├── format.ts               6d token / 18d share / bps-to-% / tx-hash-short helpers
    │   ├── viemClient.ts           Public client via donut rpc; wallet client from ui-kit signer
    │   ├── univ3.ts                tick ↔ price, liquidity ↔ amounts, in-range helpers (ported from Uniswap V3 SDK math)
    │   └── abi/
    │       ├── PUSD.ts             Generated or hand-curated ABI const
    │       ├── PUSDManager.ts
    │       ├── PUSDPlus.ts
    │       ├── PUSDLiquidity.ts
    │       └── UniV3Pool.ts        slot0, liquidity, ticks, observe for spot/TWAP peg reads
    │
    ├── contracts/
    │   ├── addresses.ts            Per-network address book (donut / mainnet)
    │   └── constants.ts            BASIS_POINTS, HARD_CAP_BPS, MAX_TOKENS (mirrored)
    │
    ├── styles/
    │   ├── tokens.css              CSS variables: palette, spacing scale, typography
    │   └── brutal.css              Page-level brutal touches (noise, rules, print marks)
    │
    └── types/
        └── protocol.ts             TokenStatus enum + TokenInfo interface mirrors
```

---

## 2. Wallet + transaction plumbing

Uses `@pushchain/ui-kit` throughout. One provider; no separate `@pushchain/core` dependency.

### 2.1 Provider setup (main.tsx)

```tsx
import { createRoot } from 'react-dom/client';
import { PushUniversalWalletProvider, PushUI } from '@pushchain/ui-kit';
import App from './App';

const walletConfig = {
  network: PushUI.CONSTANTS.PUSH_NETWORK.TESTNET, // mainnet swap at launch
  themeMode: PushUI.CONSTANTS.THEME.LIGHT,
  app: {
    title: 'PUSD',
    description: 'Push USD — the stable yours from anywhere.',
  },
  login: { email: true, google: true, wallet: true },
};

createRoot(document.getElementById('root')!).render(
  <PushUniversalWalletProvider
    config={walletConfig}
    themeOverrides={{
      '--pw-core-bg-primary-color': '#f3eee4',
      '--pw-core-bg-secondary-color': '#fbf7ec',
      '--pw-core-brand-primary-color': '#dd44b9',
      '--pw-core-text-primary-color': '#0f0d0a',
      '--pw-core-btn-border-radius': '0px',
      '--pwauth-btn-connect-bg-color': '#0f0d0a',
      '--pwauth-btn-connect-text-color': '#f3eee4',
      '--pwauth-btn-connect-border-radius': '0px',
    }}
  >
    <App />
  </PushUniversalWalletProvider>
);
```

Rationale for the overrides:
- Zero border radius — brutalist editorial. Hard corners everywhere, no pill buttons.
- Cream background matches Direction C canvas.
- Magenta is used sparingly; only `--pw-core-brand-primary-color` and accent hovers.
- Connect button is espresso-on-cream inverted — intentionally loud.

### 2.2 Hook pattern (canonical guard)

Every component that does anything on-chain uses the guard from the skill:

```tsx
const { pushChainClient, isInitialized, error } = usePushChainClient();

if (error) return <InlineError message={error.message} />;
if (!isInitialized) return <SkeletonBlock />;
if (!pushChainClient) return <ConnectPrompt />;
```

This is extracted into a single `<OnchainGate>` wrapper so per-component code stays clean.

### 2.3 Route selection — all writes are Route 1

PUSD lives on Push Chain. Every mint / redeem / wrap / unwrap is a **Route 1 transaction**: `to` is a Push Chain address, nothing crosses a bridge. The universal wallet handles signer sourcing (MetaMask origin → Push EOA; Phantom origin → Push EOA via CEA; email/Google → Push wallet).

```tsx
const tx = await pushChainClient.universal.sendTransaction({
  to: PUSDPlus_ADDRESS,
  data: PushChain.utils.helpers.encodeTxData({
    abi: PUSDPlus_ABI,
    functionName: 'depositStable',
    args: [usdcAddress, amount, userAddress],
  }),
});
await tx.wait();
```

No Route 2, no Route 3, no cascade at launch. If v2.x adds "deposit from USDC on Ethereum directly into PUSD+", that becomes a Route 2 + Route 3 pattern but is explicitly out of scope here.

### 2.4 Reads — viem + RPC

Views (`totalAssets`, `parReserveOf`, `pps`, `tokenInfo`) are not transactions and don't need the wallet client. We use `viem` with the Donut RPC directly:

```ts
export const publicClient = createPublicClient({
  chain: pushChainDonut,
  transport: http('https://evm.donut.rpc.push.org/'),
});
```

Reads run on a 15s interval for "live" metrics (pps, reserves, invariants) and once on route enter for static data (tokenList, decimals). Writes invalidate affected queries via a small React Query layer.

### 2.5 Transaction lifecycle UI

`TxStatus` has five visual states, each rendered as a single-line stamp in the mono font:
- `PREPARED · 0x…` (local, not submitted)
- `PENDING · 0x…` (awaiting wallet signature)
- `SUBMITTED · 0x…` (in mempool)
- `CONFIRMED · 0x… · block ###` (final)
- `REVERTED · reason` (terminal, red-ink rule)

No toast, no modal — inline under the submit button. Persists until user dismisses or starts a new tx.

---

## 3. Design tokens (Direction C)

### 3.1 Palette

| Name | Hex | Role |
|---|---|---|
| `cream` | `#f3eee4` | page background |
| `cream-light` | `#fbf7ec` | card surface, overlay |
| `espresso` | `#0f0d0a` | primary text, rules |
| `ink` | `#1b1612` | secondary text |
| `ink-mute` | `#554d42` | muted text |
| `magenta` | `#dd44b9` | sole accent — links, highlights, critical CTAs |
| `gold` | `#d4b47a` | secondary accent — strategy yield, NAV gain markers |
| `oxblood` | `#a63a2a` | error / revert state |
| `jade` | `#2e6e4c` | success / above-par state |

Only `magenta` and `gold` break the monochrome. They appear sparingly — one or two times per viewport, never bullet-point status indicators.

### 3.2 Type

- **Display / Serif** — Fraunces (variable, italic enabled). Used for all headings, numeric big-figures, and marketing lines.
- **Mono** — IBM Plex Mono. Used for every number the protocol produces (balances, fees, pps, addresses, bps), and for form inputs.
- **Sans** — none. We skip a sans tier on purpose; body copy is Fraunces roman at 18–20px with tight leading.

```css
--font-display: 'Fraunces', Georgia, serif;
--font-mono:    'IBM Plex Mono', ui-monospace, monospace;
--size-h1: 88px; /* "PUSD — par by default." hero */
--size-h2: 40px;
--size-h3: 24px;
--size-body: 18px;
--size-small: 14px;
--size-mono: 16px;
```

### 3.3 Rules and hairlines

Five types; used aggressively:
- `rule-hair` — 1px espresso. Between form rows, inside tables.
- `rule-thick` — 3px espresso. Section boundaries.
- `rule-double` — two 1px lines separated by 4px. Major section boundaries ("masthead ↔ body").
- `rule-dotted` — 1px espresso dotted, 4px gap. Temporal markers (cashflow, tx log).
- `rule-dashed-magenta` — 1px magenta dashed. Currently-active or loading state.

### 3.4 Layout

- 12-column grid at 1280px / 16px gutters / 64px outer margin. Content never exceeds 11 columns.
- Masthead is 11 columns wide; nav sits on a 1-column anchor to the right.
- Mint and Redeem cards occupy columns 2–10 (9-col width). Sidebars hold "at a glance" facts in columns 10–11.
- Mobile (< 720px): single column, rules gain weight, magenta usage doubles (acts as "we-are-at-a-tap-away" guide).

### 3.5 Motion

Almost none. Direction C rejects bouncy transitions. Allowed:
- Opacity fade on route change (120ms).
- Rule draw-in on mount (250ms, once).
- Magenta hover underline draws left-to-right (180ms).

No parallax. No gradient animation. No loading spinners — replaced with a 3-character mono ticker (`· · ·`).

---

## 4. Routes and flows

### 4.1 `/` — Stablecoin (landing)

Hero:
> *"A dollar that behaves — anywhere on Push Chain."*

Below, a 4-column metric strip (mono):
- `TVL · $XX.XXm`
- `PUSD · $XX.XXm`
- `PUSD+ · $XX.XXm (NAV $1.0XX)`
- `LAST BLOCK · ###` (proof of liveness)

Two cards side by side:

**I. PUSD — the boring dollar.**
One-paragraph serif pitch + feature bullets (backing, instant redeem, settlement-grade). CTA: "Mint plain PUSD →" (magenta underline on hover).

**II. PUSD+ — the dollar that earns.**
One-paragraph pitch + "Current fee APR (30d): X.XX%" + "LP positions active: X in range · Y out" + "Deployed: Z% of cap". CTA: "Mint & earn →" (bolder magenta button).

Foot: the live invariant ribbon (see §5.3).

### 4.2 `/mint` — Mint flow

The flagship route. Default mode is PUSD+. One composite `MintCard` with:

1. **TokenPicker** — nine USDC/USDT origins (Ethereum Sepolia, Solana Devnet, Base Sepolia, Arbitrum Sepolia, BNB Testnet). Exactly the v1 set; v2 adds no new token classes.
2. **AmountInput** — large mono with the ticker in ghost text (`123.456 USDC`).
3. **ModeToggle** — segmented control: `MINT & EARN (PUSD+)` | `PLAIN PUSD`. PUSD+ is active by default.
4. **QuoteBlock** — shows the full receipt:
   - "YOU DEPOSIT · 123.456 USDC"
   - "YOU RECEIVE · 123.456 PUSD+" (or "123.456 PUSD" if toggled)
   - If PUSD+: "AT CURRENT NAV · 1.012 PUSD/share → 122.00 shares"
   - If PUSD: "FEE · 0.123 USDC (5 bps haircut)"
   - "ESTIMATED TIME · ~5s (instant, Route 1)"
5. **Submit button** — "SIGN & DEPOSIT" (espresso-on-cream inverted).

Below the submit line: a small `RouteExplainer` explains which slice gets credited (par / yield-share) and why. This is **editorial transparency**, not a legal disclaimer — it reads like a newspaper box-out.

### 4.3 `/redeem` — Redeem flow

Unified entry. The input token selector switches between PUSD+ and PUSD modes automatically.

For **plain PUSD**:
- Preferred asset picker.
- "Allow basket if preferred is short" toggle (default on).
- `RouteExplainer` shows which of the three paths will execute (Preferred / Basket / Emergency) and why.
- Fee line is explicit: "PREFERRED FEE · 25 bps (tier: overrepresented)".

For **PUSD+**:
- Target stablecoin picker.
- `UnwindBudget` box: "IDLE · $X.XXm · INSTANT UNWIND (LP) · $X.XXm · EST. SLIPPAGE · X bps". Shows whether the requested size is within instant capacity and the expected unwind cost.
- Instant unwind capacity is computed from the sum of `(position.liquidity × tick-range)` across active LP positions at current pool price. Any position out-of-range contributes zero to the requested-token side.
- If request exceeds instant capacity: block the submit and show a banner ("Request exceeds instant-unwind capacity by $X.XX. Split your redeem or retry in ~10 min while the keeper rebalances.").

Submit UI matches `/mint`.

### 4.4 `/reserves` — Live reserves

Public transparency page. Readers can verify the live state of the protocol at any time. Three regions:

**Region A — Reserve table.** Columns: Token · Chain · Status · Par Reserve · Yield-Share Reserve · Accrued Fees · Accrued Haircut. One row per supported token (nine rows at launch — same USDC/USDT set as v1). Status rendered as a `Tag`. Numbers mono, right-aligned.

**Region B — LP positions (`<PositionRail>`).** Vertical list — one card per active Uniswap V3 position. Each card shows:

```
POSITION #1   ·   USDC/USDT 0.01%   ·   IN RANGE
────────────────────────────────────────────────
TICKS            −50bps … +50bps around 1.0000
VALUE            1,240,000 USDC + 1,240,000 USDT  ≈ 2.48m PUSD
FEES ACCRUED     1,242.18 USDC + 1,238.44 USDT   (uncollected)
SHARE OF YIELD   18.3% of PUSDPlus.totalAssets()
7d FEE APR       4.12%
NPM TOKEN        #481  ↗
```

- `IN RANGE` tag rendered jade; `OUT OF RANGE` oxblood; displays the last-in-range timestamp when out.
- Multiple positions stack; default sort: deployed value descending.
- If zero positions exist (contract just deployed, pre-LP): a single editorial panel explains the yield slice is fully idle and deployment is imminent.

**Region C — Pool peg chart.** USDC:USDT spot price from the pool's `slot0.sqrtPriceX96` over 24h. A horizontal rule at parity; any deviation > 20 bps flags as a gold annotation. This is our "is the peg holding" dashboard.

**Region D — PPS chart.** Mono-styled line chart of PUSD+ pps over 30d. No gradient fill; just a hairline. Annotates each performance-fee crystallisation as a small dotted vertical rule. Y-axis starts at 1.000, never zero.

Foot: the live invariant ribbon.

---

## 5. Shared components (detail)

### 5.1 `<MintCard>`

Data dependencies (via hooks):
- `useSupportedTokens()` — list + decimals + status.
- `useUserBalances(tokens)` — user's token balance + allowance per token.
- `useMintQuote(token, amount, mode)` — preview output.
- `usePPS()` — current PUSD+ price-per-share.

Submit behaviour:
- If allowance < amount: first tx is `approve(...)`; then the mint tx. UI shows both stamps sequentially.
- If `mode === 'PUSD_PLUS'`: call `PUSDPlus.depositStable(token, amount, user)`.
- If `mode === 'PUSD'`: call `PUSDManager.deposit(token, amount)`.

### 5.2 `<RedeemCard>`

Data dependencies:
- `useUserBalances()` for PUSD + PUSD+.
- `useReserveSlices()` for available liquidity per token (both slices).
- `useRedeemQuote(token, amount, mode)`.
- `useUnwindCapacity()` for PUSD+ mode.

Submit behaviour:
- `PUSD` mode → `PUSDManager.redeem(pusdAmount, preferredAsset, allowBasket)`.
- `PUSD+` mode → `PUSDPlus.redeemToStable(shares, token, user)`.

### 5.3 `<Invariants>` (live ribbon)

Renders in the footer on every page.

```
━━━ I-01 RESERVE OK · I-01b PUSD+ NAV 1.0142 · I-12 DEPLOYED 18.3% · I-13 LP ACCOUNTING OK ━━━
```

All four values are pulled live (15s interval). If any check fails:
- I-01 fails → full-page banner: "Reserve integrity check failed. Sitting back until we verify."
- I-01b fails → banner: "PUSD+ NAV has drifted below 1.0. Redemption is paused."
- I-12 fails → banner: "LP deployment exceeded cap. Keeper is unwinding."
- I-13 fails → banner: "LP position valuation has drifted beyond tolerance. Re-reading pool state…"

This is aggressive on purpose. If our own invariants break, we say so loudly.

### 5.4 `<ConnectPill>`

A themed `PushUniversalAccountButton`. Props set:
- `connectButtonText="CONNECT WALLET"` (mono, uppercase).
- `themeOverrides` with `--pwauth-btn-connect-border-radius: 0`.
- `connectedButtonClassName="brutal-connected"` — gives it a 2px espresso border and a small status LED dot (no colour fill).

### 5.5 `<Masthead>`

```
─────────────────────────────────────────────────────────────────
┌ ── THE PUSD LEDGER ──────────────────────── VOL. II · APR 22, 2026 ┐
│                                                                     │
│   I. STABLECOIN   II. MINT   III. REDEEM   IV. RESERVES             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                                     [CONNECT WALLET]
=================================================================
```

Rules are real CSS `border-top` / `border-bottom` on a grid container. The "=" line is a thick double rule, not characters.

---

## 6. Data contracts (hooks)

All return values are mono-formatted strings where appropriate (calculation in BigInt, rendering via `lib/format.ts`).

```ts
// usePPS
interface PPS {
  raw: bigint;          // pps in 1e18 fixed-point
  display: string;      // "1.0142"
  loading: boolean;
  error?: Error;
}

// useMintQuote (PUSD+ mode)
interface MintQuote {
  in: { token: Address; amount: bigint; decimals: number };
  out: { shares: bigint; sharesDisplay: string; implicitPUSD: bigint };
  fees: { haircutBps: number; haircutDisplay: string };
  route: 'YIELD_SHARE';
  loading: boolean;
  error?: Error;
}

// useRedeemQuote (plain PUSD mode)
interface RedeemQuote {
  in: { pusd: bigint };
  out: { token: Address; amount: bigint; display: string };
  path: 'PREFERRED' | 'BASKET' | 'EMERGENCY';
  fees: { bps: number; display: string };
  loading: boolean;
  error?: Error;
}

// useInvariantPulse
interface InvariantPulse {
  i01:  { ok: boolean; ratio: number };       // balance / slice-sum
  i01b: { ok: boolean; pps: string };
  i12:  { ok: boolean; utilisation: number };  // LP deployed as % of cap
  i13:  { ok: boolean; driftBps: number };     // LP valuation drift from yieldShareReserve book
  lastChecked: number;                          // ms epoch
}

// useLPPositions
interface LPPosition {
  tokenId: bigint;
  pool: Address;
  token0: { symbol: 'USDC' | 'USDT'; address: Address; decimals: number };
  token1: { symbol: 'USDC' | 'USDT'; address: Address; decimals: number };
  feeTier: 100 | 500 | 3000 | 10000;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  inRange: boolean;
  amount0: bigint;
  amount1: bigint;
  uncollectedFees0: bigint;
  uncollectedFees1: bigint;
  valueInPUSD: bigint;                         // normalized 6dp
  shareOfYield: number;                         // 0..1
  sevenDayFeeAPR: number;                       // 0..1
}
```

---

## 7. Testing

### 7.1 Unit

- Every pure helper in `lib/` (decimal normalisation, format, route classification) has Vitest coverage with property tests for decimal math.
- Hooks mock the viem client + the Push Chain client via MSW / manual stubs.

### 7.2 Component

- Storybook with every `components/*` rendered in isolation across both themes (light only at launch, but token set is theme-agnostic).
- Visual regression via Chromatic or Loki on: `/`, `/mint` (both modes), `/redeem` (both modes), `/reserves`.

### 7.3 Integration

- End-to-end against a local Anvil + deployed v2 contracts. Scenarios:
  1. Connect via MetaMask → mint PUSD+ → read balance → redeem half → verify slice accounting.
  2. Connect via Push email login → mint PUSD → redeem via basket (simulated by admin setting REDEEM_ONLY on preferred asset).
  3. Transaction revert path: user approves, protocol is paused by admin, submit → `REVERTED` stamp with "paused" reason surfaces cleanly.

### 7.4 Accessibility

- All interactive elements have accessible names; keyboard-only flow tested for mint + redeem.
- Mono-only numeric displays have `role="status"` on live-update regions.
- Contrast — espresso-on-cream is ~13:1. Magenta-on-cream is ~3.6:1, so **magenta only appears on ≥ 16px text or on rules**, never on body text.

---

## 8. Build & deploy

- **Dev:** `npm run dev` via Vite.
- **Type safety:** TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **Lint:** ESLint with `eslint-plugin-jsx-a11y` + `eslint-plugin-react-hooks`.
- **Format:** Prettier (tabs? no — 2 spaces, single quotes, trailing commas, 100 cols).
- **Test:** Vitest + Testing Library + Playwright for e2e.
- **Bundle:** Vite's default rollup; target ES2022. Tree-shakes `@pushchain/ui-kit` cleanly.
- **Env:** `.env.example` checked in with `VITE_PUSH_NETWORK`, `VITE_RPC_URL`, and `VITE_CONTRACT_ADDRESSES_JSON` (base64).
- **Hosting:** static bundle deployed to a dumb CDN (Cloudflare Pages or Vercel). No SSR at launch.

---

## 9. Phasing

**Phase 1 — Skeleton (1 week)**
Provider setup, masthead, nav, `/` landing. Connect pill works. No on-chain writes yet.

**Phase 2 — Reads (1 week)**
All hooks wired (tokens, reserves, pps, user balances). `/reserves` renders with live data. Invariant ribbon operational against testnet contracts.

**Phase 3 — Mint (1.5 weeks)**
`/mint` flow end-to-end for both modes. Tx lifecycle + inline stamps. Approve-then-mint chaining.

**Phase 4 — Redeem + LP visualisation (2 weeks)**
`/redeem` for plain PUSD (preferred / basket / emergency classification) and PUSD+ (unwind capacity + instant redeem). `InsufficientLiquidity` revert handled gracefully. `<PositionRail>` wired to `useLPPositions` with spot pool reads. Pool peg chart operational.

**Phase 5 — Polish (1 week)**
Visual regression green. a11y pass. Mobile tuning. Landing-page copy finalised with Prodigy.

**Phase 6 — Launch gates (0.5 week)**
Deploy to preview → QA pass → production build → cut.

**Total:** ~7 weeks frontend, runnable mostly in parallel with contracts Phases 3–5. The v1 frontend (`docs/design/v1-frontend-plan.md`) ships first; v2 extends that tree in place — every v1 component still lives in v2 and Direction C tokens carry through unchanged.

---

## 10. Risks to the plan

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Push UI-kit version drift during implementation | Medium | Low | Pin exact version; upgrade intentionally |
| RPC rate limits on the public Donut endpoint | Medium | Medium | Batch reads with multicall; debounce live polling; consider private RPC before mainnet |
| Wallet connection edge cases (Phantom via CEA first time) | Medium | Medium | Integration test covers the CEA-first-touch flow; helpful copy on the landing page |
| Direction C readability on low-contrast screens | Medium | Medium | Contrast verified in §7.4; a single opt-in high-contrast toggle planned for v2.1 |
| ERC-4626 quoting drift (`previewDeposit` differs from actual) | Low | Medium | Always re-quote at tx submission; show "estimated" label until confirmed |
| UniV3 position valuation skew during volatile pool ticks | Medium | Medium | `useLPPositions` refreshes `slot0` with every call; `usePoolPrice` TWAPs 5m to smooth display; values marked with "estimated" pill until settlement |
| LP out-of-range presentation causes user panic | Medium | Low | Clear editorial explainer on `/reserves` — "Out of range = not earning fees, not losing principal." |
| Design direction change post-launch | Low | High | Tokens centralised in `styles/tokens.css`; swapping palette is a one-file edit |

---

## 11. Hand-off checklist for implementation

First PR should land:
- [ ] `package.json` with pinned `@pushchain/ui-kit`, `viem`, `react@18`, `tailwindcss`, `vitest`.
- [ ] `main.tsx` with provider + theme overrides baked in.
- [ ] `App.tsx` with route skeleton + `<Masthead/>` + `<Footer/>` — but no content in routes.
- [ ] `styles/tokens.css` with the full §3 palette + type scale.
- [ ] `lib/abi/` stubs with empty arrays (filled when contracts land).
- [ ] `.env.example`.
- [ ] Storybook with one `<Masthead>` story.

This unblocks parallel work on hooks, components, and routes.

---

*End of plan.*
