# ADR 0005 — `depositForVault` security review and bounded loop variants

**Status:** Accepted
**Date:** 2026-05-05

---

## TL;DR

`PUSDManager.depositForVault` deliberately bypasses both the manager's
`nonReentrant` guard and the surplus haircut. Both bypasses are required
for the legitimate `redeemFromPlus → burnPlus → _convertIdleReservesToPusd`
call path; without them PUSD+ tier-2 fulfilment deadlocks (reentrancy) or
silently bleeds NAV (haircut). This ADR documents the dedicated security
pass on that surface and ships two governance-readable additions:

- `PUSDManager.sweepSurplusBatch(uint256 startIdx, uint256 count)`
- `PUSDPlusVault.rebalanceBatch(uint256 startIdx, uint256 count)`

Both are pure additions to the existing impls; storage is unchanged.

---

## Context

Two follow-ups were queued out-of-scope from the V2 launch (see ADR 0004):

1. A dedicated security pass on `depositForVault` — flagged in the V2 audit
   as the highest-trust function in the system. The two-key gate
   (`msg.sender == plusVault && feeExempt[plusVault]`) is the only thing
   between this and arbitrary mint authority on PUSD.
2. Bounded variants of `sweepAllSurplus` and `vault.rebalance`. Both walk
   unbounded lists (`tokenList`, `positionIds`). Fine at today's scale
   (9 tokens, 0–3 positions); needed before either grows past ~50.

Closing both before exposing PUSD+ in the user-facing dApp.

---

## Decision

### 1. Audit surface — `depositForVault`

The function lives at [`PUSDManager.sol:939–949`](../../../contracts/src/PUSDManager.sol)
(now line 965 after the bounded-variant additions). It is the only
manager surface that mints PUSD without applying the haircut and without
holding the reentrancy lock.

```solidity
function depositForVault(address token, uint256 amount) external returns (uint256 pusdMinted) {
    require(msg.sender == plusVault && feeExempt[plusVault], "PUSDManager: not vault");
    TokenInfo memory info = supportedTokens[token];
    require(info.exists && info.status == TokenStatus.ENABLED, "PUSDManager: token not enabled");
    require(amount > 0, "PUSDManager: amount must be greater than 0");

    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    pusdMinted = _normalizeDecimalsToPUSD(amount, info.decimals);
    pusd.mint(msg.sender, pusdMinted);
    return pusdMinted;
}
```

#### Bypass justifications (re-stated)

- **No `nonReentrant`.** Required because `redeemFromPlus → burnPlus →
  _convertIdleReservesToPusd` re-enters the manager from inside its own
  outer `nonReentrant` frame. Without the bypass the inner
  `depositForVault` would deadlock and the entire tier-2 fulfilment
  path would revert.
- **No surplus haircut.** This is a value-preserving 1:1 internal
  conversion, not a user mint. Applying the haircut would bleed value
  out of NAV silently and break I2 (NAV monotonic) under the conversion
  path.

#### What protects the surface

The two-key gate enforces that **both**:

1. Caller equals the configured `plusVault` (rotated only by
   `DEFAULT_ADMIN_ROLE`, behind the 48h timelock); AND
2. The vault has been explicitly granted `feeExempt[plusVault] == true`
   (toggled by `ADMIN_ROLE`, multisig, no timelock).

The asymmetric privilege levels are deliberate — if the vault ever has
to be quarantined fast, `setFeeExempt(plusVault, false)` instantly
disables the bypass without requiring a 48h address rotation. The
bypass is restored just as fast by flipping the flag back. Tests cover
this single-flip pause primitive end-to-end (see
`testSingleFlipPauseRecovers`).

#### Threat model coverage (new tests in `DepositForVaultSecurity.t.sol`)

