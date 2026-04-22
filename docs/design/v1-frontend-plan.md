# v1 Frontend Engineering Plan

> **Scope.** Reskin and complete the existing `/app` React/Vite client against the live v1 deployment (PUSD + PUSDManager on Push Chain Donut Testnet, chain 42101). Direction C (brutalist editorial) from day 1. Four surfaces: Mint, Redeem, Reserves, History. A persistent Invariants ribbon. No yield, no PUSD+ — those arrive in v2.
>
> **Starting point.** `/app` already exists: Vite + React 19 + TypeScript + `@pushchain/ui-kit@5.2.4` + ethers 6, with working `MintTab` / `RedeemTab` / `DashboardTab` / `InfoTab`. The visual is a dark purple/blue theme that does not match Direction C. The plan below is a targeted rework of the existing tree — no greenfield rewrite.

---

## 0. Non-negotiable constraints

- **Wallet layer** — `PushUniversalWalletProvider` + `PushUniversalAccountButton` from `@pushchain/ui-kit`. Do not call MetaMask or WalletConnect directly.
- **Transaction layer** — every on-chain mutation goes through `pushChainClient.universal.sendTransaction`. Multi-step flows (approve + deposit, approve + redeem) use the `data: [{ to, value, data }, …]` cascade form.
- **Cross-chain mint** — deposits from Ethereum / Solana / Base / Arbitrum / BNB testnets must include `funds: { amount, token: MOVEABLE.TOKEN.X.Y }` so Push routes the stablecoin to the Donut-side representation before `deposit` runs.
- **SDK access** — read the bundled `@pushchain/core` via `usePushChain()`. Do not add `@pushchain/core` to `package.json`; `ui-kit` already bundles it.
- **Guard pattern** — every hook consumer must check `error → isInitialized → pushChainClient` before rendering. Silent failures are the #1 bug.
- **Direction C** — cream / espresso / magenta brutalist editorial. Zero border radius on all brutalist surfaces. Type pairs are Fraunces display + IBM Plex Mono data. No gradients, no glow, no purple/blue.

---

## 1. Design tokens (single source)

All colors, typography, and rhythm live in `src/styles/tokens.css` as CSS custom properties. No inline hex. No Tailwind (the existing `@tailwindcss/vite` plugin stays available for utility sprinkling but the core language is CSS variables + scoped components).

```css
:root {
  /* --- Palette --- */
  --c-cream:      #f3eee4;   /* page bg */
  --c-paper:      #faf6ec;   /* card bg */
  --c-ink:        #0f0d0a;   /* espresso — primary text, rules */
  --c-ink-dim:    #4a4540;   /* body, secondary */
  --c-ink-mute:   #8a847b;   /* metadata, captions */
  --c-rule:       #1a1713;   /* 1px hairlines */
  --c-magenta:    #dd44b9;   /* editorial accent (CTAs, live state) */
  --c-gold:       #d4b47a;   /* numeric accent (balances, APY later) */
  --c-oxblood:    #7a2a2a;   /* errors, invariant violation */
  --c-jade:       #2a6b52;   /* success, in-range, I-01 holds */

  /* --- Typography --- */
  --f-display: 'Fraunces', 'Charter', 'Georgia', serif;
  --f-body:    'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --f-mono:    'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace;

  /* --- Rhythm --- */
  --grid: 12;
  --gutter: 24px;
  --col-max: 1200px;
  --rule-thin: 1px solid var(--c-rule);
  --rule-med:  2px solid var(--c-ink);
  --rule-bold: 4px solid var(--c-ink);

  /* --- Radius — ZERO is the rule --- */
  --r-0: 0;       /* default for every card, button, input */
  --r-sm: 2px;    /* only for pills/tags that need slight softening */

  /* --- Push UI-kit bridge --- */
  --pw-core-bg-primary-color: var(--c-cream);
  --pw-core-bg-secondary-color: var(--c-paper);
  --pw-core-text-primary-color: var(--c-ink);
  --pw-core-brand-primary-color: var(--c-magenta);
  --pw-core-btn-border-radius: var(--r-0);
  --pw-core-modal-border-radius: var(--r-0);
  --pwauth-btn-connect-bg-color: var(--c-ink);
  --pwauth-btn-connect-text-color: var(--c-cream);
  --pwauth-btn-connect-border-radius: var(--r-0);
  --pwauth-btn-connected-bg-color: var(--c-paper);
  --pwauth-btn-connected-text-color: var(--c-ink);
}
```

