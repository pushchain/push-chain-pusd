# Open Questions

Unresolved design questions that require a decision before the protocol can be considered production-ready.

---

## OQ-01 – Upgrade Governance

**Question:** Should upgrades to `PUSD` and `PUSDManager` require a timelock, a DAO vote, or both?

**Context:** Currently `UPGRADER_ROLE` is a plain EOA/multisig. Any holder can immediately push a new implementation. This is a significant centralisation risk.

**Options:**
1. Add an on-chain timelock (e.g. OpenZeppelin `TimelockController`) as the `UPGRADER_ROLE` holder.
2. Require a governance token vote to queue upgrades.
3. Accept current model and rely on multisig key management.

**Blocking:** No — but should be resolved before mainnet launch.

---

## OQ-02 – Maximum Token Count

**Question:** Should there be a hard on-chain cap on `tokenCount`?

**Context:** Basket redemption and `sweepAllSurplus` iterate over all tokens. Without a cap, gas costs are unbounded (see R-05).

**Options:**
1. Add a `require(tokenCount < MAX_TOKENS)` guard in `addSupportedToken`. A value of 20–50 seems reasonable.
2. Rely on admin discipline and off-chain monitoring.

**Blocking:** No, but should be decided before the protocol opens to many chains.

---

## OQ-03 – REMOVED Token Slot Reclamation

**Question:** Should `tokenList` entries for `REMOVED` tokens be compacted (swap-and-pop), or left as tombstones?

**Context:** Currently a `REMOVED` token occupies a permanent slot in `tokenList` and consumes a loop iteration in `_executeBasketRedeem`, `sweepAllSurplus`, and `_hasEmergencyTokens`. Compaction would reduce gas but requires updating `tokenIndex` for the swapped token.

**Options:**
1. Implement swap-and-pop on `setTokenStatus(..., REMOVED)`.
2. Leave as tombstones and rely on the `continue` guard (current approach).

**Blocking:** No, but relevant before token list grows large.

---

## OQ-04 – Haircut Application on Zero-Fee Tokens

**Question:** Should the protocol allow `surplusHaircutBps == 0` for all tokens simultaneously, effectively making deposits free? Is there a minimum haircut policy?

**Context:** At zero haircut and zero base fee, the protocol earns no revenue and has no disincentive against spam deposits.

**Blocking:** Policy decision, not a code issue.

---

## OQ-05 – Emergency Redeem Triggers

**Question:** Should `EMERGENCY_REDEEM` status be triggerable automatically (e.g. via a price oracle crossing a threshold), or always manual?

**Context:** Current implementation is entirely manual (`setTokenStatus` by `ADMIN_ROLE`). An oracle-triggered emergency mode would reduce response latency (R-01) but introduces oracle dependency and potential manipulation.

**Blocking:** Architecture decision for future version.

---

## OQ-06 – Preferred Fee When preferredFeeMin == preferredFeeMax == 0

**Question:** The `_calculatePreferredFee` function short-circuits to `0` when both bounds are zero. Should this be the default configuration, or should defaults be non-zero?

**Context:** Deploying with all fees at zero means early users pay no fees. Governance should explicitly set fees post-launch.

**Blocking:** Operational config decision.
