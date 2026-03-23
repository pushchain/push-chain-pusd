# Protocol Overview

## What is PUSD?

PUSD (Push USD) is a USD-pegged stablecoin issued by the Push Chain protocol. It is backed 1:1 by a basket of accepted stablecoins (initially USDT and USDC) held in a single on-chain reserve managed by `PUSDManager`.

The design goal is a stablecoin that:
- Is always fully collateralised by real stablecoins (no algorithmic component).
- Pools liquidity from multiple accepted stablecoins so users receive a single fungible token regardless of which asset they deposited.
- Supports multi-chain origination — the `chainNamespace` field on each token record allows the manager to track assets bridged from different chains.
- Charges configurable fees on redemption and an optional deposit haircut to accrue revenue to a treasury.

## Core Actors

| Actor | Description |
|---|---|
| **User** | Deposits stablecoins to mint PUSD; redeems PUSD to withdraw stablecoins |
| **Admin** (`ADMIN_ROLE`) | Manages token list, fees, treasury, rebalancing |
| **Upgrader** (`UPGRADER_ROLE`) | Authorises UUPS proxy upgrades on both contracts |
| **Treasury** | Passive recipient of swept fees and deposit haircuts |

## High-Level Flow

```
User
  │
  ├─ deposit(token, amount)  ──►  PUSDManager  ──► holds stablecoins
  │                                    │
  │                                    └──► PUSD.mint(user, netAmount)
  │
  └─ redeem(pusdAmount, preferredAsset, allowBasket)
         │
         └──► PUSD.burn(user, pusdAmount)
              PUSDManager sends stablecoin(s) back to user
```

## Fee Model

| Revenue stream | Where accrued | Who pays |
|---|---|---|
| **Redemption fee** (`baseFee` + optional `preferredFee`) | `accruedFees[token]` | Redeemer |
| **Deposit haircut** (`surplusHaircutBps`) | `accruedHaircut[token]` | Depositor |

Both sit inside the contract until `sweepAllSurplus()` is called, which transfers them to `treasuryReserve`.

## Token Lifecycle

Tokens progress through the following statuses managed by `ADMIN_ROLE`:

```
         addSupportedToken()
               │
           ENABLED  ◄──────────────────────────────────┐
               │                                        │
         setTokenStatus()                               │
         ┌─────┴──────────────┐           setTokenStatus()
         ▼                    ▼                         │
    REDEEM_ONLY       EMERGENCY_REDEEM ─────────────────┘
         │                    │
         └────────┬───────────┘
                  ▼
              REMOVED
```

- **ENABLED** – deposit and redeem freely.
- **REDEEM_ONLY** – no new deposits; existing holders can still redeem.
- **EMERGENCY_REDEEM** – no deposits; all redemptions are forced proportional across preferred + emergency tokens to drain this asset.
- **REMOVED** – completely excluded from all operations.
