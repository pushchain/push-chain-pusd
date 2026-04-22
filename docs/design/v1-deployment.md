# v1 Deployment — Live State

> Status: **LIVE on Push Chain Donut Testnet** as of the deployment block recorded below.
> This document is the single source of truth for what is on-chain today. Any divergence between this file and reality is a bug in this file.

---

## 1. Deployed addresses

| Contract                 | Address                                      | Type             | Verified |
| ------------------------ | -------------------------------------------- | ---------------- | -------- |
| **PUSD Proxy**           | `0x5eb3Bc0a489C5A8288765d2336659EbCA68FCd00` | ERC1967 UUPS     | ✅       |
| PUSD Implementation      | `0x9d4454B023096f34B160D6B654540c56A1F81688` | logic            | ✅       |
| **PUSDManager Proxy**    | `0x809d550fca64d94Bd9F66E60752A544199cfAC3D` | ERC1967 UUPS     | ✅       |
| PUSDManager Implementation | `0x36C02dA8a0983159322a80FFE9F24b1acfF8B570` | logic          | ✅       |
| Admin (multisig / EOA)   | `0xB59Cdc85Cacd15097ecE4C77ed9D225014b4D56D` | external         | n/a      |

**Always interact with the proxy address, never the implementation.** The implementation is only relevant when verifying bytecode or planning upgrades.

Explorer links:

- PUSD: https://donut.push.network/address/0x5eb3Bc0a489C5A8288765d2336659EbCA68FCd00
- PUSDManager: https://donut.push.network/address/0x809d550fca64d94Bd9F66E60752A544199cfAC3D

---

## 2. Chain

| Parameter          | Value                                 |
| ------------------ | ------------------------------------- |
| Network            | Push Chain Donut Testnet              |
| Chain ID           | `42101`                               |
| RPC URL            | `https://evm.donut.rpc.push.org/`     |
| Explorer           | `https://donut.push.network`          |
| Native token       | `PUSH` (18 decimals, testnet faucet)  |

---

## 3. Supported reserve tokens

PUSD accepts deposits of USDC/USDT from nine external-chain sources. Users deposit an external-chain stable and the Push Chain universal-transaction layer bridges the `funds` to the Donut-side ERC-20 representation before `PUSDManager.deposit` is called.

| # | Symbol | Origin chain      | Donut address (bridged representation)       | Decimals | Status  |
| - | ------ | ----------------- | -------------------------------------------- | -------- | ------- |
| 1 | USDT   | Ethereum Sepolia  | `0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3` | 6        | ENABLED |
| 2 | USDC   | Ethereum Sepolia  | `0x7A58048036206bB898008b5bBDA85697DB1e5d66` | 6        | ENABLED |
| 3 | USDT   | Solana Devnet     | `0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34` | 6        | ENABLED |
| 4 | USDC   | Solana Devnet     | `0x04B8F634ABC7C879763F623e0f0550a4b5c4426F` | 6        | ENABLED |
| 5 | USDT   | Base Sepolia      | `0x2C455189D2af6643B924A981a9080CcC63d5a567` | 6        | ENABLED |
| 6 | USDC   | Base Sepolia      | `0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1` | 6        | ENABLED |
| 7 | USDT   | Arbitrum Sepolia  | `0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9` | 6        | ENABLED |
| 8 | USDC   | Arbitrum Sepolia  | `0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C` | 6        | ENABLED |
| 9 | USDT   | BNB Testnet       | `0x2f98B4235FD2BA0173a2B056D722879360B12E7b` | 6        | ENABLED |

Token statuses supported by PUSDManager:

- `REMOVED` — cannot deposit or redeem; treated as if the token does not exist.
- `ENABLED` — can deposit, can redeem (preferred or basket leg).
- `REDEEM_ONLY` — cannot deposit; can still be used in redemption baskets.
- `EMERGENCY_REDEEM` — cannot deposit; forces proportional basket redemption to drain this token.

All nine tokens are currently `ENABLED`.

---

## 4. Fee + haircut configuration

| Parameter           | On-chain value | Human reading               |
| ------------------- | -------------- | --------------------------- |
| `baseFee`           | `5` bps        | 0.05 % — redemption fee     |
| `preferredFeeMin`   | `10` bps       | 0.10 % — preferred-asset min surcharge |
| `preferredFeeMax`   | `50` bps       | 0.50 % — preferred-asset max surcharge |
| `surplusHaircutBps` | `0` (default, per token) | no mint haircut on any token today |
| `treasuryReserve`   | (not yet set — surplus accrues in Manager) |

**Hard caps in code:**

- `baseFee` ≤ 100 bps (1 %).
- `preferredFeeMax` ≤ 200 bps (2 %).
- `surplusHaircutBps` ≤ 4000 bps (40 %) per token.

Deposit has **no protocol fee** — PUSD is minted 1:1 of the net deposited amount (after any per-token haircut, currently 0). Redemption applies `baseFee` plus a per-token preferred surcharge that sits between `preferredFeeMin` and `preferredFeeMax`.

---

## 5. Roles

| Role                | Held by                                      | Purpose                                  |
| ------------------- | -------------------------------------------- | ---------------------------------------- |
| `DEFAULT_ADMIN_ROLE`  | `0xB59C…D56D` on PUSD + PUSDManager         | root role admin                          |
| `ADMIN_ROLE` (Manager) | `0xB59C…D56D`                              | add/remove tokens, set fees, rebalance, sweep |
| `UPGRADER_ROLE`       | `0xB59C…D56D` on both contracts             | authorize UUPS upgrades                  |
| `MINTER_ROLE` (PUSD)  | `PUSDManager` proxy only                    | mint PUSD on deposit                     |
| `BURNER_ROLE` (PUSD)  | `PUSDManager` proxy only                    | burn PUSD on redeem                      |

