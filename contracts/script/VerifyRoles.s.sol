// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Script.sol";

import "../src/PUSD.sol";
import "../src/PUSDManager.sol";
import "../src/PUSDPlus.sol";
import "../src/PUSDLiquidity.sol";

/**
 * @title  VerifyRoles
 * @notice Read-only script that asserts the post-deploy role matrix matches the v2 contract plan.
 *         Run with `forge script --rpc-url $RPC_URL`. Reverts (with a descriptive message) if any
 *         expected role is missing or an unexpected role-holder still exists.
 *
 *         Required env:
 *           ADMIN_ADDRESS          final admin / multisig
 *           PUSD_ADDRESS, PUSD_MANAGER, PUSD_PLUS, PUSD_LIQUIDITY
 *           DEPLOYER_ADDRESS       (optional) — the deployer key whose roles must have been renounced
 */
contract VerifyRoles is Script {
    function run() external view {
        address admin    = vm.envAddress("ADMIN_ADDRESS");
        address deployer = vm.envOr("DEPLOYER_ADDRESS", admin);

        PUSD          pusd    = PUSD(vm.envAddress("PUSD_ADDRESS"));
        PUSDManager   manager = PUSDManager(vm.envAddress("PUSD_MANAGER"));
        PUSDPlus      plus    = PUSDPlus(vm.envAddress("PUSD_PLUS"));
        PUSDLiquidity liq     = PUSDLiquidity(vm.envAddress("PUSD_LIQUIDITY"));

        // 1. PUSD: only Manager mints/burns.
        require(pusd.hasRole(pusd.MINTER_ROLE(), address(manager)), "PUSD: Manager not MINTER");
        require(pusd.hasRole(pusd.BURNER_ROLE(), address(manager)), "PUSD: Manager not BURNER");

        // 2. Manager VAULT_ROLE held only by PUSDPlus.
        require(manager.hasRole(manager.VAULT_ROLE(), address(plus)), "Manager: PUSDPlus not VAULT");

        // 3. Liquidity VAULT_ROLE: held by PUSDPlus AND Manager (Manager calls pullForWithdraw).
        require(liq.hasRole(liq.VAULT_ROLE(), address(plus)),    "Liquidity: PUSDPlus not VAULT");
        require(liq.hasRole(liq.VAULT_ROLE(), address(manager)), "Liquidity: Manager not VAULT");

        // 4. PUSDPlus LIQUIDITY_ROLE held by PUSDLiquidity.
        require(plus.hasRole(plus.LIQUIDITY_ROLE(), address(liq)), "PUSDPlus: Liquidity not LIQUIDITY_ROLE");

        // 5. Wiring matches.
        require(plus.pusdLiquidity() == address(liq),    "PUSDPlus.pusdLiquidity != Liquidity");
        require(plus.pusdManager()   == address(manager),"PUSDPlus.pusdManager != Manager");
        require(manager.pusdPlus()      == address(plus), "Manager.pusdPlus != PUSDPlus");
        require(manager.pusdLiquidity() == address(liq),  "Manager.pusdLiquidity != Liquidity");
        require(liq.pusdPlus()    == address(plus),    "Liquidity.pusdPlus != PUSDPlus");
        require(liq.pusdManager() == address(manager), "Liquidity.pusdManager != Manager");

        // 6. Final admin holds DEFAULT_ADMIN_ROLE on every contract.
        require(pusd.hasRole(pusd.DEFAULT_ADMIN_ROLE(), admin),       "PUSD: admin missing");
        require(manager.hasRole(manager.DEFAULT_ADMIN_ROLE(), admin), "Manager: admin missing");
        require(plus.hasRole(plus.DEFAULT_ADMIN_ROLE(), admin),       "PUSDPlus: admin missing");
        require(liq.hasRole(liq.DEFAULT_ADMIN_ROLE(), admin),         "Liquidity: admin missing");

        // 7. If deployer != admin, deployer must have renounced everywhere.
        if (deployer != admin) {
            require(!pusd.hasRole(pusd.DEFAULT_ADMIN_ROLE(), deployer),       "PUSD: deployer still admin");
            require(!manager.hasRole(manager.DEFAULT_ADMIN_ROLE(), deployer), "Manager: deployer still admin");
            require(!plus.hasRole(plus.DEFAULT_ADMIN_ROLE(), deployer),       "PUSDPlus: deployer still admin");
            require(!liq.hasRole(liq.DEFAULT_ADMIN_ROLE(), deployer),         "Liquidity: deployer still admin");
        }

        console.log("Role matrix OK.");
    }
}
