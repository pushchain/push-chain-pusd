// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "./DeployBase.s.sol";

/**
 * @title  DeployPUSDPlusV2
 * @notice V2 deploy — upgrades existing PUSD V1 deployment to V2 (PUSD+).
 *
 *         Flow (matches design doc §12):
 *           1. Deploy a new PUSDManager implementation.
 *           2. Upgrade existing PUSDManager proxy → new impl.
 *           3. (Optional) Deploy + upgrade PUSD impl too.            (UPGRADE_PUSD=true)
 *           4. Deploy PUSDPlusVault behind UUPS proxy.
 *           5. Deploy InsuranceFund behind UUPS proxy.
 *           6. §12 step 3 atomic configuration.
 *
 *         The signing key MUST hold UPGRADER_ROLE on PUSDManager (and PUSD if
 *         UPGRADE_PUSD=true) AND DEFAULT_ADMIN_ROLE / ADMIN_ROLE on
 *         PUSDManager (for setPlusVault / setFeeExempt).
 *
 *         For a fresh chain that doesn't have V1 deployed yet, use
 *         DeployFull.s.sol instead.
 *
 *         Required env vars: see .env.example.
 *         Run:
 *           forge script script/DeployPUSDPlus.v2.s.sol:DeployPUSDPlusV2 \
 *             --rpc-url $PUSH_RPC --broadcast --verify
 */
contract DeployPUSDPlusV2 is DeployBase {
    function run() external returns (V2Result memory r) {
        Wiring memory w = _readWiringForV2();
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== PUSD+ V2 upgrade-and-deploy ===");
        console.log("Deployer:               ", deployer);
        console.log("Final admin:            ", w.admin);
        console.log("Existing PUSD:          ", w.pusdProxy);
        console.log("Existing PUSDManager:   ", w.managerProxy);

        // Pre-broadcast role check — avoids wasting gas on impl deploys if the
        // signing key isn't the admin.
        _assertHasRole(w.managerProxy, keccak256("UPGRADER_ROLE"), deployer, "PUSDManager UPGRADER_ROLE");
        _assertHasRole(w.managerProxy, bytes32(0), deployer, "PUSDManager DEFAULT_ADMIN_ROLE");
        _assertHasRole(w.managerProxy, keccak256("ADMIN_ROLE"), deployer, "PUSDManager ADMIN_ROLE");
        if (w.upgradePusd) {
            _assertHasRole(w.pusdProxy, keccak256("UPGRADER_ROLE"), deployer, "PUSD UPGRADER_ROLE");
        }
        console.log("Role precheck OK.");

        vm.startBroadcast(deployerKey);

        // Steps 1–3 — upgrade existing proxies
        _upgradeManager(w.managerProxy, deployer);
        if (w.upgradePusd) _upgradePusd(w.pusdProxy, deployer);

        // Steps 4–6 — deploy vault + IF, run atomic config
        r = _deployV2(w);

        vm.stopBroadcast();

        _logV2(w, r);
    }
}
