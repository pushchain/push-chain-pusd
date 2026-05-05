// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "./DeployBase.s.sol";

/**
 * @title  DeployFull
 * @notice Fresh-chain deploy — runs V1 (PUSD + PUSDManager + supported tokens
 *         + fees) AND V2 (PUSDPlusVault + InsuranceFund + atomic config) in a
 *         single broadcast.
 *
 *         Use this when:
 *           - Deploying to a new chain that has no PUSD yet, OR
 *           - You want to redeploy the full stack atomically.
 *
 *         Use DeployPUSD.v1.s.sol when:
 *           - You only need the V1 stable, no PUSD+ yet.
 *
 *         Use DeployPUSDPlus.v2.s.sol when:
 *           - V1 is already deployed at PUSD_PROXY / PUSD_MANAGER_PROXY and
 *             you want to upgrade in place + add the vault.
 *
 *         PUSD_PROXY and PUSD_MANAGER_PROXY env vars are IGNORED here —
 *         DeployFull always deploys those fresh. All other env vars apply.
 *
 *         Run:
 *           forge script script/DeployFull.s.sol:DeployFull \
 *             --rpc-url $PUSH_RPC --broadcast --verify
 */
contract DeployFull is DeployBase {
    function run() external returns (V1Result memory v1, V2Result memory v2) {
        address finalAdmin = vm.envAddress("ADMIN_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // V2 wiring — admin/keepers/multisigs from env, but proxy addresses
        // are filled from the V1 deploy below (env values for PUSD_PROXY /
        // PUSD_MANAGER_PROXY are intentionally ignored on the fresh path).
        Wiring memory w;
        w.admin = finalAdmin;
        w.npm = vm.envAddress("UNI_V3_NPM");
        w.factory = vm.envAddress("UNI_V3_FACTORY");
        w.keeper = vm.envAddress("KEEPER_BOT");
        w.poolAdmin = vm.envAddress("POOL_ADMIN_MULTISIG");
        w.vaultAdmin = vm.envAddress("VAULT_ADMIN_MULTISIG");
        w.guardian = vm.envAddress("GUARDIAN_MULTISIG");
        w.upgradePusd = false; // never relevant on a fresh chain

        console.log("=== PUSD + PUSD+ FULL deploy (fresh chain) ===");
        console.log("Deployer:               ", deployer);
        console.log("Final admin / timelock: ", finalAdmin);

        vm.startBroadcast(deployerKey);

        // Phase 1 — V1 stack. Deployer holds admin temporarily so the V2
        // configuration can run inside the same broadcast without a role
        // transfer round-trip.
        v1 = _deployV1(deployer, deployer);
        w.pusdProxy = v1.pusdProxy;
        w.managerProxy = v1.managerProxy;

        // Phase 2 — V2 stack on top. PUSDManager from phase 1 already has the
        // v2 implementation (current src/PUSDManager.sol IS the v2 source) so
        // no upgrade step is needed.
        v2 = _deployV2(w);

        // Phase 3 — hand admin off to finalAdmin if it differs from deployer.
        // Vault + IF were initialised with finalAdmin already; only V1 needs
        // the role transfer.
        if (finalAdmin != deployer) {
            _transferAdmin(PUSD(v1.pusdProxy), PUSDManager(v1.managerProxy), deployer, finalAdmin);
        }

        vm.stopBroadcast();

        _logV1(v1, finalAdmin);
        _logV2(w, v2);
    }
}
