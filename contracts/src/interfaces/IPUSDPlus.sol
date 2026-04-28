// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IPUSDPlus
 * @notice External surface for the PUSD+ ERC-4626 vault.
 * @dev    Implementations also satisfy `IERC4626` (deposit/mint/withdraw/redeem) through inheritance.
 */
interface IPUSDPlus {
    /// @notice Deposit `amount` of stablecoin `token` (one of the Manager's supported tokens),
    ///         mint PUSD via Manager.mintForVault, and credit `receiver` with the resulting shares.
    function depositStable(address token, uint256 amount, address receiver)
        external
        returns (uint256 shares);

    /// @notice Burn `shares` from `msg.sender`, redeem the underlying PUSD via Manager.redeemForVault,
    ///         and deliver `preferredAsset` to `receiver`.
    function redeemToStable(uint256 shares, address preferredAsset, address receiver)
        external
        returns (uint256 tokenOut);

    /// @notice Address of the linked Liquidity engine (used for NAV and capital deploy / unwind).
    function pusdLiquidity() external view returns (address);

    /// @notice Address of the linked Manager.
    function pusdManager() external view returns (address);
}
