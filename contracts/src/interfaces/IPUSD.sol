// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title  IPUSD
/// @notice Minimal interface to the deployed PUSD ERC-20. Mirrors the live contract
///         (src/PUSD.sol) — 6-decimal, mint/burn role-gated to PUSDManager.
interface IPUSD is IERC20 {
    function decimals() external view returns (uint8);

    function mint(address to, uint256 amount) external;

    function burn(address from, uint256 amount) external;
}
