// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "../../src/interfaces/IUniswapV3Pool.sol";

/// @notice Bare-bones pool for unit tests. Returns a fixed sqrtPriceX96 corresponding to tick 0 (1:1 parity).
contract MockUniV3Pool is IUniswapV3Pool {
    address public override token0;
    address public override token1;
    uint24  public override fee;
    int24   public override tickSpacing = 1;
    uint128 public override liquidity;

    /// 2^96 = 79228162514264337593543950336 = sqrt(1) << 96 → tick 0.
    uint160 public sqrtPriceX96Override = 79228162514264337593543950336;

    constructor(address _t0, address _t1, uint24 _fee) {
        token0 = _t0;
        token1 = _t1;
        fee    = _fee;
    }

    function setSqrtPriceX96(uint160 v) external { sqrtPriceX96Override = v; }
    function setLiquidity(uint128 l) external { liquidity = l; }

    function slot0() external view override returns (
        uint160, int24, uint16, uint16, uint16, uint8, bool
    ) {
        return (sqrtPriceX96Override, 0, 0, 0, 0, 0, true);
    }

    function initialize(uint160 v) external override { sqrtPriceX96Override = v; }
}
