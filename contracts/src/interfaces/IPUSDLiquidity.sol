// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IPUSDLiquidity
 * @notice Minimal interface used by PUSDManager and PUSDPlus to interact with the LP engine.
 * @dev    Fuller surface (admin, lifecycle) lives on the concrete `PUSDLiquidity` contract.
 */
interface IPUSDLiquidity {
    /// @notice PUSD-equivalent NAV of all idle balances + open Uniswap V3 positions + uncollected fees.
    function netAssetsInPUSD() external view returns (uint256);

    /// @notice Idle (non-deployed) balance of `token` held by the liquidity engine.
    function idleBalance(address token) external view returns (uint256);

    /// @notice Pull `amount` of `token` from the liquidity engine to `recipient`.
    /// @dev    Only callable by `VAULT_ROLE` (PUSDPlus). Unwinds positions, then routes a swap
    ///         (1- or 2-hop) over the active pool registry if idle + unwind is still short.
    /// @return delivered Amount actually transferred to recipient.
    function pullForWithdraw(address token, uint256 amount, address recipient)
        external
        returns (uint256 delivered);

    /// @notice Push `amount` of `token` from PUSDPlus into the liquidity engine for later deployment.
    /// @dev    Only callable by `VAULT_ROLE`. The token must already have been transferred to this contract.
    function pushForDeploy(address token, uint256 amount) external;

    // ---------------------------------------------------------------------
    //  Pool registry (multi-pool, multi-asset stable LP engine)
    // ---------------------------------------------------------------------

    /// @notice True if `pool` is registered AND active (accepting new positions).
    function isPoolActive(address pool) external view returns (bool);

    /// @notice Number of registered pools (active + deactivated). Iterate with `poolAt`.
    function poolsLength() external view returns (uint256);

    /// @notice Returns the pool address at index `i` of the enumerable registry.
    function poolAt(uint256 i) external view returns (address);
}
