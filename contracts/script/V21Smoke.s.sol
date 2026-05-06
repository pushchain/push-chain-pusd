// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Script.sol";
import "../src/PUSDManager.sol";
import "../src/PUSDPlusVault.sol";

/**
 * @title  V21Smoke
 * @notice Static read-only post-upgrade smoke for v2.1. Verifies the
 *         critical wiring is intact (no role/state drift across the impl
 *         swap) and the v2.1 prerequisite (vault basket includes every
 *         manager-supported token) is satisfied.
 *
 *         Run AFTER the multisig executes the v2.1 upgrade:
 *           forge script V21Smoke --rpc-url $DONUT_RPC -v
 *
 *         Exits with revert + descriptive message on any drift.
 */
contract V21Smoke is Script {
    address constant MANAGER_PROXY = 0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46;
    address constant VAULT_PROXY = 0xb55a5B36d82D3B7f18Afe42F390De565080A49a1;

    function run() external view {
        PUSDManager m = PUSDManager(MANAGER_PROXY);
        PUSDPlusVault v = PUSDPlusVault(VAULT_PROXY);

        // ---- 1. Wiring intact ----
        require(m.plusVault() == address(v), "V21Smoke: plusVault drift");
        require(m.feeExempt(address(v)), "V21Smoke: feeExempt revoked");
        require(v.hasRole(v.MANAGER_ROLE(), address(m)), "V21Smoke: MANAGER_ROLE drift");

        // ---- 2. Vault knobs intact (read random values; just confirm not zero) ----
        require(v.haircutBps() <= v.MAX_HAIRCUT_BPS(), "V21Smoke: haircutBps");
        require(v.publicRebalanceCooldown() <= v.MAX_REBALANCE_COOLDOWN(), "V21Smoke: cooldown cap");
        require(v.insuranceFund() != address(0), "V21Smoke: insuranceFund unset");

        // ---- 3. Basket includes every manager-supported token (v2.1 prereq) ----
        uint256 n = m.getSupportedTokensCount();
        for (uint256 i = 0; i < n; i++) {
            address t = m.getSupportedTokenAt(i);
            if (m.getTokenStatus(t) == PUSDManager.TokenStatus.REMOVED) continue;
            require(v.inBasket(t), "V21Smoke: vault basket missing supported token");
        }

        console.log("");
        console.log("=== V21Smoke: PASS ===");
        console.log("  PUSDManager proxy:    ", MANAGER_PROXY);
        console.log("  PUSDPlusVault proxy:  ", VAULT_PROXY);
        console.log("  Supported tokens:     ", n);
        console.log("  Vault basket length:  ", v.basketLength());
        console.log("  publicRebalanceCooldown:", v.publicRebalanceCooldown());
        console.log("  lastRebalanceAt:      ", v.lastRebalanceAt());
    }
}
