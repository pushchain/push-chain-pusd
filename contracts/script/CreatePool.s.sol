// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Script.sol";

import "../src/interfaces/IUniswapV3Factory.sol";
import "../src/interfaces/IUniswapV3Pool.sol";

/**
 * @title  CreatePool
 * @notice Generic helper that creates and initialises a Uniswap V3 stable-stable pool on Push
 *         Chain Donut. Idempotent: skips creation/initialisation if the pool already exists or
 *         has been initialised.
 *
 *         Required env:
 *           PRIVATE_KEY      deployer key
 *           UNIV3_FACTORY    Uniswap V3 factory on Donut
 *           TOKEN_A          first token address
 *           TOKEN_B          second token address
 *           POOL_FEE         fee tier in 1e6 units (100 = 0.01%, 500 = 0.05%, …)
 *
 *         Both tokens MUST be Manager-supported stables; this script does NOT validate that —
 *         see `AddPool.s.sol` for the registry-side guard.
 *
 *         Initial sqrtPriceX96 = 2^96 (tick 0). For 1:1 stables this is correct only when both
 *         tokens have identical decimals. Push Chain's 9 cross-chain stables are all 6-dec, so
 *         this holds for the launch set; if you need to spin up a 6-vs-18 dec pair, override with
 *         INIT_SQRT_PRICE.
 */
contract CreatePool is Script {
    /// 2^96 = sqrt(1) << 96 — corresponds to a 1:1 price (tick 0).
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function run() external {
        uint256 deployerKey  = vm.envUint("PRIVATE_KEY");
        address factoryAddr  = vm.envAddress("UNIV3_FACTORY");
        address a            = vm.envAddress("TOKEN_A");
        address b            = vm.envAddress("TOKEN_B");
        uint24  fee          = uint24(vm.envUint("POOL_FEE"));
        uint160 initSqrtP    = uint160(vm.envOr("INIT_SQRT_PRICE", uint256(SQRT_PRICE_1_1)));

        require(a != address(0) && b != address(0) && a != b, "CreatePool: bad tokens");

        IUniswapV3Factory factory = IUniswapV3Factory(factoryAddr);

        vm.startBroadcast(deployerKey);

        address existing = factory.getPool(a, b, fee);
        address pool;
        if (existing == address(0)) {
            pool = factory.createPool(a, b, fee);
            console.log("Created pool:", pool);
        } else {
            pool = existing;
            console.log("Pool already exists:", pool);
        }

        try IUniswapV3Pool(pool).slot0() returns (uint160 sqrtP, int24, uint16, uint16, uint16, uint8, bool) {
            if (sqrtP == 0) {
                IUniswapV3Pool(pool).initialize(initSqrtP);
                console.log("Pool initialised at sqrtPriceX96:", initSqrtP);
            } else {
                console.log("Pool already initialised; sqrtPriceX96:", sqrtP);
            }
        } catch {
            IUniswapV3Pool(pool).initialize(initSqrtP);
            console.log("Pool initialised at sqrtPriceX96:", initSqrtP);
        }

        vm.stopBroadcast();

        console.log("\nNext step: pass to AddPool.s.sol via env POOL_ADDRESS:", pool);
    }
}