Typography rules:

- All numerics — balances, supply, fees, tx hashes, addresses, amounts — use `--f-mono`, tabular figures (`font-variant-numeric: tabular-nums`). Never use a proportional font for a number.
- Page titles and section headers use `--f-display` (Fraunces), weight 500, slight negative tracking.
- Body copy uses `--f-body` (Inter) at 15px / 1.5 line-height.
- Labels / metadata use `--f-mono` at 11–12px, uppercase, letter-spacing 0.08em.

Rule system:

- `--rule-thin` divides rows in tables.
- `--rule-med` frames cards.
- `--rule-bold` frames the invariants ribbon when violated (and separates masthead from content).

---

## 2. File tree (post-refactor)

```
app/
├── index.html
├── package.json                        ← unchanged deps, + fonts via @fontsource
├── vite.config.ts
├── tsconfig*.json
├── .env.local                          ← from docs/design/v1-deployment.md §10
└── src/
    ├── main.tsx                        ← unchanged shell, + import './styles/tokens.css'
    ├── App.tsx                         ← REWRITTEN: router, masthead, ribbon, outlet
    ├── providers/
    │   └── PushChainProviders.tsx      ← REWRITTEN: Direction C themeOverrides
    ├── styles/
    │   ├── tokens.css                  ← NEW: the CSS-variables above
    │   └── global.css                  ← NEW: resets, masthead, rules, token pills
    ├── contracts/
    │   ├── config.ts                   ← unchanged (env → addresses/chain)
    │   ├── PUSD.json                   ← unchanged
    │   ├── PUSDManager.json            ← unchanged
    │   └── tokens.ts                   ← NEW: consolidates the SUPPORTED_TOKENS table (DRY vs. MintTab/RedeemTab dupes today)
    ├── lib/
    │   ├── format.ts                   ← number/address formatters (move from DashboardTab)
    │   ├── invariants.ts               ← I-01 solvency read + types
    │   ├── events.ts                   ← Deposited/Redeemed event parser for history
    │   └── cascade.ts                  ← helper: wraps approve+deposit / approve+redeem
    ├── hooks/
    │   ├── useReserves.ts              ← per-token balances on PUSDManager
    │   ├── useInvariants.ts            ← live I-01 read, refresh on new blocks
    │   ├── useUserHistory.ts           ← event-log scan for connected account
    │   ├── usePUSDBalance.ts           ← user PUSD balance + totalSupply
    │   └── useTokenBalance.ts          ← arbitrary ERC20 balance (used by Mint)
    ├── components/
    │   ├── Masthead.tsx                ← brutalist header (wordmark, nav, connect pill)
    │   ├── InvariantRibbon.tsx         ← live I-01 status bar under masthead
    │   ├── Footer.tsx                  ← rule line + address masthead + disclaimer
    │   ├── TokenPill.tsx               ← "USDC · ETH SEPOLIA" chip
    │   ├── MonoStat.tsx                ← large mono numeric w/ caption
    │   ├── MintCard.tsx                ← ex-MintTab, Direction C
    │   ├── RedeemCard.tsx              ← ex-RedeemTab, Direction C, bugfixed (4-arg redeem)
    │   ├── ReserveTable.tsx            ← per-token Manager balances, rule divisions
    │   ├── HistoryTable.tsx            ← connected-account tx list
    │   └── ConnectedGate.tsx           ← shared "connect your wallet" empty state
    └── pages/
        ├── MintPage.tsx                ← /mint — wraps MintCard
        ├── RedeemPage.tsx              ← /redeem — wraps RedeemCard
        ├── ReservesPage.tsx            ← / — landing + reserves (default route)
        └── HistoryPage.tsx             ← /history — connected-user tx log
```