The deployer (`0xf39F…9266`) renounced all roles at the end of the deploy script. The only privileged party is the final admin.

> **Treasury gap:** `treasuryReserve` is unset. Accrued fees and haircuts sit inside PUSDManager until the admin calls `setTreasuryReserve(addr)` and then `sweepAllSurplus()`. Until then, fee income is locked in the contract but preserved — not lost. Action item before any mainnet move.

---

## 6. Invariants (what must hold)

See `docs/design/invariants.md` for the full list. The critical one for v1:

- **I-01 (solvency):** `Σ normalize(reserve[tᵢ]) ≥ pusd.totalSupply()` for all supported tokens `tᵢ`.
  - v1 has no active capital deployment (no PUSDLiquidity, no UniV3). Reserves sit idle in PUSDManager → this is trivially a balance check on the Manager address.
  - Violation means the contract is under-collateralized and minting must halt.

The v1 frontend's invariants ribbon should live-compute I-01 from on-chain reads (`Σ ERC20(tᵢ).balanceOf(PUSDManager) × decimalsFactor ≥ PUSD.totalSupply()`) and surface a red banner on violation.

---

## 7. Post-deploy smoke tests

Run these against Donut before announcing v1 as open:

1. **Mint path (single chain):** from an account holding Donut-side USDC, call `approve` + `deposit`. Expect PUSD balance to increase by exactly the deposited amount (6-decimal normalize → 18-decimal PUSD is currently encoded as 6 → 6 since PUSD uses 6 decimals; confirm from contract).
2. **Mint path (cross-chain):** from an Ethereum Sepolia account, send a universal transaction with `funds: { token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDC, amount }`, to → PUSDManager.deposit. Expect the funds to arrive on Donut and PUSD to be minted to the recipient.
3. **Redeem preferred:** `approve` PUSD to Manager, `redeem(amount, preferredAsset, allowBasket=false, recipient)`. Expect `amount × (1 − baseFee)` of `preferredAsset` delivered.
4. **Redeem basket:** same as above with `allowBasket=true` when preferred has insufficient Manager balance. Expect proportional distribution across tokens.
5. **Solvency check:** after smoke tests, verify `Σ normalized reserves ≥ totalSupply`. Script this — do not eyeball.
6. **Admin path:** from admin EOA, call `setSurplusHaircutBps(token, 10)` (10 bps); confirm event, deposit once, observe haircut accrual; reset to 0.

---

## 8. Upgrade + pause posture

- **Upgradeable:** both contracts are UUPS proxies. Only `UPGRADER_ROLE` (currently `0xB59C…D56D`) can authorize a new implementation via `upgradeToAndCall`. No timelock in v1 — upgrade is immediate. **Added timelock is a v2 task** (48h TimelockController per ADR 0002).
- **Pause:** v1 has no explicit pause function. The admin's practical emergency tool is:
  1. Call `setTokenStatus(tᵢ, REMOVED)` for every supported token → halts deposits and redemptions of that token.
  2. Or revoke `MINTER_ROLE` from PUSDManager on PUSD → halts minting globally while still allowing redemptions (but those also need `BURNER_ROLE`).
  3. In the worst case, upgrade PUSDManager to a paused implementation.
  The v2 architecture introduces a dedicated `PAUSER_ROLE` and `Pausable` on all entry points — tracked under ADR 0002.

---

## 9. What is not in v1

The following are explicitly deferred to v2 — do not expect them on-chain today:

- `PUSDPlus` (ERC-4626 yield wrapper)
- `PUSDLiquidity` (Uniswap V3 LP engine)
- Uniswap V3 LP deployments
- Idle-vs-deployed reserve slicing
- `VAULT_ROLE`, `LIQUIDITY_ROLE`, `REBALANCER_ROLE`, `PAUSER_ROLE`
- 48-hour TimelockController on upgrades

v1 is a par-backed, idle-reserves stablecoin. Yield and active capital arrive in v2.

---

## 10. Frontend env — copy to `app/.env.local`

```
VITE_PUSD_ADDRESS=0x5eb3Bc0a489C5A8288765d2336659EbCA68FCd00
VITE_PUSD_MANAGER_ADDRESS=0x809d550fca64d94Bd9F66E60752A544199cfAC3D
VITE_CHAIN_ID=42101
VITE_RPC_URL=https://evm.donut.rpc.push.org/
```

---

## 11. Go-live checklist

Before the v1 frontend is pointed at users in public, confirm:

- [ ] All nine supported tokens have ≥ 1 USDC/USDT in the Manager from test deposits (proves each deposit path works end-to-end).
- [ ] Redeem preferred succeeds on each enabled token.
- [ ] Redeem basket succeeds when preferred is drained.
- [ ] Invariants ribbon reads correct totals on page load.
- [ ] Transaction history reads `Deposited` and `Redeemed` events for the connected account and links to explorer.
- [ ] Admin EOA is a multisig (currently a single address — confirm or migrate before opening up).
- [ ] `treasuryReserve` is set and first `sweepAllSurplus` succeeds with a non-zero value (proves the full fee loop).
- [ ] Known frontend bug fixed: `RedeemTab.tsx` calls `redeem(amount, asset, allowBasket)` but the contract signature is `redeem(amount, asset, allowBasket, recipient)` — must pass `recipient = user address` or all redemptions revert.

---

## 12. References

- `contracts/src/PUSD.sol`
- `contracts/src/PUSDManager.sol`
- `contracts/deployed.txt` — raw forge broadcast log (source of truth for addresses)
- `docs/design/architecture.md` — how the contracts relate
- `docs/design/invariants.md` — I-01 through I-13
- `docs/design/v1-frontend-plan.md` — the frontend that goes on top of this deployment
