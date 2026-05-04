// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

/// @title  IPUSDManager
/// @notice Narrow interface PUSDPlusVault uses to call into PUSDManager. Mirrors
///         only the methods the vault depends on; the full contract surface is
///         in src/PUSDManager.sol.
interface IPUSDManager {
    function deposit(address token, uint256 amount, address recipient) external;

    function redeem(
        uint256 pusdAmount,
        address preferredAsset,
        bool    allowBasket,
        address recipient
    ) external;

    /// @notice Vault-only path: skips reentrancy lock + surplus haircut.
    function depositForVault(address token, uint256 amount) external returns (uint256 pusdMinted);

    function plusVault() external view returns (address);
    function feeExempt(address account) external view returns (bool);
}
