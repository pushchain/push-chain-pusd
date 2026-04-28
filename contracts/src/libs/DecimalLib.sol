// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title DecimalLib
 * @notice Decimal normalisation helpers between an external token's decimals and PUSD's 6-decimal canonical form.
 * @dev    Pure library, identical semantics to v1 inline helpers (carried forward unchanged).
 */
library DecimalLib {
    uint8 internal constant PUSD_DECIMALS = 6;

    /// @notice Convert `amount` (in `tokenDecimals`) into PUSD's 6-decimal form, rounding down.
    function toPUSD(uint256 amount, uint8 tokenDecimals) internal pure returns (uint256) {
        if (tokenDecimals == PUSD_DECIMALS) {
            return amount;
        } else if (tokenDecimals > PUSD_DECIMALS) {
            return amount / (10 ** (tokenDecimals - PUSD_DECIMALS));
        } else {
            return amount * (10 ** (PUSD_DECIMALS - tokenDecimals));
        }
    }

    /// @notice Convert `pusdAmount` (in PUSD's 6-decimal form) into `tokenDecimals`, rounding down.
    function fromPUSD(uint256 pusdAmount, uint8 tokenDecimals) internal pure returns (uint256) {
        if (tokenDecimals == PUSD_DECIMALS) {
            return pusdAmount;
        } else if (tokenDecimals > PUSD_DECIMALS) {
            return pusdAmount * (10 ** (tokenDecimals - PUSD_DECIMALS));
        } else {
            return pusdAmount / (10 ** (PUSD_DECIMALS - tokenDecimals));
        }
    }
}