Removals: `components/DashboardTab.tsx`, `components/InfoTab.tsx`, `components/MintTab.tsx`, `components/RedeemTab.tsx` are deleted; their behavior moves into the new `pages/` + `components/` layout. `abi/Counter.json` is deleted (stale scaffold artifact).

---

## 3. Routing

Add `react-router-dom@^6` (the only new dep). Four routes, no nested layouts:

| Path        | Page             | Purpose                                       |
| ----------- | ---------------- | --------------------------------------------- |
| `/`         | ReservesPage     | Landing. Supply + reserves + invariants recap. Acts as both marketing top-page and the reserves dashboard. |
| `/mint`     | MintPage         | Mint PUSD from any supported external-chain USDC/USDT. |
| `/redeem`   | RedeemPage       | Redeem PUSD for a preferred token or basket.  |
| `/history`  | HistoryPage      | Connected account's Deposited + Redeemed events. |

Rationale for `/` = Reserves: Direction C treats the product as a *ledger*. The first thing a visitor sees is the ledger state. Mint/Redeem are explicit actions behind their own routes.

---

## 4. Masthead

Height 96px, sits above the invariants ribbon. Not sticky — scrolls off.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  PUSD  — Push USD / issue 001                         RESERVES  MINT  REDEEM │
│  A par-backed universal stablecoin on Push Chain                  HISTORY    │
│                                                          ┌──────────────────┐│
│                                                          │ CONNECT WALLET  ▸││
│                                                          └──────────────────┘│
├══════════════════════════════════════════════════════════════════════════════┤  ← --rule-bold
```

- Wordmark: Fraunces display, 44px, `-0.02em` tracking.
- Subtitle: mono uppercase, 11px, letter-spacing 0.1em.
- Nav: mono uppercase, 12px, underline active route with 2px ink rule. No icons.
- Connect: `<PushUniversalAccountButton>` with `--pwauth-*` overrides from tokens.css.

---

## 5. Invariants ribbon (live)

A 36px band below the masthead that reads I-01 every 12 seconds and on every new block the frontend observes through its JSON-RPC polling.

```
■ SOLVENCY OK    RESERVES 1,248,031.42  ≥  SUPPLY 1,248,031.42    Δ +0.00    UPDATED 12s ago
```

States (driven by `useInvariants()`):

| State                | Band bg     | Glyph | Copy                                                              |
| -------------------- | ----------- | ----- | ----------------------------------------------------------------- |
| `ok`                 | `--c-paper` | `■`   | green `■`, reserves ≥ supply, positive Δ                          |
| `warning` (Δ < 0.01% of supply) | `--c-cream` | `▲`   | gold `▲`, reserves essentially equal supply — tight margin        |
| `violation` (reserves < supply) | `--c-oxblood` on `--c-cream`, `--rule-bold` wrap | `✕` | oxblood `✕`, block mint/redeem CTA buttons until resolved           |
| `loading`            | `--c-paper` | `…`   | mono `…`, suppress Δ                                              |

`useInvariants()` returns:

```ts
type InvariantPulse = {
  state: 'ok' | 'warning' | 'violation' | 'loading';
  reserves: bigint;        // normalized to PUSD decimals (6)
  supply: bigint;
  delta: bigint;           // reserves - supply
  perToken: Array<{ symbol: string; chain: string; balance: bigint; decimals: number }>;
  updatedAt: number;       // epoch ms
  error: Error | null;
};
```

Implementation: read `PUSDManager.tokenCount`, iterate `getSupportedTokenAt(i)`, batch `balanceOf(PUSDManager)` + `decimals()`, normalize to 6dp, sum, compare to `PUSD.totalSupply()`. Cache with a 10s TTL. Refresh on route change.

When `violation`, both `/mint` and `/redeem` CTAs are replaced by an oxblood disabled button reading `SOLVENCY CHECK FAILED — ACTIONS HALTED` with a secondary link to `/` for the per-token breakdown.

---

## 6. Reserves page (default `/`)

Three-section layout, 12-column grid, max width 1200px.

### §A — Headline numbers (full width)

```
TOTAL SUPPLY                 BACKING                 BASE FEE            FEE INCOME
1,248,031.42                 1,248,031.42            0.05%               412.70
PUSD                         USD · 9 TOKENS          REDEMPTION          ACCRUED
```

Four `MonoStat` tiles with Fraunces-mono hybrid. Rule separation between tiles. Captions in mono uppercase.

### §B — Reserve table (full width)

```
TOKEN        CHAIN                DONUT ADDRESS            BALANCE         % OF RESERVES   STATUS
─────────────────────────────────────────────────────────────────────────────────────────────────
USDT         ETHEREUM SEPOLIA     0xCA0C…F9d3              124,800.00      10.00%          ENABLED
USDC         ETHEREUM SEPOLIA     0x7A58…5d66              124,800.00      10.00%          ENABLED
USDT         SOLANA DEVNET        0x4f1A…4e34              124,800.00      10.00%          ENABLED
…
```

- Single table, no cards. Rule separator per row (`--rule-thin`).
- Columns: Symbol (display serif), Chain (mono, uppercase), Address (mono, truncated with tooltip of full), Balance (mono tabular), % (mono), Status (mono).
- `TOKEN` and `BALANCE` dominate — other columns 30% smaller.
- Sort: descending balance by default; allow sort click on header.
- Status color: `ENABLED` jade, `REDEEM_ONLY` ink-dim, `EMERGENCY_REDEEM` gold, `REMOVED` hidden.

### §C — Explanation (2/3 column)

Short editorial prose explaining how v1 PUSD works. No bullets. Rule-separated paragraphs. Set in Fraunces at 17px / 1.65, body copy beneath in Inter.

> *PUSD is a par-backed stablecoin on Push Chain. Every unit is minted against an equivalent deposit of USDC or USDT from a supported external-chain origin. Reserves are held idle inside the PUSDManager contract and do not accrue yield in this version.*
>
> *Deposits are free. Redemptions pay a 0.05 % protocol fee. When a preferred redemption asset is unavailable, users can opt into a basket redemption that distributes across all reserves proportionally.*

---

## 7. Mint page (`/mint`)

Single card, centered, 560px max width. Ported from existing `MintTab.tsx`.

```
MINT PUSD                                                   CROSS-CHAIN ROUTE
                                                            ──────────────────
