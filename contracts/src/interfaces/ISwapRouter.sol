// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.22;

/**
 * @title  ISwapRouter
 * @notice Vendored subset of Uniswap V3 periphery `ISwapRouter` covering the single-hop and
 *         path-encoded multi-hop entrypoints used by `PUSDLiquidity`.
 * @dev    https://github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/ISwapRouter.sol
 *         Path encoding for multi-hop:
 *           abi.encodePacked(tokenIn, fee01, tokenMid1, fee12, tokenMid2, ..., tokenOut)
 *         Each token is 20 bytes, each fee is 3 bytes.
 */
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);

    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /// @notice Multi-hop exact-input swap. The path is a packed sequence
    ///         `(tokenIn, fee, midToken, fee, ..., tokenOut)`.
    function exactInput(ExactInputParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
