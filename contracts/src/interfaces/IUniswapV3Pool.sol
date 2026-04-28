// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.22;

/**
 * @title  IUniswapV3Pool
 * @notice Vendored subset of Uniswap V3 core `IUniswapV3Pool` (read-only state we depend on).
 */
interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function liquidity() external view returns (uint128);

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function initialize(uint160 sqrtPriceX96) external;
}
