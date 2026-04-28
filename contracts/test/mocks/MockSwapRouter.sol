// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../src/interfaces/ISwapRouter.sol";

/// @notice 1:1 stable swap with a configurable bps haircut. Pre-funded with both legs.
/// @dev    Both `exactInputSingle` and `exactInput` (multi-hop) are supported. The router must be
///         pre-funded with the destination tokens — production V3 routers route through pools, the
///         mock just holds inventory and pays out at parity minus a haircut.
contract MockSwapRouter is ISwapRouter {
    using SafeERC20 for IERC20;

    uint256 public swapHaircutBps; // basis points removed from output (per-route, not per-hop)

    /// @notice Last decoded path call captured for assertions.
    bytes public lastPath;

    function setSwapHaircutBps(uint256 bps) external {
        require(bps <= 10000, "MockRouter: too high");
        swapHaircutBps = bps;
    }

    function exactInputSingle(ExactInputSingleParams calldata p)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        IERC20(p.tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);
        amountOut = p.amountIn - (p.amountIn * swapHaircutBps) / 10000;
        require(amountOut >= p.amountOutMinimum, "MockRouter: slippage");
        IERC20(p.tokenOut).safeTransfer(p.recipient, amountOut);
    }

    function exactInput(ExactInputParams calldata p)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        require(p.path.length >= 43, "MockRouter: path too short"); // 20+3+20
        require((p.path.length - 20) % 23 == 0, "MockRouter: path malformed");

        lastPath = p.path;

        address tokenIn  = _firstToken(p.path);
        address tokenOut = _lastToken(p.path);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);

        // Single haircut at the route level — sufficient for asserting plumbing.
        amountOut = p.amountIn - (p.amountIn * swapHaircutBps) / 10000;
        require(amountOut >= p.amountOutMinimum, "MockRouter: slippage");
        IERC20(tokenOut).safeTransfer(p.recipient, amountOut);
    }

    function _firstToken(bytes memory path) internal pure returns (address out) {
        assembly { out := shr(96, mload(add(path, 32))) }
    }

    function _lastToken(bytes memory path) internal pure returns (address) {
        uint256 len = path.length;
        uint256 word;
        assembly { word := mload(add(path, len)) }
        return address(uint160(word));
    }
}
