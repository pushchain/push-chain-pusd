// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../src/PUSD.sol";
import "../src/PUSDManager.sol";
import "../src/PUSDPlus.sol";
import "../src/PUSDLiquidity.sol";

/**
 * @title  DeployAndConfigure (v2.1 — multi-pool)
 * @notice Fresh-deploy all four protocol contracts on Push Chain Donut Testnet, wire roles,
 *         register the canonical cross-chain reserve tokens, and rotate admin to the final
 *         multisig if different from the deployer.
 *
 *         Pools are created and registered in a SEPARATE step via `CreatePool.s.sol` followed by
 *         `AddPool.s.sol`, so this script makes no assumptions about which pairs are launched.
 *
 *         Required env vars:
 *           PRIVATE_KEY              deployer EOA private key (hex)
 *           ADMIN_ADDRESS            final admin / multisig (== deployer for testnet shortcut)
 *           UNIV3_NPM                Uniswap V3 NonfungiblePositionManager on Donut
 *           UNIV3_ROUTER             Uniswap V3 SwapRouter on Donut
 *           UNIV3_FACTORY            Uniswap V3 Factory on Donut
 *           FEE_RECIPIENT            performance-fee destination (multisig is fine)
 *
 *         Optional:
 *           SEED_TOKENS=1            register the 9-canonical-stables set on Donut. Token
 *                                    addresses must be supplied via env per the script body.
 */
