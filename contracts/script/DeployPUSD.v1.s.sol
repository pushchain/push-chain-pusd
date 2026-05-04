// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "./DeployBase.s.sol";

/**
 * @title  DeployPUSDV1
 * @notice V1 deploy — fresh PUSD + PUSDManager on a chain that doesn't have
 *         them yet. Configures supported reserves, fees, and (optionally)
 *         transfers admin to a final admin address.
 *
 *         For a fresh chain that wants the WHOLE V1+V2 stack, use
 *         DeployFull.s.sol. To upgrade an existing V1 deployment to V2 and
 *         add the vault, use DeployPUSDPlus.v2.s.sol.
 *
 *         Required env vars: PRIVATE_KEY, ADMIN_ADDRESS.
 *         Run:
 *           forge script script/DeployPUSD.v1.s.sol:DeployPUSDV1 \
 *             --rpc-url $PUSH_RPC --broadcast --verify
 */
contract DeployPUSDV1 is DeployBase {
    function run() external returns (V1Result memory r) {
        address finalAdmin  = vm.envAddress("ADMIN_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("=== PUSD V1 deploy ===");
        console.log("Deployer:    ", deployer);
        console.log("Final admin: ", finalAdmin);

        vm.startBroadcast(deployerKey);
        r = _deployV1(deployer, finalAdmin);
        vm.stopBroadcast();

        _logV1(r, finalAdmin);
    }
}