Deposit any supported stablecoin                            ETHEREUM SEPOLIA
from any supported chain.                                   → PUSH CHAIN
                                                            ──────────────────
YOU PAY                              BALANCE  MAX
┌──────────────────────────────────────────────────────┐
│  0.00                    USDC · ETH SEPOLIA       ▾  │
└──────────────────────────────────────────────────────┘

                            ↓

YOU RECEIVE
┌──────────────────────────────────────────────────────┐
│  0.00                                PUSD            │
└──────────────────────────────────────────────────────┘

DEPOSIT AMOUNT                                  100.00 USDC
PROTOCOL FEE                                         NONE
YOU RECEIVE                                     100.00 PUSD
─────────────────────────────────────────────────────────
                                  [ MINT 100.00 PUSD → ]
```

### Card shell

- 2px ink rule frame, zero radius, 32px padding.
- Title Fraunces 28px; subtitle Inter 14px.
- "CROSS-CHAIN ROUTE" aside: mono, renders the origin chain of the selected token → "PUSH CHAIN". Makes the cross-chain nature legible.

### Token selector

- Full-width dropdown panel (not overlay) with rule dividers.
- Each row: symbol + `TokenPill` (chain name) + address tail in mono.
- Nine entries, sourced from `src/contracts/tokens.ts` (single source vs. v1's duplicated arrays).

### Submit

Magenta-on-ink button full width, 56px tall, mono label, arrow glyph `→`. Disabled states use ink-dim text on cream. Loading state replaces label with mono `PROCESSING…` and an animated `∷∷∷` bar.

### Transaction flow (unchanged semantics, tightened copy)

1. Resolve the `MOVEABLE.TOKEN` constant for `(selectedToken.chain, selectedToken.symbol)` — same map as today, moved into `lib/cascade.ts`.
2. Encode `approve(PUSDManager, amount)` and `deposit(token, amount, recipient)` via `PushChain.utils.helpers.encodeTxData`.
3. Call `pushChainClient.universal.sendTransaction` with `data: [approve, deposit]` and `funds` when `moveableToken` exists.
4. On `tx.hash` arrival, surface a live "BROADCASTING" state (mono); on `tx.wait()` resolve, show the success ribbon with the mono-address link to Donut explorer.
5. Errors render in an oxblood-on-cream rule-framed block below the card.

---

## 8. Redeem page (`/redeem`)

Same card shell as Mint, mirrored flow. Ported from existing `RedeemTab.tsx`.

**Bug fix:** the current `RedeemTab` calls `redeem(amount, preferredAsset, basketMode)` but the contract signature is `redeem(amount, preferredAsset, allowBasket, recipient)`. Add `recipient = pushChainClient.universal.account` as the fourth argument. Without this, all v1 redemptions revert.

New UI elements:

- A small mono-labeled toggle: `BASKET MODE [ON|OFF]` — unchanged behavior, restyled.
- A preview block below the amount field:

  ```
  BURN                                     100.00 PUSD
  REDEMPTION FEE (0.05%)                   −0.05 PUSD
  PREFERRED SURCHARGE (tbd)                pending
  YOU RECEIVE                              99.95 USDC · ETH SEPOLIA
  ```

  The "Preferred surcharge" line reads the per-token preferred-fee via a view (if one exists) or reports `pending` when the preferred fee is not yet in v1 scope. In v1, only `baseFee` is active — mark the row with a mono `—` and add a tooltip explaining preferred surcharges activate with v2 fee policy.

- Output line shows the token pill and the chain-of-origin.

Submit button copy: `REDEEM 100.00 PUSD →`. Oxblood-on-cream when basket mode is active (visual signal that the user is opting into proportional drain). Magenta-on-ink for single-asset preferred redemption.

---

## 9. History page (`/history`)

Connected-account tx list. Reads `Deposited` and `Redeemed` events from PUSDManager for `user = msg.sender == account OR recipient == account`, via `ethers.Contract.queryFilter` in a bounded block window (last 10,000 blocks, paginated).

```
HISTORY — ACCOUNT 0xB59C…D56D

