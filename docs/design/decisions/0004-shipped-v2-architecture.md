# ADR 0004 — Shipped V2 Architecture

**Status:** Accepted (deposit side amended by [ADR 0006](0006-direct-vault-deposit.md), 2026-05-06)
**Date:** 2026-05-04
**Supersedes:** [ADR 0003 — Product Architecture (Two-Tier)](0003-product-architecture.md)
**Amended by:** [ADR 0006 — Direct Vault Deposits + Basket Wrap (V2.1)](0006-direct-vault-deposit.md) — `PUSDManager.depositToPlus` rewrite to send reserves directly to the vault; the fee-exempt-flag isolation model from this ADR is preserved on the redemption side.

---

## TL;DR

V2 ships as **three contracts plus one passive sidecar**, not four with sliced
reserves. Reserve slicing is replaced by a **fee-exempt vault flag** on
PUSDManager. PUSD+ is a **custom 6-decimal ERC-20 with NAV-per-share**, not
ERC-4626. The Uniswap V3 LP engine is inlined into `PUSDPlusVault` rather
than living as a separate `PUSDLiquidity` contract.

| ADR 0003 (planned)                            | ADR 0004 (shipped)                                  |
| --------------------------------------------- | --------------------------------------------------- |
| 4 contracts: PUSD / PUSDManager / PUSDPlus / PUSDLiquidity | 3 contracts + 1 sidecar: PUSD / PUSDManager / PUSDPlusVault / InsuranceFund |
| Reserves sliced into `parReserve` + `yieldShareReserve`    | Single reserve; PUSDPlusVault is **fee-exempt** via two-key check |
| PUSD+ as ERC-4626                                          | PUSD+ as custom 6-decimal ERC-20 with `nav() / previewMintPlus / previewBurnPlus` |
| Separate `PUSDLiquidity.sol` for V3 LP                     | LP engine inlined into `PUSDPlusVault`; vendored `V3Math` library |
| n/a                                                        | New `InsuranceFund` sidecar receives haircut on harvested LP fees |

The result is fewer contracts, fewer storage migrations, no upgrade risk to
the v1 PUSDManager storage layout, and one less interface boundary to audit.

---

## Context

Between ADR 0003 (2026-04-22) and shipping (2026-05-04), three forces pushed
the design simpler:

1. **EIP-170 pressure on PUSDPlusVault.** Inlining the LP engine pushed the
   contract toward the 24 KiB limit even before adding the redemption queue.
   The audit-time fix was to vendor a small subset of Uniswap V3 math
   (`mulDiv`, `getSqrtRatioAtTick`, `getAmountsForLiquidity`) as a public
   library and turn on `via_ir = true` + `evm_version = "shanghai"` in
   `foundry.toml`. Splitting LP into a separate contract was the alternative;
   measured cost of an extra interface call + storage layout vs. the vendor
   was worse on every axis.

2. **Storage migration risk on PUSDManager.** ADR 0003 required adding two
   parallel reserve mappings and migrating every `IERC20.balanceOf(manager)`
   call site to use the slice. That's a large diff against an upgradeable
   v1 contract that already holds real money. A `mapping(address => bool) feeExempt`
   plus a `plusVault` address (two storage slots) achieves the same isolation
   guarantee — vault redeems / converts pay zero fees and skip the haircut —
   without touching any v1 mapping.

3. **ERC-4626 wasn't earning its keep.** PUSD+ has a redemption queue
   (burn-and-fill: PUSD+ is burned at the user's call but settlement may
   wait for the next keeper rebalance). ERC-4626's `redeem` semantics
   assume synchronous settlement at current NAV. Either we'd revert when
   the vault was idle-short, or we'd add async machinery on top of the
   sync API and confuse every integrator. A custom 6-dec ERC-20 with
   explicit `previewMintPlus / previewBurnPlus` plus a public
   `fulfillQueueClaim` is honest about the asynchrony.

A separate audit raised one design question we resolved here too: PUSDPlusVault
calling back into PUSDManager (`depositForVault`) creates a re-entry path
through the manager's own lock. We resolved this with the **two-key gate**
(`msg.sender == plusVault && feeExempt[plusVault]`) plus a deliberate
bypass of `nonReentrant` and the surplus haircut — see PUSDManager.sol:939-949.
The bypass is necessary (otherwise `redeemFromPlus → burnPlus →
_convertIdleReservesToPusd → depositForVault` deadlocks) and bounded (only
the vault, only when the exemption is on, and only for value-preserving 1:1
conversions).

