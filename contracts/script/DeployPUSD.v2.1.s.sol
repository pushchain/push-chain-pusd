// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Script.sol";
import "../src/PUSDManager.sol";

/**
 * @title  DeployPUSDV21
 * @notice v2.1 — function-body-only impl upgrade for PUSDManager.
 *
 *         Deploys a fresh PUSDManager implementation (with the rewritten
 *         depositToPlus body) and prints the calldata to upgrade the proxy.
 *         On testnet today, admin EOA submits directly. On mainnet (once a
 *         TimelockController is rotated in), the multisig schedules through
 *         the 48h timelock.
 *
 *         Storage layout is unchanged below `__gap_v2`. `forge inspect
 *         storage-layout` against the v2 impl must produce a byte-identical
 *         diff for slots 0..23 (everything before the gap).
 *
 *         Run:
 *           forge script DeployPUSDV21 --rpc-url $DONUT_RPC --broadcast --verify
 *
 *         Then submit the printed calldata via the multisig timelock.
 */
contract DeployPUSDV21 is Script {
    address constant MANAGER_PROXY = 0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46;

    function run() external returns (address newImpl) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        PUSDManager impl = new PUSDManager();
        newImpl = address(impl);

        vm.stopBroadcast();

        console.log("");
        console.log("=== PUSDManager v2.1 impl deployed ===");
        console.log("Impl address:   ", newImpl);
        console.log("Manager proxy:  ", MANAGER_PROXY);
        console.log("");
        console.log("Submit this calldata to PUSDManager proxy:");
        console.log("  testnet today: admin EOA cast send (no timelock yet)");
        console.log("  mainnet target: multisig via 48h TimelockController");
        console.logBytes(abi.encodeWithSignature("upgradeToAndCall(address,bytes)", newImpl, bytes("")));
        console.log("");
        console.log("Verification reminder: forge inspect PUSDManager storage-layout - diff must be byte-identical");
        console.log("below __gap_v2 against the v2 impl currently active.");
    }
}