contract DeployAndConfigure is Script {
    function run() external {
        uint256 deployerKey  = vm.envUint("PRIVATE_KEY");
        address finalAdmin   = vm.envAddress("ADMIN_ADDRESS");
        address npmAddr      = vm.envAddress("UNIV3_NPM");
        address routerAddr   = vm.envAddress("UNIV3_ROUTER");
        address factoryAddr  = vm.envAddress("UNIV3_FACTORY");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address deployer     = vm.addr(deployerKey);

        console.log("=== PUSD v2.1 Fresh Deploy ===");
        console.log("Deployer:  ", deployer);
        console.log("Final admin:", finalAdmin);

        vm.startBroadcast(deployerKey);

        // ---------------- 1. PUSD ----------------
        address pusdImpl = address(new PUSD());
        address pusdProxy = address(new ERC1967Proxy(
            pusdImpl,
            abi.encodeWithSelector(PUSD.initialize.selector, deployer)
        ));
        PUSD pusd = PUSD(pusdProxy);
        console.log("PUSD proxy:", pusdProxy);

        // ---------------- 2. PUSDManager ----------------
        address managerImpl = address(new PUSDManager());
        address managerProxy = address(new ERC1967Proxy(
            managerImpl,
            abi.encodeWithSelector(PUSDManager.initialize.selector, pusdProxy, deployer)
        ));
        PUSDManager manager = PUSDManager(managerProxy);
        console.log("PUSDManager proxy:", managerProxy);

        pusd.grantRole(pusd.MINTER_ROLE(), managerProxy);
        pusd.grantRole(pusd.BURNER_ROLE(), managerProxy);

        // ---------------- 3. PUSDPlus ----------------
        address plusImpl = address(new PUSDPlus());
        address plusProxy = address(new ERC1967Proxy(
            plusImpl,
            abi.encodeWithSelector(
                PUSDPlus.initialize.selector,
                pusdProxy, managerProxy, deployer, feeRecipient
            )
        ));
        PUSDPlus plus = PUSDPlus(plusProxy);
        console.log("PUSDPlus proxy:", plusProxy);

        manager.setPUSDPlus(plusProxy);

        // ---------------- 4. PUSDLiquidity ----------------
        // v2.1 initialize takes NO usdc/usdt — the pool registry is wired post-deploy.
        address liqImpl = address(new PUSDLiquidity());
        address liqProxy = address(new ERC1967Proxy(
            liqImpl,
            abi.encodeWithSelector(
                PUSDLiquidity.initialize.selector,
                deployer, managerProxy, npmAddr, routerAddr, factoryAddr
            )
        ));
        PUSDLiquidity liq = PUSDLiquidity(liqProxy);
        console.log("PUSDLiquidity proxy:", liqProxy);

        liq.setPUSDPlus(plusProxy);
        plus.setPUSDLiquidity(liqProxy);
        manager.setPUSDLiquidity(liqProxy);

        // ---------------- 5. Rebalancer ----------------
        // Grant REBALANCER_ROLE to the deployer so the operator can immediately drive
        // OpenInitialPosition / collectFees / decreasePosition from a single key. The deployer
        // (or eventual multisig) can extend the role to a keeper bot post-launch.
        liq.grantRole(liq.REBALANCER_ROLE(), deployer);
        if (finalAdmin != deployer) {
            liq.grantRole(liq.REBALANCER_ROLE(), finalAdmin);
        }

        // ---------------- 6. Tariff defaults ----------------
        manager.setBaseFee(5);                    // 0.05%
        manager.setPreferredFeeRange(10, 150);    // OQ-06 recommendation

        console.log("Pools NOT registered yet. Run CreatePool.s.sol then AddPool.s.sol per pair.");

        // ---------------- 7. Hand off admin to multisig (if separate) ----------------
        if (finalAdmin != deployer) {
            _rotateAdmin(pusd, finalAdmin, deployer);
            _rotateAdminManager(manager, finalAdmin, deployer);
            _rotateAdminPlus(plus, finalAdmin, deployer);
            _rotateAdminLiq(liq, finalAdmin, deployer);
        }

        vm.stopBroadcast();

        console.log("\n=== Deploy summary ===");
        console.log("PUSD:        ", pusdProxy);
        console.log("PUSDManager: ", managerProxy);
        console.log("PUSDPlus:    ", plusProxy);
        console.log("PUSDLiquidity:", liqProxy);
        console.log("\nFrontend env:");
        console.log("VITE_PUSD_ADDRESS=",         pusdProxy);
        console.log("VITE_PUSD_MANAGER_ADDRESS=", managerProxy);
        console.log("VITE_PUSD_PLUS_ADDRESS=",    plusProxy);
        console.log("VITE_PUSD_LIQUIDITY_ADDRESS=", liqProxy);
    }

    function _rotateAdmin(PUSD pusd, address newAdmin, address oldAdmin) internal {
        pusd.grantRole(pusd.DEFAULT_ADMIN_ROLE(), newAdmin);
        pusd.grantRole(pusd.UPGRADER_ROLE(),     newAdmin);
        pusd.renounceRole(pusd.UPGRADER_ROLE(),     oldAdmin);
        pusd.renounceRole(pusd.DEFAULT_ADMIN_ROLE(), oldAdmin);
    }

    function _rotateAdminManager(PUSDManager m, address newAdmin, address oldAdmin) internal {
        m.grantRole(m.DEFAULT_ADMIN_ROLE(), newAdmin);
        m.grantRole(m.ADMIN_ROLE(),         newAdmin);
        m.grantRole(m.PAUSER_ROLE(),        newAdmin);
        m.grantRole(m.UPGRADER_ROLE(),      newAdmin);
        m.renounceRole(m.UPGRADER_ROLE(),      oldAdmin);
        m.renounceRole(m.PAUSER_ROLE(),        oldAdmin);
        m.renounceRole(m.ADMIN_ROLE(),         oldAdmin);
        m.renounceRole(m.DEFAULT_ADMIN_ROLE(), oldAdmin);
    }

    function _rotateAdminPlus(PUSDPlus p, address newAdmin, address oldAdmin) internal {
        p.grantRole(p.DEFAULT_ADMIN_ROLE(), newAdmin);
        p.grantRole(p.ADMIN_ROLE(),         newAdmin);
        p.grantRole(p.PAUSER_ROLE(),        newAdmin);
        p.grantRole(p.UPGRADER_ROLE(),      newAdmin);
        p.renounceRole(p.UPGRADER_ROLE(),      oldAdmin);
        p.renounceRole(p.PAUSER_ROLE(),        oldAdmin);
        p.renounceRole(p.ADMIN_ROLE(),         oldAdmin);
        p.renounceRole(p.DEFAULT_ADMIN_ROLE(), oldAdmin);
    }

    function _rotateAdminLiq(PUSDLiquidity l, address newAdmin, address oldAdmin) internal {
        l.grantRole(l.DEFAULT_ADMIN_ROLE(), newAdmin);
        l.grantRole(l.ADMIN_ROLE(),         newAdmin);
        l.grantRole(l.PAUSER_ROLE(),        newAdmin);
        l.grantRole(l.UPGRADER_ROLE(),      newAdmin);
        // newAdmin already received REBALANCER_ROLE earlier; deployer renounces theirs here.
        l.renounceRole(l.REBALANCER_ROLE(),   oldAdmin);
        l.renounceRole(l.UPGRADER_ROLE(),      oldAdmin);
        l.renounceRole(l.PAUSER_ROLE(),        oldAdmin);
        l.renounceRole(l.ADMIN_ROLE(),         oldAdmin);
        l.renounceRole(l.DEFAULT_ADMIN_ROLE(), oldAdmin);
    }
}