---

## Decision

We ship the simpler architecture documented in
[`docs/design/architecture.md`](../architecture.md):

- **PUSD.sol** — unchanged.
- **PUSDManager.sol** — in-place UUPS upgrade. New entrypoints
  `depositToPlus`, `redeemFromPlus`, `setPlusVault`, `setFeeExempt`,
  `depositForVault`. Storage append-only with `__gap_v2[48]`.
- **PUSDPlusVault.sol** — new UUPS contract. Custom 6-dec ERC-20 with
  NAV-per-share, redemption queue, inlined V3 LP engine. 5 roles, 5 hard
  caps in code.
- **InsuranceFund.sol** — new UUPS contract. Passive; `balanceOf` is truth.
  Vault `notifyDeposit` is `try/catch`'d so a paused IF cannot brick rebalance.

Build configuration: `via_ir = true` and `evm_version = "shanghai"` are
**load-bearing** for EIP-170 compliance on PUSDPlusVault. Do not flip them
off without re-measuring impl size.

Surplus haircut cap on PUSDManager reduced from 4000 bps to 1000 bps —
v2-only governance change, deliberate, tested.

---

## Consequences

### Good

- **One less moving part.** PUSDLiquidity is gone. Its state, role table,
  and interfaces don't need to be tracked in tests, design docs, or
  invariants.
- **No v1 storage migration.** The append-only upgrade preserves every v1
  storage slot and adds two new ones plus a 48-slot gap.
- **Simpler invariants.** I1 ("PUSD remains 1:1 backed") is a single
  expression over `Σ reserve − Σ accruedFees − Σ accruedHaircut` rather than
  a sum over two slice mappings.
- **Honest UX for PUSD+ redeem.** Async settlement is a first-class object
  (the queue), not an opaque revert.

### Tradeoffs

- **Vault holds LP state directly.** The vault's storage is wider than it
  would be if LP were extracted. We mitigate with the `__gap[40]` reserve
  and explicit upgrade verification.
- **`depositForVault` bypasses the reentrancy lock.** This is the highest-
  trust function in the system. The two-key gate keeps the blast radius
  bounded but it deserves a dedicated security pass — flagged as a
  follow-up review item.
- **PUSD+ is not ERC-4626.** Integrations expecting `convertToShares` will
  need to adapt to `previewMintPlus / previewBurnPlus`. We considered
  adding a thin ERC-4626 facade and chose not to — confusion about whether
  redeem is sync or async is worse than a clearly-different API.

### Migration / cleanup

- All docs that described the 4-contract design have been removed from the
  working tree — git history is the archive. The narrative diff is captured
  in this ADR; the original prose is recoverable via `git log --follow` if
  ever needed.
- The served Skill, `llms.txt`, root README, and DEPLOYMENT.md have been
  updated to reflect shipped reality (and to fix 6 stale reserve token
  addresses).
- Internal contributor context lives in [`docs/research/`](../../research/), encrypted at rest. Cross-cutting in `agents.md`; per-contract files (`pusd.md`, `pusdmanager.md`, `pusdplusvault.md`, `insurancefund.md`); plus `frontend.md` and `backend.md`.
- The legacy top-level `agents/` directory and the stale `contracts/docs/`
  shadow tree have been removed.
- ADR 0003 is superseded but kept (with a Superseded banner) for audit trail.

---

## References

- [docs/research/pusdplusvault.md](../../research/pusdplusvault.md) — design doc that landed in code, including I1–I5 and the queue mechanic (encrypted at rest)
- `contracts/src/PUSDManager.sol:60-70, 776-857, 904-949, 952` — v2 storage append, depositToPlus / redeemFromPlus, setters, depositForVault, `__gap_v2`
- `contracts/src/PUSDPlusVault.sol` — full vault including queue and LP
- `contracts/src/InsuranceFund.sol` — sidecar
- `contracts/foundry.toml` — `via_ir`, `evm_version` build flags
- `contracts/deployed.txt` — Deployment 4 addresses (2026-05-04)
