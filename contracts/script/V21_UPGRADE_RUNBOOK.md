# V2.1 Upgrade Runbook

> Multisig checklist for the PUSDManager v2.1 impl swap.

## What v2.1 ships

- `PUSDManager.depositToPlus` rewrite — direct path forwards reserves to vault, wrap path basket-redeems through manager.
- `PUSDPlusVault._convertIdleReservesToPusd` preferred-first conversion.
- `PUSDPlusVault.rebalance` permissionless-with-cooldown (KEEPER bypasses).
- New vault state: `lastRebalanceAt`, `publicRebalanceCooldown` (consumes 1 slot from `__gap`).
- `IPUSDPlusVault.inBasket` interface extension.

## Roles needed

- **Deployer**: any EOA with gas (deploys impl).
- **POOL_ADMIN_ROLE on vault**: needs to run `PopulateVaultBasket.s.sol` BEFORE the manager upgrade activates.
- **UPGRADER_ROLE on PUSDManager**: triggers `upgradeToAndCall`.
- **DEFAULT_ADMIN_ROLE on PUSDPlusVault**: triggers vault impl upgrade.

> **Today (Deployment 4 testnet)**: `UPGRADER_ROLE` and `DEFAULT_ADMIN_ROLE` are held by the admin EOA (`0xA1c1AF949C5752E9714cFE54f444cE80f078069A`). No `TimelockController` is deployed. Upgrades execute in a single transaction with no delay. Steps 4–5 (schedule + wait 48h + execute) are **mainnet-only** and only kick in once the roles are rotated to a timelock.

## Step 0 — Pre-upgrade verification (off-chain)

- [ ] Storage-layout diff vs current v2 impl. Must be byte-identical below `__gap_v2` for PUSDManager and below `__gap` for PUSDPlusVault (after `__gap[39]`).
  ```bash
  forge inspect PUSDManager storage-layout > .v21.layout
  git stash && forge inspect PUSDManager storage-layout > .v2.layout && git stash pop
  diff .v2.layout .v21.layout
  ```
- [ ] Full test suite passes locally:
  ```bash
  forge test --match-contract PUSDPlusVault -vv
  forge test --match-contract DepositForVaultSecurity -vv
  forge test --match-contract BoundedBatchVariants -vv
  ```
- [ ] Fork tests pass against current testnet state:
  ```bash
  forge test --match-contract V21UpgradeFork --fork-url $DONUT_RPC -vv
  ```

## Step 1 — Populate vault basket (POOL_ADMIN multisig)

Required because v2.1's direct-deposit path reverts on tokens missing from
`vault.basket`. Idempotent — safe to re-run.

```bash
export POOL_ADMIN_PRIVATE_KEY=...   # or use multisig batch tx
forge script PopulateVaultBasket --rpc-url $DONUT_RPC --broadcast
```

Verify:

- [ ] `cast call $VAULT "basketLength()(uint256)"` returns ≥ 9
- [ ] For each of the 9 supported tokens: `cast call $VAULT "inBasket(address)(bool)" $TOKEN` returns true

## Step 2 — Deploy new PUSDManager impl

```bash
export DEPLOYER_PRIVATE_KEY=...
forge script DeployPUSDV21 --rpc-url $DONUT_RPC --broadcast --verify
# (file: contracts/script/DeployPUSD.v2.1.s.sol — naming follows DeployPUSD.v1.s.sol pattern)
```

Capture the printed impl address. Save the printed upgrade calldata for the multisig submission.

- [ ] Impl deployed and verified on Donut explorer.

## Step 3 — Deploy new PUSDPlusVault impl

> v2.1 also touches the vault (new state slot for cooldown + new function bodies). A separate fresh impl deploy is required.

```bash
forge create PUSDPlusVault --rpc-url $DONUT_RPC --broadcast --verify --private-key $DEPLOYER_PRIVATE_KEY
# (vault impl deploy is via forge create directly; same source as v2)
```

