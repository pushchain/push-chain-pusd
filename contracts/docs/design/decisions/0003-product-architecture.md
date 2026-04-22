# ADR 0003 – Product Architecture: Boring Base, Separate Liquidity Engine, Wrapped Yield

**Status:** Accepted
**Date:** 2026-04-22
**Supersedes:** — (resolves Forks 1–5 from `research/Open-Design-Forks.md` and OQ-01, OQ-02 from `design/open-questions.md`)

---

## Context

The research tree (`research/Evolution.md`, `research/Open-Design-Forks.md`) has been circling the same meta-question for months:

> Is PUSD a boring settlement asset, a yield-bearing savings product, or both?

The question is not merely a contract detail. It determines:

- Whether base PUSD can be safely used for payments and accounting integrations.
- Whether a separate `PUSDLiquidity` contract is needed.
- How much reserve capital may be deployed into strategies.
- How the redemption promise is written into public documentation.
- How the frontend is organised.

Leaving this unresolved has already caused research to re-enter the same fork from different angles (09-03, 10-03, 11-03, 12-03, 21-03). It also leaves two pre-mainnet blockers unaddressed:

- **OQ-01** — no on-chain timelock on `UPGRADER_ROLE`.
- **OQ-02** — no cap on `tokenCount`, leaving basket redeem gas cost unbounded (R-05).

This ADR resolves the product question and the two pre-mainnet blockers together, because they are all downstream of the same stance: *PUSD is infrastructure first.*

---

## Decision

Commit to the following product architecture as canonical. Every subsequent design review should assume these as fixed unless a future ADR supersedes this one.

### 1. Base PUSD stays boring

PUSD (the ERC-20 at `src/PUSD.sol`) remains a thin, permission-gated, 1:1-collateralised token with no embedded yield, no rebase, and no strategy exposure. Its storage layout and behaviour are treated as the most sensitive surface in the protocol and are expected to change rarely.

*Resolves Fork 1 in favour of Option A.*

### 2. Active liquidity lives in a separate contract

A new contract, `PUSDLiquidity.sol`, will be introduced behind its own UUPS proxy. It is the only contract permitted to receive deployable capital from `PUSDManager` under an explicit, role-gated policy. Its responsibilities are:

- Hold capital transferred out of `PUSDManager` under policy.
- Deploy that capital into protocol-owned liquidity venues only (no external strategies at launch).
- Rebalance and unwind positions.
- Expose strategy value and withdrawable liquidity.

`PUSDManager` retains sole custody of the redemption-backing reserve. It is the *redemption truth*. `PUSDLiquidity` is the *active treasury*. These two roles must never be fused.

*Resolves Fork 4 in favour of the conservative scope (protocol-owned liquidity only).*

### 3. Deployable cap: 25–35% at launch

The share of reserve capital that `PUSDManager` may transfer into `PUSDLiquidity` is capped at **35%** at launch, with a recommended operating band of 25–30%. The cap is a contract-level parameter (`maxDeployableBps`) with an upper bound of `3500` and a setter guarded by `ADMIN_ROLE`. A full explanation of the parameter and its invariants will live in the forthcoming `PUSDLiquidity` design doc.

*Resolves Fork 3 in favour of the conservative path.*

### 4. Yield is a wrapper, not a rebase

If and when yield is productised, it will ship as `PUSD+` (working name) — an ERC-4626-style share-accounting vault that accepts PUSD and issues shares. Base PUSD is never rebasing. Base PUSD never earns. Accounting integrations, payments, and external wallets see a boring, non-rebasing 1:1 ERC-20.

`PUSD+` is out of scope for the initial launch. This ADR only fixes its *shape*, so that when it ships it cannot contaminate the base asset by design.

### 5. Frontend presents a unified experience

The fact that there are two (eventually three) contracts is an implementation detail. The user-facing frontend presents a single seamless experience:

- **Hold** — PUSD balance, spendable, stable.
- **Save** — optional switch into `PUSD+` for yield.

The user never has to know which contract holds their position at any moment. The frontend uses the presence of a `PUSD+` deposit to decide whether to surface the Save surface.

*Resolves Fork 2 in favour of Option B (backend separation, unified UX).*

### 6. The redemption promise, written plainly

Public documentation will state the redemption behaviour exactly as the contract implements it:

> PUSD can be redeemed for the preferred supported asset when that asset has sufficient liquidity. When it does not, redemption falls back to a proportional basket across all non-removed reserves. When any reserve is placed in `EMERGENCY_REDEEM`, redemption forces proportional drainage of that reserve together with the preferred asset. The user always exits; the exit asset is not always identical to the deposit asset.

