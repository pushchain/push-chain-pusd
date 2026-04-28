// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Script.sol";

import "../src/PUSDLiquidity.sol";
import "../src/PUSDManager.sol";

/**
 * @title  OpenInitialPosition
 * @notice Push capital from `Manager.yieldShareReserve` into `PUSDLiquidity` and open the first
 *         concentrated stable-stable position on the chosen pool.
 *
 *         Required env:
 *           PRIVATE_KEY            REBALANCER private key
 *           PUSD_LIQUIDITY         deployed PUSDLiquidity proxy
 *           PUSD_MANAGER           deployed PUSDManager proxy
 *           POOL                   target pool (must already be `addPool`-registered + active)
 *           TOKEN_A, TOKEN_B       reserve tokens that match POOL.token0/token1 (any order)
 *           AMOUNT_A, AMOUNT_B     amounts of TOKEN_A/TOKEN_B to deploy (raw units)
 *
 *         Optional:
 *           TICK_LOWER             default -50  (≈ −0.5% from parity)
 *           TICK_UPPER             default  50
 *           MIN_A                  default 0
 *           MIN_B                  default 0
 *           DEADLINE_SECONDS       default 300
 */
contract OpenInitialPosition is Script {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        PUSDLiquidity liq = PUSDLiquidity(vm.envAddress("PUSD_LIQUIDITY"));
        PUSDManager   m   = PUSDManager(vm.envAddress("PUSD_MANAGER"));
        address pool      = vm.envAddress("POOL");
        address tA        = vm.envAddress("TOKEN_A");
        address tB        = vm.envAddress("TOKEN_B");
        uint256 amtA      = vm.envUint("AMOUNT_A");
        uint256 amtB      = vm.envUint("AMOUNT_B");

        int24 tl    = int24(vm.envOr("TICK_LOWER", int256(-50)));
        int24 tu    = int24(vm.envOr("TICK_UPPER", int256(50)));
        uint256 minA = vm.envOr("MIN_A", uint256(0));
        uint256 minB = vm.envOr("MIN_B", uint256(0));
        uint256 dt   = vm.envOr("DEADLINE_SECONDS", uint256(300));

        // The pool's canonical token0/token1 ordering may flip TOKEN_A/TOKEN_B; align here.
        (, , address t0, address t1, ) = liq.poolInfo(pool);
        bool aIs0 = (tA == t0);
        require(aIs0 || tA == t1, "OpenInitialPosition: TOKEN_A mismatch");
        require(t0 == tA || t1 == tA, "OpenInitialPosition: tokens mismatch");
        require(t0 == tB || t1 == tB, "OpenInitialPosition: tokens mismatch");

        uint256 amount0 = aIs0 ? amtA : amtB;
        uint256 amount1 = aIs0 ? amtB : amtA;
        uint256 min0    = aIs0 ? minA : minB;
        uint256 min1    = aIs0 ? minB : minA;

        vm.startBroadcast(key);

        // 1. Push capital from Manager.yieldShareReserve into Liquidity.
        m.transferYieldToLiquidity(t0, amount0);
        m.transferYieldToLiquidity(t1, amount1);
        console.log("Pushed token0 -> Liquidity:", amount0);
        console.log("Pushed token1 -> Liquidity:", amount1);

        // 2. Open the position.
        uint256 tokenId = liq.mintPosition(
            pool, tl, tu, amount0, amount1, min0, min1, block.timestamp + dt
        );
        console.log("Position opened. tokenId:", tokenId);

        vm.stopBroadcast();
    }
}
