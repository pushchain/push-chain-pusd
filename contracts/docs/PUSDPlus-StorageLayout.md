# PUSDManager v2 — Storage Layout

The PUSDManager upgrade is **append-only**: existing slots are preserved bit-for-bit, and v2 state is added at the bottom of the contract before the constants/events. There is no reordering, no deletion, no type change on any v1 slot.

## Layout (post-v2)

| Region | Name | Type | Origin |
|---|---|---|---|
| v1 | `pusd` | `PUSD` (address) | v1 |
| v1 | `_status` | `uint256` (reentrancy) | v1 |
| v1 | `supportedTokens` | `mapping(address => TokenInfo)` | v1 |
| v1 | `tokenList` | `mapping(uint256 => address)` | v1 |
| v1 | `tokenIndex` | `mapping(address => uint256)` | v1 |
| v1 | `tokenCount` | `uint256` | v1 |
| v1 | `treasuryReserve` | `address` | v1 |
| v1 | `baseFee` | `uint256` | v1 |
| v1 | `preferredFeeMin` | `uint256` | v1 |
| v1 | `preferredFeeMax` | `uint256` | v1 |
| v1 | `accruedFees` | `mapping(address => uint256)` | v1 |
| v1 | `accruedHaircut` | `mapping(address => uint256)` | v1 |
| v1 | `sweptFees` | `mapping(address => uint256)` | v1 |
| v1 | `sweptHaircut` | `mapping(address => uint256)` | v1 |
| **v2** | **`plusVault`** | `address` | **v2** |
| **v2** | **`feeExempt`** | `mapping(address => bool)` | **v2** |
| **v2** | `__gap_v2` | `uint256[48]` | **v2** |

## Verification

Before submitting the timelock upgrade proposal, run `forge inspect` against both v1 (deployed) and v2 (candidate) builds and diff. Anything other than additive trailing slots is a critical bug — do not deploy.

```bash
# v1 baseline
git stash
forge inspect src/PUSDManager.sol:PUSDManager storage-layout > /tmp/pusd-manager-v1.json
git stash pop

# v2 candidate
forge inspect src/PUSDManager.sol:PUSDManager storage-layout > /tmp/pusd-manager-v2.json

# Diff
diff <(jq -r '.storage[] | "\(.label) slot=\(.slot) offset=\(.offset) type=\(.type)"' /tmp/pusd-manager-v1.json) \
     <(jq -r '.storage[] | "\(.label) slot=\(.slot) offset=\(.offset) type=\(.type)"' /tmp/pusd-manager-v2.json)
```

Expected diff is **only added lines at the bottom**:

```
> plusVault slot=N offset=0 type=t_address
> feeExempt slot=N+1 offset=0 type=t_mapping(t_address,t_bool)
> __gap_v2 slot=N+2 offset=0 type=t_array(t_uint256)48_storage
```

## Pre-deploy gate

- [ ] Storage layout diff matches the additive form above — no slot reuse, no type narrowing, no struct field shuffle.
- [ ] OpenZeppelin Upgrades plugin's `validateUpgrade` passes against the deployed v1 implementation.
- [ ] `__gap_v2` size (48 slots) is enough for v2 patches without colliding with v3.
- [ ] Surplus haircut max (was 4000 bps, now 1000 bps) is respected — `forge test` covers `setSurplusHaircutBps`.

## PUSDPlusVault — initial layout note

PUSDPlusVault is a brand-new proxy at v2. It reserves `uint256[40] private __gap` at the bottom of declared state for future v2 patch versions. Same `forge inspect` workflow applies for any subsequent vault upgrade.
