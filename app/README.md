# PUSD — Frontend (`/app`)

React + Vite dApp for **Push USD (PUSD)** — a par-backed universal stablecoin on Push Chain Donut Testnet. Brutalist editorial visual (Direction C). All wallet interactions go through `@pushchain/ui-kit`.

## What this app does

- **Mint** — deposit a supported stablecoin from any external chain (Ethereum / Solana / Base / Arbitrum / BNB testnets), receive PUSD 1:1 on Push Chain.
- **Redeem** — burn PUSD, receive a preferred reserve token; falls back to basket payout if the preferred token is short.
- **Reserves** — live per-token PUSDManager balances, total supply, and I-01 solvency invariant.
- **Activity** — connected-account `Deposited` / `Redeemed` event log.
- **Docs** — in-app developer reference at `/docs`.

## Stack

| Layer       | Choice                                                             |
| ----------- | ------------------------------------------------------------------ |
| Framework   | React 19 + Vite 7 + TypeScript 5                                   |
| Wallet / tx | `@pushchain/ui-kit` (bundles `@pushchain/core`)                    |
| RPC reads   | `ethers` v6 `JsonRpcProvider` against `https://evm.donut.rpc.push.org/` |
| Routing     | `react-router-dom` v6                                              |
| Styling     | CSS custom properties — `src/styles/tokens.css` + `global.css`    |

> **Do not** add `wagmi`, `viem`, `@rainbow-me/*`, or standalone MetaMask / WalletConnect SDKs. `@pushchain/ui-kit` is the only wallet surface.

## Routes

| Path              | Page                   | Purpose                                          |
| ----------------- | ---------------------- | ------------------------------------------------ |
| `/`               | `HomePage`             | Editorial landing — stats, dispatch feed, design principles |
| `/convert/mint`   | `ConvertPage` (mint)   | Mint PUSD from any supported stablecoin          |
| `/convert/redeem` | `ConvertPage` (redeem) | Redeem PUSD for a preferred token or basket      |
| `/reserves`       | `ReservesDetailPage`   | Per-token reserve breakdown                      |
| `/history`        | `HistoryPage`          | Connected-account event log                      |
| `/docs`           | `DocsPage`             | In-app developer reference                       |

`/convert`, `/mint`, `/redeem` redirect to the canonical paths above.

## Project layout

```
app/
├── public/            ← static assets served at site root
│   ├── llms.txt                          ← agent entry point
│   ├── agents/skill/push-pusd/SKILL.md   ← integration skill
│   └── 404.html, favicons, og-image, …
├── src/
│   ├── App.tsx        ← route shell
│   ├── main.tsx       ← mounts <PushUniversalWalletProvider>
│   ├── providers/     ← PushUniversalWalletProvider wrapper
│   ├── components/    ← Masthead, Footer, ConvertPanel, DispatchFeed, …
│   ├── pages/         ← HomePage, ConvertPage, ReservesDetailPage, DocsPage, …
│   ├── hooks/         ← useReserves, useProtocolStats, useUserHistory, …
│   ├── contracts/     ← addresses (env-driven), ABIs, supported token list
│   ├── lib/           ← format, decimal, explorer, blockscout helpers, cascade.ts
│   └── styles/        ← tokens.css + global.css (Direction C design system)
├── index.html
├── package.json
└── vite.config.ts
```

## Architecture

### Provider tree

```
<StrictMode>
  <PushChainProviders>            ← src/providers/PushChainProviders.tsx
    <App>                         ← src/App.tsx
      <BrowserRouter>
        <EditorialBand />         ← top strip (live numbers)
        <Masthead />              ← logo, nav, connect
        <main><Routes>…</Routes></main>
        <Footer />
      </BrowserRouter>
    </App>
  </PushChainProviders>
</StrictMode>
```

`PushUniversalWalletProvider` (inside `PushChainProviders`) is the only wallet context. Direction C tokens (cream, espresso, magenta) are bridged into the Push modal via theme overrides so the modal reads as native UI.

### Read path (RPC → screen)