(If a dedicated v2.1 vault deploy script doesn't exist, deploy the contract manually with `forge create PUSDPlusVault` — same source.)

- [ ] Vault impl deployed and verified.

## Step 4 — Trigger upgrades

### Testnet (current — no timelock)

Admin EOA calls `upgradeToAndCall` directly on each proxy. Two transactions,
seconds of elapsed time.

```bash
cast send $MANAGER_PROXY "upgradeToAndCall(address,bytes)" $NEW_MANAGER_IMPL "0x" \
  --rpc-url $DONUT_RPC --private-key $ADMIN_PRIVATE_KEY

cast send $VAULT_PROXY "upgradeToAndCall(address,bytes)" $NEW_VAULT_IMPL "0x" \
  --rpc-url $DONUT_RPC --private-key $ADMIN_PRIVATE_KEY
```

- [ ] PUSDManager upgrade tx mined.
- [ ] PUSDPlusVault upgrade tx mined.

### Mainnet (future — once timelock is deployed)

Submit two `upgradeToAndCall` proposals through the 48h timelock.

- [ ] PUSDManager upgrade scheduled at timelock.
- [ ] PUSDPlusVault upgrade scheduled at timelock.

## Step 5 — (Mainnet only) Wait the timelock window

48 hours. Use the time to verify on a tenderly fork that the queued
upgrades behave as expected. Skip on testnet.

## Step 6 — (Mainnet only) Execute upgrades

- [ ] Multisig calls `TimelockController.execute` for the PUSDManager upgrade.
- [ ] Multisig calls `TimelockController.execute` for the PUSDPlusVault upgrade.

## Step 6.5 — Drain pre-existing legacy PUSD from vault

Pre-v2.1 `depositToPlus` accumulated PUSD in the vault as claim tickets.
Under v2.1 these don't grow (direct path skips PUSD), but any pre-existing
balance still sits there. One-shot drain via the keeper:

```bash
export KEEPER_PRIVATE_KEY=...

# Option A — proportional drain across vault basket (preserves ratios)
forge script UnwrapLegacyPUSD --rpc-url $DONUT_RPC --broadcast

# Option B — drain into one specific token (e.g. seeding inventory for a pool)
TARGET_TOKEN=0x7A58048036206bB898008b5bBDA85697DB1e5d66 \
  forge script UnwrapLegacyPUSD --rpc-url $DONUT_RPC --broadcast
```

- [ ] `cast call $VAULT "balanceOf(address)(uint256)" $PUSD --rpc-url $DONUT_RPC` returns 0 (or close — proportional drain may leave dust).
- [ ] Vault basket balances increased correspondingly.

This is a one-shot migration step. After v2.1 + this drain, the vault
holds only reserve tokens. Future incidental PUSD accumulation (e.g. from
queue claim cleanup) is handled by the keeper's normal `redeemPusdForToken`
cadence — no manual step needed.

## Step 7 — Smoke verification

```bash
forge script V21Smoke --rpc-url $DONUT_RPC -v
```

This is read-only and reverts loudly on any drift. It checks:

- `manager.plusVault() == VAULT_PROXY`
- `manager.feeExempt(VAULT_PROXY) == true`
- `vault.hasRole(MANAGER_ROLE, MANAGER_PROXY)`
- `vault.haircutBps() ≤ MAX_HAIRCUT_BPS`
- `vault.publicRebalanceCooldown() ≤ MAX_REBALANCE_COOLDOWN`
- For every non-REMOVED supported token: `vault.inBasket(token) == true`

- [ ] Smoke passes.

## Step 8 — Live mint test

Send a tiny test deposit (~$1) from the multisig to confirm direct path works:

```bash
# Approve manager to spend $1 USDC.eth
cast send $USDC_ETH "approve(address,uint256)" $MANAGER 1000000 \
  --rpc-url $DONUT_RPC --private-key $MULTISIG_KEY

# Direct deposit
cast send $MANAGER "depositToPlus(address,uint256,address)" \
  $USDC_ETH 1000000 $MULTISIG \
  --rpc-url $DONUT_RPC --private-key $MULTISIG_KEY
```

- [ ] `usdc.balanceOf(VAULT_PROXY)` increased by ~1000000.
- [ ] `pusd.totalSupply()` unchanged.
- [ ] `vault.balanceOf(MULTISIG)` increased by ~1000000.

## Step 9 — Document

- [ ] Append Deployment 5 entry to `contracts/deployed.txt` with both new impl addresses + date.
- [ ] Update `DEPLOYMENT.md` with new impl addresses.
- [ ] Bump `app/public/llms.txt` version line; add v2.1 note.
- [ ] Add v2.1 note to served `SKILL.md`.

## Rollback (if smoke or live mint fails)

If the upgrade misbehaves:

1. Multisig submits a rollback `upgradeToAndCall(<v2 impl>, "")` for the misbehaving contract.
2. Wait 48h timelock.
3. Execute. State is preserved (UUPS upgrades don't touch storage).

Storage was preserved by the v2 → v2.1 swap, so the rollback v2.1 → v2 is
equally safe.
