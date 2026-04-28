// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.22;

/**
 * @title  IUniswapV3Factory
 * @notice Vendored subset of Uniswap V3 core `IUniswapV3Factory`.
 */
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
}
