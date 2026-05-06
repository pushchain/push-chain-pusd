// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Script.sol";
import "../src/PUSDPlusVault.sol";

/**
 * @title  PopulateVaultBasket
 * @notice v2.1 prerequisite — ensure every manager-supported reserve token is
 *         present in `vault.basket[]` so v2.1's direct-deposit path counts
 *         forwarded reserves toward NAV.
 *
 *         `vault.addBasketToken` is `POOL_ADMIN_ROLE`-only and idempotent
 *         (no-ops if already present). Run this script BEFORE the v2.1
 *         PUSDManager impl swap activates.
 *
 *         Deployment 4 supported tokens (must mirror DeployBase.s.sol):
 *
 *           USDT.eth   (Ethereum_Sepolia)   0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3
 *           USDC.eth   (Ethereum_Sepolia)   0x7A58048036206bB898008b5bBDA85697DB1e5d66
 *           USDT.sol   (Solana_Devnet)      0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34
 *           USDC.sol   (Solana_Devnet)      0x04B8F634ABC7C879763F623e0f0550a4b5c4426F
 *           USDT.base  (Base_Testnet)       0x2C455189D2af6643B924A981a9080CcC63d5a567
 *           USDC.base  (Base_Testnet)       0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1
 *           USDT.arb   (Arbitrum_Sepolia)   0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9
 *           USDC.arb   (Arbitrum_Sepolia)   0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C
 *           USDT.bnb   (BNB_Testnet)        0x2f98B4235FD2BA0173a2B056D722879360B12E7b
 *
 *         Run with:
 *           forge script PopulateVaultBasket --rpc-url $DONUT_RPC --broadcast
 */
contract PopulateVaultBasket is Script {
    address constant VAULT_PROXY = 0xb55a5B36d82D3B7f18Afe42F390De565080A49a1;

    function run() external {
        address[9] memory tokens = [
            0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3, // USDT.eth
            0x7A58048036206bB898008b5bBDA85697DB1e5d66, // USDC.eth
            0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34, // USDT.sol
            0x04B8F634ABC7C879763F623e0f0550a4b5c4426F, // USDC.sol
            0x2C455189D2af6643B924A981a9080CcC63d5a567, // USDT.base
            0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1, // USDC.base
            0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9, // USDT.arb
            0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C, // USDC.arb
            0x2f98B4235FD2BA0173a2B056D722879360B12E7b // USDT.bnb
        ];

        PUSDPlusVault vault = PUSDPlusVault(VAULT_PROXY);

        // Caller must hold POOL_ADMIN_ROLE on the vault.
        uint256 poolAdminKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(poolAdminKey);

        uint256 added = 0;
        uint256 alreadyPresent = 0;
        for (uint256 i = 0; i < 9; i++) {
            if (vault.inBasket(tokens[i])) {
                alreadyPresent++;
            } else {
                vault.addBasketToken(tokens[i]);
                added++;
            }
        }

        vm.stopBroadcast();

        console.log("PopulateVaultBasket complete");
        console.log("  Added:           ", added);
        console.log("  Already present: ", alreadyPresent);
        console.log("  basketLength now:", vault.basketLength());
    }
}
