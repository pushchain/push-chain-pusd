import { PushUI, PushUniversalWalletProvider } from '@pushchain/ui-kit';
import type { ReactNode } from 'react';

/**
 * Wraps the tree in Push Universal Wallet Provider with Direction C theme overrides.
 *
 * Theme mode is LIGHT — Direction C's cream base reads as a light theme to the UI-kit.
 * All color, radius, and button styling bridge to the CSS variables defined in tokens.css
 * so that the Push modals feel native inside the brutalist editorial shell.
 */
const PushChainProviders = ({ children }: { children: ReactNode }) => {
  return (
    <PushUniversalWalletProvider
      config={{
        network: PushUI.CONSTANTS.PUSH_NETWORK.TESTNET,
        app: {
          title: 'PUSD',
          description: 'A par-backed universal stablecoin on Push Chain.',
        },
        login: {
          email: true,
          google: true,
          wallet: true,
        },
      }}
      themeMode={PushUI.CONSTANTS.THEME.LIGHT}
      themeOverrides={{
        '--pw-core-bg-primary-color': '#f3eee4',
        '--pw-core-bg-secondary-color': '#faf6ec',
        '--pw-core-text-primary-color': '#0f0d0a',
        '--pw-core-brand-primary-color': '#dd44b9',
        '--pw-core-btn-border-radius': '0',
        '--pw-core-modal-border-radius': '0',
        '--pwauth-btn-connect-bg-color': '#0f0d0a',
        '--pwauth-btn-connect-text-color': '#f3eee4',
        '--pwauth-btn-connect-border-radius': '0',
        '--pwauth-btn-connected-bg-color': '#faf6ec',
        '--pwauth-btn-connected-text-color': '#0f0d0a',
      }}
    >
      {children}
    </PushUniversalWalletProvider>
  );
};

export { PushChainProviders };
