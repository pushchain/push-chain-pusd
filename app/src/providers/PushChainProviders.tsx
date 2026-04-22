import {
    PushUI,
    PushUniversalWalletProvider,
} from "@pushchain/ui-kit";

/**
 * PushChainProviders Component
 * 
 * This component wraps your entire application with Push Chain's Universal Wallet Provider.
 * It configures the wallet connection options, network settings, and app metadata.
 * 
 * Configuration Guide:
 * - network: Choose between MAINNET, TESTNET, or DEV
 * - login: Configure authentication methods (email, google, wallet)
 * - modal: Customize the UI appearance and behavior
 * - chainConfig: Add your custom RPC endpoints
 * - appMetadata: Brand your app with logo, title, and description
 */

const PushChainProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <PushUniversalWalletProvider
      config={{
        network: PushUI.CONSTANTS.PUSH_NETWORK.TESTNET,
        app: {
          title: "PUSD",
          description: "Universal stablecoin on Push Chain — mint and redeem PUSD from any chain.",
        },
        login: {
          email: true,
          google: true,
          wallet: true,
        },
      }}
      themeMode={PushUI.CONSTANTS.THEME.DARK}
      themeOverrides={{
        '--pw-core-brand-primary-color': '#4f8ef7',
        '--pw-core-bg-primary-color': '#0d0e14',
        '--pw-core-bg-secondary-color': '#13151f',
        '--pw-core-text-primary-color': '#f0f2ff',
        '--pw-core-modal-border-radius': '16px',
        '--pw-core-btn-border-radius': '10px',
      }}
    >
      {children}
    </PushUniversalWalletProvider>
  );
};

export { PushChainProviders };
