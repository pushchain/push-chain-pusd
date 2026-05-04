// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

interface IInsuranceFund {
    /// @notice Deposit a haircut payment into the fund. Caller must have transferred
    ///         the tokens to this contract beforehand. The fund is a passive
    ///         destination — it does not pull on its own.
    function notifyDeposit(address token, uint256 amount) external;

    /// @notice Total balance of `token` held by the fund.
    function balanceOf(address token) external view returns (uint256);
}
