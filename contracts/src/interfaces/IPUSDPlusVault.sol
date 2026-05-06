// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

/// @title  IPUSDPlusVault
/// @notice Narrow interface PUSDManager v2 / v2.1 uses to call into PUSDPlusVault.
///         Restricted to the functions the manager actually invokes — keeping the
///         interface small lets PUSDManager be reasoned about without pulling in
///         the full vault surface.
interface IPUSDPlusVault {
    /// @notice Mint PUSD+ at current NAV. PUSD-equivalent value (or basket
    ///         equivalent under v2.1) must already be on the vault.
    function mintPlus(uint256 pusdIn, address recipient) external returns (uint256 plusOut);

    /// @notice Burn PUSD+ from `from`, hand pusdOwed PUSD to `pusdRecipient` if
    ///         the vault can fulfil instantly, else enqueue. Caller is responsible
    ///         for routing the returned PUSD to the user (or noticing the queueId).
    function burnPlus(uint256 plusIn, address from, address pusdRecipient, address preferredAsset, bool allowBasket)
        external
        returns (uint256 pusdReturned, uint256 queueId);

    /// @notice v2.1: read whether `token` is in the vault's LP basket. PUSDManager
    ///         uses this to surface a clear revert when a direct deposit would
    ///         otherwise strand reserves outside NAV-counted basket. Public
    ///         mapping auto-getter.
    function inBasket(address token) external view returns (bool);
}