This text (or a direct equivalent) is the protocol's user-facing commitment and should be linked from every surface that touches redemption.

*Resolves Fork 5 in favour of the three-path promise already implemented in `PUSDManager._executeRedeem` / `_executeBasketRedeem` / `_executeEmergencyRedeem`.*

### 7. Upgrade path is timelocked before mainnet

`UPGRADER_ROLE` on both `PUSD` and `PUSDManager` (and, when deployed, `PUSDLiquidity` and `PUSD+`) must be held by an OpenZeppelin `TimelockController` instance — not an EOA and not a plain multisig — before any mainnet deployment. The operating multisig becomes a proposer on the timelock; a separate executor set may be used. Minimum delay at launch: **48 hours**.

Deployment scripts (`DeployAndConfigure.s.sol`) must be updated to accept a `timelock` parameter and grant `UPGRADER_ROLE` to that address instead of the admin multisig.

*Resolves OQ-01 in favour of Option 1 (on-chain timelock).*

### 8. Token count is capped on-chain

`PUSDManager.addSupportedToken` will reject additions once `tokenCount` reaches a compile-time constant `MAX_TOKENS = 25`. The cap is chosen to keep basket redemption and `sweepAllSurplus` well within typical block gas limits even as the token list ages with tombstoned `REMOVED` entries.

The cap can be increased by upgrade if and only if the basket and sweep loops are first rewritten to avoid iterating tombstones (see related work in OQ-03).

*Resolves OQ-02 in favour of Option 1 (hard cap at 25).*

---

## Rationale

### Why commit now, and why all at once

The individual choices above have been leaning in these directions in the research log for weeks. The cost of leaving them unresolved is that every subsequent design discussion re-opens the same fork, and every new contributor has to re-derive the answer. Committing them together as one bundle is cheaper than committing them one at a time because they are not independent:

- "Boring base + separate liquidity engine" only makes sense if yield is a wrapper.
- A wrapped yield product only makes sense if the base doesn't earn.
- The 25–35% deploy cap only has meaning if there is a separate contract to deploy *into*.
- A unified frontend UX is only possible if the split is on the backend.
- A timelock and a `MAX_TOKENS` cap are the two cheapest things we can do right now to earn mainnet credibility, and both have been signposted as pre-mainnet for months.

### Why base PUSD stays boring

Every well-integrated stablecoin in production today (USDC, USDT, DAI, PYUSD) is non-rebasing and strategy-free at the base asset. Payments rails, accounting software, and CEXes treat rebasing or yield-bearing tokens as a second-class citizen precisely because the 1:1 spending semantics break. Contaminating PUSD's base asset with strategy risk trades long-term integrability for short-term deposit marketing — a bad trade for a universal stable.

The research log's 10-03-2026 entry already captures this conclusion. This ADR only makes it binding.

### Why `PUSDLiquidity` and not a `PUSDManager` extension

The manager's job — *be the ledger of redemption truth* — is in tension with the job of an active treasury — *move capital toward yield and liquidity depth*. Mixing them would mean:

- Every upgrade to strategy logic requires re-auditing the redemption logic.
- Strategy losses could directly reduce redeemable liquidity without a clear accounting boundary.
- The surplus ring-fence (I-02) would be harder to prove.

A separate contract with its own proxy and its own role set keeps these concerns disjoint and allows each to be paused, upgraded, or replaced independently — the same reasoning that justified splitting `PUSD` from `PUSDManager` in ADR 0001.

### Why 25–35% and not 50%+

Under stress, redemption depth is what saves the peg. A 35% ceiling on deployable capital means that at least 65% of reserves sits in `PUSDManager` as idle, redeemable stable. That idle capital looks inefficient in a spreadsheet and is exactly what a stablecoin needs when Twitter calls the peg into question. The research log's 10-03-2026 and 11-03-2026 entries both concluded that launch credibility is a bigger prize than a few extra basis points of APY.

### Why a wrapper, not a rebase, for `PUSD+`

Share accounting (ERC-4626 style) has two properties a rebase cannot match:

1. The share-to-asset exchange rate monotonically reflects accrued value without requiring every holder's balance to change. Accounting systems, CEX listings, and wallet integrations work unchanged.
2. Losses are expressed as a change in exchange rate, not a change in balance. Users know exactly how much PUSD they deposited and can reason about their position without fearing phantom balance changes.

