# PUSD Evolution Log

This file records the evolution of PUSD research over time.

It is intentionally opinionated and chronological.

---

## 19-02-2026 — Baseline contract framing

### PUSD baseline
Initial documentation established PUSD as:
- a thin, permission-gated ERC20,
- 6 decimals,
- upgradeable,
- with no embedded collateral or redemption logic.

This was the correct baseline and remains valid.

### PUSDManager baseline
Initial manager framing established:
- reserve custody in manager,
- per-token metadata,
- mint on deposit,
- burn on redeem,
- upgradeability,
- role-based admin control.

At this stage, the system was still closer to a simple reserve-backed mint/redeem controller than a full basket stable architecture.

### Important takeaway
The initial split between `PUSD.sol` and `PUSDManager.sol` was correct and should be preserved:
- token contract stays thin,
- manager owns business logic.

---

## 19-02-2026 — Redemption architecture moved from simple to basket-aware

### Problem identified
If users deposit multiple chain-specific stable assets, a single-token redemption model is too brittle.

If preferred redemption is the only path:
- users can get blocked when that asset has low liquidity,
- reserves can fragment,
- peg confidence degrades even when the system is solvent in aggregate.

### Design progression
Research moved through these states:
1. simple preferred-asset redemption
2. preferred redemption with fallback
3. explicit basket redemption
4. emergency proportional redemption

### Why basket redemption was introduced
Basket redemption was added because the system promise became:
- PUSD is redeemable against a basket of supported stable assets,
- not necessarily the same asset and chain as original deposit.

### Why this matters
This is one of the foundational design turns:
PUSD stopped being “redeem into exact original asset” and moved toward:
- unified stable abstraction,
- with liquidity-aware redemption routing.

---

## 20-02-2026 — Token status model evolved

### Early tension
The design originally used a more binary supported / unsupported view, then moved through softer lifecycle states.

### Final current model
The current meaningful statuses are:
- `ENABLED`
- `REDEEM_ONLY`
- `EMERGENCY_REDEEM`
- `REMOVED`

### Why this changed
A simple enabled / disabled model was not enough because:
- disabling deposits should not necessarily disable redemptions,
- risky assets may need to be drained without allowing new inflows,
- the system needs a controlled offboarding path.

### Interpretation of statuses
- `ENABLED`: full participation
- `REDEEM_ONLY`: no new deposits, still redeemable
- `EMERGENCY_REDEEM`: force drainage of risky asset exposure
- `REMOVED`: terminal exclusion from normal flows

### Important outcome
This status model is one of the strongest pieces of the current manager design and should remain.

---

## 21-02-2026 — Fee model moved from generic fees to inventory-steering fees

### Initial question
Should redemption have fees at all?

### Final direction
Yes, but not as arbitrary rent extraction.

The meaningful fees identified were:
- `baseFee`
- `preferredFee`

### Why preferred fee exists
Preferred redemption drains specific inventory.
If a user insists on a scarce asset, the system should either:
- make it more expensive,
- or steer the user toward basket / alternate redemption.

### Dynamic fee insight
Preferred fee should be based on relative liquidity share:
- more abundant inventory → lower preferred fee
- scarcer inventory → higher preferred fee

### Why this matters
This converts fees from “monetization only” into a control mechanism for reserve health.

---

## 22-02-2026 — Haircut and surplus tracking were introduced

### Initial problem
If some assets are considered riskier or strategically less desirable, the protocol may want to:
- mint slightly less PUSD than nominal deposit amount,
- or collect protocol-owned spread.

### Design turn
This became `surplusHaircutBps` at the token level.

### Implementation choice
Haircut is:
- collected in underlying token units,
- tracked on-manager via `accruedHaircut`,
- swept later to `treasuryReserve`.

### Why not treat it as free liquidity
This was an important correction.
Accrued fees and haircut must not be counted as withdrawable user liquidity.

