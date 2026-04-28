// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "../../src/interfaces/IUniswapV3Factory.sol";
import "./MockUniV3Pool.sol";

contract MockUniV3Factory is IUniswapV3Factory {
    mapping(address => mapping(address => mapping(uint24 => address))) public pools;

    function getPool(address a, address b, uint24 fee) external view override returns (address) {
        if (a > b) (a, b) = (b, a);
        return pools[a][b][fee];
    }

    function createPool(address a, address b, uint24 fee) external override returns (address pool) {
        if (a > b) (a, b) = (b, a);
        pool = address(new MockUniV3Pool(a, b, fee));
        pools[a][b][fee] = pool;
    }
}
