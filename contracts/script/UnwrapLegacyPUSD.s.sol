// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Script.sol";
import "../src/PUSDPlusVault.sol";
import "../src/PUSDManager.sol";

/**
 * @title  UnwrapLegacyPUSD
 * @notice Convert PUSD that the vault accumulated from pre-v2.1 `depositToPlus`
 *         calls into actual reserve tokens. Drains `vault.balanceOf(pusd)` via
 *         the existing keeper-only `vault.redeemPusdForToken(pusdIn, token)`
 *         path (vault is fee-exempt — free conversion).
 *
 *         Two modes:
 *           - **Single-target** (env: TARGET_TOKEN): convert all legacy PUSD
 *             into one specific reserve token. Useful when the keeper wants
 *             inventory of a particular token for an upcoming `openPool`.
 *           - **Proportional** (TARGET_TOKEN unset): split legacy PUSD across
 *             every basket token proportional to that token's current vault
 *             balance. If basket is empty of all reserves, falls back to
 *             single-target on basket[0]. Keeps inventory ratios stable.
 *
 *         This is a one-shot migration aid for the v2.1 upgrade. After v2.1
 *         activates, new deposits don't add PUSD to the vault, so this script
 *         only needs to run **once** post-upgrade. After that, the keeper's
 *         normal `redeemPusdForToken` cadence handles any incidental PUSD
 *         accumulation (e.g. from queue claim cleanup).
 *
 *         Caller must hold `KEEPER_ROLE` on the vault.
 *
 *         Run:
 *           # all legacy PUSD → USDC.eth
 *           TARGET_TOKEN=0x7A58048036206bB898008b5bBDA85697DB1e5d66 \
 *             forge script UnwrapLegacyPUSD --rpc-url $DONUT_RPC --broadcast
 *
 *           # split proportional to vault basket balances
 *           forge script UnwrapLegacyPUSD --rpc-url $DONUT_RPC --broadcast
 */
contract UnwrapLegacyPUSD is Script {
    address constant VAULT_PROXY = 0xb55a5B36d82D3B7f18Afe42F390De565080A49a1;
    address constant PUSD_PROXY = 0x488d080e16386379561a47A4955D22001d8A9D89;

    function run() external {
        PUSDPlusVault vault = PUSDPlusVault(VAULT_PROXY);
        IERC20Like pusd = IERC20Like(PUSD_PROXY);

        uint256 legacyPusd = pusd.balanceOf(VAULT_PROXY);
        console.log("");
        console.log("=== UnwrapLegacyPUSD ===");
        console.log("  Vault legacy PUSD:", legacyPusd);

        if (legacyPusd == 0) {
            console.log("  Nothing to unwrap. Done.");
            return;
        }

        uint256 keeperKey = vm.envUint("PRIVATE_KEY");

        // Mode selection — TARGET_TOKEN env var if set, else proportional.
        address targetToken = vm.envOr("TARGET_TOKEN", address(0));

        vm.startBroadcast(keeperKey);

        if (targetToken != address(0)) {
            console.log("  Mode: single-target");
            console.log("  Target:", targetToken);
            require(vault.inBasket(targetToken), "Target token not in vault basket");
            uint256 outDelta = vault.redeemPusdForToken(legacyPusd, targetToken);
            console.log("  Converted:", legacyPusd, "PUSD ->", outDelta);
        } else {
            console.log("  Mode: proportional across vault basket");
            _proportionalUnwrap(vault, legacyPusd);
        }

        vm.stopBroadcast();

        console.log("  Vault PUSD remaining:", pusd.balanceOf(VAULT_PROXY));
        console.log("  Done.");
    }

    function _proportionalUnwrap(PUSDPlusVault vault, uint256 totalPusd) internal {
        uint256 n = vault.basketLength();
        require(n > 0, "Empty basket - nothing to split into");

        // Compute total non-PUSD basket balance to derive shares.
        uint256 totalBasketBal;
        for (uint256 i = 0; i < n; i++) {
            address t = vault.basket(i);
            if (t == PUSD_PROXY) continue;
            totalBasketBal += IERC20Like(t).balanceOf(VAULT_PROXY);
        }

        if (totalBasketBal == 0) {
            // Bootstrap case — pick basket[0] (skipping PUSD if it's basket[0]).
            address fallbackToken = vault.basket(0);
            if (fallbackToken == PUSD_PROXY && n > 1) fallbackToken = vault.basket(1);
            console.log("  Basket empty of reserves; defaulting to:", fallbackToken);
            vault.redeemPusdForToken(totalPusd, fallbackToken);
            return;
        }

        // Iterate basket, allocate proportionally. Track remaining to handle
        // the rounding remainder on the last token.
        uint256 raised;
        for (uint256 i = 0; i < n; i++) {
            address t = vault.basket(i);
            if (t == PUSD_PROXY) continue;
            uint256 bal = IERC20Like(t).balanceOf(VAULT_PROXY);
            if (bal == 0) continue;

            uint256 share = (totalPusd * bal) / totalBasketBal;
            // On the last contributing token, sweep the rounding remainder.
            if (i == n - 1 || raised + share > totalPusd) {
                share = totalPusd - raised;
            }
            if (share == 0) continue;

            console.log("  share -> token:");
            console.log("    token:", t);
            console.log("    pusd: ", share);
            vault.redeemPusdForToken(share, t);
            raised += share;
            if (raised >= totalPusd) break;
        }
    }
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
}