### Final rule
Reserved surplus is ring-fenced and excluded from:
- available liquidity
- basket redemption liquidity
- rebalance spendability

---

## 23-02-2026 — Reserved surplus ring-fence became explicit

### Problem identified
If accrued fees / haircut remain inside manager balances but are also counted as redeemable liquidity, then:
- users can indirectly redeem protocol-owned value,
- rebalances can accidentally spend treasury-owned reserves,
- accounting becomes false.

### Final current fix
Available liquidity is now effectively:
- on-contract token balance
- minus accrued fees
- minus accrued haircut

### Why this matters
This is one of the most important correctness improvements in the manager design.

---

## 24-02-2026 — Rebalance logic was constrained

### Initial temptation
Allow admin to rebalance freely as long as equal normalized value comes in and out.

### Risk identified
Without further constraint, rebalance can accidentally consume reserved surplus.

### Current rule
Rebalance requires:
- exact normalized value match,
- token existence and non-removed status,
- and sufficient tokenOut balance after accounting for reserved surplus.

### Interpretation
Rebalance is not free extraction.
It is controlled inventory reshuffling.

---

## 10-03-2026 — PUSD was considered as a yield-bearing asset

### Major research fork
The system explored whether:
- base PUSD itself should earn,
- or whether yield should be isolated into a separate layer.

### Arguments for yield-bearing PUSD
- simpler user story,
- easier liquidity bootstrapping,
- "stablecoin on any chain that earns fees" is strong marketing.

### Arguments against
- base stable loses boring settlement semantics,
- integrations become harder,
- LP-based yield is market-risky, unlike native staking yield,
- losses or poor periods contaminate the base asset,
- payments and accounting become more confusing.

### Conclusion reached
For long-term infrastructure credibility:
- base PUSD should stay boring,
- yield should likely live in a separate layer.

This remains the recommended direction unless the protocol intentionally pivots into a yield-first product.

---

## 11-03-2026 — PUSD+ / yield wrapper research

### Why it appeared
If liquidity bootstrap comes before universal settlement adoption, capital likely needs visible yield.

### Explored model
- user deposits supported stable
- PUSD is minted
- PUSD is then routed into a yield-bearing layer
- user receives a vault / share-style representation

### Key conclusion
If this route is taken:
- yield should be represented via share accounting,
- not by making base PUSD rebasing.

### Correct mental model
- `PUSD` = spending / settlement balance
- `PUSD+` or equivalent = savings / yield layer

### UX conclusion
Even if two layers exist under the hood, frontend should likely present this as one seamless experience.

---

## 12-03-2026 — PUSDLiquidity was introduced conceptually

### Why it is needed
`PUSDManager` is becoming too important to burden with:
- LP operations,
- active treasury,
- cross-chain liquidity deployment,
- routing strategies.

### Strong design outcome
A separate `PUSDLiquidity.sol` should exist.

### Intended responsibilities
- hold deployable capital transferred from manager under explicit policy
- provide liquidity to selected venues
- rebalance deployed positions
- unwind and return funds when manager needs redemption liquidity
- expose strategy value and withdrawable liquidity

### Strong separation principle
- `PUSDManager` = redemption truth
- `PUSDLiquidity` = active treasury / liquidity engine

This is likely the correct architecture going forward.

---

## 21-03-2026 — Final current conceptual state

### What PUSD is trending toward
PUSD is trending toward:
- a universal stable abstraction across chain-specific USDC/USDT-like assets,
- redeemable via preferred / basket / emergency logic,
- with explicit reserve health controls,
- and likely with a separate active liquidity engine.

### What remains unresolved
The unresolved top-level question is:
- whether yield should be externalized into PUSD+ only,
- or whether the product should lean harder into "stablecoin that earns by default."

### Current recommendation
For adoption that survives stress:
- keep base PUSD boring
- build active yield and LP logic outside the manager
- use product UX to hide complexity