// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IPUSDManager
 * @notice External surface PUSDPlus uses against the v2 PUSDManager.
 * @dev    Only the vault-path entrypoints + relevant views are surfaced here; the
 *         full admin/user-facing surface lives on the concrete contract.
 */
interface IPUSDManager {
    /// @notice Mint PUSD against `amount` of `token`, recording it in the yield slice.
    /// @dev    Only callable by `VAULT_ROLE` (PUSDPlus). PUSDPlus is the recipient.
    /// @return pusdMinted PUSD minted to `recipient` (after `vaultHaircutBps`).
    function mintForVault(address token, uint256 amount, address recipient)
        external
        returns (uint256 pusdMinted);

    /// @notice Burn `pusdAmount` and deliver `preferredAsset` to `recipient` from the yield slice.
    /// @dev    Only callable by `VAULT_ROLE` (PUSDPlus). Pulls from PUSDLiquidity if idle slice is short.
    /// @return tokenOut Net amount of `preferredAsset` transferred to `recipient`.
    function redeemForVault(uint256 pusdAmount, address preferredAsset, address recipient)
        external
        returns (uint256 tokenOut);

    /// @notice Address of the deployed PUSD ERC-20 token.
    function pusd() external view returns (address);

    /// @notice Yield slice balance for `token` (PUSD+ backing).
    function yieldShareReserve(address token) external view returns (uint256);

    /// @notice Plain slice balance for `token` (plain PUSD backing).
    function parReserve(address token) external view returns (uint256);

    /// @notice Whether the contract is hard-paused (mint and redeem reverted on both paths).
    function paused() external view returns (bool);

    // ---------------------------------------------------------------------
    //  Supported-token enumeration (used by PUSDLiquidity for NAV iteration
    //  and stable-stable pool validation).
    // ---------------------------------------------------------------------

    /// @notice Number of supported reserve tokens (some may be REMOVED — see `tokenList`).
    function tokenCount() external view returns (uint256);

    /// @notice Address at index `i` of the enumerable supported-token registry.
    function tokenList(uint256 i) external view returns (address);

    /// @notice Decimal count for `token` (validated stable, 6\u201318). Returns 0 if unsupported.
    function decimalsOf(address token) external view returns (uint8);

    /// @notice True iff `token` is registered AND its status is ENABLED, REDEEM_ONLY, or
    ///         EMERGENCY_REDEEM (i.e. accepted as collateral somewhere in the protocol).
    function isSupportedStable(address token) external view returns (bool);
}