| Concern                                                | Test                                          |
| ------------------------------------------------------ | --------------------------------------------- |
| Caller spoofing vault address                          | `testRevertsWhenCallerIsNotPlusVault`         |
| Vault-address call without exemption flag              | `testRevertsWhenVaultNotFeeExempt`            |
| Single-flip pause primitive                            | `testSingleFlipPauseRecovers`                 |
| Reentry attempt through a malicious ERC-20 callback    | `testReentrancyBlockedOnUserDeposit`          |
| Legitimate inner call via `redeemFromPlus` path        | `testLegitimateInnerCallSucceedsDuringRedeemFromPlus` |
| Haircut not silently applied to vault-side mints       | `testNoHaircutAccruedOnVaultDeposit`          |
| Public `deposit` still applies haircut (control)       | `testPublicDepositStillAppliesHaircut`        |
| I1 / I3 / I4 hold across the conversion path           | `testInvariantsHoldAfterRedeemFromPlusConversion` |
| Token status edge cases (REMOVED / REDEEM_ONLY / EMR)  | `testRevertsOn{Removed,RedeemOnly,EmergencyRedeem}Token` |
| Zero amount                                            | `testRevertsOnZeroAmount`                     |
| Unsupported token                                      | `testRevertsOnUnsupportedToken`               |

The reentrancy test uses a custom `ReentrantToken` that fires a re-entry
into `manager.deposit` from its own `transferFrom` callback. The outer
`nonReentrant` blocks it; the inner reverts with
`ReentrancyGuard: reentrant call`, which the token bubbles verbatim
to the caller.

### 2. Bounded variants

`sweepAllSurplus` and `rebalance` both walk full lists in a single tx.
Fine at current scale, but a 50+ token / position list is plausible
once cross-chain reserves expand. We ship `sweepSurplusBatch` and
`rebalanceBatch` now so governance and the keeper can page the work
without an upgrade later.

#### `PUSDManager.sweepSurplusBatch(uint256 startIdx, uint256 count)`

- Same role gate as `sweepAllSurplus` (`ADMIN_ROLE`, `nonReentrant`).
- Reverts `startIdx out of range` on invalid start.
- Clamps `count` to the remaining range (no revert on over-large count).
- Reverts `no surplus to sweep` if the page touched no token with
  surplus, mirroring `sweepAllSurplus`.

#### `PUSDPlusVault.rebalanceBatch(uint256 startIdx, uint256 count)`

- Same gate as `rebalance` (`KEEPER_ROLE`, `nonReentrant`,
  `whenNotPaused`).
- Per-position semantics identical to `rebalance` — collect, haircut,
  no behavior change beyond the iteration bounds.
- Emits a single `Rebalanced(timestamp, nav())` per call so off-chain
  observers can stitch pages back into a logical rebalance epoch by
  block.

#### Storage discipline

Neither addition touches storage. Verified by `forge inspect ... storage-layout`
diff before and after; no slot delta. The functions append to the impl
contract code only, so the deployment is a v2 patch upgrade — UUPS
`upgradeTo(newImpl)` against the existing proxy with the existing
`UPGRADER_ROLE` (48h timelock).

### 3. Why ship them now

- **No storage churn.** Pure code addition, no migration risk.
- **Governance-readable.** `(startIdx, count)` is auditable in a
  multisig calldata view; an unbounded `for` loop is not.
- **Operational headroom.** The keeper can page `rebalanceBatch` if
  position count grows mid-cycle; the alternative (today) is a hard
  block at the gas limit and an emergency response.

---

## Consequences

- **Re-audit surface bounded to two new functions.** Both are
  copies-with-bounds of code that's already audited. Pattern is
  uncontroversial.
- **`depositForVault`'s "queued for security review" flag clears.** The
  audit-flagged behaviour entry in `docs/research/pusdmanager.md` is
  downgraded to "audited; see ADR 0005."
- **Proxy upgrade required.** Both new functions live in the impl. Pure
  read-only deployers (e.g. clients holding the old ABI) keep working.

---

## Open follow-ups

- **Multi-vault generalisation.** The two-key gate is hard-pinned to a
  single `plusVault` address. If we ever recognise multiple vaults
  (e.g. a longer-duration product), generalize to `mapping(address =>
  bool) recognizedVault` and re-key the gate. The existing `feeExempt`
  mapping is already the right shape for this.
- **Per-page event semantics.** `rebalanceBatch` emits `Rebalanced` per
  page. If we ever need a single epoch event, add a separate
  `RebalanceEpoch` emission gated on `startIdx == 0` so paging stays
  cheap to call.