1. A hook (`useReserves`, `useInvariants`, `useProtocolStats`, …) instantiates a fresh `ethers.JsonRpcProvider(RPC_URL)` from [`src/contracts/config.ts`](src/contracts/config.ts).
2. It calls `PUSDManager` / `PUSD` using the JSON ABIs in [`src/contracts/`](src/contracts/).
3. Results are normalised in [`src/lib/`](src/lib/) (decimals, address formatting, explorer URLs).
4. The hook returns a typed object; consumers must check `error` before reading values.

Reads never require a connected wallet.

### Write path (UI → universal transaction)

1. A page (typically [`ConvertPage`](src/pages/ConvertPage.tsx) via [`ConvertPanel`](src/components/ConvertPanel.tsx)) collects the user input.
2. It composes a cascade of `{ to, value, data }` legs using the helpers in [`src/lib/cascade.ts`](src/lib/cascade.ts) — `buildApproveLeg`, `buildDepositLeg`, `buildRedeemLeg`.
3. It calls `pushChainClient.universal.sendTransaction({ to: ZERO, value: 0n, data: legs, funds? })`. The `funds` field bridges the user's external-chain stable into Donut for cross-chain mints.
4. After the tx resolves, the page invalidates / refetches the relevant hooks so the UI shows the new state.

`ConvertPanel.tsx` is the canonical end-to-end reference for the write path. New write code should mirror its shape.

### State

No Redux / Zustand / global store. State is local to each hook and each page. Hooks self-cache via `useEffect` + `useState`-driven memoisation. There is no central refresh scheduler — pages re-fetch after a write completes.

### Static deploy

`yarn build` outputs `dist/`. `yarn deploy` writes a `CNAME` for `pusd.push.org` and pushes to `gh-pages` on a separate prod-deployment repo. `public/404.html` pairs with the SPA-rehydration script in `index.html` so deep links survive on static hosts that can't serve `index.html` for arbitrary paths.

## Local development

```sh
cd app
yarn install

# Copy and fill in the env vars below
cp .env.local.example .env.local   # or create manually

yarn dev    # http://localhost:5173
```

Required env vars (current deployment):

```ini
VITE_PUSD_ADDRESS=0x488d080e16386379561a47a4955d22001d8a9d89
VITE_PUSD_MANAGER_ADDRESS=0x7a24EEa43a1095e9Dc652Ab9Cba156A93eD5Ed46
VITE_CHAIN_ID=42101
VITE_RPC_URL=https://evm.donut.rpc.push.org/
```

## Scripts

| Command        | What it does                                   |
| -------------- | ---------------------------------------------- |
| `yarn dev`     | Start Vite dev server                          |
| `yarn build`   | TypeScript typecheck + Vite production build   |
| `yarn preview` | Serve the production build locally             |
| `yarn lint`    | ESLint over `src/`                             |

## Push Chain conventions

**Reads** use `ethers` `JsonRpcProvider` directly against the Donut RPC — no wallet required.

**Writes** use `pushChainClient.universal.sendTransaction(...)`. Two write paths exist depending on the wallet type:

- **External-chain wallet** (MetaMask, Phantom, etc.) → the user gets a relay-managed Donut account that supports multicall. `approve` + `deposit` are batched into one signature: pass both legs in the `data` array with `to` set to the zero address (the multicall sentinel).
- **Native Push EOA** (Push Wallet or a key pointed at the Donut RPC) → standard EVM EOA, no multicall. Mint takes two signed transactions (approve, then deposit). Redeem is a single transaction — `PUSDManager` burns via `BURNER_ROLE` directly.

**Cross-chain mint** — if the reserve token lives on the user's origin chain, attach a `funds: { amount, token }` param. The relay bridges the token to the user's Push Chain account before the multicall executes.

**Hook guard pattern** — every consumer of `usePushChain()` / `usePushChainClient()` must check `error → isInitialized → pushChainClient` before rendering. Silent failures are the most common bug.

**No mock state** — all reserve and supply values come from on-chain reads. Render `—` (em-dash) for unknown values, never a placeholder number.

## Pointers

- Protocol overview: [`/README.md`](../README.md)
- Contracts: [`/contracts/README.md`](../contracts/README.md)
- Protocol design specs: [`/docs`](../docs/)
- Agent context (served): https://pusd.push.org/llms.txt + https://pusd.push.org/agents/skill/push-pusd/SKILL.md (sources in [`public/`](public/))
