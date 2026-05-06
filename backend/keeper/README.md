# PUSD+ Keeper

Liveness service for `PUSDPlusVault`. On a fixed cadence:

1. **Rebalance** — calls `vault.rebalance()` (or pages through
   `rebalanceBatch` if `REBALANCE_PAGE_SIZE > 0`). Harvests LP fees and
   applies the haircut to the insurance fund.
2. **Fulfil queue** — walks `queue[1..nextQueueId)` and calls
   `fulfillQueueClaim(id)` for each open entry. Reverts on idle-short are
   logged and skipped (the next tick retries).
3. **Monitor** — reads `totalAssets`, `nav`, `totalQueuedPusd`, `paused`
   and logs them. Emits a warning if queued PUSD is ≥ 5% of TVL.

The keeper is **liveness-only**. Going offline does not threaten
solvency — see [`docs/research/backend.md`](../../docs/research/backend.md)
for the full design rationale.

## Run

```bash
cp .env.example .env
# fill in KEEPER_PRIVATE_KEY (must hold KEEPER_ROLE on the vault)
pnpm install
pnpm dev                       # tsx-driven dev loop
DRY_RUN=true pnpm dev          # read-only smoke test
```

A short-interval test:

```bash
LOOP_INTERVAL_MS=10000 DRY_RUN=true pnpm dev
```

## Granting `KEEPER_ROLE`

The keeper's signing address must be granted `KEEPER_ROLE` on the
deployed `PUSDPlusVault`. From the timelock multisig:

```solidity
bytes32 KEEPER = keccak256("PUSDPLUS_KEEPER_ROLE");
vault.grantRole(KEEPER, keeperEoa);
```

Until that's done, the keeper will boot and run reads but every write
will revert with `AccessControlUnauthorizedAccount`.

## Out of scope

This is the minimal keeper. The following are **not** in this service
and are tracked in `docs/research/backend.md`:

- HTTP API for the frontend (`F2`).
- Subgraph / custom indexer.
- KMS integration for the signing key.
- Hot/warm keeper pair.
- PagerDuty / Slack alerting (this keeper just logs).

## Layout

```
backend/keeper/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── src/
    ├── index.ts          ← entry; starts loop
    ├── config.ts         ← env parsing
    ├── client.ts         ← viem public + wallet clients
    ├── abi.ts            ← minimal vault ABI subset
    ├── log.ts            ← structured JSON logger
    ├── loop.ts           ← orchestrates the three jobs
    └── jobs/
        ├── rebalance.ts      ← vault.rebalance / rebalanceBatch
        ├── fulfillQueue.ts   ← walk queue, fulfilQueueClaim
        └── monitor.ts        ← read-only health snapshot
```
