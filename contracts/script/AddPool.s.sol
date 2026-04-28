// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Script.sol";

import "../src/PUSDLiquidity.sol";

/**
 * @title  AddPool
 * @notice Registers a previously-created pool with `PUSDLiquidity`. The contract validates
 *         provenance (factory.getPool == pool) and stable-stable membership (Manager-side).
 *
 *         Required env:
 *           PRIVATE_KEY        admin/multisig key (must hold ADMIN_ROLE on Liquidity)
 *           PUSD_LIQUIDITY     deployed Liquidity proxy
 *           POOL_ADDRESS       pool to register (output of CreatePool.s.sol)
 */
contract AddPool is Script {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        PUSDLiquidity liq = PUSDLiquidity(vm.envAddress("PUSD_LIQUIDITY"));
        address pool = vm.envAddress("POOL_ADDRESS");

        vm.startBroadcast(key);
        liq.addPool(pool);
        vm.stopBroadcast();

        (bool registered, bool active, address t0, address t1, uint24 fee) =
            liq.poolInfo(pool);
        require(registered && active, "AddPool: not active after add");
        console.log("Registered pool:", pool);
        console.log("  token0:", t0);
        console.log("  token1:", t1);
        console.log("  fee:", fee);
    }
}
