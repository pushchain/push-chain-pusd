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
 *         Supported tokens (must mirror DeployBase.s.sol):
 *
 *           USDT.eth   (Ethereum_Sepolia)   0x0f97A213207703923F5f0C613C9827f7C9A0f96B
 *           USDC.eth   (Ethereum_Sepolia)   0x7A58048036206bB898008b5bBDA85697DB1e5d66
 *           USDT.sol   (Solana_Devnet)      0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34
 *           USDC.sol   (Solana_Devnet)      0x04B8F634ABC7C879763F623e0f0550a4b5c4426F
 *           USDT.base  (Base_Testnet)       0x148823809B853e1db187BC09A9ac909BC42F971a
 *           USDC.base  (Base_Testnet)       0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1
 *           USDT.arb   (Arbitrum_Sepolia)   0xFE6E9DF2BbC9ce05D98b83B1365df6DcA9951891
 *           USDC.arb   (Arbitrum_Sepolia)   0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C
 *           USDT.bsc   (BNB_Testnet)        0x731aF1Da5365259d27528557EE4aFBA4baC90ef2
 *           USDC.bsc   (BNB_Testnet)        0x120EBf25Dad7D6a09Ad2316f23f9Be95DBb90639
 *
 *         VAULT_PROXY is read from env (PUSD_PLUS_VAULT_ADDRESS) so this script
 *         works against fresh redeploys without source edits.
 *
 *         Run with:
 *           forge script PopulateVaultBasket --rpc-url $DONUT_RPC --broadcast
 */
contract PopulateVaultBasket is Script {
    function run() external {
        address vaultProxy = vm.envAddress("PUSD_PLUS_VAULT_ADDRESS");

        address[10] memory tokens = [
            0x0f97A213207703923F5f0C613C9827f7C9A0f96B, // USDT.eth
            0x7A58048036206bB898008b5bBDA85697DB1e5d66, // USDC.eth
            0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34, // USDT.sol
            0x04B8F634ABC7C879763F623e0f0550a4b5c4426F, // USDC.sol
            0x148823809B853e1db187BC09A9ac909BC42F971a, // USDT.base
            0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1, // USDC.base
            0xFE6E9DF2BbC9ce05D98b83B1365df6DcA9951891, // USDT.arb
            0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C, // USDC.arb
            0x731aF1Da5365259d27528557EE4aFBA4baC90ef2, // USDT.bsc
            0x120EBf25Dad7D6a09Ad2316f23f9Be95DBb90639 // USDC.bsc
        ];

        PUSDPlusVault vault = PUSDPlusVault(vaultProxy);

        // Caller must hold POOL_ADMIN_ROLE on the vault.
        uint256 poolAdminKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(poolAdminKey);

        uint256 added = 0;
        uint256 alreadyPresent = 0;
        for (uint256 i = 0; i < 10; i++) {
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
