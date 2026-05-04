// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

/// @title  IPUSDPlusVault
/// @notice Narrow interface PUSDManager v2 uses to call into PUSDPlusVault.
///         Restricted to the two functions the manager actually invokes — keeping
///         the interface small lets PUSDManager be reasoned about without pulling
///         in the full vault surface.
interface IPUSDPlusVault {
    /// @notice Mint PUSD+ at current NAV. PUSD must already be on the vault.
    function mintPlus(uint256 pusdIn, address recipient) external returns (uint256 plusOut);

    /// @notice Burn PUSD+ from `from`, hand pusdOwed PUSD to `pusdRecipient` if
    ///         the vault can fulfil instantly, else enqueue. Caller is responsible
    ///         for routing the returned PUSD to the user (or noticing the queueId).
    function burnPlus(
        uint256 plusIn,
        address from,
        address pusdRecipient,
        address preferredAsset,
        bool    allowBasket
    ) external returns (uint256 pusdReturned, uint256 queueId);
}
