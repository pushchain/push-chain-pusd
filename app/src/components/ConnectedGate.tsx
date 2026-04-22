/**
 * ConnectedGate — empty state that shows when a surface needs a wallet.
 *
 * Opens the Push wallet modal via `handleConnectToPushWallet()`. Used by
 * `/history` and by the action buttons on `/mint` / `/redeem` when there
 * is no connected account.
 */

import { PushUI, usePushWalletContext } from '@pushchain/ui-kit';
import type { ReactNode } from 'react';

type ConnectedGateProps = {
  title?: string;
  subtitle?: string;
  glyph?: string;
  children?: ReactNode;
};

export function ConnectedGate({
  title = 'CONNECT TO CONTINUE',
  subtitle = 'This surface needs a connected universal account.',
  glyph = '◌',
  children,
}: ConnectedGateProps) {
  const { connectionStatus, handleConnectToPushWallet } = usePushWalletContext();
  const connecting = connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.CONNECTING;

  return (
    <div className="empty">
      <div className="empty__glyph" aria-hidden="true">{glyph}</div>
      <div className="empty__title">{title}</div>
      <div className="empty__sub">{subtitle}</div>
      <button
        type="button"
        className="btn btn--primary"
        onClick={handleConnectToPushWallet}
        disabled={connecting}
      >
        {connecting ? 'CONNECTING…' : 'CONNECT WALLET →'}
      </button>
      {children}
    </div>
  );
}

/**
 * Helper: returns `true` when a universal account is connected.
 */
export function useIsConnected(): boolean {
  const { connectionStatus } = usePushWalletContext();
  return connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.CONNECTED;
}