TYPE       TIME              AMOUNT                ASSET              TX
────────────────────────────────────────────────────────────────────────────────
MINT       2026-04-22 14:22  +100.00 PUSD          USDC · ETH SEP     0x1fe8…e787 ↗
REDEEM     2026-04-21 09:11  −50.00 PUSD → 49.97   USDC · ETH SEP     0xae52…bfd2 ↗
MINT       2026-04-20 17:05  +200.00 PUSD          USDT · SOL DEV     0xa920…a4ce ↗
```

- Single table, rule-divided, mono tabular figures.
- `TYPE` — display weight, colored: MINT jade, REDEEM oxblood.
- `TIME` — block timestamp, formatted to local 24h.
- `AMOUNT` — signed mono; for redeem, shows burn → receive composite.
- `TX` — short hash + explorer link.
- Empty state: "NO ACTIVITY YET — head to /mint or /redeem." in ink-dim Fraunces.

Load strategy: start with a `getBlockNumber - 10_000` to `latest` scan, one call per event type, then coalesce in-memory. Show `LOADING…` while pending. No infinite scroll in v1.

---

## 10. Providers

### `PushChainProviders.tsx`

```tsx
import { PushUI, PushUniversalWalletProvider } from '@pushchain/ui-kit';

export function PushChainProviders({ children }: { children: React.ReactNode }) {
  return (
    <PushUniversalWalletProvider
      config={{
        network: PushUI.CONSTANTS.PUSH_NETWORK.TESTNET,
        app: {
          title: 'PUSD',
          description: 'A par-backed universal stablecoin on Push Chain.',
        },
        login: { email: true, google: true, wallet: true },
      }}
      themeMode={PushUI.CONSTANTS.THEME.LIGHT}
      themeOverrides={{
        '--pw-core-bg-primary-color': 'var(--c-cream)',
        '--pw-core-bg-secondary-color': 'var(--c-paper)',
        '--pw-core-text-primary-color': 'var(--c-ink)',
        '--pw-core-brand-primary-color': 'var(--c-magenta)',
        '--pw-core-btn-border-radius': '0',
        '--pw-core-modal-border-radius': '0',
        '--pwauth-btn-connect-bg-color': 'var(--c-ink)',
        '--pwauth-btn-connect-text-color': 'var(--c-cream)',
        '--pwauth-btn-connect-border-radius': '0',
        '--pwauth-btn-connected-bg-color': 'var(--c-paper)',
        '--pwauth-btn-connected-text-color': 'var(--c-ink)',
      }}
    >
      {children}
    </PushUniversalWalletProvider>
  );
}
```

Theme mode is **light** — Direction C's cream base reads as a light theme to the UI-kit. Keep Push modals on a paper background to preserve the brutalist feel inside the wallet sheet.

---

## 11. Hooks — canonical shapes

```ts
// useReserves.ts
export function useReserves(): {
  rows: Array<{
    symbol: string;
    chain: string;
    address: `0x${string}`;
    decimals: number;
    balance: bigint;
    pctOfReserves: number;
    status: 'ENABLED' | 'REDEEM_ONLY' | 'EMERGENCY_REDEEM' | 'REMOVED';
  }>;
  totalReserves: bigint;   // normalized to 6dp
  loading: boolean;
  error: Error | null;
};