### Why a timelock now

Today, `UPGRADER_ROLE` is a plain multisig. That means *any* holder of the multisig, at any time, can push a new implementation with no public delay. For a stablecoin intended to be integrated into payments and accounting, that is a governance gap that an auditor will flag and that an informed holder will not accept. A 48-hour timelock is the minimum standard practice, costs essentially nothing to deploy, and immediately elevates the protocol's trust posture. It also gives the ecosystem a window to respond to a compromised-key scenario — which is exactly the mitigation missing from R-02 and R-03.

### Why `MAX_TOKENS = 25`

Basket redeem and `sweepAllSurplus` iterate `tokenList`. At 9 tokens today, loop cost is trivial. At 25 tokens with a handful of tombstoned `REMOVED` entries, we remain comfortably within a 30M gas budget even under pessimistic per-token costs. Beyond 25, we would want to have done the tombstone-reclamation work (OQ-03) first. Picking a number now forces that conversation to happen before the loop becomes a liability rather than after.

---

## Consequences

### What becomes binding

1. Any proposal to make base PUSD rebasing or yield-bearing is out of scope and must first supersede this ADR.
2. Reserve capital may only leave `PUSDManager` via `PUSDLiquidity`, never directly to an external strategy. The pathway `PUSDManager → PUSDLiquidity → venue` is the only permitted shape.
3. Deployment pipelines must deploy a `TimelockController` and wire `UPGRADER_ROLE` to it before mainnet. Testnet deployments may keep the current EOA/multisig for iteration speed, but mainnet genesis cannot.
4. `addSupportedToken` must enforce `tokenCount < MAX_TOKENS`. This is a code change to `PUSDManager` and must ship before the protocol opens to additional chains.
5. Public documentation must use the "preferred → basket → emergency" language verbatim (or a direct equivalent) on every redemption-facing page.

### What remains out of scope in this ADR

- The full `PUSDLiquidity` design, invariants, and role set. A separate design doc will cover it once this ADR is accepted.
- The `PUSD+` wrapper's deposit/withdraw mechanics, fee model, and share-price initialisation. To be addressed in a future ADR when yield becomes a roadmap item.
- Tombstone reclamation (OQ-03) and the surrounding gas optimisation work. Tracked separately; `MAX_TOKENS = 25` is the operational mitigation until then.
- Oracle-triggered `EMERGENCY_REDEEM` (OQ-05). Still a future-version question; current manual trigger is unchanged.

### Expected follow-up work

| Item | Location | Owner |
|---|---|---|
| `MAX_TOKENS` constant + guard in `addSupportedToken` | `contracts/src/PUSDManager.sol` | contracts |
| `DeployAndConfigure.s.sol` accepts `--timelock` param | `contracts/script/DeployAndConfigure.s.sol` | contracts |
| `PUSDLiquidity.sol` skeleton + design doc | `contracts/src/` + `docs/design/` | contracts |
| Update public redemption copy on all frontend surfaces | `app/src/` | frontend |
| Resolve Forks 1–5 and OQ-01/OQ-02 in their source files with a pointer here | `docs/research/` + `docs/design/` | docs |

### What this unlocks

Committing this bundle is what lets the frontend stop pretending to be a developer console and become a product with a clear story: *"Push USD is the dollar. Push Save is where it earns. You never have to pick which contract you're in."* The UI redesign now has a product architecture to organise around, instead of three separate tabs with no narrative.

---

## Alternatives considered

**A. Keep the current setup and decide later.** Rejected: the research log shows this question returning every 1–2 weeks under different framings. The cost of re-deriving an answer each time exceeds the cost of committing one now.

**B. Yield-bearing base PUSD (Fork 1 Option B).** Rejected: as above, breaks integration semantics and contaminates settlement with strategy risk. Reverses a conclusion the research itself reached on 10-03-2026.

**C. Single contract with internal boundaries.** Rejected: conflates redemption truth with active treasury, making upgrades and audits coupled in a way ADR 0001 already rejected for analogous reasons.

**D. No timelock, rely on multisig discipline.** Rejected: standard-of-care for a stablecoin in 2026 includes a timelock. Not meeting it is not a cost saving, it is a trust-discount we would pay for the life of the protocol.

**E. No `MAX_TOKENS` cap, rely on admin discipline.** Rejected: the cost of a cap is ~1 line of Solidity; the cost of hitting the block gas limit during a basket redemption is a catastrophic trust event. Asymmetric payoff.