// useInvariants.ts
export function useInvariants(): InvariantPulse;  // see §5

// useUserHistory.ts
export function useUserHistory(opts?: { fromBlock?: bigint; toBlock?: bigint }): {
  rows: Array<{
    type: 'MINT' | 'REDEEM';
    timestamp: number;
    amount: bigint;         // signed — positive on MINT, negative on REDEEM
    receivedAmount?: bigint; // only for REDEEM
    asset: { symbol: string; chain: string; address: `0x${string}`; decimals: number };
    txHash: `0x${string}`;
    blockNumber: bigint;
  }>;
  loading: boolean;
  error: Error | null;
};

// usePUSDBalance.ts
export function usePUSDBalance(): {
  balance: bigint;          // 6dp
  totalSupply: bigint;      // 6dp
  loading: boolean;
  error: Error | null;
};
```

All hooks use `usePushChainClient()` / `usePushChain()` for their read path, and fall back to the direct RPC provider (`new ethers.JsonRpcProvider(RPC_URL)`) for pre-connect reads. They follow the canonical guard pattern internally and never throw — errors return via the `error` field.

---

## 12. Page-level behavior matrix

| Route      | Works when not connected | Works when connected | Degrades when I-01 violated |
| ---------- | ------------------------ | -------------------- | ---------------------------- |
| `/`        | ✅ (full)                | ✅ (same + user balance)  | banner only; no action change |
| `/mint`    | ✅ (read-only card)       | ✅ (full flow)        | CTA disabled; empty state card explains |
| `/redeem`  | ✅ (read-only card)       | ✅ (full flow)        | CTA disabled                  |
| `/history` | ⊘ "Connect to view history" empty state | ✅ (full)          | unaffected                   |

---

## 13. Delivery plan (6 phases, ~3 weeks)

| Phase | Scope                                                         | Output                                    | Est. |
| ----- | ------------------------------------------------------------- | ----------------------------------------- | ---- |
| 0     | Design tokens landed, global.css + masthead skeleton          | `src/styles/*`, `App.tsx` shell           | 2d   |
| 1     | Routing + Masthead + Invariants ribbon (with live data)       | `react-router-dom` wired, `useInvariants` | 3d   |
| 2     | Reserves page (`/`) — headline stats + reserve table          | `useReserves`, `ReserveTable`             | 3d   |
| 3     | Mint page — ported from `MintTab`, Direction C applied        | `MintCard`, `lib/cascade.ts`              | 2d   |
| 4     | Redeem page — bugfixed (`recipient` arg), Direction C applied | `RedeemCard`                              | 2d   |
| 5     | History page — event scan + table                             | `useUserHistory`, `HistoryTable`          | 2.5d |
| 6     | Footer, edge states, mobile pass, deploy to Vercel            | `Footer`, responsive rules, `vercel.json` | 2d   |

Total: ~16.5 dev-days.

---

## 14. Risk table

| Risk                                                   | Impact     | Mitigation                                                    |
| ------------------------------------------------------ | ---------- | ------------------------------------------------------------- |
| Redeem bug (missing `recipient`)                       | Critical   | Phase 4 starts with writing a failing test, then the fix.     |
| Invariants ribbon false positives (decimal normalization) | High    | Unit tests on `normalizeToPUSD`; reference fixture from `deployed.txt`. |
| Event log scan overloads RPC                           | Medium     | Bound block window (10k blocks); exponential backoff on rate limit. |
| Donut RPC outage breaks read hooks                     | Medium     | All hooks expose `error`; ribbon goes to `loading` not `violation` when error is an RPC error vs. an invariant math error. |
| Fraunces + IBM Plex Mono font load delay / FOUT        | Low–Medium | Use `@fontsource` subsets, `font-display: swap`, system-font fallback stack. |
| User on wrong chain in wallet                          | Medium     | UI-kit handles network prompt; card shows `WRONG NETWORK` state referencing chain 42101. |

---

## 15. Hand-off checklist

Before calling v1 frontend done:

- [ ] All four routes render on a cold load without JS errors.
- [ ] Ribbon goes green when reserves ≥ supply on the live deployment.
- [ ] Mint from Ethereum Sepolia USDC succeeds end-to-end against Donut.
- [ ] Redeem for preferred asset succeeds and explorer link resolves.
- [ ] Redeem in basket mode succeeds when preferred is drained.
- [ ] History table populates for the deployer account's prior activity.
- [ ] Direction C tokens match `docs/design/v1-frontend-plan.md §1` byte-for-byte (no stray hexes).
- [ ] Zero usage of `localStorage` / `sessionStorage` anywhere in the code.
- [ ] Lighthouse ≥ 90 on Performance + Accessibility for `/`.
- [ ] `npm run build && npm run preview` produces a deploy-ready bundle under 400KB gzipped (excluding fonts).
- [ ] Deploy: Vercel, custom domain tbd. Env vars pulled from §10 of `v1-deployment.md`.

---

## 16. What changes for v2 (foreshadowing)

v2 keeps every surface from v1 and adds:

- Mint card gains a `MINT FOR YIELD (PUSD+)` toggle; default is the yield path (PUSD+).
- Reserves page splits into **Par Reserve** (idle, backs PUSD 1:1) and **Yield Share Reserve** (deployed to Uniswap V3 LP, backs PUSD+).
- Ribbon adds I-01b (`pps ≥ 1.0`), I-12 (`deployed ≤ 30% at launch / 50% cap`), I-13 (LP drift ≤ 10 bps).
- History adds `WRAP` and `UNWRAP` event types.
- LP position cards replace the strategy-card concept. Each LP row shows: pool, tick range, in-range badge, fees earned, share of yield reserve.

See `docs/design/v2-frontend-plan.md` for the full v2 frontend spec.
